// Explain cache key (TUT-19, docs/specs/tut-19-explain-cache-pictures-notes.md).
// One row per (exact question, class band, language). The old key was the
// concept only, so two different sums of one concept shared an explanation.
//
//   questionKey(text, band) -> 'q2:' + 40 hex   (language is a separate column)
//   classBand(cls)          -> '1-5' | '6-8' | '9-12' | 'x'   ('x' = unknown)
//
// normalizeQuestion keeps every digit, operator and the place of the blank;
// it only removes differences that cannot change the question (spaces, case,
// "Q2." numbering, x / × / *, ÷ and /, dash variants, the different blank marks).
// The text hashed is the extractor's text sent by the page, never a model reply.
// Unit tests: tests/unit/question-key.test.js.
import crypto from 'crypto';

export const KEY_VERSION = 'q2:';

export function normalizeQuestion(text) {
  let s = String(text == null ? '' : text).normalize('NFKC').toLowerCase();
  s = s.replace(/^\s*(?:q(?:uestion)?\s*)?\d+\s*(?:\)\s*|[.:]\s+)/i, '');        // "2)", "Q2. ", "1: " (not "3.5")
  s = s.replace(/(?<=[\d_\s)])\s*[x*]\s*(?=[\d_\s(])/g, '×');                      // x and * between operands
  s = s.replace(/(?<=[\d_)\s])\s*\/\s*(?=[\d_(\s])/g, (m) => (/\s/.test(m) ? '÷' : '/'));   // "8 / 2" is a division, "3/4" stays a fraction
  s = s.replace(/[−–—]/g, '-');
  s = s.replace(/_{2,}|\?|□|\[\s*\]|\(\s*\)|…|\.{3,}/g, '_');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*([+\-×÷=])\s*/g, '$1');                                          // spacing around operators is not meaning
  return s;
}

export function classBand(cls) {
  const m = String(cls == null ? '' : cls).match(/\d{1,2}/);
  const n = m ? Number(m[0]) : 0;
  if (n >= 1 && n <= 5) return '1-5';
  if (n >= 6 && n <= 8) return '6-8';
  if (n >= 9 && n <= 12) return '9-12';
  return 'x';
}

export function questionKey(text, band) {
  const b = ['1-5', '6-8', '9-12'].includes(band) ? band : 'x';
  return KEY_VERSION + crypto.createHash('sha256').update(normalizeQuestion(text) + '|' + b).digest('hex').slice(0, 40);
}
