// The blocking safety gate for home experiments (pass 1 of 2; pass 2 is a
// Claude check in scripts/el/safety.mjs). Deterministic, so it also runs when
// the server loads a lesson file: an experiment that fails here is never
// served, whatever the file says.
//
// Rules (founder brief 2026-10-05): no flame, no mains electricity, kitchen
// items only, no sharp tools, hot water only as a step the adult does.

// Items an experiment may list. The first eight are the founder's list; the
// rest are harmless household objects the experiments need (a bowl to hold
// water, a rubber band, a fridge magnet). Nothing here can cut, burn or shock.
export const ITEM_WHITELIST = [
  'vinegar', 'lemon', 'baking soda', 'salt', 'turmeric', 'soap', 'water', 'ice',
  'paper', 'cardboard', 'newspaper', 'tissue', 'cloth', 'cotton', 'sock', 'towel',
  'plastic bottle', 'cup', 'glass', 'bowl', 'plate', 'tray', 'spoon', 'steel spoon', 'wooden spoon', 'plastic spoon', 'jar', 'bucket',
  'coin', 'rubber band', 'string', 'thread', 'pencil', 'ruler', 'paper clip', 'fridge magnet', 'magnet', 'marble', 'toy car', 'ball', 'book', 'small stone', 'cork',
  'rice', 'sand', 'pulses', 'dal', 'tea leaves', 'flour', 'cooking oil', 'oil', 'sugar', 'pepper', 'iron nail', 'steel bowl', 'sieve', 'tea strainer', 'cloth strainer',
  'sunlight', 'window', 'wall', 'torch-free', 'table', 'floor', 'plastic sheet', 'sponge', 'potato', 'apple', 'grapes', 'egg', 'balloon', 'straw', 'coloured pencil',
];

// A word that fails the experiment whatever the sentence says.
export const FORBIDDEN = [
  'flame', 'fire', 'match', 'matches', 'matchbox', 'lighter', 'candle', 'burn', 'burner', 'gas', 'stove', 'cooker', 'microwave', 'oven', 'heater', 'gas stove', 'spirit lamp',
  'mains', 'socket', 'plug', 'switch board', 'switchboard', 'wall outlet', 'extension', 'ac supply', 'power supply', '220', '230 v', 'adapter', 'charger',
  'knife', 'blade', 'scissors', 'cutter', 'razor', 'needle', 'pin', 'sharp', 'saw', 'axe', 'nail cutter', 'compass point',
  'acid from', 'bleach', 'phenol', 'kerosene', 'petrol', 'spirit', 'alcohol', 'sanitizer', 'sanitiser', 'detergent powder', 'drain cleaner', 'toilet cleaner', 'medicine', 'tablet',
];

// "hot water", "boiling", "boil", "kettle", "steam": allowed only in a step
// the lesson lists in adultSteps (the adult does this step).
export const ADULT_ONLY = ['hot water', 'boiling', 'boil', 'boiled', 'kettle', 'steam', 'warm water'];

const has = (text, word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);

// { ok, reasons[] } for one experiment ({ title, items, steps, adultSteps, note }).
export function checkExperiment(x) {
  const reasons = [];
  if (!x) return { ok: true, reasons };
  const adult = new Set(x.adultSteps || []);
  const everything = [x.title, x.note, ...(x.items || [])].filter(Boolean);
  const all = [...everything, ...(x.steps || [])];
  for (const t of all) for (const w of FORBIDDEN) if (has(t, w)) reasons.push(`forbidden word "${w}" in: ${t.slice(0, 80)}`);
  for (const t of everything) for (const w of ADULT_ONLY) if (has(t, w)) reasons.push(`"${w}" outside an adult step: ${t.slice(0, 80)}`);
  (x.steps || []).forEach((t, i) => {
    for (const w of ADULT_ONLY) {
      if (has(t, w) && !adult.has(i)) reasons.push(`"${w}" in step ${i + 1} which the adult does not own`);
      if (has(t, w) && adult.has(i) && !/\badult\b|\bparent\b|\bmother\b|\bfather\b/i.test(t)) reasons.push(`step ${i + 1} is an adult step but does not say so`);
    }
  });
  for (const it of x.items || []) {
    const name = it.toLowerCase().replace(/^\s*(a|an|some|one|two|three|\d+)\s+/, '').replace(/\(.*?\)/g, '').trim();
    const known = ITEM_WHITELIST.some((w) => name === w || name.includes(w) || w.includes(name));
    if (!known) reasons.push(`item not on the whitelist: "${it}"`);
  }
  return { ok: reasons.length === 0, reasons };
}
