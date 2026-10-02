// Unit tests for server/fraction-check.js (exam prep gate, round 4):
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFractions, checkFractionsIn } from '../../server/fraction-check.js';

const ok = (t) => assert.deepEqual(checkFractions(t).wrong, [], t);
const bad = (t) => assert.ok(checkFractions(t).wrong.length > 0, 'should be flagged: ' + t);

test('true fraction statements pass', () => {
  ok('So 1/2 = 2/4 = 4/8.');
  ok('3/4 > 2/3 because 9/12 > 8/12');
  ok('1/4 + 2/4 = 3/4');
  ok('4/4 = 1 whole');
  ok('1 1/2 = 3/2');
  ok('2/3 is greater than 1/2, and 1/8 is less than 1/2.');
  ok('1/2 × 2 = 1');
  ok('3/6 ≠ 1/3');
  ok('1/3 < 1/2 < 2/3');
  ok('ఉదా: 1/2 = 2/4 అవుతుంది');
});

test('false fraction statements are flagged', () => {
  bad('1/2 = 2/2');
  bad('1/8 > 1/2');
  bad('2/3 is less than 1/2');
  bad('1/4 + 2/4 = 3/8');
  bad('1/2 = 2/4 = 3/8');
  bad('5/0 = 1');
});

test('partial expressions and plain numbers are left alone', () => {
  ok('half of 1/2 = 1/4');
  ok('Step 2 = add the tops');
  ok('There are 12 = 12 cards');
  assert.equal(checkFractions('no fractions here').checked, 0);
});

test('checkFractionsIn walks every string of a note', () => {
  const r = checkFractionsIn({ cards: [{ front: '1/2 = ?', back: '1/2 = 3/6' }, { front: 'x', back: '2/5 > 3/5' }] });
  assert.equal(r.wrong.length, 1);
  assert.match(r.wrong[0].reason, /2\/5 > 3\/5/);
});
