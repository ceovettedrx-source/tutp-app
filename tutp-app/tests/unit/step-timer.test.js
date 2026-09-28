// Unit tests for server/step-timer.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTimer } from '../../server/step-timer.js';

test('steps, summary and Server-Timing header', () => {
  let t = 1000;
  const timer = stepTimer(() => t);
  t += 40; timer.mark('auth');
  t += 7020.4; timer.mark('model1');
  t += 1; timer.mark('boxes');
  assert.equal(timer.summary(), 'auth 40 | model1 7020 | boxes 1 = 7061 ms');
  assert.equal(timer.header(), 'auth;dur=40, model1;dur=7020, boxes;dur=1, total;dur=7061');
});

test('no steps: total only', () => {
  const timer = stepTimer(() => 5);
  assert.equal(timer.header(), 'total;dur=0');
});
