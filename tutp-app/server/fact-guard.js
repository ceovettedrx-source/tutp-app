// Known wrong statements the model has written (TUT-18, golden checks). A hit is a hard
// issue: the reply is asked for once more with the hint, and the golden set fails on it.
//   wrongFacts(value)   -> the list of rule ids that matched any string inside the value
//   factHint(ids)       -> the sentence for the retry
// Add a rule here whenever a founder check finds a wrong fact; each needs a test line in
// tests/unit/fact-guard.test.js.
export const FACT_RULES = [
  {
    id: 'cold-air-sinks-subtropical',
    // "cold air sinks at the subtropical high / around 30 degrees": the air there sinks because
    // it has risen at the equator, cooled and spread out, not because it is cold.
    test: (t) => /\bcold(er)?\s+air\b[^.]{0,60}\b(sinks?|sinking|descend\w*|falls?)\b[^.]{0,80}(subtropical|30\s*(°|degrees?|deg))/i.test(t)
      || /(subtropical|30\s*(°|degrees?))[^.]{0,80}\bcold(er)?\s+air\b[^.]{0,60}\b(sinks?|sinking|descend\w*)\b/i.test(t),
    hint: 'At the subtropical high (about 30 degrees) the air is sinking, descending air that has already risen at the equator and spread out; do not say cold air sinks there.',
  },
];

function strings(value, out, depth = 0) {
  if (depth > 6 || value == null) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach((v) => strings(v, out, depth + 1));
  return out;
}

export function wrongFacts(value) {
  const text = strings(value, []);
  return FACT_RULES.filter((r) => text.some((t) => r.test(t))).map((r) => r.id);
}

export function factHint(ids) {
  return FACT_RULES.filter((r) => ids.includes(r.id)).map((r) => r.hint).join(' ');
}
