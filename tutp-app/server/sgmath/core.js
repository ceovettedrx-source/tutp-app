// Singapore Maths Method (TUT-43, docs/specs/TUT-43-singapore-maths.md): pure logic,
// no database, so tests/unit/sgmath-solver.test.js and sgmath-core.test.js run it.
//
// Problems are built from code, not from a model: numbers and the bar model come from
// a seeded generator per (model type, grade, difficulty, index), and the answer is
// computed from the same numbers. The words come from string rows per language
// (sgmath_strings, keys tpl.*), so a new language is rows only and a translation
// can never change a number (numbers are inserted as digits at fill time).
import { validateModel, unknownValue, layoutBarModel, renderSvg, barValue } from '../../public/app/shared/diagram/bar-model.js';

export const MODEL_TYPES = ['part_whole', 'comparison', 'before_after', 'fraction', 'ratio'];
export const GRADE_RANGE = { part_whole: [1, 6], comparison: [2, 6], before_after: [3, 6], fraction: [3, 6], ratio: [5, 6] };
export const PROBLEMS_PER_CELL = 8;            // per difficulty: 8 x 3 = 24 per grade x type cell
export const DIFFICULTIES = [1, 2, 3];
export const SESSION_PROBLEMS = 3;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const typesForGrade = (grade) => MODEL_TYPES.filter((t) => grade >= GRADE_RANGE[t][0] && grade <= GRADE_RANGE[t][1]);

// "Class 4" -> 4; anything outside 1..12 -> null.
export function gradeOf(cls) {
  const m = String(cls || '').match(/(\d{1,2})/);
  const g = m ? Number(m[1]) : NaN;
  return g >= 1 && g <= 12 ? g : null;
}
export const gradeSupported = (g) => Number.isInteger(g) && g >= 1 && g <= 6;

// ---- seeded generator -----------------------------------------------------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// Value of one grid unit, by grade and difficulty (keeps every bar <= 20 units).
const UNIT_BY_GRADE = {
  1: [[1], [1], [1]],
  2: [[1, 2], [2, 5], [5]],
  3: [[5, 10], [10], [10, 25]],
  4: [[10, 25], [25, 50], [50, 100]],
  5: [[25, 50], [50, 100], [100, 250]],
  6: [[50, 100], [100, 250], [250, 500]],
};
const NAMES = 12;      // name.1 .. name.12 in the string table
// Masculine in Hindi on purpose, so one template fits every item (kitne, the).
const ITEMS = ['mangoes', 'laddus', 'biscuits', 'marbles', 'balloons', 'stickers', 'flowers', 'coins'];

export const VARIANTS = {
  part_whole: ['total', 'part', 'three'],
  comparison: ['diff', 'more', 'less'],
  before_after: ['left', 'spent'],
  fraction: ['part', 'rest'],
  ratio: ['part', 'other'],
};

// One problem, fully determined by its id parts. Returns
// { id, type, grade, difficulty, variant, spec, answer, unitKey, vars, equation, equationOptions }.
export function makeProblem(type, grade, difficulty, index) {
  const id = `${type}-g${grade}-d${difficulty}-${index}`;
  const r = rng(hashStr(id));
  const unit = pick(r, UNIT_BY_GRADE[grade][difficulty - 1]);
  const vars = { name1: between(r, 1, NAMES), name2: 0, item: pick(r, ITEMS) };
  do { vars.name2 = between(r, 1, NAMES); } while (vars.name2 === vars.name1);
  const variants = VARIANTS[type];
  let variant, spec, unitKey = 'item';
  const maxU = grade === 1 ? 10 : grade === 2 ? 14 : 18;

  if (type === 'part_whole') {
    variant = difficulty === 3 && grade >= 2 ? 'three' : variants[(index + difficulty) % 2];
    if (variant === 'three') {
      const a = between(r, 2, 6), b = between(r, 2, 6), c = between(r, 2, Math.max(2, Math.min(6, maxU - a - b)));
      spec = { kind: 'parts', unit, bars: [{ name: 'all', segments: [{ units: a }, { units: b }, { units: c }] }], unknown: { bar: 0, total: true } };
      Object.assign(vars, { a: a * unit, b: b * unit, c: c * unit });
    } else {
      const a = between(r, 2, Math.floor(maxU / 2) + 1), b = between(r, 2, maxU - a);
      if (variant === 'total') {
        spec = { kind: 'parts', unit, bars: [{ name: 'all', segments: [{ units: a }, { units: b }] }], unknown: { bar: 0, total: true } };
        Object.assign(vars, { a: a * unit, b: b * unit });
      } else {
        spec = { kind: 'parts', unit, bars: [{ name: 'all', segments: [{ units: a }, { units: b }] }], unknown: { bar: 0, segment: 1 } };
        Object.assign(vars, { total: (a + b) * unit, a: a * unit });
      }
    }
  } else if (type === 'comparison') {
    variant = grade < 3 ? variants[index % 2] : variants[(index + difficulty) % 3];
    const small = between(r, 2, maxU - 3), d = between(r, 2, Math.min(8, maxU - small));
    const big = small + d;
    if (variant === 'diff') {
      spec = { kind: 'lengths', unit, bars: [{ name: 'name1', segments: [{ units: big }] }, { name: 'name2', segments: [{ units: small }] }], unknown: { difference: [0, 1] } };
      Object.assign(vars, { a: big * unit, b: small * unit });
    } else if (variant === 'more') {
      spec = { kind: 'lengths', unit, bars: [{ name: 'name1', segments: [{ units: big }] }, { name: 'name2', segments: [{ units: small }] }], unknown: { bar: 0, total: true } };
      Object.assign(vars, { b: small * unit, d: d * unit });
    } else {
      spec = { kind: 'lengths', unit, bars: [{ name: 'name1', segments: [{ units: big }] }, { name: 'name2', segments: [{ units: small }] }], unknown: { bar: 1, total: true } };
      Object.assign(vars, { a: big * unit, d: d * unit });
    }
  } else if (type === 'before_after') {
    variant = variants[(index + difficulty) % 2];
    const left = between(r, 2, maxU - 3), given = between(r, 2, Math.min(9, maxU - left));
    spec = { kind: 'parts', unit, bars: [{ name: 'start', segments: [{ units: left }, { units: given }] }], unknown: variant === 'left' ? { bar: 0, segment: 0 } : { bar: 0, segment: 1 } };
    if (variant === 'left') Object.assign(vars, { s: (left + given) * unit, c: given * unit });
    else { Object.assign(vars, { s: (left + given) * unit, l: left * unit }); unitKey = 'rupees'; }
  } else if (type === 'fraction') {
    variant = variants[(index + difficulty) % 2];
    const parts = pick(r, difficulty === 1 ? [2, 3, 4] : difficulty === 2 ? [3, 4, 5, 6] : [5, 6, 8, 10]);
    const k = between(r, 1, parts - 1);
    const fu = unit * between(r, 1, grade <= 3 ? 2 : 4);
    const segments = Array.from({ length: parts }, (_, j) => ({ units: 1, ...(j < k ? { shaded: true } : {}) }));
    spec = { kind: 'fraction', unit: fu, bars: [{ name: 'all', segments }], unknown: variant === 'part' ? { shaded: true } : { unshaded: true } };
    Object.assign(vars, { w: parts * fu, k, n: parts });
  } else {
    variant = variants[(index + difficulty) % 2];
    const p = between(r, 1, 5), q = between(r, p + 1, Math.min(12 - p, p + 6));
    const ru = unit * between(r, 1, 3);
    spec = { kind: 'units', unit: ru, bars: [{ name: 'name1', segments: Array.from({ length: p }, () => ({ units: 1 })) }, { name: 'name2', segments: Array.from({ length: q }, () => ({ units: 1 })) }], unknown: variant === 'part' ? { bar: 0, total: true } : { bar: 1, total: true } };
    Object.assign(vars, { p, q, t: (p + q) * ru });
  }
  const answer = expectedAnswer(type, variant, vars);
  const equation = equationFor(type, variant, vars);
  const equationOptions = equationChoices(type, variant, vars, equation, r);
  return { id, type, grade, difficulty, index, variant, spec, answer, unitKey, vars, equation, equationOptions };
}

// The answer from the story numbers (kept apart from the bar-model solver on purpose:
// tests check both agree, so a bug in one cannot hide in the other).
export function expectedAnswer(type, variant, v) {
  switch (`${type}.${variant}`) {
    case 'part_whole.total': return v.a + v.b;
    case 'part_whole.part': return v.total - v.a;
    case 'part_whole.three': return v.a + v.b + v.c;
    case 'comparison.diff': return v.a - v.b;
    case 'comparison.more': return v.b + v.d;
    case 'comparison.less': return v.a - v.d;
    case 'before_after.left': return v.s - v.c;
    case 'before_after.spent': return v.s - v.l;
    case 'fraction.part': return (v.w / v.n) * v.k;
    case 'fraction.rest': return (v.w / v.n) * (v.n - v.k);
    case 'ratio.part': return (v.t / (v.p + v.q)) * v.p;
    case 'ratio.other': return (v.t / (v.p + v.q)) * v.q;
    default: throw new Error('unknown variant ' + type + '.' + variant);
  }
}

export function equationFor(type, variant, v) {
  switch (`${type}.${variant}`) {
    case 'part_whole.total': return `${v.a} + ${v.b} = ?`;
    case 'part_whole.part': return `${v.total} − ${v.a} = ?`;
    case 'part_whole.three': return `${v.a} + ${v.b} + ${v.c} = ?`;
    case 'comparison.diff': return `${v.a} − ${v.b} = ?`;
    case 'comparison.more': return `${v.b} + ${v.d} = ?`;
    case 'comparison.less': return `${v.a} − ${v.d} = ?`;
    case 'before_after.left': return `${v.s} − ${v.c} = ?`;
    case 'before_after.spent': return `${v.s} − ${v.l} = ?`;
    case 'fraction.part': return `${v.w} ÷ ${v.n} × ${v.k} = ?`;
    case 'fraction.rest': return `${v.w} ÷ ${v.n} × ${v.n - v.k} = ?`;
    case 'ratio.part': return `${v.t} ÷ ${v.p + v.q} × ${v.p} = ?`;
    case 'ratio.other': return `${v.t} ÷ ${v.p + v.q} × ${v.q} = ?`;
    default: throw new Error('unknown variant');
  }
}

// Three choices: the right one and two typical mistakes (wrong operation, wrong part).
function equationChoices(type, variant, v, right, r) {
  const wrong = [];
  const swap = (s) => (s.includes('+') ? s.replace(/\+/g, '−') : s.replace(/−/g, '+'));
  if (type === 'fraction') {
    wrong.push(`${v.w} × ${v.n} ÷ ${v.k} = ?`, variant === 'part' ? `${v.w} ÷ ${v.n} × ${v.n - v.k} = ?` : `${v.w} ÷ ${v.n} × ${v.k} = ?`);
  } else if (type === 'ratio') {
    wrong.push(`${v.t} ÷ ${v.p} = ?`, variant === 'part' ? `${v.t} ÷ ${v.p + v.q} × ${v.q} = ?` : `${v.t} ÷ ${v.p + v.q} × ${v.p} = ?`);
  } else if (variant === 'three') {
    wrong.push(`${v.a} + ${v.b} − ${v.c} = ?`, `${v.a} + ${v.b} = ?`);
  } else {
    wrong.push(swap(right));
    const nums = right.match(/\d+/g).map(Number);
    wrong.push(`${nums[0]} × ${nums[1]} = ?`);
  }
  const uniq = [...new Set([right, ...wrong])].filter(Boolean).slice(0, 3);
  const order = uniq.map((e) => ({ e, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.e);
  return order;
}

// The numbers a question text must contain (and no others).
export function storyNumbers(p) {
  const keys = { 'part_whole.total': ['a', 'b'], 'part_whole.part': ['total', 'a'], 'part_whole.three': ['a', 'b', 'c'], 'comparison.diff': ['a', 'b'], 'comparison.more': ['b', 'd'], 'comparison.less': ['a', 'd'], 'before_after.left': ['s', 'c'], 'before_after.spent': ['s', 'l'], 'fraction.part': ['w', 'k', 'n'], 'fraction.rest': ['w', 'k', 'n'], 'ratio.part': ['p', 'q', 't'], 'ratio.other': ['p', 'q', 't'] }[`${p.type}.${p.variant}`];
  return keys.map((k) => p.vars[k]);
}

export function solve(spec) { return unknownValue(spec); }

export function bank(type, grade, difficulty) {
  return Array.from({ length: PROBLEMS_PER_CELL }, (_, i) => makeProblem(type, grade, difficulty, i));
}
export function problemById(id) {
  const m = /^(part_whole|comparison|before_after|fraction|ratio)-g([1-6])-d([1-3])-([0-7])$/.exec(String(id || ''));
  if (!m) return null;
  const [, type, g, d, i] = m;
  const grade = Number(g);
  if (!typesForGrade(grade).includes(type)) return null;
  return makeProblem(type, grade, Number(d), Number(i));
}

// ---- text -------------------------------------------------------------------
// strings: { key: text } for one language (already merged with English per key).
export function fillText(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => (values[k] !== undefined ? String(values[k]) : ''));
}
export function problemText(p, strings) {
  const values = { ...p.vars, name1: strings['name.' + p.vars.name1] || '', name2: strings['name.' + p.vars.name2] || '', item: strings['item.' + p.vars.item] || p.vars.item };
  if (p.type === 'fraction') values.frac = `${p.vars.k}/${p.vars.n}`;
  return fillText(strings[`tpl.${p.type}.${p.variant}`], values);
}
export function barNames(p, strings) {
  return p.spec.bars.map((b) => (b.name === 'name1' ? strings['name.' + p.vars.name1] : b.name === 'name2' ? strings['name.' + p.vars.name2] : strings['bar.' + b.name] || ''));
}
export function concreteText(p, strings) {
  const units = p.spec.bars.map((b) => b.segments.reduce((s, g) => s + g.units, 0));
  const parts = p.spec.bars[0].segments.map((g) => g.units);
  const values = { n1: parts[0], n2: parts[1] ?? '', n3: parts[2] ?? '', b1: units[0], b2: units[1] ?? '', k: p.spec.bars[0].segments.filter((g) => g.shaded).length, n: p.spec.bars[0].segments.length, unit: p.spec.unit, item: strings['item.' + p.vars.item] || '' };
  return fillText(strings[`concrete.${p.spec.kind}${p.spec.kind === 'parts' && parts.length === 3 ? '3' : ''}`], values);
}
export function hintText(type, n, strings) { return strings[`hint.${type}.${Math.min(3, Math.max(1, n))}`] || ''; }

// The guard for any hint text: it must not contain the answer as a number.
export function hintIsSafe(text, answer) {
  const nums = (String(text).match(/\d+(?:\.\d+)?/g) || []).map(Number);
  return !nums.includes(Number(answer));
}

// Picture for a problem: '?' on the unknown, values shown only when reveal is set.
export function problemSvg(p, strings, { reveal = false, font } = {}) {
  const names = barNames(p, strings);
  const spec = { ...p.spec, bars: p.spec.bars.map((b, i) => ({ ...b, name: names[i] })) };
  const layout = layoutBarModel(spec);
  const labels = {};
  if (!reveal) {
    // question picture: every number given in the story stays, the unknown is '?'
    if (p.spec.kind === 'units') { labels.total0 = p.spec.unknown.bar === 0 ? '?' : ''; labels.total1 = p.spec.unknown.bar === 1 ? '?' : ''; }
  } else if (p.spec.unknown.difference) labels.diff = String(p.answer);
  else if (p.spec.unknown.total) {
    labels['total' + p.spec.unknown.bar] = String(p.answer);
    if (p.spec.kind === 'lengths') labels[`b${p.spec.unknown.bar}s0`] = String(p.answer);
  }
  else if (p.spec.unknown.bar !== undefined) labels[`b${p.spec.unknown.bar}s${p.spec.unknown.segment}`] = String(p.answer);
  return renderSvg(layout, { spec, title: strings['svg.title'] || 'Bar model', font, labels });
}

// ---- learning record ----------------------------------------------------------
// attempts: [{ model_type, step, correct, created_at, difficulty }] oldest first.
export function masteryByType(attempts) {
  const out = Object.fromEntries(MODEL_TYPES.map((t) => [t, { score: null, attempts: 0 }]));
  for (const a of attempts) {
    const m = out[a.model_type];
    if (!m) continue;
    const x = a.correct ? 1 : 0;
    m.score = m.score === null ? x : 0.3 * x + 0.7 * m.score;
    m.attempts++;
  }
  return out;
}
export function masteryLabel(m) {
  if (!m || !m.attempts) return 'not_tried';
  if (m.score >= 0.8 && m.attempts >= 4) return 'strong';
  if (m.score >= 0.5) return 'getting_there';
  return 'learning';
}

// First session = diagnostic (one problem per type for the grade, pictorial only).
// Then: a type never tried comes first, else the weakest with at least 2 attempts.
export function chooseFocus(grade, attempts) {
  const types = typesForGrade(grade);
  if (!attempts.length) return { diagnostic: true, types };
  const m = masteryByType(attempts);
  const untried = types.find((t) => !m[t].attempts);
  if (untried) return { diagnostic: false, type: untried };
  const enough = types.filter((t) => m[t].attempts >= 2);
  const ranked = (enough.length ? enough : types.filter((t) => m[t].attempts)).sort((a, b) => m[a].score - m[b].score || m[a].attempts - m[b].attempts || types.indexOf(a) - types.indexOf(b));
  return { diagnostic: false, type: ranked[0] || types[0] };
}

// Difficulty for a type: start at 1, up after 2 right in a row, down after 2 wrong.
// Uses the problem outcomes (abstract step; pictorial for diagnostic problems).
export function nextDifficulty(attempts, type) {
  let d = 1, streak = 0;
  for (const a of attempts.filter((x) => x.model_type === type && x.step === 'abstract')) {
    if (a.correct) { streak = streak > 0 ? streak + 1 : 1; if (streak >= 2) { d = Math.min(3, d + 1); streak = 0; } }
    else { streak = streak < 0 ? streak - 1 : -1; if (streak <= -2) { d = Math.max(1, d - 1); streak = 0; } }
  }
  return d;
}

// Problem ids for a session. recent: { problemId: lastSeenMs }. A problem done in the
// last 30 days is not repeated while others exist; the order is stable for a child and day.
export function pickProblems({ type, grade, difficulty, recent = {}, seed = '', now = Date.now(), n = SESSION_PROBLEMS }) {
  const cell = bank(type, grade, difficulty).map((p) => p.id);
  const r = rng(hashStr(seed + '|' + type + grade + difficulty));
  const shuffled = cell.map((id) => ({ id, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.id);
  const cutoff = now - 30 * DAY_MS;
  const fresh = shuffled.filter((id) => !(recent[id] >= cutoff));
  const stale = shuffled.filter((id) => recent[id] >= cutoff).sort((a, b) => recent[a] - recent[b]);
  return [...fresh, ...stale].slice(0, n);
}
export function diagnosticProblems(grade, seed = '') {
  return typesForGrade(grade).map((t) => {
    const r = rng(hashStr(seed + '|diag|' + t));
    return makeProblem(t, grade, 1, Math.floor(r() * PROBLEMS_PER_CELL)).id;
  });
}

// ---- time and gate ----------------------------------------------------------------
// Monday (IST) of the week containing nowMs, as YYYY-MM-DD.
export function weekStartIst(nowMs) {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const dow = (ist.getUTCDay() + 6) % 7;               // Monday 0 .. Sunday 6
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow));
  return monday.toISOString().slice(0, 10);
}
// tier -> 'max' (unlimited), 'free_weekly' (1 a week), 'locked'.
export function gateFor(tier) {
  if (tier === 'max') return 'max';
  if (tier === 'pro' || tier === 'ultrapro') return 'free_weekly';
  return 'locked';
}

// Weekly growth: average mastery at the end of each of the last `weeks` IST weeks;
// a week with no attempts is null (a gap, not a zero).
export function weeklyGrowth(attempts, nowMs, weeks = 8) {
  const out = [];
  const thisWeek = Date.parse(weekStartIst(nowMs) + 'T00:00:00+05:30');
  for (let w = weeks - 1; w >= 0; w--) {
    const start = thisWeek - w * 7 * DAY_MS, end = start + 7 * DAY_MS;
    const inWeek = attempts.filter((a) => { const t = Date.parse(a.created_at); return t >= start && t < end; });
    if (!inWeek.length) { out.push({ week: weekStartIst(start + DAY_MS), value: null }); continue; }
    const m = masteryByType(attempts.filter((a) => Date.parse(a.created_at) < end));
    const vals = Object.values(m).filter((x) => x.attempts).map((x) => x.score);
    out.push({ week: weekStartIst(start + DAY_MS), value: Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100) });
  }
  return out;
}

export { validateModel, barValue };
