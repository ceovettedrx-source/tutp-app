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
import { pickIcon } from './story-icons.js';

export const SCENE_LABELS = ['hook', 'problem', 'mathMoment', 'wrapUp'];
const MAX_VISUAL_TOTAL = 1000; // the page draws at most 60 items and counts the rest
const MAX_EQUATIONS = 6;

function str(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
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

// The model's visual -> a checked visual, or null when its shape or numbers
// are wrong. Types: groups, numberLine, barModel, factFamily.
export function validateVisual(v) {
  if (!v || typeof v !== 'object') return null;
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
    return { type: 'numberLine', from, to, step, jumps };
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
    return total && parts.length >= 2 && parts.length <= 6 && sum === total ? { type: 'barModel', parts, total } : null;
  }
  if (v.type === 'factFamily') {
    const a = num(v.a), b = num(v.b), total = num(v.total);
    const op = v.op === 'multiply' ? 'multiply' : v.op === 'add' ? 'add' : null;
    if (!a || !b || !total || !op) return null;
    if ((op === 'add' ? a + b : a * b) !== total) return null;
    return { type: 'factFamily', a, b, total, op };
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

// raw (parsed JSON) -> { ok: true, story, fixed } or { ok: false, issues }.
export function validateStory(raw) {
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
    visual = validateVisual(v);
    if (visual) visualSource = 'model';
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
  if (!visual && facts.length) { visual = facts[0]; visualSource = 'derived'; }
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
  if (visual && visual.type === 'groups') {
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

  // A sum written in a scene must be right, and agree with the equations list.
  issues.push(...sceneEquationIssues(scenes.map((s) => s.text), equations));

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
