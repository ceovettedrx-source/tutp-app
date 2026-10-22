// Explain illustrations, made in the background and cached by concept_key
// (docs/specs/answer-explain-v2.md section D). The answer and the explanation
// never wait on this:
//
//   request(conceptKey, scenePrompt)  starts the work if nobody has (fire and forget)
//   status(conceptKey)                -> { status: 'pending'|'ready'|'fallback', url? }
//
// One row per concept_key in `illustrations` (unique), shared by every
// question and family. The picture is a file in the PRIVATE bucket
// "illustrations"; `status` hands out a short-lived signed URL
// (server/lib/signed-url.js), never a public one.
//
// 'fallback' means: draw the SVG template. It is what a parent gets when the
// provider is missing (no key), IMAGE_GEN_ENABLED is off, the daily cap is
// reached or the provider failed. Config reasons write NO row, so a key that
// is added later works at once; a failed attempt writes a 'fallback' row that
// is tried again after an hour. Each fallback is logged (usage_events
// "illustration.fallback", reason only). Unit tests: tests/unit/illustration-service.test.js.
import { signedUrl, uploadPrivate } from '../lib/signed-url.js';
import { getProvider, imageGenEnabled, dailyCap, withSuffix } from './image-provider.js';
import { checkPicture } from './picture-check.js';

export const BUCKET = 'illustrations';
const PENDING_STALE_MS = 3 * 60 * 1000;
const FAILED_RETRY_MS = 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function startOfIstDayUtc(now = Date.now()) {
  const ist = now + IST_OFFSET_MS;
  return new Date(ist - (ist % 86400000) - IST_OFFSET_MS).toISOString();
}

export function createIllustrationService({
  supabase, env: baseEnv = process.env, now = Date.now, getProviderFn = getProvider, logEvent = () => {}, onBillingFail = () => {}, checkFn = checkPicture,
}) {
  const objectPath = (key) => `${key}.png`;

  async function row(key) {
    const { data, error } = await supabase.from('illustrations').select('*').eq('concept_key', key).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // Why generation cannot happen right now, or null when it can.
  async function blockedReason(provider, env) {
    if (!imageGenEnabled(env)) return 'flag_off';
    if (!provider) return 'no_key';
    const cap = dailyCap(env);
    const { count, error } = await supabase.from('illustrations').select('id', { count: 'exact', head: true })
      .eq('provider', provider.name).gte('created_at', startOfIstDayUtc(now()));
    if (error) throw error;
    return (count || 0) >= cap ? 'cap_hit' : null;
  }

  const fallback = (reason, key) => {
    console.log('illustration: fallback', { concept_key: key, reason });
    try { logEvent('illustration.fallback', { concept_key: key, reason }); } catch { /* logging never fails a request */ }
    return { status: 'fallback', reason };
  };

  // TUT-73: one structured line per real generation, so cost per image is countable from logs.
  const logGenerated = (key, provider, feature) => {
    console.log(JSON.stringify({ severity: 'INFO', event: 'image_generated', model: provider.model, concept_key: key, feature }));
  };

  // TUT-73: a provider refusal (402 payment, 429 limit, any non-2xx) is loud: one WARNING
  // line, one usage_events row, and the founder alert check. Never the key or the body.
  const reportBillingFail = (key, status, feature) => {
    console.warn(JSON.stringify({ severity: 'WARNING', event: 'image_billing_fail', status, concept_key: key, feature }));
    try { logEvent('image_billing_fail', { status, concept_key: key, feature }); } catch { /* logging never fails a request */ }
    try { Promise.resolve(onBillingFail()).catch(() => {}); } catch { /* the alert never fails a request */ }
  };

  // A picture is checked once, when it is made: a vision model says whether it shows what the scene
  // says. No: made again once; still no: no picture (a 'fallback' row with reason 'vision_mismatch',
  // never retried). The verdict is stored in the row's `reason` ('vision_ok' on a ready picture), so
  // a picture is never checked twice. A check that could not run keeps the picture, unmarked.
  // The mock provider (e2e) is not checked: it draws a fixed square.
  async function generate(key, scenePrompt, provider, feature = 'unknown') {
    try {
      const check = provider.name !== 'mock';
      let made = null, verdict = null;
      for (let attempt = 1; attempt <= (check ? 2 : 1); attempt++) {
        const out = await provider.generate(withSuffix(scenePrompt));
        const v = check ? await checkFn({ buffer: out.buffer, contentType: out.contentType, scene: scenePrompt }) : null;
        if (v) {
          console.log('illustration: checked', { concept_key: key, attempt, match: v.match, reason: v.reason, usd: v.usd });
          try { logEvent('illustration.checked', { concept_key: key, attempt, match: v.match, reason: v.reason, usd: v.usd }); } catch { /* logging never fails a request */ }
        }
        if (!v || v.match !== false) { made = out; verdict = v && v.match === true ? 'vision_ok' : null; break; }
      }
      if (!made) {
        await supabase.from('illustrations').update({ status: 'fallback', reason: 'vision_mismatch' }).eq('concept_key', key);
        fallback('vision_mismatch', key);
        return;
      }
      const { buffer, contentType } = made;
      const ok = await uploadPrivate(supabase, BUCKET, objectPath(key), buffer, contentType || 'image/png');
      if (!ok) throw new Error('upload failed');
      await supabase.from('illustrations').update({ status: 'ready', storage_path: objectPath(key), reason: verdict }).eq('concept_key', key);
      logGenerated(key, provider, feature);
    } catch (err) {
      if (err && Number.isInteger(err.status) && provider.name === 'gemini') reportBillingFail(key, err.status, feature);
      console.error('illustration: generation failed', { concept_key: key, error: err && err.message });
      await supabase.from('illustrations').update({ status: 'fallback', reason: 'error' }).eq('concept_key', key).then(() => {}, () => {});
      fallback('error', key);
    }
  }

  // opts.env: the environment for this request (the e2e mock provider, server/e2e-overrides.js).
  async function request(key, scenePrompt, opts = {}) {
    const env = opts.env || baseEnv;
    try {
      const existing = await row(key);
      const t = now();
      if (existing) {
        const age = t - new Date(existing.created_at).getTime();
        if (existing.status === 'ready') return { status: 'ready' };
        if (existing.status === 'pending' && age < PENDING_STALE_MS) return { status: 'pending' };
        if (existing.status === 'fallback' && existing.reason === 'vision_mismatch') return { status: 'fallback', reason: 'vision_mismatch' };   // checked twice: never again
        if (existing.status === 'fallback' && age < FAILED_RETRY_MS) return { status: 'fallback', reason: existing.reason || 'error' };
      }
      const provider = getProviderFn(env);
      const blocked = await blockedReason(provider, env);
      if (blocked) return fallback(blocked, key);
      if (existing) {
        // Take over a stale or failed row; only one caller wins the update.
        const { data, error } = await supabase.from('illustrations')
          .update({ status: 'pending', provider: provider.name, model: provider.model, created_at: new Date(t).toISOString(), reason: null })
          .eq('concept_key', key).eq('status', existing.status).eq('created_at', existing.created_at).select('id');
        if (error || !data || !data.length) return { status: 'pending' };
      } else {
        const { error } = await supabase.from('illustrations').insert({ concept_key: key, status: 'pending', provider: provider.name, model: provider.model });
        if (error) {
          if (error.code === '23505') return { status: 'pending' };   // another request claimed it first
          throw error;
        }
      }
      generate(key, scenePrompt, provider, opts.feature || 'unknown'); // not awaited: the answer never waits
      return { status: 'pending' };
    } catch (err) {
      console.error('illustration: request error', err && err.message);
      return fallback('error', key);
    }
  }

  async function status(key, opts = {}) {
    const env = opts.env || baseEnv;
    try {
      const r = await row(key);
      if (!r) {
        const blocked = await blockedReason(getProviderFn(env), env);
        return blocked ? { status: 'fallback', reason: blocked } : { status: 'fallback', reason: 'not_requested' };
      }
      if (r.status === 'ready') {
        const url = await signedUrl(supabase, BUCKET, r.storage_path || objectPath(key), 300);
        return url ? { status: 'ready', url } : { status: 'fallback', reason: 'sign_failed' };
      }
      if (r.status === 'pending') {
        return now() - new Date(r.created_at).getTime() < PENDING_STALE_MS ? { status: 'pending' } : { status: 'fallback', reason: 'stale' };
      }
      return { status: 'fallback', reason: r.reason || 'error' };
    } catch (err) {
      console.error('illustration: status error', err && err.message);
      return { status: 'fallback', reason: 'error' };
    }
  }

  return { request, status };
}
