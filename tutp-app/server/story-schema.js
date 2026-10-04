// Storytelling Method: the model's reply is checked here before a page sees
// it (docs/specs/storytelling-redesign.md). Shape:
//   { title, gradeSubjectTag, readMinutes,
//     scenes: [{ label: hook | problem | mathMoment | wrapUp, text }],
//     visual: { type: 'groups', itemNoun, total, groups: [n, ...] } | null,
//     equations: [string], tryTogether: { question, answer }, parentPrompt }
// Numbers are recomputed in code, never trusted to the model: a visual whose
// groups do not add up to its total is dropped, a plain-arithmetic equation
// with a wrong result is corrected, and the try-together answer is checked
// against its question. Unit tests: tests/unit/story-schema.test.js.

import { solveArithmetic, evaluate } from './arith-check.js';
import { pickIcon, iconForNoun } from './story-icons.js';

export const SCENE_LABELS = ['hook', 'problem', 'mathMoment', 'wrapUp'];
const MAX_VISUAL_TOTAL = 1000; // the page draws at most 60 items and counts the rest
const MAX_EQUATIONS = 6;

// The letter x/X or * written as a times sign between two numbers ("4 x 6",
// "6x3", "5 * 12") becomes "4 × 6". Anywhere else (a sentence with x as the
// unknown, a blank on either side like "4 x __", words) it is left alone; ×
// itself is not matched, so running it twice changes nothing.
export function fixTimesSign(s) {
  return s.replace(FIX_TIMES, '$1 × ');
}

function str(v, max) {
  if (typeof v !== 'string') return null;
  const s = fixTimesSign(v.trim());
  return s && s.length <= max ? s : null;
}
function int(v) {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

// The part of a word that stays when its ending changes: the word without its
// last 3 letters (7 or more), 2 (5 or 6), 1 (shorter), never under 2 letters.
// Counted in code points, so a Telugu letter with its vowel sign is not cut
// in the middle of a syllable more than the language itself does.
export function nounStem(noun) {
  const cs = [...String(noun).normalize('NFC').toLowerCase().trim()];
  const n = cs.length;
  const k = n >= 7 ? n - 3 : n >= 5 ? n - 2 : Math.max(2, n - 1);
  return cs.slice(0, k).join('');
}

// The letter x, X or * written as multiplication between two numbers ("4 x 6",
// "4x6", "4 * 6") becomes ×. Only a number on the left (not part of a Latin
// word) and a number on the right count, so "x + 5 = 12", "2x + 3" and a
// word with an x in it stay as they are. Telugu text around the sum is fine.
const DIGIT = '[\\d\\u0966-\\u096F\\u0BE6-\\u0BEF\\u0C66-\\u0C6F]';
const FIX_TIMES = new RegExp(`(?<![A-Za-z])(${DIGIT}+)[ \\t]*[xX*][ \\t]*(?=${DIGIT})`, 'g');
const TIMES = new RegExp(`(?<![A-Za-z_])(${DIGIT}+)([ \\t]*)[xX*]([ \\t]*)(?=${DIGIT})`, 'g');
export function timesSign(text) {
  return typeof text === 'string' ? text.replace(TIMES, '$1$2×$3') : text;
}

// Devanagari, Telugu and Tamil digits -> 0-9, so a sum written in any of them
// is read the same way.
export function asciiDigits(text) {
  return String(text).replace(/[०-९௦-௯౦-౯]/g, (c) => String((c.charCodeAt(0) - 0x6)  % 16));
}

const MAX_NUM = 100000;
const num = (v) => { const n = int(v); return n != null && n >= 1 && n <= MAX_NUM ? n : null; };

// Venn elements: one region's list of short strings -> [{text, icon}] (icon ''
// when the item map has none, the page then shows the text), or null.
const VENN_MAX_ITEMS = 24;
function vennItems(list) {
  if (!Array.isArray(list) || list.length > 10) return null;
  const out = [];
  for (const it of list) {
    const text = str(typeof it === 'number' ? String(it) : it, 24);
    if (!text) return null;
    out.push({ text, icon: iconForNoun(text) });
  }
  return out;
}
export function validateVenn(v) {
  const left = v.left && str(v.left.label, 30), right = v.right && str(v.right.label, 30);
  const l = v.left && vennItems(v.left.items), r = v.right && vennItems(v.right.items);
  const b = vennItems(v.both == null ? [] : v.both);
  if (!left || !right || !l || !r || !b) return null;
  if (l.length + b.length < 1 || r.length + b.length < 1) return null;
  const all = [...l, ...r, ...b].map((i) => i.text.normalize('NFC').toLowerCase());
  if (all.length > VENN_MAX_ITEMS || new Set(all).size !== all.length) return null; // an element is in one region only
  return { type: 'venn', left: { label: left, items: l }, right: { label: right, items: r }, both: b };
}
// Every Venn element, for the check that the story names them.
export const vennElements = (v) => [...v.left.items, ...v.right.items, ...v.both].map((i) => i.text);

// Optional item icon of numberLine, barModel and factFamily (story visuals v3):
// the model's single emoji, else the map for itemNoun, else none.
const withIcon = (visual, v) => {
  const icon = pickIcon(v.icon, str(v.itemNoun, 40) || '');
  return icon ? { ...visual, icon } : visual;
};

// The model's visual -> a checked visual, or null when its shape or numbers
// are wrong. Types: groups, numberLine, barModel, factFamily, venn, library.
// ctx.library = { offered: Set of ids, build(id) } checks a library picture:
// only an id that was offered in the prompt, and is still approved, is kept.
export function validateVisual(v, ctx = {}) {
  if (!v || typeof v !== 'object') return null;
  if (v.type === 'library') {
    const id = typeof v.id === 'string' ? v.id : '';
    return ctx.library && ctx.library.offered.has(id) ? ctx.library.build(id) : null;
  }
  if (v.type === 'venn') return validateVenn(v);
  if (v.type === 'groups') {
    const total = int(v.total);
    const groups = Array.isArray(v.groups) ? v.groups.map(int) : [];
    const noun = str(v.itemNoun, 40);
    const sum = groups.reduce((a, b) => a + (b || 0), 0);
    const good = noun && total != null && total >= 1 && total <= MAX_VISUAL_TOTAL
      && groups.length >= 1 && groups.length <= 12 && groups.every(g => g != null && g >= 1) && sum === total;
    return good ? { type: 'groups', itemNoun: noun, icon: pickIcon(v.icon, noun), total, groups } : null;
  }
  if (v.type === 'numberLine') {
    const from = int(v.from), to = int(v.to);
    const step = v.step == null ? 1 : int(v.step);
    if (from == null || to == null || step == null || from < 0 || to > 1000 || step < 1 || to <= from) return null;
    if ((to - from) % step !== 0 || (to - from) / step > 20) return null;
    const jumps = [];
    for (const j of (Array.isArray(v.jumps) ? v.jumps : []).slice(0, 6)) {
      const a = j && int(j.from), b = j && int(j.to);
      if (a == null || b == null || a === b || a < from || a > to || b < from || b > to) return null;
      jumps.push({ from: a, to: b });
    }
    return withIcon({ type: 'numberLine', from, to, step, jumps }, v);
  }
  if (v.type === 'barModel') {
    const total = num(v.total);
    const parts = [];
    for (const p of (Array.isArray(v.parts) ? v.parts : []).slice(0, 7)) {
      const value = p && num(p.value);
      if (!value) return null;
      parts.push({ label: (p && str(p.label, 24)) || '', value });
    }
    const sum = parts.reduce((a, p) => a + p.value, 0);
    return total && parts.length >= 2 && parts.length <= 6 && sum === total ? withIcon({ type: 'barModel', parts, total }, v) : null;
  }
  if (v.type === 'factFamily') {
    const a = num(v.a), b = num(v.b), total = num(v.total);
    const op = v.op === 'multiply' ? 'multiply' : v.op === 'add' ? 'add' : null;
    if (!a || !b || !total || !op) return null;
    if ((op === 'add' ? a + b : a * b) !== total) return null;
    return withIcon({ type: 'factFamily', a, b, total, op }, v);
  }
  return null;
}

// "a op b = c" with two whole numbers -> a fact-family visual, else null.
// Subtraction and division are the same family read the other way round:
// 9 - 4 = 5 is {4, 5, total 9, add}; 24 ÷ 6 = 4 is {6, 4, total 24, multiply}.
export function equationFact(eq) {
  const m = asciiDigits(eq).match(/^\s*(\d+)\s*([+\-−–×x*÷/])\s*(\d+)\s*=\s*(\d+)\s*$/);
  if (!m) return null;
  const x = num(Number(m[1])), y = num(Number(m[3])), z = num(Number(m[4]));
  if (!x || !y || !z) return null;
  const op = m[2];
  if (op === '+') return x + y === z ? { type: 'factFamily', a: x, b: y, total: z, op: 'add' } : null;
  if (/[×x*]/.test(op)) return x * y === z ? { type: 'factFamily', a: x, b: y, total: z, op: 'multiply' } : null;
  if (/[\-−–]/.test(op)) return y + z === x ? { type: 'factFamily', a: y, b: z, total: x, op: 'add' } : null;
  return y * z === x ? { type: 'factFamily', a: y, b: z, total: x, op: 'multiply' } : null; // ÷ or /
}

// A picture for an equation that is not a plain "a op b = c": a chain of
// three to six numbers joined by one kind of sign ("2 + 3 + 4 = 9" is a bar of
// 2, 3, 4; "2 × 3 × 4 = 24" is 4 groups of 6) and an equation with one blank
// ("4 × __ = 24", "6 × 9 = 6 × 3 × __"), solved first (server/arith-check.js)
// and then drawn from the filled-in equation. Whole numbers and exact results
// only; anything else gives null (no picture, never a wrong one).
const BLANKS = /_+|□|\?|\[\s*\]|\(\s*\)/g;
const MAX_GROUPS = 12;
function chainTerms(side) {
  const sign = side.includes('+') ? '+' : side.includes('*') ? '*' : null;
  if (!sign) return null;
  const parts = side.split(sign).map((t) => t.trim());
  if (parts.length < 3 || parts.length > 6 || !parts.every((t) => /^\d+$/.test(t))) return null;
  const nums = parts.map(Number);
  return nums.every((n) => n >= 1) ? { sign, nums } : null;
}
export function equationVisual(eq) {
  const plain = equationFact(eq);
  if (plain) return plain;
  if (typeof eq !== 'string' || eq.length > 80) return null;
  let s = asciiDigits(eq).replace(/[×xX*]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  const blanks = (s.match(BLANKS) || []).length;
  if (blanks > 1) return null;
  if (blanks === 1) {
    const x = solveArithmetic(eq);
    if (x == null || x < 1) return null;
    s = s.replace(BLANKS, String(x));
  }
  if (!/^[\d\s+\-*/=]+$/.test(s)) return null;
  const sides = s.split('=').map((t) => t.trim());
  if (sides.length !== 2) return null;
  const [lv, rv] = sides.map((t) => evaluate(t));
  if (lv == null || lv !== rv || !Number.isInteger(lv) || lv < 1) return null;
  const filled = equationFact(s);          // "4 * 6 = 24" after a blank was solved
  if (filled) return filled;
  const chain = chainTerms(sides[1]) || chainTerms(sides[0]);
  if (!chain) return null;
  if (chain.sign === '+') {
    return lv <= MAX_NUM ? { type: 'barModel', parts: chain.nums.map((value) => ({ label: '', value })), total: lv } : null;
  }
  // × chain: one factor (the last that is 2..12) is the number of groups, the rest is the size of each
  let at = -1;
  for (let i = chain.nums.length - 1; i >= 0; i--) if (chain.nums[i] >= 2 && chain.nums[i] <= MAX_GROUPS) { at = i; break; }
  if (at < 0 || lv > MAX_VISUAL_TOTAL) return null;
  const n = chain.nums[at];
  return { type: 'groups', itemNoun: '', icon: '', total: lv, groups: Array(n).fill(lv / n) };
}

// Same operation, same total, same two numbers in either order.
export function sameFact(f, g) {
  return f.op === g.op && f.total === g.total && ((f.a === g.a && f.b === g.b) || (f.a === g.b && f.b === g.a));
}

// Every "a op b = c" written in the scene texts, recomputed. A stated result
// that is wrong, or that disagrees with the same sum in the equations list, is
// an issue (the route retries once with the issue as a hint). Fractions,
// decimals, negatives, remainders and anything that is not whole-number
// arithmetic are skipped, never corrected or rejected.
const SCENE_EQ = /(?<![\d.,/\w\-−–])(?<!=\s*)(\d+(?:\s*[+\-−–×x*÷/]\s*\d+)+)\s*=\s*(\d+)(?!\d|[.,]\d|\s*[+\-−–×x*÷/]\s*\d)/g;
export function sceneEquationIssues(texts, equations) {
  const canon = (s) => s.replace(/\s+/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  const listed = new Map();
  for (const e of equations || []) {
    const p = canon(asciiDigits(e)).split('=');
    if (p.length === 2 && /^\d+$/.test(p[1])) listed.set(p[0], Number(p[1]));
  }
  const issues = [];
  for (const text of texts) {
    for (const m of asciiDigits(text).matchAll(SCENE_EQ)) {
      const lhs = m[1];
      if (lhs.length > 60 || /\d\/\d/.test(lhs)) continue; // 1/2 is a fraction, not a division
      const value = evaluate(canon(lhs));
      if (value == null || !Number.isInteger(value)) continue; // remainder or not whole
      const stated = Number(m[2]);
      const said = `${m[1].trim()} = ${m[2]}`;
      if (value !== stated) { issues.push(`a scene says "${said}" but ${m[1].trim()} is ${value}; fix the number`); continue; }
      const L = listed.get(canon(lhs));
      if (L != null && L !== stated) issues.push(`a scene says "${said}" but the equations list gives ${L}; make them agree`);
    }
  }
  return issues.slice(0, 4);
}

// Anthropic Messages response -> the parsed JSON object, or null.
export function extractStoryJson(data) {
  const block = ((data && data.content) || []).find(b => b && b.type === 'text');
  const text = block && typeof block.text === 'string' ? block.text : '';
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

// "6 × 9 = 54" -> the equation with the right result when the left side is
// plain arithmetic and the right side is a whole number; anything else is
// returned as it came.
export function fixEquation(eq) {
  const parts = eq.split('=');
  if (parts.length !== 2) return { text: eq, fixed: false };
  const rhs = parts[1].trim();
  if (!/^\d+$/.test(rhs) || !/[+\-−–×x*÷/]/.test(parts[0])) return { text: eq, fixed: false };
  const value = solveArithmetic(parts[0].trim() + ' =');
  if (value == null || String(value) === rhs) return { text: eq, fixed: false };
  return { text: `${parts[0].trim()} = ${value}`, fixed: true };
}

// The whole-number answer of a try-together question that is plain
// arithmetic, alone ("5 × 3 = ?") or after a sentence ("... how many? 5 × 3
// = ?", "What is 5 × 3?"); null when it is not.
export function questionValue(question) {
  const q = question.replace(/\?+\s*$/, '').replace(/=\s*(_+|□)?\s*$/, '').trim();
  const whole = solveArithmetic(q + ' =');
  if (whole != null) return whole;
  const tail = q.match(/(\d[\d\s+\-−–×x*÷/()]*\d\)?)\s*$/);
  if (!tail || !/[+\-−–×x*÷/]/.test(tail[1])) return null;
  return solveArithmetic(tail[1].trim() + ' =');
}

// Sentences of a scene text, for the "scene 3 is 1 to 3 sentences" rule. A
// sentence ends at . ! ? । or ॥ (with a closing quote or bracket) followed by
// a space; a decimal (3.5), an initial (A. Rao) and the usual abbreviations
// (Dr. Fig. e.g. i.e. etc. vs. No.) do not end one, and neither does "...".
const ABBREV = /(?:^|[\s(])(?:Dr|Mr|Mrs|Ms|Prof|St|Fig|Figs|No|Nos|vs|etc|approx|e\.g|i\.e|Sr|Jr)\.$/i;
const INITIAL = /(?:^|[\s(])[A-Z]\.$/;
export function splitSentences(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const out = [];
  let start = 0;
  const re = /[.!?।॥]+['"’”)\]]*(?=\s+\S)/g;
  let m;
  while ((m = re.exec(t))) {
    const end = m.index + m[0].length;
    const so_far = t.slice(start, end);
    if (/^\s*[a-z]/.test(t.slice(end))) continue; // "'Why?' asked Meera." is one sentence
    if (/^\.{2,}/.test(m[0]) && !/[!?।॥]/.test(m[0])) continue; // an ellipsis
    if (m[0][0] === '.' && (ABBREV.test(so_far) || INITIAL.test(so_far))) continue;
    out.push(t.slice(start, end).trim());
    start = end;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
// The first n sentences, cut only at a sentence boundary.
export function trimToSentences(text, n) {
  return splitSentences(text).slice(0, n).join(' ');
}
const MAX_SCENE3_SENTENCES = 3;

// Is the lesson maths? By its own subject tag first ("Class 5 · Maths ·
// Fractions", in any of the story languages), else by what the story carries:
// a maths picture or equations. Used by the percentage rule below and by the
// library-coverage log.
const MATHS_WORD = /math|arithmetic|algebra|geometry|गणित|గణిత|கணித|ಗಣಿತ|ഗണിത|গণিত|ગણિત|ਗਣਿਤ|ଗଣିତ|matem|mathémat|رياضيات/i;
const OTHER_SUBJECT_WORD = /scien|evs\b|environment|biolog|physic|chemi|social|histor|geograph|civic|econom|english|language|grammar|literature|computer|विज्ञान|विज्ञ|సైన్స్|విజ్ఞాన|అంగ్ల|அறிவியல்|सामाजिक|సాంఘిక|சமூக/i;
export function isMathsStory({ tag, visual, equations }) {
  const t = String(tag || '');
  if (MATHS_WORD.test(t)) return true;
  if (OTHER_SUBJECT_WORD.test(t)) return false;
  return !!((visual && visual.type !== 'library') || (equations && equations.length));
}

// A try-together question for a lesson that is not maths must not be
// arithmetic built from a percentage: "40% of 50 units" treats a mass share
// as a count. A question that names a percentage together with another number
// is flagged (a plain "what percent ...?" with no numbers is a recall question
// and passes). Returns the issue text, or '' when fine.
const PERCENT_WORD = /%|％|per\s?cent|percentage|శాతం|प्रतिशत|फीसदी|சதவீதம்|ಶೇಕಡಾ|ശതമാനം|শতাংশ|टक्के|ટકા|ਪ੍ਰਤੀਸ਼ਤ/i;
export function percentQuestionIssue(question) {
  const q = asciiDigits(String(question || ''));
  if (!PERCENT_WORD.test(q)) return '';
  const rest = q.replace(/\d+(?:[.,]\d+)?\s*(?:%|％|per\s?cent|percentage|శాతం|प्रतिशत|फीसदी|சதவீதம்|ಶೇಕಡಾ|ശതമാനം|শতাংশ|टक्के|ટકા|ਪ੍ਰਤੀਸ਼ਤ)/gi, ' ');
  if (!/\d/.test(rest)) return '';
  return 'the try-together question builds arithmetic from a percentage; for a lesson that is not maths ask a conceptual question or a simple count grounded in the story (for example how many chromatids 3 replicated chromosomes have), never a "percent of a number" sum, because a percentage in science is a share, not a count';
}

// raw (parsed JSON) -> { ok: true, story, fixed, visualSource, maths, concept }
// or { ok: false, issues }. ctx.final = this is the last try (after the one
// retry): a scene 3 of more than 3 sentences is trimmed at a sentence
// boundary instead of being an issue.
export function validateStory(raw, ctx = {}) {
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['not an object'] };
  let fixed = 0;

  const title = str(raw.title, 120);
  if (!title) issues.push('title missing or too long');

  const scenes = [];
  if (!Array.isArray(raw.scenes)) {
    issues.push('scenes missing');
  } else {
    for (const s of raw.scenes.slice(0, 6)) {
      const text = s && str(s.text, 700);
      if (!s || !SCENE_LABELS.includes(s.label) || !text) continue; // skipped; fewer than 3 left is an issue below
      scenes.push({ label: s.label, text });
    }
    if (scenes.length < 3) issues.push('fewer than 3 usable scenes');
  }

  let visual = null;
  let visualSource = 'none';
  const v = raw.visual;
  if (v && typeof v === 'object') {
    visual = validateVisual(v, ctx);
    if (visual) visualSource = visual.type === 'library' ? 'library' : 'model';
    else fixed++; // dropped: the numbers did not add up, or the shape was wrong
  }

  const equations = [];
  if (Array.isArray(raw.equations)) {
    for (const e of raw.equations.slice(0, MAX_EQUATIONS)) {
      const t = str(e, 60);
      if (!t) continue;
      const r = fixEquation(t);
      if (r.fixed) fixed++;
      equations.push(r.text);
    }
  }

  // Every maths story gets a picture, and a fact-family picture uses the
  // numbers of the equations list. No picture from the model: build one from
  // the first plain whole-number equation. A fact family that is not one of
  // the listed equations is replaced by the listed one.
  const facts = equations.map(equationFact).filter(Boolean);
  const derived = equations.map(equationVisual).filter(Boolean); // facts, chains, equations with a blank
  if (!visual && derived.length) { visual = derived[0]; visualSource = 'derived'; }
  else if (visual && visual.type === 'factFamily' && facts.length && !facts.some((f) => sameFact(f, visual))) {
    visual = facts[0]; visualSource = 'derived'; fixed++;
  }

  let tryTogether = null;
  const tt = raw.tryTogether;
  let question = tt && str(tt.question, 300);
  // A "= ?" left at the end of a sentence with no expression before it (seen in
  // Telugu and Tamil replies) is cut off, not retried.
  if (question && /=\s*(\?|_+|□)?\s*$/.test(question) && questionValue(question) == null) {
    question = question.replace(/\s*=\s*(\?|_+|□)?\s*$/, '').trim();
    fixed++;
  }
  let answer = tt && str(typeof tt.answer === 'number' ? String(tt.answer) : tt.answer, 300);
  if (!question || !answer) {
    issues.push('tryTogether missing');
  } else {
    const value = questionValue(question);
    if (value != null) {
      const numbers = (answer.match(/\d+/g) || []).map(Number);
      if (/^\d+$/.test(answer) && Number(answer) !== value) { answer = String(value); fixed++; }
      else if (!numbers.includes(value)) issues.push('tryTogether answer disagrees with its question');
    }
    tryTogether = { question, answer };
  }

  const parentPrompt = str(raw.parentPrompt, 500);
  if (!parentPrompt) issues.push('parentPrompt missing');

  // One word for the counted things: the picture's itemNoun must be the word
  // the scenes and the try-together question use (haiku once wrote the Telugu
  // word for "messages" where the story meant laddus). Matched by stem, so the
  // endings of an inflected language (లడ్డు, లడ్డూలు, లడ్డులను) still count.
  if (visual && visual.type === 'groups' && visual.itemNoun) {
    const stem = nounStem(visual.itemNoun);
    const has = (t) => t.normalize('NFC').toLowerCase().includes(stem);
    const inScenes = scenes.filter((s) => has(s.text)).length;
    if (inScenes < 2) {
      issues.push(`the word "${visual.itemNoun}" (visual.itemNoun) is not used in the scenes; use exactly that word for the counted things`);
    }
    if (tryTogether && !has(tryTogether.question)) {
      issues.push(`the try-together question does not use the word "${visual.itemNoun}"; use the same word`);
    }
  }

  // A Venn diagram is drawn from the story's own sets: at least half of its
  // elements must be named in the story (short items such as numbers are
  // matched whole, longer words by stem so an inflected ending still counts).
  if (visual && visual.type === 'venn') {
    const texts = [...scenes.map((s) => s.text), tryTogether ? tryTogether.question : '', ...equations].join(' ').normalize('NFC').toLowerCase();
    const named = vennElements(visual).filter((e) => {
      const t = e.normalize('NFC').toLowerCase();
      return texts.includes(t.length <= 3 ? t : nounStem(t));
    }).length;
    if (named * 2 < vennElements(visual).length) {
      issues.push('the Venn diagram shows elements the story does not name; draw it from the sets in the story itself');
    }
  }

  // A sum written in a scene must be right, and agree with the equations list.
  issues.push(...sceneEquationIssues(scenes.map((s) => s.text), equations));

  // Scene 3 (the big idea) is 1 to 3 sentences. Asked again once; on the last
  // try it is cut after its third sentence, never in the middle of one.
  const scene3 = scenes.find((s) => s.label === 'mathMoment') || scenes[2];
  if (scene3) {
    const n = splitSentences(scene3.text).length;
    if (n > MAX_SCENE3_SENTENCES) {
      if (ctx.final) { scene3.text = trimToSentences(scene3.text, MAX_SCENE3_SENTENCES); fixed++; }
      else issues.push(`scene 3 has ${n} sentences; write it in 1 to 3 short sentences (technical terms stay in the lesson's language, the explanation in the story language)`);
    }
  }

  // A lesson that is not maths: no percentage arithmetic in the try-together.
  const maths = isMathsStory({ tag: str(raw.gradeSubjectTag, 80), visual, equations });
  if (!maths && tryTogether) {
    const pq = percentQuestionIssue(tryTogether.question);
    if (pq) issues.push(pq);
  }

  // The try-together question is a NEW problem: it must not reuse both
  // numbers of the fact-family picture.
  if (tryTogether && visual && visual.type === 'factFamily') {
    const nums = new Set((asciiDigits(tryTogether.question).match(/\d+/g) || []).map(Number));
    if (nums.has(visual.a) && nums.has(visual.b)) {
      issues.push(`the try-together question reuses the picture's numbers (${visual.a} and ${visual.b}); write a new problem with new numbers`);
    }
  }

  if (issues.length) return { ok: false, issues };

  const words = scenes.map(s => s.text).join(' ').split(/\s+/).length;
  const minutes = int(raw.readMinutes);
  return {
    ok: true,
    fixed,
    visualSource,
    maths,
    concept: typeof raw.concept === 'string' ? raw.concept.slice(0, 80) : '',
    story: {
      title,
      gradeSubjectTag: str(raw.gradeSubjectTag, 80) || '',
      readMinutes: minutes != null && minutes >= 1 && minutes <= 10 ? minutes : Math.max(1, Math.ceil(words / 110)),
      scenes: scenes.map((s) => ({ ...s, text: timesSign(s.text) })),
      visual,
      equations: equations.map(timesSign),
      tryTogether: tryTogether && { ...tryTogether, question: timesSign(tryTogether.question) },
      parentPrompt,
    },
  };
}

// The model's JSON parsed but did not pass: keep what a parent can still
// read. Returns a story with fallback: true, or null when nothing readable
// is left (the route then answers with its usual 502).
export function salvageStory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pieces = [];
  if (Array.isArray(raw.scenes)) {
    for (const s of raw.scenes) { const t = s && str(s.text, 700); if (t) pieces.push(t); }
  }
  if (!pieces.length && typeof raw.story === 'string') {
    // the old shape: one story string, cut into at most 4 groups of sentences
    const sentences = raw.story.split(/(?<=[.!?।])\s+/).map(s => s.trim()).filter(Boolean);
    const per = Math.max(1, Math.ceil(sentences.length / 4));
    for (let i = 0; i < sentences.length; i += per) pieces.push(sentences.slice(i, i + per).join(' ').slice(0, 700));
  }
  if (pieces.join('').length < 20) return null;
  return {
    fallback: true,
    title: str(raw.title, 120) || str(raw.subject, 120) || '',
    gradeSubjectTag: '',
    readMinutes: 1,
    scenes: pieces.slice(0, 6).map((text, i) => ({ label: SCENE_LABELS[Math.min(i, 3)], text })),
    visual: null,
    equations: [],
    tryTogether: null,
    parentPrompt: str(raw.parentPrompt, 500) || str(raw.abhyasaPrompt, 500) || '',
  };
}
