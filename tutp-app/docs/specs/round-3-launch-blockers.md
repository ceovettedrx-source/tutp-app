# Round 3 — launch blockers (2026-09-29)

From the founder's master plan (2026-09-28): add a child later, co-parent
invite + duplicate-phone detection, removed-member 401, fast /me + loading
state. Decisions A, B, C approved by the founder 2026-09-29 (plus: member
removal by mother and father only, with a confirm step, tested; existing
duplicate families listed, never deleted). Branch `round-3-launch-blockers`
from round 2 (`195d683`).

Added while building (within the approved decisions):
- `POST /api/register/check-phone` { regIdToken }: the register page asks
  right after the OTP step, so an already-registered number sees "sign in"
  before filling the 7-step form, not after. Answers only for the phone the
  caller just proved.
- A family registered on one of the e2e test numbers (9999900001-09) is
  marked `is_test` by the server (`isTestPhone`, server/test-families.js),
  so the new test family B stays out of every metric.
- The fast /me checks the phone only inside its own family: a phone that
  has since joined a second family no longer ends the session (it did as
  `ambiguous`); a phone that left the family still ends it (`no_role`).
- `GET /api/family/:id` also returns `openParentSlot` for the Family page.
- e2e: new `tests/e2e/family.spec.js` (r1-r5), run by `run.js` after login.

## 1. Add a child later
- `POST /api/family/add-child` { family_id, child: { name, class, schoolName,
  section } }. Same guards as add-member: own family, mother or father only
  (founder rule 2026-09-28), name required, same trimming as `/api/register`
  (school/section feed homework matching), family's state/district copied.
- Family page (`/app/family/`): "Add child" form next to "Add member".
- The new child starts on the free tier (5 sessions) and is bought through
  the existing per-child purchase flow; nothing new in payments.
- **Decision A:** limit of 6 children per family (stops abuse of per-child
  free sessions). Recommended.

## 2. Co-parent invite + duplicate-phone detection
- **Decision B (recommended):** no invite link. A parent adds the other
  parent's name + phone on the Family page (`POST /api/family/add-parent`);
  it fills the empty `data.father` (or `data.mother`) slot. The co-parent
  then signs in with OTP on that number, which proves they own it; login
  already finds them by phone. Only an empty slot can be filled; changing an
  existing parent's phone stays a manual fix (backlog).
- Refused (409) if that phone already belongs to any family (as parent or
  member): the response says to sign in instead, or to ask support.
- `/api/register`: before inserting, check the verified phone and the other
  parent's phone with `findFamilyIdByPhone`; a hit returns 409
  `already_registered` and the page shows "This number is already
  registered — sign in" with a link to `/app/login/`. No duplicate family,
  no duplicate child.
- Existing duplicates (e.g. the 2026-09-27 pair) are not touched: deleting
  real data is a stop rule. I list them for the founder instead.

## 3. Removed member gets 401 on the next request
- Today there is **no remove-member endpoint or UI**; members can only be
  added. Add `POST /api/family/remove-member` { family_id, member_id }
  (mother or father only) and a remove button per member on the Family page
  with a confirm step. It deletes the `family_members` row.
- **Decision C (recommended): per-request check, no revocation list.** At
  sign-in the cookie gets `role` (and `memberId` for a member). A middleware
  on `/api/*` checks a `family_member` session with one primary-key lookup
  (`family_members.id = memberId and family_id = familyId`); gone → cookie
  cleared, 401 `session_expired`. Mother/father sessions pay nothing extra.
  Cookies from before this release (no `role`) are resolved once through
  the phone lookup and re-stamped by the sliding refresh.

## 4. Fast /me + loading state
- `/me` now waits on `findFamilyIdByPhone` (up to 4 sequential queries).
  With `role`/`memberId` in the cookie it only needs the family row (with
  `data`, to check the phone is still that parent's) and, for a member, the
  member row — all in parallel with students. Same `classifySession`
  outcomes; the phone lookup stays only for legacy cookies.
- Loading state: the role guard keeps the page hidden; instead show a small
  centred Tut-P spinner (in `session-guard.js`, before the page is revealed)
  after 300 ms, so a slow network shows progress, not a blank screen.
- Target: `/me` server time under 800 ms (was ~3.5 s cold), measured with a
  `server-timing` header like the homework route.

## Files
`server.js` (4 routes, middleware, `/me`, register check, cookie claims),
`server/session-state.js` (+ unit tests), `public/app/family/index.html`,
`public/app/register/index.html`, `public/app/shared/session-guard.js`,
`tests/e2e/login.spec.js` (new tests), `tests/unit/session-state.test.js`.
No prompt/model change → no live model spend; replay only.

## Edge cases
Add-parent to a family whose empty slot is the *mother*; phone typed with
+91/spaces (normalizePhone); a member removed while their page is open
(next API call 401 → login page); the removed member's phone still in a
parent slot (they keep that role); a family_member session whose cookie
predates the release; teacher+family session when the family part ends
(teacher part kept, as today); registration where both phones are the same.

## Tests (e2e on a no-traffic preview, family 16 + a test member)
- r1 parent adds a child → it appears in the child picker; member gets 403.
- r2 add-parent fills the empty slot; the added phone can sign in (OTP test
  number); a phone already in another family → 409.
- r3 register with an already-registered phone → 409, no new row.
- r4 mother removes a member → the member's open session gets 401 on its
  next request (the backlog test); a member can't remove anyone (403).
- r5 `/me` server-timing under 800 ms; loading spinner visible on a
  throttled load; login a–g unchanged. Login and cache specs run twice.
