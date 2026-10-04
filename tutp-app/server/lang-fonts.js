// The script of a piece of text -> the Noto Sans font that draws it. Used for
// the diagram labels (the answer's own language, not the explain-in language)
// and by the pages, which load only the font of the script on screen.
// Unit tests: tests/unit/lang-fonts.test.js.

const SCRIPTS = [
  { script: 'telugu', re: /[ఀ-౿]/, font: 'Noto Sans Telugu' },
  { script: 'devanagari', re: /[ऀ-ॿ]/, font: 'Noto Sans Devanagari' },
  { script: 'tamil', re: /[஀-௿]/, font: 'Noto Sans Tamil' },
  { script: 'kannada', re: /[ಀ-೿]/, font: 'Noto Sans Kannada' },
  { script: 'malayalam', re: /[ഀ-ൿ]/, font: 'Noto Sans Malayalam' },
  { script: 'arabic', re: /[؀-ۿ]/, font: 'Noto Sans Arabic' },
];

// The script with the most letters in `text` ('latin' when there are none).
export function scriptOf(text) {
  const s = String(text || '');
  let best = 'latin', bestN = 0;
  for (const { script, re } of SCRIPTS) {
    const n = (s.match(new RegExp(re.source, 'g')) || []).length;
    if (n > bestN) { best = script; bestN = n; }
  }
  return best;
}

export function fontFor(script) {
  const hit = SCRIPTS.find((s) => s.script === script);
  return hit ? hit.font : null;
}

export function fontStack(script) {
  const f = fontFor(script);
  return f ? `'${f}', 'Plus Jakarta Sans', sans-serif` : "'Plus Jakarta Sans', 'Noto Sans', sans-serif";
}
