// What each Anthropic call costs, from the reply's usage block. USD per
// 1M tokens (input / output); a cache write costs 1.25x input, a cache read
// 0.1x. An unknown model gives usd null (logged, never thrown).
export const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

export function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  const n = (k) => Number(usage[k]) || 0;
  const usd = (n('input_tokens') * p.input
    + n('cache_creation_input_tokens') * p.input * 1.25
    + n('cache_read_input_tokens') * p.input * 0.1
    + n('output_tokens') * p.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

// One usage_events row ("model.call") per model call, retries included.
// Fire and forget: logging never blocks or fails the request.
let supabase = null;
export function initModelCost(client) { supabase = client; }

// The two cache counts also go into their own usage_events columns
// (supabase/migrations/032_usage_events_cache_tokens.sql) once the migration has run and
// USAGE_CACHE_COLUMNS=1 is set on the service; until then they live in
// properties only, so an insert never names a column that does not exist yet.
// ok / status: the call's outcome, read by the daily model-health check.
export function logModelCall({ feature, model, usage, familyId = null, studentId = null, ms = null, replay = false, ok = true, status = null }, env = process.env) {
  const properties = {
    feature, model, replay, ok, status,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    cache_read: usage?.cache_read_input_tokens ?? 0,
    cache_write: usage?.cache_creation_input_tokens ?? 0,
    usd: replay ? 0 : costUsd(model, usage),
    ms,
  };
  if (!supabase) return properties;
  const row = { event_name: 'model.call', family_id: familyId, student_id: studentId, properties };
  if (env.USAGE_CACHE_COLUMNS === '1') {
    row.cache_creation_input_tokens = usage?.cache_creation_input_tokens ?? null;
    row.cache_read_input_tokens = usage?.cache_read_input_tokens ?? null;
  }
  supabase.from('usage_events').insert(row)
    .then(({ error }) => { if (error) console.error('model.call log failed:', error.message); }, () => {});
  return properties;
}
