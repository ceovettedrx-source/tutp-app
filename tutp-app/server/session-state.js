// Does a family session from the cookie still stand? Used by
// GET /api/session/me. A session outlives changes to the family it names:
// the family row can be deleted (a duplicate registration cleaned up by
// hand: family 8 on 2026-09-28 left a browser on an empty "New Family"
// picker), or the phone can move to another family or leave it.
// Unit tests: tests/unit/session-state.test.js.
//
//   session      { familyId, viewerKey, ... } from getSession()
//   familyExists whether family_registrations still has session.familyId
//   phoneFamily  findFamilyIdByPhone(session.phone) now: null, or
//                { id, ambiguous, roleMatches }; not needed with a viewerKey
//
// -> { state: 'ok', roleMatches }
//    { state: 'family_gone' }  the family row is gone
//    { state: 'moved' }        the phone now belongs to a different family
//    { state: 'ambiguous' }    the phone is in more than one family
//    { state: 'no_role' }      the phone has no role in any family
export function classifySession({ session, familyExists, phoneFamily }) {
  if (!familyExists) return { state: 'family_gone' };
  // Signed in as a specific profile (account picker / password setup): the
  // role comes from the session itself.
  if (session.viewerKey != null) {
    const key = String(session.viewerKey);
    return {
      state: 'ok',
      roleMatches: key === 'mother' || key === 'father' ? [{ role: key }] : [{ role: 'family_member', memberId: key }],
    };
  }
  if (!phoneFamily) return { state: 'no_role' };
  if (phoneFamily.ambiguous) return { state: 'ambiguous' };
  if (phoneFamily.id !== session.familyId) return { state: 'moved' };
  if (!Array.isArray(phoneFamily.roleMatches) || !phoneFamily.roleMatches.length) return { state: 'no_role' };
  return { state: 'ok', roleMatches: phoneFamily.roleMatches };
}
