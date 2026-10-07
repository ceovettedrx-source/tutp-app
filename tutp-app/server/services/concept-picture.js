// One picture per concept, for every surface that explains a concept to a
// child (docs/specs/img1.md section D). A thin layer over illustration-service.js
// (the cache, the private bucket, the daily cap) that adds:
//
//   - signed picture requests: Explain, Notes, Story, Answer cards and the
//     Experiential Learning lessons put `picture: { concept_key, scene_prompt, sig }`
//     in their replies, and the page hands it back to POST /api/illustration/request.
//     The signature covers key and scene, so a page can only ask for the picture
//     the server itself described (nobody can spend image money on a prompt of
//     their own).
//   - the free tier: a free family sees ONE generated picture per day in full;
//     every further concept's picture comes back as a tiny blurred preview
//     (server/lib/png-thumb.js, 24 pixels, never the real file) with the upsell.
//     A concept the family already saw in full today stays in full. Paid
//     families always get the picture. Each full showing is one
//     `picture_shown` row in usage_events (family, concept_key).
//
//   request({ familyId, studentId, key, scene, env })   starts generation if nobody has
//   status({ familyId, studentId, key, paid, env })     -> { status, url? } | { status:'ready', blurred:true, thumb, upsell }
// Unit tests: tests/unit/concept-picture.test.js.
import crypto from 'crypto';
import { BUCKET, startOfIstDayUtc } from './illustration-service.js';
import { downloadPrivate } from '../lib/signed-url.js';
import { pngThumb } from '../lib/png-thumb.js';
import { normalizeConceptKey, cleanScenePrompt } from '../explain-schema.js';

export const FREE_PICTURES_PER_DAY = 1;
export const PICTURE_UPSELL = {
  label: 'See every picture in Pro',
  text: 'Free families see one new picture a day. Pro shows a picture with every explanation, note and story.',
};
const SHOWN_EVENT = 'picture_shown';
const THUMB_CACHE_MAX = 300;

const secretOf = (secret) => secret || process.env.SESSION_SECRET || 'dev';

export function signPicture(key, scene, secret) {
  return crypto.createHmac('sha256', secretOf(secret)).update('pic:' + key + '|' + scene).digest('hex').slice(0, 16);
}
export function verifyPicture(key, scene, sig, secret) {
  if (typeof sig !== 'string') return false;
  const want = signPicture(key, scene, secret);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

// What a route puts in its reply for a concept: { concept_key, scene_prompt, sig },
// or null when the key or the scene is unusable (the surface then shows no picture).
export function pictureFor(rawKey, rawScene, secret) {
  const concept_key = normalizeConceptKey(rawKey);
  const scene_prompt = cleanScenePrompt(rawScene);
  if (!concept_key || !scene_prompt) return null;
  return { concept_key, scene_prompt, sig: signPicture(concept_key, scene_prompt, secret) };
}

export function createConceptPictures({ supabase, illus, now = Date.now, download = downloadPrivate, thumbOf = pngThumb }) {
  const chains = new Map();         // familyId -> promise tail: one decision at a time per family
  const thumbs = new Map();         // concept_key -> data URL of the blurred preview (or '' when none can be made)

  const serial = (familyId, fn) => {
    const tail = chains.get(familyId) || Promise.resolve();
    const run = tail.then(fn, fn);
    chains.set(familyId, run.catch(() => {}));
    return run;
  };

  async function thumbFor(key) {
    if (thumbs.has(key)) return thumbs.get(key);
    let url = '';
    try {
      const file = await download(supabase, BUCKET, `${key}.png`);
      const t = file ? thumbOf(file, 24) : null;
      if (t) url = 'data:image/png;base64,' + t.toString('base64');
    } catch { /* a plain card is shown */ }
    thumbs.set(key, url);
    while (thumbs.size > THUMB_CACHE_MAX) thumbs.delete(thumbs.keys().next().value);
    return url;
  }

  // Full picture for this family now? Records the showing when it is the day's free one.
  async function freeMayShow(familyId, studentId, key, run) {
    const { data, error } = await supabase.from('usage_events').select('properties')
      .eq('event_name', SHOWN_EVENT).eq('family_id', familyId).gte('created_at', startOfIstDayUtc(now()));
    if (error) throw error;
    const today = (data || []).filter((r) => ((r.properties && r.properties.run) || '') === run);
    const seen = new Set(today.map((r) => r.properties && r.properties.concept_key));
    if (seen.has(key)) return true;
    if (seen.size >= FREE_PICTURES_PER_DAY) return false;
    const { error: insErr } = await supabase.from('usage_events')
      .insert({ event_name: SHOWN_EVENT, family_id: familyId, student_id: studentId || null, properties: { concept_key: key, ...(run ? { run } : {}) } });
    if (insErr) throw insErr;
    return true;
  }

  return {
    request: ({ key, scene, env }) => illus.request(key, scene, { env }),

    // opts.run: the e2e key suffix (each test run counts its own pictures); '' in production.
    async status({ familyId, studentId, key, paid, env, run = '' }) {
      const base = await illus.status(key, { env });
      if (base.status !== 'ready' || paid) return base;
      try {
        const full = await serial(familyId, () => freeMayShow(familyId, studentId, key, run));
        if (full) return base;
      } catch (err) {
        console.error('concept-picture: free quota check failed, showing the blurred card', err && err.message);
      }
      return { status: 'ready', blurred: true, thumb: await thumbFor(key), upsell: PICTURE_UPSELL };
    },
  };
}
