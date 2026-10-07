// Notes quality v2: does the generated title/key idea belong to THIS homework,
// and does the quick check use new numbers? Pure functions, no I/O. A failed
// check triggers at most one retry in server/routes/chips.js.

import { foreignScriptIn, FOREIGN_SCRIPT_HINT } from './lang-check.js';

const STOP = new Set(['what', 'which', 'with', 'from', 'that', 'this', 'there', 'their', 'have', 'find', 'write', 'fill', 'blank', 'blanks', 'answer', 'answers', 'following', 'question', 'questions', 'give', 'make', 'each', 'when', 'then', 'than', 'into', 'about', 'using', 'solve', 'complete', 'homework']);

const scriptOf = (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 0x0c00 && c <= 0x0c7f) return 'te';
  if (c >= 0x0900 && c <= 0x097f) return 'hi';
  if (/\p{Script=Latin}/u.test(ch)) return 'la';
  return 'other';
};

const stem = (w, s) => (s === 'la' ? w.toLowerCase().slice(0, 5) : [...w].slice(0, 4).join(''));

function words(text) {
  const out = [];
  for (const w of String(text || '').match(/[\p{L}\p{M}]+/gu) || []) {
    const s = scriptOf(w);
    const len = [...w].length;
    if (s === 'other') continue;
    if (s === 'la' ? len < 4 || STOP.has(w.toLowerCase()) : len < 3) continue;
    out.push({ s, stem: stem(w, s) });
  }
  return out;
}

export function numbersIn(text) {
  // "1. " list numbering at the start of a line is not a number of the homework.
  const nums = String(text || '').replace(/^\s*\d+[.)]\s+/gm, '').replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) || [];
  return nums.filter((n) => n !== '0' && n !== '1');
}

function operatorsIn(text) {
  const t = String(text || '').replace(/(\d)\s*[xX*]\s*(?=\d|_)/g, '$1 × ');
  const ops = new Set();
  for (const ch of t) if ('+×÷='.includes(ch)) ops.add(ch);
  if (/\d\s*\/\s*\d/.test(t)) ops.add('/');
  return ops;
}

// { ok, reasons } for the notes (structured form) against the homework text.
// Reasons: 'no_overlap' (title and key idea share no number, operator or
// keyword with the homework), 'quick_reuse' (a quick-check question repeats
// homework numbers).
export function checkNotes(notes, homework) {
  const reasons = [];
  // A letter of a wrong script inside a word (img1, server/lang-check.js): always checked, even with no homework text.
  if (notes && !notes.plain && foreignScriptIn(notes)) reasons.push('foreign_script');
  if (!notes || notes.plain || !homework) return { ok: reasons.length === 0, reasons };
  // Title, key idea and the worked example's problem: a good key idea for a
  // numbers-only homework names the skill in words ("split one factor and keep
  // both sides equal") and has no digits, so the example problem carries the
  // operators and shape of the homework.
  const head = `${notes.title || ''} ${notes.key_idea || ''} ${(notes.worked_example && notes.worked_example.problem) || ''}`;

  const hwNums = new Set(numbersIn(homework));
  const hwOps = operatorsIn(homework);
  // Homework words are only comparable in the script the notes' own prose uses
  // (a Telugu key idea cannot echo an English word it translated).
  const headScripts = new Set(words(`${notes.title || ''} ${notes.key_idea || ''}`).map((w) => w.s));
  const hwWords = words(homework).filter((w) => headScripts.has(w.s));
  if (hwNums.size || hwOps.size || hwWords.length) {
    const headNums = new Set(numbersIn(head));
    const headOps = operatorsIn(head);
    const headStems = new Set(words(head).map((w) => w.stem));
    const shared = [...hwNums].some((n) => headNums.has(n))
      || [...hwOps].some((o) => headOps.has(o))
      || hwWords.some((w) => headStems.has(w.stem));
    if (!shared) reasons.push('no_overlap');
  }

  const lines = String(homework).split('\n').map((l) => new Set(numbersIn(l))).filter((s) => s.size);
  const reused = (notes.quick_check || []).some((p) => {
    const q = new Set(numbersIn(p.q));
    if (!q.size) return false;
    // The same numbers as a homework question (one set contains the other).
    return lines.some((l) => [...q].every((n) => l.has(n)) || [...l].every((n) => q.has(n)));
  });
  if (reused) reasons.push('quick_reuse');
  return { ok: reasons.length === 0, reasons };
}

// The extra line for the single retry.
export function correctionHint(reasons, homework) {
  const parts = [];
  if (reasons.includes('no_overlap')) {
    parts.push('Your title and key_idea were not about this exact homework. Name the specific skill these questions practise and mention its numbers or symbols, not a general list of properties.');
  }
  if (reasons.includes('quick_reuse')) {
    parts.push('Your quick_check repeated numbers from the homework. Use completely different numbers.');
  }
  if (reasons.includes('foreign_script')) parts.push(FOREIGN_SCRIPT_HINT);
  return parts.join(' ');
}
