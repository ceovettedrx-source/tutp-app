// Math engine (TUT-19, server/math-engine.js).
//   node --test tests/unit/math-engine.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion, verifyCard, asciiDigits, answerMatches, correctionHint } from '../../server/math-engine.js';

// The 8 questions of the live bug (2026-10-09, Class 3-4 maths) and their answers.
const LIVE = [
  ['9 = 3 × __', '3'], ['100 × 5 = 25 × __', '20'], ['25 × 0 + 75 =', '75'], ['6 × 9 = 6 × 3 × __', '3'],
  ['9 + 3 = __', '12'], ['31 × 0 =', '0'], ['45 − 18 =', '27'], ['8 ÷ 2 = ?', '4'],
];

test('the 8 live questions are solved', () => {
  for (const [q, a] of LIVE) {
    const p = parseQuestion(q);
    assert.ok(p, q);
    assert.equal(p.answerText, a, q);
  }
});

test('whole, decimal and fraction sums; blank on either side', () => {
  assert.equal(parseQuestion('0.5 + 0.25 =').answerText, '0.75');
  assert.equal(parseQuestion('3/4 + 1/4 =').answerText, '1');
  assert.equal(parseQuestion('1/2 + 1/4 =').answerText, '3/4');
  assert.equal(parseQuestion('25 × __ = 100').answerText, '4');
  assert.equal(parseQuestion('__ + 5 = 12').answerText, '7');
  assert.equal(parseQuestion('__ ÷ 4 = 3').answerText, '12');
  assert.equal(parseQuestion('12 - __ = 5').answerText, '7');
});

test('digits of other scripts are read', () => {
  assert.equal(asciiDigits('१२ ౫ ௭ ٣'), '12 5 7 3');
  assert.equal(parseQuestion('१२ + ५ =').answerText, '17');
  assert.equal(parseQuestion('౧౨ × ౩ = ?').answerText, '36');
  assert.equal(parseQuestion('٦ × ٧ =').answerText, '42');
});

test('word problems, algebra and rubbish are not parsed (no mark, never a false one)', () => {
  for (const q of ['A car travels 120 km in 2 hours. Find its average speed.', 'Solve 2x + 3 = 11', 'Differentiate between distance and displacement.', '', 'abc', '5 ÷ 0 =', '7 + __ = 3']) {
    assert.equal(parseQuestion(q), null, q);
  }
  assert.equal(parseQuestion(null), null);
  assert.equal(parseQuestion('9'.repeat(200)), null);
});

test('the child\'s written answer after "=" is not part of the question numbers', () => {
  const p = parseQuestion('45 − 18 = 33');
  assert.equal(p.answerText, '27');
  assert.deepEqual(p.numbers, ['45', '18']);
});

test('verifyCard: right answer and its own numbers = checked', () => {
  for (const [q, a] of LIVE) {
    const nums = parseQuestion(q).numbers.join(' and ');
    const v = verifyCard({ question: q, card: { title: 't', quick: 'q', full: `We work ${nums} step by step.`, answer: a } });
    assert.equal(v.status, 'checked', q);
  }
});

test('verifyCard: 20 seeded wrong answers are all blocked', () => {
  let n = 0;
  for (const [q, a] of LIVE) {
    const nums = parseQuestion(q).numbers.join(' and ');
    for (const wrong of [String(Number(a) + 1), String(Number(a) + 10), String(Number(a) * 2 + 7)]) {
      if (wrong === a) continue;
      const v = verifyCard({ question: q, card: { full: `We work ${nums}.`, answer: wrong } });
      assert.equal(v.status, 'mismatch', `${q} -> ${wrong}`);
      assert.equal(v.reason, 'answer');
      n++;
    }
  }
  assert.ok(n >= 20, 'seeded ' + n);
});

test('verifyCard: a missing answer or a card that ignores the question\'s numbers is a mismatch', () => {
  assert.equal(verifyCard({ question: '25 × 0 + 75 =', card: { full: '25 and 0 and 75', answer: undefined } }).status, 'mismatch');
  const v = verifyCard({ question: '100 × 5 = 25 × __', card: { full: 'Multiply 9 by 3 to get 27.', answer: '20' } });
  assert.equal(v.status, 'mismatch');
  assert.equal(v.reason, 'numbers');
  assert.ok(v.missing.includes('100'));
});

test('verifyCard: a word problem is unchecked, whatever the card says', () => {
  const v = verifyCard({ question: 'A car travels 120 km in 2 hours.', card: { full: '120 / 2 = 60', answer: '60' } });
  assert.equal(v.status, 'unchecked');
});

test('answerMatches reads "x = 4", "100", "3/4", "0,75"-style and other-script answers', () => {
  const p = parseQuestion('25 × __ = 100');
  assert.ok(answerMatches(p, '4'));
  assert.ok(answerMatches(p, 'x = 4'));
  assert.ok(answerMatches(p, '25 × 4 = 100'.replace('= 100', '= 4') ) === true);
  assert.ok(answerMatches(p, '४'));
  assert.ok(!answerMatches(p, '5'));
  assert.ok(answerMatches(parseQuestion('1/2 + 1/4 ='), '3/4'));
  assert.ok(answerMatches(parseQuestion('1/2 + 1/4 ='), '0.75'));
  assert.ok(!answerMatches(p, null));
});

test('correctionHint names the right answer and the question\'s numbers', () => {
  const v = verifyCard({ question: '9 + 3 = __', card: { full: 'x', answer: '13' } });
  const h = correctionHint(v);
  assert.match(h, /12/);
  assert.match(h, /9, 3/);
  assert.equal(correctionHint({ status: 'checked' }), '');
});
