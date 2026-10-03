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

import { solveArithmetic } from './arith-check.js';

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
  const v = raw.visual;
  if (v && typeof v === 'object') {
    const total = int(v.total);
    const groups = Array.isArray(v.groups) ? v.groups.map(int) : [];
    const noun = str(v.itemNoun, 40);
    const sum = groups.reduce((a, b) => a + (b || 0), 0);
    const good = v.type === 'groups' && noun && total != null && total >= 1 && total <= MAX_VISUAL_TOTAL
      && groups.length >= 1 && groups.length <= 12 && groups.every(g => g != null && g >= 1) && sum === total;
    if (good) visual = { type: 'groups', itemNoun: noun, total, groups };
    else fixed++; // dropped: the groups did not add up to the total, or the shape was wrong
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
  if (visual) {
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

  if (issues.length) return { ok: false, issues };

  const words = scenes.map(s => s.text).join(' ').split(/\s+/).length;
  const minutes = int(raw.readMinutes);
  return {
    ok: true,
    fixed,
    story: {
      title,
      gradeSubjectTag: str(raw.gradeSubjectTag, 80) || '',
      readMinutes: minutes != null && minutes >= 1 && minutes <= 10 ? minutes : Math.max(1, Math.ceil(words / 110)),
      scenes, visual, equations, tryTogether, parentPrompt,
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
