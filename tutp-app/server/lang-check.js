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

// TUT-18: Hindi written in Latin letters ("Agar ek jagah ... mein"), which is neither the
// parent's language nor the page's. Two different romanized-Hindi words in one text is
// enough; ordinary English never contains them.
export const ROMANIZED_HINDI_HINT = 'Your previous reply mixed in Hindi written in English letters (for example "mein", "hai", "agar"). Write every string in one language only: the language asked for, in its own script. Never write Hindi, Telugu or any Indian language in Latin letters.';
const ROMAN_HI = new Set(['agar', 'mein', 'hai', 'hain', 'kya', 'aur', 'nahi', 'nahin', 'jaisa', 'kaise', 'kyun', 'kyunki', 'bhi', 'wala', 'wali', 'aaj', 'jagah', 'paani', 'hawa', 'garmi', 'sardi', 'hoga', 'hogi', 'karo', 'karna', 'kiya', 'liye', 'saath', 'sabse', 'zyada', 'yeh', 'woh', 'iska', 'uska', 'lekin']);

export function romanizedHindi(text) {
  const hits = new Set();
  for (const w of String(text || '').toLowerCase().match(/[a-z]+/g) || []) if (ROMAN_HI.has(w)) hits.add(w);
  return hits.size >= 2;
}

export function romanizedHindiIn(value, depth = 0) {
  if (depth > 6 || value == null) return false;
  if (typeof value === 'string') return romanizedHindi(value);
  if (Array.isArray(value)) return value.some((v) => romanizedHindiIn(v, depth + 1));
  if (typeof value === 'object') return Object.values(value).some((v) => romanizedHindiIn(v, depth + 1));
  return false;
}

// The script each explain-in language is written in. The check above only says a letter is
// from SOME Indian script; this says it is from THIS language's script, so an English or Telugu
// card holding Hindi labels or a Hindi check question is caught (2026-10-14: English cards with
// Devanagari labels were stored under "English" and served again).
const SCRIPT_OF_LANGUAGE = {
  English: 'latin', Spanish: 'latin', French: 'latin', German: 'latin',
  Hindi: 'devanagari', Marathi: 'devanagari', Telugu: 'telugu', Tamil: 'tamil', Arabic: 'arabic',
};
const LETTER_SCRIPTS = [
  ['latin', /\p{Script=Latin}/u], ['devanagari', /\p{Script=Devanagari}/u], ['telugu', /\p{Script=Telugu}/u],
  ['tamil', /\p{Script=Tamil}/u], ['arabic', /\p{Script=Arabic}/u], ['kannada', /\p{Script=Kannada}/u],
  ['malayalam', /\p{Script=Malayalam}/u], ['bengali', /\p{Script=Bengali}/u], ['gujarati', /\p{Script=Gujarati}/u],
  ['gurmukhi', /\p{Script=Gurmukhi}/u], ['oriya', /\p{Script=Oriya}/u],
];
// A native-script language needs this share of its letters in its own script (the rest may be
// Latin key terms in brackets); a Telugu request answered with an all-English card is a mismatch too.
const NATIVE_SHARE = 0.3;

// Letters per script in every string inside `value`. Greek letters (pi, theta) and other
// symbols are left out: they are maths notation, not a language.
function letterCounts(value, counts = {}, depth = 0) {
  if (depth > 6 || value == null) return counts;
  if (typeof value === 'string') {
    for (const ch of value) {
      if (!/\p{L}/u.test(ch)) continue;
      const hit = LETTER_SCRIPTS.find(([, re]) => re.test(ch));
      if (hit) counts[hit[0]] = (counts[hit[0]] || 0) + 1;
      else if (!/\p{Script=Greek}/u.test(ch)) counts.other = (counts.other || 0) + 1;
    }
  } else if (Array.isArray(value)) value.forEach((v) => letterCounts(v, counts, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach((v) => letterCounts(v, counts, depth + 1));
  return counts;
}

// '' when `value` is written in `language`'s script (or nothing can be compared), else the
// script found that does not belong ('devanagari', 'latin' for too little native text, ...).
export function scriptMismatch(language, value) {
  const want = SCRIPT_OF_LANGUAGE[language];
  if (!want) return '';
  const c = letterCounts(value);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (!total) return '';
  const foreign = Object.keys(c).find((s) => s !== 'latin' && s !== want && c[s] > 0);
  if (foreign) return foreign;
  if (want !== 'latin' && (c[want] || 0) / total < NATIVE_SHARE) return 'latin';
  return '';
}

// The sentence for the retry when scriptMismatch() found something.
export const scriptMismatchHint = (language) => `Your previous reply was not in ${language}. Rewrite EVERY string the parent or child reads (title, quick, full, tip, traps, misconception, parent questions, the check question and its options, the feedback and the picture labels) in ${language} only, in its own script. Even if the homework question is in another language, write the check question and the labels in ${language}.`;

const NOT_VISIBLE = new Set(['concept_key', 'scene_prompt', 'model', 'prompt_version', 'correct_index', 'position', 'source', 'checked', 'schema']);

// The words a card shows: every string field of a stored explain payload except the English
// slugs and the picture prompt, which are never displayed.
export function visibleText(payload, depth = 0) {
  if (depth > 6 || payload == null) return [];
  if (typeof payload === 'string') return [payload];
  if (Array.isArray(payload)) return payload.flatMap((v) => visibleText(v, depth + 1));
  if (typeof payload === 'object') return Object.entries(payload).flatMap(([k, v]) => (NOT_VISIBLE.has(k) ? [] : visibleText(v, depth + 1)));
  return [];
}

// May a stored card be served for a request in `language`? One check for every cached field.
export const cardMatchesLanguage = (language, payload) => !scriptMismatch(language, visibleText(payload));

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
