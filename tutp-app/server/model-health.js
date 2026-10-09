// Daily production model-health check (TUT-11), called by Cloud Scheduler on
// POST /api/cron/model-health (X-Cron-Token header, like the other crons).
//   1. one tiny Anthropic call (cheapest model, max_tokens <= 5)
//   2. one tiny Gemini text call on the key the image path uses (cheapest text
//      model, max 5 output tokens, text only: no image generation)
//   3. the last 24 hours' error rate of model calls, from usage_events
// The founder is emailed only when a call fails or the error rate is above 10%.
// Nothing here ever prints a key, a prompt or a raw upstream body.
import { callClaude } from './anthropic.js';

export const HEALTH_MAX_TOKENS = 5;
export const ANTHROPIC_HEALTH_MODEL = 'claude-haiku-4-5';
export const GEMINI_HEALTH_MODEL = 'gemini-2.5-flash-lite';
export const ERROR_RATE_LIMIT = 0.10;
export const MIN_CALLS_FOR_RATE = 5;   // a rate over a handful of calls is noise

export function anthropicHealthBody() {
  return { model: ANTHROPIC_HEALTH_MODEL, max_tokens: HEALTH_MAX_TOKENS, messages: [{ role: 'user', content: 'ping' }] };
}

export function geminiHealthRequest(key, model = process.env.GEMINI_HEALTH_MODEL || GEMINI_HEALTH_MODEL) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: HEALTH_MAX_TOKENS, responseModalities: ['TEXT'] },
      }),
    },
  };
}

async function checkAnthropic(call) {
  try {
    const r = await call({ feature: 'model_health', body: anthropicHealthBody(), alert: false });
    return r.ok ? { ok: true } : { ok: false, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: 'request_failed' };
  }
}

async function checkGemini(fetchImpl, key) {
  if (!key) return { ok: true, skipped: 'no_key_configured' };
  try {
    const { url, init } = geminiHealthRequest(key);
    const r = await fetchImpl(url, init);
    return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: 'request_failed' };
  }
}

// Error rate of the last 24 hours of live model calls (replayed rows never count).
export async function recentErrorRate(supabase, now = Date.now()) {
  if (!supabase) return { calls: 0, errors: 0, rate: null, skipped: 'no_database' };
  try {
    const since = new Date(now - 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabase.from('usage_events').select('properties')
      .eq('event_name', 'model.call').gte('created_at', since).limit(5000);
    if (error) throw error;
    const live = (data || []).map((r) => r.properties || {}).filter((p) => !p.replay);
    const errors = live.filter((p) => p.ok === false).length;
    return { calls: live.length, errors, rate: live.length ? errors / live.length : null };
  } catch {
    return { calls: 0, errors: 0, rate: null, skipped: 'query_failed' };
  }
}

export function healthEmail(status) {
  const lines = [];
  if (!status.anthropic.ok) lines.push(`Anthropic test call FAILED (HTTP ${status.anthropic.status}).`);
  if (!status.gemini.ok) lines.push(`Gemini test call FAILED (HTTP ${status.gemini.status}).`);
  const e = status.errors;
  if (e.rate != null && e.calls >= MIN_CALLS_FOR_RATE && e.rate > ERROR_RATE_LIMIT) {
    lines.push(`Model call error rate in the last 24 hours: ${(e.rate * 100).toFixed(1)}% (${e.errors} of ${e.calls}).`);
  }
  return {
    subject: 'Tut-P: daily model health check FAILED',
    text: lines.join('\n') + '\n\nThis is the daily check (POST /api/cron/model-health). Look at the Anthropic balance first, then the Gemini key.',
  };
}

// The Express handler: 401 without the cron token, else the check. `authorized(req)`
// and `run()` are passed in so the route can be tested without a server.
export function modelHealthHandler({ authorized, run }) {
  return async (req, res) => {
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const status = await run();
      res.status(status.ok ? 200 : 503).json(status);
    } catch (err) {
      console.error('Model health check error:', err && err.message);
      res.status(500).json({ ok: false, error: 'health check crashed' });
    }
  };
}

// deps: { call, fetchImpl, supabase, send, env, now } (all optional but call/fetchImpl default to the real ones)
export async function runModelHealth({ call = callClaude, fetchImpl = fetch, supabase = null, send = null, env = process.env, now = Date.now() } = {}) {
  const [anthropic, gemini, errors] = await Promise.all([
    checkAnthropic(call),
    checkGemini(fetchImpl, env.GEMINI_IMAGE_API_KEY),
    recentErrorRate(supabase, now),
  ]);
  const rateBad = errors.rate != null && errors.calls >= MIN_CALLS_FOR_RATE && errors.rate > ERROR_RATE_LIMIT;
  const ok = anthropic.ok && gemini.ok && !rateBad;
  const status = { ok, anthropic, gemini, errors: { calls: errors.calls, errors: errors.errors, rate: errors.rate }, emailed: false };
  if (!ok && send) {
    try {
      const { subject, text } = healthEmail(status);
      await send(env.FOUNDER_ALERT_EMAIL || 'ceo.vettedrx@gmail.com', subject, text);
      status.emailed = true;
    } catch (err) {
      console.error('model-health email failed:', err && err.message);
    }
  }
  return status;
}
