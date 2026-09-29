// Unit tests for server/cron-auth.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronAuthorized } from '../../server/cron-auth.js';

test('header token must match', () => {
  assert.equal(cronAuthorized({ 'x-cron-token': 'abc' }, 'abc'), true);
  assert.equal(cronAuthorized({ 'x-cron-token': 'abd' }, 'abc'), false);
  assert.equal(cronAuthorized({ 'x-cron-token': 'abcd' }, 'abc'), false);
});

test('missing header, empty header or no configured token is refused', () => {
  assert.equal(cronAuthorized({}, 'abc'), false);
  assert.equal(cronAuthorized({ 'x-cron-token': '' }, 'abc'), false);
  assert.equal(cronAuthorized({ 'x-cron-token': '' }, ''), false);
  assert.equal(cronAuthorized({ 'x-cron-token': 'abc' }, undefined), false);
  assert.equal(cronAuthorized(undefined, 'abc'), false);
});

test('a repeated header (array) is refused', () => {
  assert.equal(cronAuthorized({ 'x-cron-token': ['abc', 'abc'] }, 'abc'), false);
});
