// Script sanity for model text (docs/specs/img1.md section C, Telugu quality pass).
// The model sometimes lets a letter of a wrong script slip into a word (a Georgian
// letter inside a Telugu word was seen in recorded Telugu notes). No Indian-language
// page or answer can ever hold such a letter, so it is a hard check: the reply is
// asked for once more, with the hint below.
//
//   foreignScript(text)         the first letter in a script no page of ours uses, or ''
//   foreignScriptIn(value)      the same over every string inside any value (object, array, string)
//   FOREIGN_SCRIPT_HINT         the sentence for the retry
// Allowed: Latin and the Indian scripts (Telugu, Devanagari, Tamil, Kannada, Malayalam, Bengali,
// Gujarati, Gurmukhi, Odia) plus Arabic (Urdu), and every symbol, digit and punctuation mark.
// Unit tests: tests/unit/lang-check.test.js.

const ALLOWED = /^[\p{Script=Latin}\p{Script=Telugu}\p{Script=Devanagari}\p{Script=Tamil}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Oriya}\p{Script=Arabic}\p{Script=Common}\p{Script=Inherited}]$/u;

export const FOREIGN_SCRIPT_HINT = 'Your previous reply contained a letter from a wrong script inside a word (not the language asked for). Rewrite every string using only the correct language\'s own script, plus Latin letters where a term is in brackets.';

export function foreignScript(text) {
  for (const ch of String(text || '')) {
    if (/\p{L}/u.test(ch) && !ALLOWED.test(ch)) return ch;
  }
  return '';
}

export function foreignScriptIn(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') return foreignScript(value);
  if (Array.isArray(value)) {
    for (const v of value) { const f = foreignScriptIn(v, depth + 1); if (f) return f; }
    return '';
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) { const f = foreignScriptIn(v, depth + 1); if (f) return f; }
  }
  return '';
}
