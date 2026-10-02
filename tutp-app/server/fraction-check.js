// Exam prep gate (round 4): every fraction statement in a generated note
// must be arithmetically true. Finds relations such as "1/2 = 2/4",
// "3/4 > 2/3", "1/4 + 2/4 = 3/4", "4/4 = 1", "1 1/2 = 3/2" or
// "2/3 is greater than 1/2" in a text, works both sides out exactly and
// reports the ones that are false. Only relations with a fraction in them
// are checked; plain whole-number sums are left alone.
//
// checkFractions(text) -> { checked, wrong: [{ text, reason }] }
// checkFractionsIn(value) does the same over every string in an object.

const TERM = String.raw`\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?`;
const OP = String.raw`(?:\s*[+×*÷]\s*|\s+[-−x]\s+)`;
const EXPR = `${TERM}(?:${OP}${TERM})*`;
const REL = String.raw`\s*(?:=|<|>|≠|≤|≥)\s*|\s+(?:is equal to|equals|is the same as|is greater than|is bigger than|is more than|is less than|is smaller than)\s+`;
const SPAN = new RegExp(`(${EXPR})((?:(?:${REL})(?:${EXPR}))+)`, 'gi');
const REL_SPLIT = new RegExp(`(${REL})`, 'i');

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return Math.abs(a); }
function frac(n, d) {
  if (d === 0) return null;
  const g = gcd(n, d) || 1;
  return d < 0 ? { n: -n / g, d: -d / g } : { n: n / g, d: d / g };
}

function parseTerm(t) {
  const s = t.trim();
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const w = +m[1], n = +m[2], d = +m[3];
    return d ? frac(w * d + n, d) : null;
  }
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return frac(+m[1], +m[2]);
  return /^\d+$/.test(s) ? frac(+s, 1) : null;
}

function apply(a, op, b) {
  if (!a || !b) return null;
  switch (op) {
    case '+': return frac(a.n * b.d + b.n * a.d, a.d * b.d);
    case '-': case '−': return frac(a.n * b.d - b.n * a.d, a.d * b.d);
    case '×': case '*': case 'x': case 'X': return frac(a.n * b.n, a.d * b.d);
    case '÷': return b.n === 0 ? null : frac(a.n * b.d, a.d * b.n);
    default: return null;
  }
}

// Left to right, × and ÷ before + and −.
function evaluate(expr) {
  const parts = expr.split(new RegExp(`(${OP})`)).filter((p) => p !== undefined && p !== '');
  const terms = [], ops = [];
  parts.forEach((p, i) => (i % 2 === 0 ? terms.push(parseTerm(p)) : ops.push(p.trim())));
  if (terms.some((t) => !t)) return null;
  const vals = [terms[0]], addOps = [];
  ops.forEach((op, i) => {
    if (/^[×*xX÷]$/.test(op)) vals[vals.length - 1] = apply(vals[vals.length - 1], op, terms[i + 1]);
    else { addOps.push(op); vals.push(terms[i + 1]); }
  });
  return addOps.reduce((acc, op, i) => apply(acc, op, vals[i + 1]), vals[0]);
}

function compare(a, rel, b) {
  const diff = a.n * b.d - b.n * a.d;
  const r = rel.trim().toLowerCase();
  if (r === '=' || r === 'is equal to' || r === 'equals' || r === 'is the same as') return diff === 0;
  if (r === '≠') return diff !== 0;
  if (r === '<' || r === 'is less than' || r === 'is smaller than') return diff < 0;
  if (r === '>' || r === 'is greater than' || r === 'is bigger than' || r === 'is more than') return diff > 0;
  if (r === '≤') return diff <= 0;
  if (r === '≥') return diff >= 0;
  return true;
}

export function checkFractions(text) {
  const out = { checked: 0, wrong: [] };
  if (typeof text !== 'string' || !text.includes('/')) return out;
  for (const m of text.matchAll(SPAN)) {
    const span = m[0];
    if (!span.includes('/')) continue;
    // "half of 1/2 = 1/4": the left side is only part of an expression.
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    if (/\bof\s*$/i.test(before) || /[\d/]\s*$/.test(before)) continue;
    const pieces = span.split(REL_SPLIT);
    // pieces: expr, rel, expr, rel, expr ...
    for (let i = 0; i + 2 < pieces.length; i += 2) {
      const a = evaluate(pieces[i]), b = evaluate(pieces[i + 2]);
      out.checked++;
      if (!a || !b) { out.wrong.push({ text: span.trim(), reason: 'cannot be worked out (division by zero?)' }); break; }
      if (!compare(a, pieces[i + 1], b)) {
        out.wrong.push({ text: span.trim(), reason: `${pieces[i].trim()} ${pieces[i + 1].trim()} ${pieces[i + 2].trim()} is false` });
        break;
      }
    }
  }
  return out;
}

export function checkFractionsIn(value) {
  const out = { checked: 0, wrong: [] };
  const walk = (v) => {
    if (typeof v === 'string') {
      const r = checkFractions(v);
      out.checked += r.checked;
      out.wrong.push(...r.wrong);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}
