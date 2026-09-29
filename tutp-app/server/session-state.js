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

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// The roles `phone` holds in one family: row is its family_registrations row
// ({ id, data }), members its family_members rows ({ id, name, phone }).
// The one place that decides what counts as a match (findFamilyIdByPhone and
// the fast /api/session/me both use it).
export function roleMatchesForPhone(row, members, phone) {
  const digits = last10(phone);
  if (digits.length !== 10) return [];
  const out = [];
  if (last10(row?.data?.mother?.phone) === digits) out.push({ role: 'mother', name: row.data.mother.name || null });
  if (last10(row?.data?.father?.phone) === digits) out.push({ role: 'father', name: row.data.father.name || null });
  (members || []).forEach(m => {
    if (last10(m.phone) === digits) out.push({ role: 'family_member', memberId: m.id, name: m.name || null });
  });
  return out;
}

// Removed-member check (round 3). The session cookie carries `mids`: the
// family_members ids it signs in as, [] when it also holds a mother/father
// role (nothing to check), missing on a cookie from before round 3.
//   roleMatches -> the mids claim for a new session
export function memberIdsClaim(roleMatches) {
  const roles = roleMatches || [];
  if (roles.some(r => r.role === 'mother' || r.role === 'father')) return [];
  return roles.filter(r => r.role === 'family_member' && r.memberId != null).map(r => String(r.memberId));
}

// What the per-request check has to do for this session:
//   'none'    no family part, or a mother/father session
//   'members' look up session's member ids (see memberIdsFor)
//   'legacy'  a pre-round-3 cookie: resolve the phone once, then stamp mids
export function memberCheckFor(session) {
  if (!session || !session.familyId) return 'none';
  if (session.viewerKey != null) {
    const key = String(session.viewerKey);
    return key === 'mother' || key === 'father' ? 'none' : 'members';
  }
  if (Array.isArray(session.mids)) return session.mids.length ? 'members' : 'none';
  return 'legacy';
}

export function memberIdsFor(session) {
  if (session.viewerKey != null) return [String(session.viewerKey)];
  return (session.mids || []).map(String);
}

// A pre-round-3 cookie: phoneFamily is findFamilyIdByPhone(session.phone).
//   { state: 'ok', mids }  stamp mids on the cookie
//   { state: 'ended' }     the phone has no role in the session's family
//                          (a removed member, or the family is gone)
//   { state: 'unknown' }   ambiguous phone: leave it to /api/session/me
export function resolveLegacy(session, phoneFamily) {
  if (phoneFamily && phoneFamily.ambiguous) return { state: 'unknown' };
  if (!phoneFamily || phoneFamily.id !== session.familyId || !(phoneFamily.roleMatches || []).length) return { state: 'ended' };
  return { state: 'ok', mids: memberIdsClaim(phoneFamily.roleMatches) };
}

// API paths the check skips: signing in/out and registering must work with
// an old or ended cookie still in the browser.
export function skipsMemberCheck(path) {
  return path === '/api/logout' || path === '/api/session' || path.startsWith('/api/session/select') ||
    path.startsWith('/api/session/set') || path.startsWith('/api/register');
}
