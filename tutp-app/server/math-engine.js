// Math engine (TUT-19): every plain-arithmetic answer is recomputed in code
// before a child or parent sees it, and the "checked" mark comes only from here
// (never from the model).
//
//   parseQuestion(text)  -> { kind, op, a, b, blank, numbers[], answer, answerText } | null
//   verifyCard({ question, card })  -> { status: 'checked' | 'unchecked' | 'mismatch', ... }
//   asciiDigits(text), numbersIn(text)
//
// Reads: whole numbers, decimals (any places up to 6), simple fractions a/b, with
// + - × ÷ ; "a op b", "a op b =", "a op b = ?", one blank in an equation
// ("25 × __ = 100", "__ + 5 = 12"); whole-number compound sums and brackets go
// through arith-check.js. Digits of Devanagari, Bengali, Gurmukhi, Gujarati,
// Tamil, Telugu, Kannada, Malayalam and Arabic-Indic scripts are read too.
// Word problems are NOT parsed: they are "unchecked" (no mark, never a false one).
// Unit tests: tests/unit/math-engine.test.js.
import { solveArithmetic } from './arith-check.js';

const ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0660, 0x06f0];
export function asciiDigits(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/[٠-٩۰-۹०-९০-৯੦-੯૦-૯௦-௯౦-౯೦-೯൦-൯]/g, (ch) => {
    const c = ch.codePointAt(0);
    const z = ZEROS.find((zero) => c >= zero && c <= zero + 9);
    return String(c - z);
  });
}

// ---- exact rationals (n/d), small integers only
const LIMIT = 1e12;
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
function rat(n, d = 1) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  const r = { n: n / g, d: d / g };
  return Math.abs(r.n) > LIMIT || r.d > LIMIT ? null : r;
}
function ratOf(text) {
  const t = String(text).trim();
  let m = t.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (m) return rat(Number(m[1]), Number(m[2]));
  m = t.match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  const frac = m[3] || '';
  const n = Number(m[2] + frac) * (m[1] ? -1 : 1);
  return rat(n, 10 ** frac.length);
}
const OPS = {
  '+': (x, y) => rat(x.n * y.d + y.n * x.d, x.d * y.d),
  '-': (x, y) => rat(x.n * y.d - y.n * x.d, x.d * y.d),
  '*': (x, y) => rat(x.n * y.n, x.d * y.d),
  '÷': (x, y) => (y.n === 0 ? null : rat(x.n * y.d, x.d * y.n)),
};
const same = (x, y) => !!x && !!y && x.n === y.n && x.d === y.d;
function ratText(r, decimals) {
  if (r.d === 1) return String(r.n);
  if (decimals) return String(Math.round((r.n / r.d) * 1e6) / 1e6);
  return `${r.n}/${r.d}`;
}

// What the question looks like after the usual cleaning (same marks as arith-check.js).
function clean(question) {
  return asciiDigits(question)
    .replace(/^\s*(?:q(?:uestion)?\s*)?\d+\s*(?:\)\s*|[.:]\s+)/i, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(?<=[\d_)\s])\s*[×xX*]\s*(?=[\d_(\s])/g, ' * ')
    .replace(/\s\/\s/g, ' ÷ ').replace(/÷/g, ' ÷ ')
    .replace(/[−–—]/g, '-')
    .replace(/_{2,}|\?|□|\[\s*\]|\(\s*\)|…|\.{3,}/g, ' _ ')
    .replace(/\s+/g, ' ').trim();
}

const NUM = String.raw`\d+(?:\.\d{1,6})?(?:\/\d+)?`;
const FORM_RESULT = new RegExp(`^(${NUM}) ?([+*÷-]) ?(${NUM})(?: ?= ?(_|${NUM})?)?$`);
const FORM_BLANK_R = new RegExp(`^(${NUM}) ?([+*÷-]) ?_ ?= ?(${NUM})$`);
const FORM_BLANK_L = new RegExp(`^_ ?([+*÷-]) ?(${NUM}) ?= ?(${NUM})$`);
const SHOW_OP = { '+': '+', '-': '-', '*': '×', '÷': '÷' };

export function parseQuestion(question) {
  if (typeof question !== 'string' || question.length > 160) return null;
  const s = clean(question);
  if (!s) return null;
  const hasDec = /\d\.\d/.test(s);
  let m = s.match(FORM_RESULT);
  if (m) {
    const [, as, op, bs, rs] = m;
    // "a op b = N": N is the child's written answer and is ignored.
    const a = ratOf(as), b = ratOf(bs);
    const ans = a && b ? OPS[op](a, b) : null;
    if (!ans) return null;
    return { kind: 'binary', op: SHOW_OP[op], a: as.replace(/\s+/g, ''), b: bs.replace(/\s+/g, ''), blank: null, numbers: [as, bs].map((x) => x.replace(/\s+/g, '')), answer: ans, answerText: ratText(ans, hasDec) };
  }
  m = s.match(FORM_BLANK_R);
  if (m) {                                   // a op _ = c
    const [, as, op, cs] = m;
    const a = ratOf(as), c = ratOf(cs);
    if (!a || !c) return null;
    const x = solveBlank(a, op, c, 'right');
    if (!x) return null;
    return { kind: 'blank', op: SHOW_OP[op], a: as.replace(/\s+/g, ''), b: null, c: cs.replace(/\s+/g, ''), blank: 'right', numbers: [as, cs].map((v) => v.replace(/\s+/g, '')), answer: x, answerText: ratText(x, hasDec) };
  }
  m = s.match(FORM_BLANK_L);
  if (m) {                                   // _ op b = c
    const [, op, bs, cs] = m;
    const b = ratOf(bs), c = ratOf(cs);
    if (!b || !c) return null;
    const x = solveBlank(b, op, c, 'left');
    if (!x) return null;
    return { kind: 'blank', op: SHOW_OP[op], a: null, b: bs.replace(/\s+/g, ''), c: cs.replace(/\s+/g, ''), blank: 'left', numbers: [bs, cs].map((v) => v.replace(/\s+/g, '')), answer: x, answerText: ratText(x, hasDec) };
  }
  // Whole-number compound sums, brackets, "6 × 9 = 6 × 3 × __".
  const whole = solveArithmetic(question);
  if (whole == null) return null;
  const sides = s.split('=').map((t) => t.trim());
  const child = sides.length === 2 && /^\d+$/.test(sides[1]) && /[+*÷\/-]/.test(sides[0]) && !s.includes('_');
  const numbers = ((child ? sides[0] : s).match(/\d+/g) || []);
  return { kind: 'compound', op: null, a: null, b: null, blank: null, numbers, answer: rat(whole), answerText: String(whole) };
}

// a op x = c (x on the right) or x op b = c (x on the left) -> x
function solveBlank(known, op, c, side) {
  let x = null;
  if (op === '+') x = OPS['-'](c, known);
  else if (op === '*') x = OPS['÷'](c, known);
  else if (op === '-') x = side === 'right' ? OPS['-'](known, c) : OPS['+'](c, known);
  else if (op === '÷') x = side === 'right' ? OPS['÷'](known, c) : OPS['*'](c, known);
  if (!x || x.n < 0) return null;
  // check by substitution
  const back = side === 'right' ? OPS[op](known, x) : OPS[op](x, known);
  return same(back, c) ? x : null;
}

export function numbersIn(text) {
  const t = asciiDigits(text).replace(/(\d),(?=\d{3}\b)/g, '$1');
  return new Set(t.match(/\d+(?:\.\d+)?/g) || []);
}

// The model's "answer" field -> true when it is the engine's answer.
export function answerMatches(parsed, modelAnswer) {
  if (!parsed || modelAnswer == null) return false;
  const t = asciiDigits(modelAnswer).replace(/(\d),(?=\d{3}\b)/g, '$1');
  const m = t.match(/-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g);
  if (!m) return false;
  // The last number in "25 × 4 = 100" is the answer; "x = 4" has one number.
  const r = ratOf(m[m.length - 1]);
  return same(r, parsed.answer);
}

// card: { title, quick, full, answer }. 'unchecked' = the question is not plain
// arithmetic this engine reads (no mark, no claim).
export function verifyCard({ question, card }) {
  const parsed = parseQuestion(question);
  if (!parsed) return { status: 'unchecked', parsed: null };
  const have = numbersIn([card && card.title, card && card.quick, card && card.full, card && card.answer].filter(Boolean).join(' '));
  const missing = parsed.numbers.filter((n) => !have.has(n.includes('/') ? n.split('/')[0] : n));
  if (!answerMatches(parsed, card && card.answer)) return { status: 'mismatch', reason: 'answer', parsed, expected: parsed.answerText };
  if (missing.length) return { status: 'mismatch', reason: 'numbers', parsed, expected: parsed.answerText, missing };
  return { status: 'checked', parsed, answerText: parsed.answerText };
}

export function correctionHint(v) {
  if (!v || v.status !== 'mismatch') return '';
  const nums = v.parsed.numbers.join(', ');
  return v.reason === 'answer'
    ? `CORRECTION: this is a plain arithmetic question and its answer is ${v.expected}. Reply again in the same JSON: "answer" must be ${v.expected}, and "full" must work this exact question step by step using its own numbers (${nums}).`
    : `CORRECTION: your explanation does not use this question's own numbers. Reply again in the same JSON: "full" must work this exact question step by step using ${nums}, ending with the answer ${v.expected}.`;
}
