// Unit checks for auth-cache.mjs (TUT-104). Run: node --test tests/e2e/auth-cache.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  phone10, statePath, isCachedSpec, readCookies, saveState, recordOtp, countOtp,
  budgetVerdict, makeAuthDir, removeAuthDir, CACHED_PHONES,
} from './auth-cache.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tutp-e2e-auth-test-'));

test('phone10 takes the last 10 digits, whatever the format', () => {
  assert.equal(phone10('+919999900001'), '9999900001');
  assert.equal(phone10('9999900001'), '9999900001');
  assert.equal(phone10('+91 99999 00001'), '9999900001');
});

test('statePath is one file per account inside the dir', () => {
  assert.equal(statePath('/d', '+919999900004'), path.join('/d', '9999900004.json'));
});

test('only the specs that share a login use the cache; login, family, partners, cache never do', () => {
  for (const s of ['el.spec.js', 'story.spec.js', 'homework.spec.js', 'learning-library.spec.js', 'answer-explain.spec.js']) assert.equal(isCachedSpec(s), true, s);
  for (const s of ['login.spec.js', 'family.spec.js', 'partners.spec.js', 'cache.spec.js', 'cron.spec.js']) assert.equal(isCachedSpec(s), false, s);
});

test('family B member 9999900006 is never cached (family r4 removes it every run)', () => {
  assert.ok(!CACHED_PHONES.includes('9999900006'));
  assert.ok(CACHED_PHONES.includes('9999900001'));
});

test('saveState keeps the session cookie and drops the logged-out marker; readCookies returns it', () => {
  const dir = tmp();
  try {
    assert.equal(readCookies(dir, '+919999900001'), null);
    saveState(dir, '+919999900001', { cookies: [{ name: 'tutp_session', value: 'x' }, { name: 'tutp_logged_out', value: '1' }], origins: [] });
    const c = readCookies(dir, '9999900001');
    assert.deepEqual(c.map((k) => k.name), ['tutp_session']);
  } finally { removeAuthDir(dir); }
});

test('OTP counter counts one line per send and is zero for a fresh dir', () => {
  const dir = tmp();
  try {
    assert.equal(countOtp(dir), 0);
    recordOtp(dir); recordOtp(dir); recordOtp(dir);
    assert.equal(countOtp(dir), 3);
  } finally { removeAuthDir(dir); }
});

test('budget: 30 is the target, over 50 is a hard fail', () => {
  assert.equal(budgetVerdict(30), 'ok');
  assert.equal(budgetVerdict(31), 'over-target');
  assert.equal(budgetVerdict(50), 'over-target');
  assert.equal(budgetVerdict(51), 'fail');
});

test('removeAuthDir deletes the dir, and refuses a dir that is not ours', () => {
  const dir = makeAuthDir();
  assert.ok(fs.existsSync(dir));
  assert.ok(path.basename(dir).startsWith('tutp-e2e-auth-'));
  removeAuthDir(dir);
  assert.equal(fs.existsSync(dir), false);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'something-else-'));
  try {
    assert.throws(() => removeAuthDir(other));
    assert.ok(fs.existsSync(other));
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
});
