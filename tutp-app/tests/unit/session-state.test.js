// Unit tests for server/session-state.js (does a family session still stand):
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySession } from '../../server/session-state.js';

const phoneSession = { phone: '+919999900001', familyId: 16, viewerKey: null };
const mother = { role: 'mother', name: 'M' };

test('ok: the phone still has a role in its own family', () => {
  assert.deepEqual(classifySession({ session: phoneSession, familyExists: true, phoneFamily: { id: 16, roleMatches: [mother] } }),
    { state: 'ok', roleMatches: [mother] });
});

test('ok: two roles on one phone stay two roles (the picker is right there)', () => {
  const both = [mother, { role: 'father', name: 'F' }];
  assert.deepEqual(classifySession({ session: phoneSession, familyExists: true, phoneFamily: { id: 16, roleMatches: both } }).roleMatches, both);
});

test('family_gone: the family row was deleted (family 8, 2026-09-28)', () => {
  assert.deepEqual(classifySession({ session: { ...phoneSession, familyId: 8 }, familyExists: false, phoneFamily: { id: 16, roleMatches: [mother] } }),
    { state: 'family_gone' });
});

test('family_gone wins over a profile session too', () => {
  assert.deepEqual(classifySession({ session: { ...phoneSession, viewerKey: 'mother' }, familyExists: false, phoneFamily: null }),
    { state: 'family_gone' });
});

test('moved: the phone now belongs to a different family', () => {
  assert.deepEqual(classifySession({ session: phoneSession, familyExists: true, phoneFamily: { id: 21, roleMatches: [mother] } }),
    { state: 'moved' });
});

test('ambiguous: the phone is in two families', () => {
  assert.deepEqual(classifySession({ session: phoneSession, familyExists: true, phoneFamily: { ambiguous: true, candidates: [] } }),
    { state: 'ambiguous' });
});

test('no_role: the phone is in no family, or has no role in its own', () => {
  assert.deepEqual(classifySession({ session: phoneSession, familyExists: true, phoneFamily: null }), { state: 'no_role' });
  assert.deepEqual(classifySession({ session: phoneSession, familyExists: true, phoneFamily: { id: 16, roleMatches: [] } }), { state: 'no_role' });
  assert.deepEqual(classifySession({ session: phoneSession, familyExists: true, phoneFamily: { id: 16 } }), { state: 'no_role' });
});

test('profile sessions (viewerKey) take their role from the session', () => {
  assert.deepEqual(classifySession({ session: { ...phoneSession, viewerKey: 'father' }, familyExists: true }),
    { state: 'ok', roleMatches: [{ role: 'father' }] });
  assert.deepEqual(classifySession({ session: { ...phoneSession, viewerKey: 42 }, familyExists: true }),
    { state: 'ok', roleMatches: [{ role: 'family_member', memberId: '42' }] });
});
