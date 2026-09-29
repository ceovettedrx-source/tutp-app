// Unit tests for server/session-state.js (does a family session still stand):
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySession, roleMatchesForPhone, memberIdsClaim, memberCheckFor, memberIdsFor, resolveLegacy, skipsMemberCheck,
} from '../../server/session-state.js';

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

// Round 3: removed-member check and the fast /me role match.
const row = { id: 16, data: { mother: { name: 'M', phone: '+919999900001' }, father: { name: 'F', phone: '99999 00002' } } };
const members = [{ id: 'u1', name: 'G', phone: '+919999900003' }];

test('roleMatchesForPhone: mother, father and member by last 10 digits', () => {
  assert.deepEqual(roleMatchesForPhone(row, members, '+919999900001'), [{ role: 'mother', name: 'M' }]);
  assert.deepEqual(roleMatchesForPhone(row, members, '9999900002'), [{ role: 'father', name: 'F' }]);
  assert.deepEqual(roleMatchesForPhone(row, members, '+91 99999 00003'), [{ role: 'family_member', memberId: 'u1', name: 'G' }]);
  assert.deepEqual(roleMatchesForPhone(row, [], '+919999900003'), []);
  assert.deepEqual(roleMatchesForPhone(row, members, '123'), []);
});

test('memberIdsClaim: a parent role means nothing to check', () => {
  assert.deepEqual(memberIdsClaim([{ role: 'mother' }, { role: 'family_member', memberId: 'u1' }]), []);
  assert.deepEqual(memberIdsClaim([{ role: 'family_member', memberId: 'u1' }]), ['u1']);
  assert.deepEqual(memberIdsClaim(null), []);
});

test('memberCheckFor: which sessions get the per-request check', () => {
  assert.equal(memberCheckFor(null), 'none');
  assert.equal(memberCheckFor({ familyId: null, teacherId: 3 }), 'none');
  assert.equal(memberCheckFor({ familyId: 16, viewerKey: 'mother' }), 'none');
  assert.equal(memberCheckFor({ familyId: 16, viewerKey: 'u1' }), 'members');
  assert.equal(memberCheckFor({ familyId: 16, viewerKey: null, mids: [] }), 'none');
  assert.equal(memberCheckFor({ familyId: 16, viewerKey: null, mids: ['u1'] }), 'members');
  assert.equal(memberCheckFor({ familyId: 16, viewerKey: null }), 'legacy');
  assert.deepEqual(memberIdsFor({ viewerKey: 'u1' }), ['u1']);
  assert.deepEqual(memberIdsFor({ viewerKey: null, mids: ['u2'] }), ['u2']);
});

test('resolveLegacy: stamp, end, or leave an ambiguous phone to /me', () => {
  const s = { familyId: 16 };
  assert.deepEqual(resolveLegacy(s, { id: 16, roleMatches: [{ role: 'family_member', memberId: 'u1' }] }), { state: 'ok', mids: ['u1'] });
  assert.deepEqual(resolveLegacy(s, { id: 16, roleMatches: [{ role: 'mother' }] }), { state: 'ok', mids: [] });
  assert.deepEqual(resolveLegacy(s, null), { state: 'ended' });
  assert.deepEqual(resolveLegacy(s, { id: 17, roleMatches: [{ role: 'mother' }] }), { state: 'ended' });
  assert.deepEqual(resolveLegacy(s, { id: 16, roleMatches: [] }), { state: 'ended' });
  assert.deepEqual(resolveLegacy(s, { ambiguous: true, candidates: [] }), { state: 'unknown' });
});

test('skipsMemberCheck: sign-in, logout and register only', () => {
  for (const p of ['/api/logout', '/api/session', '/api/session/select-account', '/api/session/set-password', '/api/register', '/api/register/check-phone', '/api/register-teacher']) assert.ok(skipsMemberCheck(p), p);
  for (const p of ['/api/session/me', '/api/family/16/members', '/api/homework']) assert.ok(!skipsMemberCheck(p), p);
});
