// Anthropic prompt caching (TUT-10). A cacheable prompt is built as TWO system
// blocks: a STATIC one (the rules, schema and pedagogy, byte-identical for every
// call of the feature) and a DYNAMIC one (language, child, board, the parent's
// words, anything per request). The breakpoint goes on the last static block only,
// so the dynamic block never has to match.
//
//   promptParts(staticText, dynamicText) -> [ {type,text}, {type,text} ]  (no cache_control yet)
//   prepareSystem(model, system)         -> what to send as body.system:
//       - a string stays a string;
//       - two blocks whose static part is long enough for the model's cache floor
//         get cache_control on the static block;
//       - two blocks below the floor are joined into one string (nothing would be
//         cached there, and the prompt is plain text again).
//   systemText(system)                   -> the whole prompt as one string (tests, logs)
//
// Minimum cacheable prefix per model, from Anthropic's prompt caching docs
// (checked 2026-10-09): Sonnet 5 1,024 tokens; Haiku 4.5 4,096 tokens. Below the
// floor the API silently skips the cache, so skipping here costs nothing and
// only avoids a block layout that cannot help. An unknown model is never cached.
export const MIN_CACHE_TOKENS = {
  'claude-sonnet-5': 1024,
  'claude-sonnet-4-6': 1024,
  'claude-haiku-4-5': 4096,
};

// A cheap upper-bound-free estimate: English prompt text runs about 3.6
// characters per token (rules, JSON shapes). Used only to decide whether the
// static block is clearly above the floor.
export const CHARS_PER_TOKEN = 3.6;
export const estimateTokens = (text) => Math.ceil(String(text || '').length / CHARS_PER_TOKEN);

export function promptParts(staticText, dynamicText) {
  return [{ type: 'text', text: staticText }, { type: 'text', text: dynamicText }];
}

export const systemText = (system) =>
  Array.isArray(system) ? system.map((b) => b.text).join('\n\n') : String(system || '');

// Why a prompt is or is not cached: { cache: bool, reason }.
export function cacheDecision(model, system) {
  if (!Array.isArray(system) || system.length !== 2) return { cache: false, reason: 'not a split prompt' };
  const min = MIN_CACHE_TOKENS[model];
  if (!min) return { cache: false, reason: 'model without a known cache floor' };
  const est = estimateTokens(system[0].text);
  if (est < min) return { cache: false, reason: `static prefix about ${est} tokens, below the ${min} floor of ${model}` };
  return { cache: true, reason: `static prefix about ${est} tokens` };
}

export function prepareSystem(model, system) {
  if (!Array.isArray(system)) return system;
  if (cacheDecision(model, system).cache) {
    return [{ ...system[0], cache_control: { type: 'ephemeral' } }, { type: 'text', text: system[1].text }];
  }
  return systemText(system);
}
