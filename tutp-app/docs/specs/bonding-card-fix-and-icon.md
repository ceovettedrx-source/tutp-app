# bonding-card-v1: TUT-31 Bonding Report card fix + new icon

Branch `bonding-card-v1` (from main 15e2f7b). Does not build the TUT-20 PIS score.

## 1. Bug: "—" and "Could not load your bonding score right now."

### What the code and the logs show
- The card calls `GET /api/bonding-score/:familyId/:viewerKey` with `familyId` from the tab's
  `sessionStorage.tutp_family_id` and a fixed viewer key (`mother`, `father`, or the member id).
  Any non-2xx answer prints the error copy; "no data yet" is a 200 and prints "N/A", so the card
  only shows "—" on 401, 403, 500 or a network error.
- Cloud Run logs, 14 days, this route: no 500s. Fresh e2e logins get 200 (hasData true or false).
  The only non-test failure is one burst on 2026-10-10 03:11 UTC (revision 00437-bef): 7 father
  calls, all 403, in the same minute as every other call for family 16 (students, members, the
  family itself, about 50 calls, all 403) while the session-scoped `parent-involvement-baseline`
  answered 200. A 403 on every family-scoped call with a working session means the family id the
  page sends is not the family the cookie belongs to.
- Cause (strongly indicated, not seen in a browser yet): `session-guard.js` trusts a present
  `tutp_family_id` and never compares it with the cookie. `sessionStorage` is per tab, the cookie
  is shared by all tabs. Sign in as another family (or number) in another tab, or after a logout in
  one tab, and the older tab keeps the old family id: every card 403s, the bonding card among them.
  The route, the query (`bonding_scores` by `family_id`) and the auth helper are correct and stay
  unchanged. The e2e step below reproduces it in a browser before the fix is accepted.

### Fix
1. `public/app/shared/session-guard.js` (family pages only): when `tutp_family_id` is present, ask
   `/api/session/me` in the background (page not hidden, no added wait). 401 -> login (as today). If
   `me.familyId` differs from the stored id: store the cookie's family id and roles, drop
   `tutp_student_id` and `tutp_family_member_id` (they belong to the old family), reload once (a
   `tutp_guard_synced` flag stops any loop; a second mismatch goes to login). Same id: nothing.
2. Error copy on the three dashboards (state what happened, what to do, no apology):
   - 401/403: "Your sign-in does not match this family. Sign in again to see your bonding score."
     (with a link to /app/login/)
   - anything else: "The bonding score did not load. Reload the page in a minute."

## 2. Icon
- New files, exact content as supplied: `public/assets/icons/bonding-small.svg`,
  `public/assets/icons/bonding.svg`.
- `public/app/{father,mother,family-member}/index.html`: the card header `favorite` glyph becomes
  `<img src="/assets/icons/bonding-small.svg" alt="" width="22" height="22">` inside a white round
  chip (the dashboards have no dark theme today; the chip keeps the navy parent readable if a dark
  scheme or theme is ever applied).
- `bonding.svg` (48-64 px) has no home yet: there is no Bonding full-report page or section (the
  "View Full Report" modal is the homework-completion report). The file is added, not used.
- Sidebar "Bonding Report" link on all three dashboards also uses `bonding-small.svg` (founder
  decision 2026-10-10), replacing the Material heart; sized to match the neighbouring glyphs.

## Files
`public/assets/icons/bonding-small.svg`, `bonding.svg`; `public/app/shared/session-guard.js`;
`public/app/{father,mother,family-member}/index.html`; `tests/e2e/bonding.spec.js` (new, added to
`SPECS` in `tests/e2e/run.js`); `docs/CHANGES-EXPLAINED.md`. No `server.js`, no migration, no AI call.

## What can go wrong
1. Cause is a different one (for example a 403 on the viewer key, not the family). Mitigation: the
   e2e reproduces the stale-tab case first and fails before the fix; the 401/403 copy covers the
   viewer-key case too; the report names what was proven and what was not.
2. The background check reloads a good page (false mismatch): compare as strings, only reload when
   `/me` answers 200 with a different non-empty id; a network error leaves the page alone.
3. Reload loop: `tutp_guard_synced` is set before the reload and cleared on a page whose ids match.
4. A member's page loses its member id on sync: only the ids of the old family are dropped, then the
   existing restore path in `enforceRole` sets the member again from `/me`.
5. Extra `/api/session/me` call on every family-page load (about 400 ms server, background). Already
   used for the role cache; acceptable, measured in the e2e run.
6. Icon on one dashboard only: grep all three; the e2e asserts the `<img>` and its loaded size on
   father, mother and family-member.
7. Score shows "—" for a seeded family: the e2e seeds through the product's own endpoint
   (`POST /api/bonding-score`, the father's own key, test family 16) and asserts "72%" renders.
   The daily cron overwrites that row with the computed value, which is harmless.
8. Dark mode: the e2e loads each dashboard with `colorScheme: 'dark'` and asserts the chip is light
   and the card text is readable (contrast at least 4.5).

## Tests (`tests/e2e/bonding.spec.js`, no paid AI calls)
- a  icon present, loaded (naturalWidth > 0), 22 px, `alt=""`, on father, mother and family-member
- b  seeded score renders a number with `%` (not "—") for the test family, all three viewers
- c  stale tab: father signed in, tab family id set to another id, reload -> synced to 16, number
     renders, no 403 left on the page's own calls
- d  forced 500 and forced 403 on the score call -> the two copies above, none says "sorry"
- e  dark scheme: chip light, text contrast ok
Run twice in a row on the no-traffic preview with the rest of the suite; model spend $0.
