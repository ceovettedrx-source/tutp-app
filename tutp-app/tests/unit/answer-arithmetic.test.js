// TUT-28: Answer please builds plain-arithmetic cards in code (one format, the value only,
// "checked"), keeps the model's card for everything else, and refuses working-out text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingLine, engineBlocks, reasoningIn, formatMismatches, blockStrings } from '../../server/answer-arithmetic.js';
import { parseQuestion } from '../../server/math-engine.js';
import { validateAnswer, mergeAnswers } from '../../server/answer-schema.js';

const line = (q) => workingLine(q, parseQuestion(q));
const steps = (final, extra = {}) => ({ type: 'steps', given: ['a'], find: 'x', formula: [{ text: 'f', why_text: 'w' }], substitution: ['s'], final_answer: final, ...extra });
const text = (t) => ({ type: 'text', text: t });
const Q = (q_text, blocks, extra = {}) => ({ q_text, q_type: 'short', marks: null, blocks, keywords: ['xx'], diagram: null, concept_key: 'c3-maths-sums', scene_prompt: 'A boy with five red apples in a basket.', ...extra });
const reply = (questions, subject = 'Mathematics') => ({ status: 'ok', subject, questions });

test('the working line fills the blank, in the question\'s own words', () => {
  assert.equal(line('24 + 29 + ____ = 10 + 14 + 29'), '24 + 29 + 0 = 10 + 14 + 29');
  assert.equal(line('6 × 9 = 6 × 3 × ____'), '6 × 9 = 6 × 3 × 3');
  assert.equal(line('9 + 3 = ____'), '9 + 3 = 12');
  assert.equal(line('9 + 3'), '9 + 3 = 12');
  assert.equal(line('1) 45 − 18 = ____'), '45 − 18 = 27');
  assert.equal(line('8 ÷ 2 = ?'), '8 ÷ 2 = 4');
});

test('the founder\'s Q4: the answer is 0, as a value, whatever the model said', () => {
  const b = engineBlocks('24 + 29 + ____ = 10 + 14 + 29', [text('so missing number is 14 ... check ... Answer: 0')]);
  assert.equal(b.blocks.length, 1);
  assert.equal(b.blocks[0].type, 'steps');
  assert.equal(b.blocks[0].final_answer, '0');
  assert.deepEqual(b.blocks[0].substitution, ['24 + 29 + 0 = 10 + 14 + 29']);
  assert.equal(b.mismatch, false, 'the model\'s last number was 0 too');
  const wrong = engineBlocks('24 + 29 + ____ = 10 + 14 + 29', [steps('14')]);
  assert.equal(wrong.mismatch, true);
  assert.equal(wrong.blocks[0].final_answer, '0');
});

test('the answer is the blank\'s value, never an expression', () => {
  const b = engineBlocks('6 × 9 = 6 × 3 × ____', [steps('6 × 3 × 3')]);
  assert.equal(b.blocks[0].final_answer, '3');
  assert.equal(b.mismatch, false, 'same value, only the shape was wrong');
});

test('questions the engine does not read keep the model\'s card', () => {
  for (const q of ['Ravi has 5 apples and buys 3 more. How many now?', 'Name the capital of France.', 'Find the speed if d = 120 km and t = 4 h', 'What is photosynthesis?']) {
    assert.equal(engineBlocks(q, [text('x')]), null, q);
  }
});

test('two batches, two styles in, one format out for arithmetic', () => {
  const b1 = validateAnswer(reply([Q('9 = 3 × ____', [text('3')]), Q('9 + 3 = ____', [text('12')])]), {});
  const b2 = validateAnswer(reply([Q('45 − 18 = ____', [steps('27')]), Q('8 ÷ 2 = ____', [steps('4', { given: ['8', '2'], find: 'x' })])]), {});
  assert.ok(b1.ok && b2.ok, JSON.stringify([b1.issues, b2.issues]));
  const merged = mergeAnswers([b1.answer, b2.answer]);
  assert.equal(merged.questions.length, 4);
  for (const q of merged.questions) {
    assert.equal(q.blocks.length, 1);
    assert.deepEqual(Object.keys(q.blocks[0]).sort(), ['final_answer', 'find', 'formula', 'given', 'substitution', 'type']);
    assert.deepEqual(q.blocks[0].given, []);
    assert.deepEqual(q.blocks[0].formula, []);
    assert.equal(q.checked, true);
    assert.deepEqual(q.keywords, []);
    assert.equal(q.scene_prompt, '');
  }
  assert.deepEqual(merged.questions.map((q) => q.blocks[0].final_answer), ['3', '12', '27', '4']);
});

test('a mismatch is counted, a matching answer is not', () => {
  const v = validateAnswer(reply([Q('9 + 3 = ____', [steps('13')]), Q('8 ÷ 2 = ____', [steps('4')])]), {});
  assert.equal(v.mismatches, 1);
  assert.equal(v.answer.questions[0].blocks[0].final_answer, '12');
});

test('"checked" is only ever set on an engine-built card', () => {
  const v = validateAnswer(reply([Q('Ravi has 5 apples and buys 3 more. How many now?', [steps('8')], { checked: true })]), {});
  assert.ok(v.ok);
  assert.equal(v.answer.questions[0].checked, undefined);
});

test('no per-card picture on a maths page, even for a question the engine cannot read; other subjects keep theirs', () => {
  const word = Q('Ravi has 5 apples and buys 3 more. How many now?', [text('8 apples')]);
  assert.equal(validateAnswer(reply([word], 'Mathematics'), {}).answer.questions[0].scene_prompt, '');
  const sci = Q('What is photosynthesis?', [text('Plants make food using light.')], { keywords: [], scene_prompt: 'A green plant in sunlight.' });
  assert.ok(validateAnswer(reply([sci], 'Science'), {}).answer.questions[0].scene_prompt.length > 0);
});

test('working-out in a model-built card is a hard issue, then degrades to the clean final answer', () => {
  const bad = Q('What is the unit of force?', [text('Let me think. The unit of force is the newton. Check: yes.')], { keywords: [] });
  const v = validateAnswer(reply([bad], 'Science'), {});
  assert.equal(v.ok, false);
  assert.match(v.issues.join(' '), /working-out/);
  const bad2 = Q('Find the speed: d = 120 km, t = 4 h', [steps('30 km/h', { substitution: ['wait, 120 / 4 = 30'] })], { q_type: 'numerical', keywords: [] });
  const strict = validateAnswer(reply([bad2], 'Science'), {});
  assert.equal(strict.ok, false);
  const soft = validateAnswer(reply([bad2], 'Science'), { degrade: true });
  assert.equal(soft.ok, true);
  assert.deepEqual(soft.answer.questions[0].blocks, [{ type: 'text', text: '30 km/h' }]);
  const unrecoverable = Q('Find the speed: d = 120 km, t = 4 h', [steps('hmm 30 km/h')], { q_type: 'numerical', keywords: [] });
  assert.equal(validateAnswer(reply([unrecoverable], 'Science'), { degrade: true }).ok, false);
});

test('reasoning markers', () => {
  for (const t of ['so missing number is 14 ... check', 'Wait, that is wrong', 'Answer: 0 so Answer: 3', 'Check: 3 + 4']) assert.equal(reasoningIn(t), true, t);
  for (const t of ['The newton is the unit of force.', '30 km/h', 'Plants make food. The answer is found by adding.']) assert.equal(reasoningIn(t), false, t);
});

test('format check: counts model-built cards whose block kind does not follow q_type', () => {
  const qs = [
    { q_type: 'numerical', blocks: [{ type: 'steps' }] },
    { q_type: 'numerical', blocks: [{ type: 'text' }] },
    { q_type: 'short', blocks: [{ type: 'text' }] },
    { q_type: 'difference', blocks: [{ type: 'text' }] },
    { q_type: 'short', checked: true, blocks: [{ type: 'steps' }] },
  ];
  assert.equal(formatMismatches(qs), 2);
});

test('blockStrings lists every string a parent could read', () => {
  assert.ok(blockStrings([steps('5')]).includes('5'));
  assert.ok(blockStrings([text('hello')]).includes('hello'));
});
