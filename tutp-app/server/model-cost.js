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

export function logModelCall({ feature, model, usage, familyId = null, studentId = null, ms = null, replay = false }) {
  const properties = {
    feature, model, replay,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    cache_read: usage?.cache_read_input_tokens ?? 0,
    cache_write: usage?.cache_creation_input_tokens ?? 0,
    usd: replay ? 0 : costUsd(model, usage),
    ms,
  };
  if (!supabase) return properties;
  supabase.from('usage_events').insert({ event_name: 'model.call', family_id: familyId, student_id: studentId, properties })
    .then(({ error }) => { if (error) console.error('model.call log failed:', error.message); }, () => {});
  return properties;
}
