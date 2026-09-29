// Unit tests for server/arith-check.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { solveArithmetic, evaluate, checkArithmetic, applyArithmeticCheck } from '../../server/arith-check.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures');
const rows = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).rows;
const ROWS = [...rows('worksheet-rows.json'), ...rows('worksheet-12-rows.json')];

test('every worksheet row solves to its correct answer', () => {
  for (const r of ROWS) {
    assert.equal(solveArithmetic(r.question), Number(r.correct), r.question);
    assert.equal(solveArithmetic(`${r.n}) ${r.question}`), Number(r.correct), 'numbered ' + r.question);
    assert.equal(solveArithmetic(`${r.question} ${r.written}`), Number(r.correct), 'with the child\'s answer ' + r.question);
    assert.equal(solveArithmetic(`${r.question} ?`), Number(r.correct), '= ? ' + r.question);
  }
});

test('missing-number forms', () => {
  assert.equal(solveArithmetic('6 × 9 = 6 × 3 × __'), 3);
  assert.equal(solveArithmetic('__ + 5 = 12'), 7);
  assert.equal(solveArithmetic('45 − __ = 27'), 18);
  assert.equal(solveArithmetic('8 × ( ) = 56'), 7);
  assert.equal(solveArithmetic('3/4 = __/8'), 6);
  assert.equal(solveArithmetic('(12 + 8) × 3 = __ × 20'), 3);
});

test('left alone: words, decimals, non-whole results, divisor blanks, two blanks', () => {
  for (const q of ['Ravi has 5 apples and eats 2. How many are left?', 'Find 45 − 18', '2.5 + 1 =',
    '7 ÷ 2 =', '72 ÷ __ = 8', '__ + __ = 10', 'x + 5 = 12', '3:4 = 6:8', '6 × 9 = 6 × 3 × 3', '', null]) {
    assert.equal(solveArithmetic(q), null, String(q));
  }
});

test('evaluate: precedence and brackets', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('100 - 45 - 5'), 50);
  assert.equal(evaluate('72 / 8 * 3'), 27);
  assert.equal(evaluate('5 / 0'), null);
  assert.equal(evaluate('5 +'), null);
});

test('checkArithmetic: the 2026-09-29 reply (copied answers) is fixed and counted', () => {
  const json = { mode: 'questions', extracted_questions: [
    { question: '24 + 13 =', answer: '37', reasoning: 'r' },
    { question: '45 − 18 =', answer: '33', reasoning: 'r' },
    { question: '7 × 8 =', answer: '7 × 8 = 54', reasoning: 'r' },
    { question: 'Write a sentence with "because".', answer: 'I stayed home because it rained.' },
    { question: '72 ÷ 8 =', answer: 'nine' },
  ] };
  const { json: out, checked, fixed } = checkArithmetic(json);
  assert.equal(checked, 4);
  assert.equal(fixed, 3);
  assert.deepEqual(out.extracted_questions.map((q) => q.answer), ['37', '27', '7 × 8 = 56', 'I stayed home because it rained.', '9']);
  assert.equal(out.extracted_questions[1].reasoning, 'r');
});

test('applyArithmeticCheck rewrites only the text block, and only when something changed', () => {
  const reply = (qs) => ({ id: 'm', content: [{ type: 'text', text: 'Here: ' + JSON.stringify({ mode: 'questions', extracted_questions: qs }) }] });
  const good = reply([{ question: '24 + 13 =', answer: '37' }]);
  assert.equal(applyArithmeticCheck(good).data, good);
  const bad = applyArithmeticCheck(reply([{ question: '45 − 18 =', answer: '33' }]));
  assert.equal(bad.fixed, 1);
  assert.equal(JSON.parse(bad.data.content[0].text).extracted_questions[0].answer, '27');
  assert.equal(applyArithmeticCheck({ content: [{ type: 'text', text: 'no json' }] }).fixed, 0);
});
