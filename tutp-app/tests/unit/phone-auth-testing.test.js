// Unit tests for public/app/shared/phone-auth-testing.js (TUT-59):
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDisableAppVerification as f } from '../../public/app/shared/phone-auth-testing.js';

const PREVIEW = 'tut43---tutp-demo-vs4743puka-uc.a.run.app';

test('test number on a tagged preview host: skip reCAPTCHA', () => {
  assert.equal(f('+919999900001', PREVIEW), true);
  assert.equal(f('+91 99999 00005', PREVIEW), true);
  assert.equal(f('+919999900009', PREVIEW), true);
});

test('real number on a preview host: keep reCAPTCHA', () => {
  assert.equal(f('+919876543210', PREVIEW), false);
  assert.equal(f('+919999900000', PREVIEW), false);
  assert.equal(f('+919999900010', PREVIEW), false);
  assert.equal(f('', PREVIEW), false);
  assert.equal(f(undefined, PREVIEW), false);
});

test('test number on tutp.online or an untagged host: keep reCAPTCHA', () => {
  assert.equal(f('+919999900001', 'tutp.online'), false);
  assert.equal(f('+919999900001', 'www.tutp.online'), false);
  assert.equal(f('+919999900001', 'tutp-demo-vs4743puka-uc.a.run.app'), false);
  assert.equal(f('+919999900001', 'localhost'), false);
  assert.equal(f('+919999900001', ''), false);
});
