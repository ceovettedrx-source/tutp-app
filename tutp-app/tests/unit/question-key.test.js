// Explain cache key (TUT-19, server/question-key.js).
//   node --test tests/unit/question-key.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { questionKey, normalizeQuestion, classBand, KEY_VERSION } from '../../server/question-key.js';

test('harmless differences give one key: spaces, case, x × *, numbering, blank marks, full-width digits', () => {
  const same = ['6 × 9 = ?', '6x9=__', 'Q2.  6 X 9 =  ____', '2) 6 * 9 = □', '６ × ９ = ?', '6 × 9 = ( )'];
  const keys = new Set(same.map((q) => questionKey(q, '1-5')));
  assert.equal(keys.size, 1, same.map(normalizeQuestion).join(' | '));
  assert.equal(questionKey('8 ÷ 2 = ?', '1-5'), questionKey('8 / 2 = ?', '1-5'));
  assert.equal(questionKey('45 − 18 =', '1-5'), questionKey('45 - 18 =', '1-5'));
});

test('12 near-miss pairs all have distinct keys (digit, operator, blank place, side)', () => {
  const qs = [
    '25 × 0 + 75 =', '31 × 0 =', '100 × 5 = 25 × __', '9 = 3 × __', '9 = 3 × 3', '9 + 3 = __', '9 - 3 = __', '9 × 3 = __',
    '9 ÷ 3 = __', '__ × 3 = 9', '3 × __ = 9', '6 × 9 = 6 × 3 × __', '6 × 9 = 6 × 3 × 2', '16 × 9 = ?', '6 × 19 = ?', '6.5 × 9 = ?', '65 × 9 = ?', '3/4 + 1/4 =', '3 ÷ 4 + 1 ÷ 4 =',
  ];
  const keys = qs.map((q) => questionKey(q, '1-5'));
  assert.equal(new Set(keys).size, qs.length, 'two different questions share a key');
});

test('same concept, different numbers (the TUT-19 live bug) never share a key', () => {
  assert.notEqual(questionKey('100 × 5 = 25 × __', '1-5'), questionKey('9 = 3 × __', '1-5'));
});

test('key has the q2: version prefix (an old concept-only row is never a hit) and holds no student or family field', () => {
  const k = questionKey('6 × 9 = ?', '1-5');
  assert.ok(k.startsWith(KEY_VERSION) && /^q2:[0-9a-f]{40}$/.test(k), k);
  assert.ok(!/c4-|multiplication/.test(k));
});

test('class band is part of the key: 1-5, 6-8, 9-12 and unknown are four different keys', () => {
  const q = 'Find the speed of a car that travels 120 km in 2 hours.';
  const keys = ['1-5', '6-8', '9-12', 'x'].map((b) => questionKey(q, b));
  assert.equal(new Set(keys).size, 4);
  assert.equal(questionKey(q, 'junk'), questionKey(q, 'x'));
});

test('classBand: numbers, words around them, and unknown', () => {
  assert.equal(classBand('Class 4'), '1-5');
  assert.equal(classBand('5'), '1-5');
  assert.equal(classBand('Class 6'), '6-8');
  assert.equal(classBand('8th'), '6-8');
  assert.equal(classBand('Class 9'), '9-12');
  assert.equal(classBand('12'), '9-12');
  for (const u of ['', null, undefined, 'KG', 'Class ten', 'Class 13', 'Class 0']) assert.equal(classBand(u), 'x', String(u));
});

test('a hash of the extractor text: the same text always gives the same key', () => {
  assert.equal(questionKey('Q3. 12 + 8 = ?', '1-5'), questionKey('3) 12 + 8 = __', '1-5'));
});
