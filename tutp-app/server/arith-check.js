// Homework Help: plain arithmetic is checked in code, not trusted to the
// model (2026-09-29: a photo reply copied the child's "45 − 18 = 33" as the
// answer). Handles integer + − × ÷ with brackets, as "expr =", "expr = ?",
// "expr = __", "expr = N" (N taken as the child's answer and ignored), and
// one blank in an equation ("6 × 9 = 6 × 3 × __", "__ + 5 = 12"). Anything
// else (words, decimals, a result that isn't a whole number) is left alone.
// Unit tests: tests/unit/arith-check.test.js.

const BLANK = /_{2,}|\?|□|\[\s*\]|\(\s*\)|…|\.{3,}/g;

// Question text -> the whole-number answer, or null when it isn't a plain
// arithmetic question this module can solve.
export function solveArithmetic(question) {
  if (typeof question !== 'string' || question.length > 120) return null;
  let s = question
    .replace(/^\s*(?:q(?:uestion)?\s*)?\d+\s*(?:\)\s*|[.:]\s+)/i, '') // "2)", "Q2. ", "1: " (not "3.5")
    .replace(/(\d),(?=\d{3}\b)/g, '$1')                         // 1,000
    .replace(/[×xX*]/g, '*').replace(/[÷/]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(BLANK, ' _ ')
    .trim();
  if (!/^[\d\s+\-*/()=_]+$/.test(s)) return null;
  const sides = s.split('=').map((t) => t.trim());
  if (sides.length > 2) return null;
  const [left, right = ''] = sides;
  const blanks = (s.match(/_/g) || []).length;

  if (right === '' || right === '_') {                       // "expr =", "expr = __"
    if (blanks > (right === '_' ? 1 : 0)) return null;
    return whole(evaluate(left));
  }
  if (blanks === 0) {
    // "expr = N": the N is the child's written answer.
    return /^\d+$/.test(right) && /[+\-*/]/.test(left) ? whole(evaluate(left)) : null;
  }
  if (blanks !== 1) return null;
  const withBlank = left.includes('_') ? left : right;
  const other = left.includes('_') ? right : left;
  const target = evaluate(other);
  if (target == null) return null;
  // The blank enters the side linearly when it isn't a divisor: solve
  // a·x + b = target from x = 0, 1, and check the answer by substitution.
  const at = (x) => evaluate(withBlank.replace('_', `(${x})`));
  const b = at(0), a1 = at(1), a2 = at(2);
  if (b == null || a1 == null || a2 == null) return null;
  const a = a1 - b;
  if (a === 0 || Math.abs((a2 - b) - 2 * a) > 1e-9) return null;
  const x = whole((target - b) / a);
  return x != null && Math.abs(at(x) - target) < 1e-9 ? x : null;
}

function whole(v) {
  if (v == null || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-9 && Math.abs(r) <= Number.MAX_SAFE_INTEGER ? r : null;
}

// Integer expression with + - * / and brackets -> number, or null.
export function evaluate(expr) {
  const tokens = String(expr).match(/\d+|[+\-*/()]|\S/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  function primary() {
    const t = tokens[i++];
    if (t === '(') { const v = sum(); if (tokens[i++] !== ')') throw 0; return v; }
    if (t === '-') return -primary();
    if (/^\d+$/.test(t || '')) return Number(t);
    throw 0;
  }
  function product() {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[i++], r = primary();
      if (op === '/' && r === 0) throw 0;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + product() : v - product();
    return v;
  }
  try {
    if (!tokens.length) return null;
    const v = sum();
    return i === tokens.length && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// The number a model answer gives: its last whole number ("45 − 18 = 27",
// "27 (twenty-seven)"), or null.
function lastNumber(answer) {
  const m = String(answer ?? '').replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/g);
  return m ? Number(m[m.length - 1]) : null;
}

// Homework JSON -> { json, checked, fixed }. A wrong answer gets the computed
// number in place of its last number (or becomes that number).
export function checkArithmetic(json) {
  const qs = Array.isArray(json && json.extracted_questions) ? json.extracted_questions : null;
  if (!qs) return { json, checked: 0, fixed: 0 };
  let checked = 0, fixed = 0;
  const extracted = qs.map((q) => {
    if (!q || typeof q !== 'object') return q;
    const want = solveArithmetic(q.question);
    if (want == null) return q;
    checked++;
    if (lastNumber(q.answer) === want) return q;
    fixed++;
    const text = String(q.answer ?? '');
    const m = [...text.matchAll(/-?\d+(?:\.\d+)?/g)].pop();
    const answer = m ? text.slice(0, m.index) + want + text.slice(m.index + m[0].length) : String(want);
    return { ...q, answer };
  });
  return { json: { ...json, extracted_questions: extracted }, checked, fixed };
}

// Anthropic reply -> the same reply with its first text block's JSON
// checked. Returns { data, checked, fixed }.
export function applyArithmeticCheck(data) {
  const blocks = (data && data.content) || [];
  const i = blocks.findIndex((b) => b && b.type === 'text');
  if (i < 0) return { data, checked: 0, fixed: 0 };
  const text = blocks[i].text || '';
  let json;
  try { json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return { data, checked: 0, fixed: 0 }; }
  const { json: out, checked, fixed } = checkArithmetic(json);
  if (!fixed) return { data, checked, fixed };
  const content = blocks.slice();
  content[i] = { ...blocks[i], text: JSON.stringify(out) };
  return { data: { ...data, content }, checked, fixed };
}
