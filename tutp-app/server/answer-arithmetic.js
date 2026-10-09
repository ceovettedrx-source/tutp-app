// Answer Please, plain arithmetic (TUT-28). The math engine (server/math-engine.js,
// TUT-19) reads the question; when it can, the card is BUILT HERE and the model's
// text for that question is dropped:
//   one steps block: the working line (the question with its answer filled in) and
//   a final_answer that is the value only ("3", "0", "28.5"), never an expression.
// The "checked" mark is set by the caller only for a card built here.
// Also: reasoningIn() finds the model's own thinking-out-loud in a block.
// Unit tests: tests/unit/answer-arithmetic.test.js.
import { parseQuestion, answerMatches } from './math-engine.js';

const BLANK = /[_＿]{2,}|_|□|\?/;

// "24 + 29 + ____ = 10 + 14 + 29" + "0" -> "24 + 29 + 0 = 10 + 14 + 29"
export function workingLine(qText, parsed) {
  const base = String(qText || '').replace(/^\s*\(?\d{1,2}[).]\s+/, '').replace(/\s+/g, ' ').trim();
  const line = BLANK.test(base)
    ? base.replace(BLANK, parsed.answerText).replace(/\s*=\s*$/, '')
    : base.replace(/\s*=\s*[\d.,]*\s*$/, '') + ' = ' + parsed.answerText;
  return line.length <= 200 ? line : parsed.answerText;
}

// The text the model gave as "the answer" of a question, for the mismatch count.
function modelAnswerText(blocks) {
  const steps = blocks.find((b) => b.type === 'steps');
  if (steps) return steps.final_answer;
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
}

// -> null (the engine does not read this question: keep the model's card)
//    { blocks, mismatch }  mismatch: the model's own answer had another VALUE than the engine's
export function engineBlocks(qText, modelBlocks) {
  const parsed = parseQuestion(qText);
  if (!parsed) return null;
  const mismatch = !answerMatches(parsed, modelAnswerText(modelBlocks || []));
  return {
    parsed, mismatch,
    blocks: [{ type: 'steps', given: [], find: '', formula: [], substitution: [workingLine(qText, parsed)], final_answer: parsed.answerText }],
  };
}

// Working-out that must never reach a card. English markers: the model thinks in English.
const REASONING = [
  /\b(let me|let's|hmm|on second thought|so the missing|so missing|double[- ]check|re-?check)\b/i,
  /\bwait\b\s*[,.!…-]/i,
  /\bcheck\s*:/i,
  /\banswer\s*:[^]*\banswer\s*:/i,
];
export function reasoningIn(text) {
  const t = String(text || '');
  return REASONING.some((r) => r.test(t));
}

// How many model-built cards do not have the block kind their q_type calls for
// (numerical -> steps, difference -> compare_table, the rest -> text). Engine-built cards are
// all steps by construction and are left out. A count only (X-Answer-Format-Mixed): no retry.
export function formatMismatches(questions) {
  const want = (t) => (t === 'numerical' ? 'steps' : t === 'difference' ? 'compare_table' : 'text');
  return (questions || []).filter((q) => !q.checked && q.blocks && q.blocks[0] && q.blocks[0].type !== want(q.q_type)).length;
}

// every string a parent could read in a question's blocks
export function blockStrings(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === 'text') out.push(b.text);
    else if (b.type === 'compare_table') b.rows.forEach((r) => out.push(...r));
    else out.push(...(b.given || []), b.find, ...(b.formula || []).map((f) => f.text), ...(b.substitution || []), b.final_answer);
  }
  return out.filter(Boolean);
}
