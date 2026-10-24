# TUT-104: e2e login cache (Playwright storageState with IndexedDB)

Status: spec only, awaiting founder sign-off. No code changed.
Linear: TUT-104 (High, In Progress). Phase A only; screenshot tests are phase B.

## Intent

1. Each e2e account logs in once per run (one Firebase OTP send); every spec reuses that session.
2. Reuse works through `context.storageState({ indexedDB: true })` and `browser.newContext({ storageState })`.
3. OTP sends per full run: at most 30 (today about 500; the ticket says two runs used about 1000 of the 1000/day quota).
4. No new secrets, no app code change, no auth-bypass endpoint, no custom tokens.
5. Done when ll11 is fixed and the full suite is green twice in a row on commit 2f4e1b9, with the OTP counter in the run summary.

## Verified facts (evidence)

| Fact | Evidence |
|---|---|
| Playwright installed is 1.63.0, so the 1.51 floor is met | `node -p "require('playwright/package.json').version"` in wt-tut69; `package.json:43` pins `"playwright": "1.63.0"` |
| `indexedDB: true` exists for `storageState()` since 1.51 and the docs name Firebase Auth as the use | Context7, Playwright v1.51.0 `class-browsercontext.md` |
| Specs use the plain library (`chromium.launch`, `browser.newContext`), not `@playwright/test`, so `storageState` works on a plain context | `answer-explain.spec.js:75-90` |
| `run.js` spawns each spec as its own process, so state must be shared on disk (a per-process variable cannot) | `run.js` header and `SPECS` list |
| Login today: `tutpSendOTP(phone)` then `tutpVerifyOTP(code)` then `tutpEstablishSession(idToken)`, then `sessionStorage` is set by hand (`tutp_family_id`, `tutp_roles`, `tutp_baseline_skipped`) | `answer-explain.spec.js:92-120` |
| A login has three parts: Firebase IndexedDB, the server session cookie (JWT, lives `SESSION_TTL_DAYS`), and `sessionStorage` | `server.js:393-419`. `storageState` carries the first two; `sessionStorage` it does **not**, so the helper must re-set it per page |
| OTP-send call sites: `signIn(` 30 across 8 specs; `newCtx(` 40 across 11 specs, `login.spec.js` 12 | `grep -c` per spec |
| Runtime OTP count per run is NOT known; call sites sit inside loops (languages) and helpers | No log prints it. The ticket gives about 500/run. The counter (Task 1) is what measures it |
| ll11 failed on the **OTP quota**, not on the v2 header: `auth/quota-exceeded ... send-verification-code-per-day` | CI run 40068024515, log lines 918, 1456; in run 2 all of ll1-ll11 failed the same way |
| The v2 header is honoured on any `E2E_REPLAY=1` preview, whether or not `ANSWER_V2_ENABLED` is set | `server/e2e-overrides.js:5`, `e2e-mode.js:64-67` |

## Accounts and who may reuse a session

| Account | Cached | Why |
|---|---|---|
| 9999900001 mother, family 16 | yes | most specs |
| 9999900002 father, family 16 | yes | homework, chips, story |
| 9999900003 member, family 16 | yes | chips, family |
| 9999900004 mother, family B | yes | answer-explain, img1, uploads, ll |
| 9999900005 father, family B | yes | family |
| 9999900006 member, family B | **no** | added and removed by family r4 on every run |

Specs that keep a fresh real login:
- `login.spec.js`, all tests. It tests OTP, session restore, logout (c), error text, the role guard (f/g) and phone normalization (j).
- `family.spec.js` r4 (member removed, then 401). Other family tests may use the cache.
- Anything that asserts the OTP screen shows. Cached specs never reach it.

## Plan (tests first)

Files: create `tests/e2e/auth-cache.mjs` (helper); modify `tests/e2e/run.js`, the 8 specs that define `signIn`/`newCtx`, `tests/e2e/preload.mjs` only if needed, `.gitignore`, and `docs/`.

1. **Task 1: OTP counter plus baseline.** `auth-cache.mjs` exports `countOtp()`. Each spec's `tutpSendOTP` call goes through it (append to `$E2E_AUTH_DIR/otp-count.log`). `run.js` prints `OTP sends this run: N` in the summary. Test: run `login.spec.js` alone and assert the printed N equals its real sends. This gives the true baseline before anything changes.
2. **Task 2: cache helper.** `auth-cache.mjs` exports `loginOnce(browser, who, base)`, which logs in with the existing OTP flow, saves `storageState({ indexedDB: true })` to `$E2E_AUTH_DIR/<phone>.json`, and `useSession(browser, who, opts)`, which returns a context built from that state and re-sets the three `sessionStorage` keys through `addInitScript`. Unit tests: state file has an `indexedDB` section; a second `useSession` makes no OTP call (counter unchanged); the cookie works (`/api/session/me` returns 200).
3. **Task 3: run.js owns the lifecycle.** At start `run.js` makes a temp dir (`os.tmpdir()/tutp-e2e-auth-<pid>`), sets `E2E_AUTH_DIR`, and logs in the 5 cached accounts. At the end, in a `finally`, it deletes the dir. Spec processes read the dir through the env var. Run alone without `run.js` (no env var), a spec falls back to today's fresh login, so the laptop debug path is unchanged.
4. **Task 4: move specs over, one per commit**, easiest first: `el`, `story`, `library`, `homework`, `chips`, `img1`, `learning-library`, `answer-explain`, `uploads`, `family` (not r4). Each: swap the login call for `useSession`, run that spec alone twice, compare pass count with the baseline.
5. **Task 5: ll11.** First re-run `learning-library.spec.js` on the cache. If ll11 still fails, diagnose from the real error (systematic-debugging), not from the v2-header guess. See below.
6. **Task 6: full verification.** Full suite twice in a row on the no-traffic preview, OTP counter at most 30, then fast-forward main.

Commits: lowercase messages, one command per line, `TUTP_AGENT_COMMIT=1`. One session deploys or runs e2e at a time; the release gets its own tag, never `preview`.

## What can go wrong, and the test that catches it

| Risk | Test or guard |
|---|---|
| State file leaks real tokens | Dir is under the OS temp dir, never the repo; `.gitignore` gets `tutp-e2e-auth*` and `*.auth.json` as a second guard; `finally` deletes it (also on Ctrl+C via a `SIGINT` handler). Test: after a run, assert the dir is gone and `git status` shows no state file. The pre-commit secret scan stays on |
| Firebase ID token expires mid-run (1 h) | The SDK refreshes with the stored refresh token on first call, and the server session is its own JWT (days). Test: set the saved `expirationTime` in the state file to the past, then `useSession` must still return 200 on `/api/session/me` with zero new OTP sends |
| A spec that logs out or revokes poisons the shared session | Logout and r4 run in their own fresh contexts and never write back to the cache. Test: run `login.spec.js` (it does logout c) then check that the cached 0001 state still returns 200 on `/api/session/me`. Open point: if logout invalidates the server session by user and not by cookie, the order or the account must change, and the test shows it |
| Playwright below 1.51 | `loginOnce` asserts `playwright/package.json` version is at least 1.51 and fails with a clear message. The CI install is checked in Task 6 (workflow uses `npm ci`, so 1.63.0 from the lockfile) |
| A spec depends on a fresh login (OTP screen, empty `sessionStorage`) | `login.spec.js` and r4 stay fresh. Each moved spec is run alone twice against its baseline pass count (Task 4); a spec that changes result is reverted and kept fresh |
| IndexedDB typed-array limitation | Playwright's docs note IndexedDB values with typed arrays are not serialized. Firebase stores auth in `firebaseLocalStorageDb` as plain JSON. Test: after `useSession`, read `firebase:authUser:*` from IndexedDB and assert `stsTokenManager.refreshToken` is present; fail the helper if absent |
| `sessionStorage` is lost (not in storageState) | `useSession` sets the three keys itself; test asserts the dashboard loads with no baseline overlay |
| Cached session carries stale `keySuffix`/v2 headers | Those are per-context routes added by `e2e.attach`, not part of the state; `useSession` still calls `e2e.attach(ctx, opts)` with the spec's own opts |
| Counter misses sends | Task 1 compares counter N to a hand count on `login.spec.js` alone |

## ll11 fix plan

The CI log does not support the v2-header theory. ll11 failed on `send-verification-code-per-day`, and in the second run every `ll` test failed on it. The v2 header is honoured on any `E2E_REPLAY=1` preview regardless of `ANSWER_V2_ENABLED`. So:
1. After Task 4 moves `learning-library.spec.js` to the cache, run it alone twice. Expected: ll11 passes, because the quota cause is gone.
2. If ll11 still fails, I read the real failure line and fix that. If the cause is the preview missing `E2E_REPLAY=1`, the fix is the tag, not the spec (flag-parity check applies).
3. ll11 is not edited before step 1 shows it still fails.

## Verification

- OTP counter line in the `run.js` summary, and a hard fail if N is over 30 (env `E2E_OTP_BUDGET`, default 30).
- Full suite twice in a row on a no-traffic tag of the live digest, commit 2f4e1b9 (tutp-demo-00524-had or a fresh tag of the same digest), `E2E_REPLAY=1`, via the e2e workflow in CI. Quota check first: one full run needs about 30, so confirm the quota day has reset.
- Then fast-forward main to the verified commit and push. Never `--no-verify`, never move traffic.
- Static estimate for the budget (unconfirmed until Task 1): 5 cached accounts + `login.spec.js` fresh logins (12 call sites) + family r4 and its member logins (6 call sites) is about 23, under 30. If Task 1 shows loops push it over, I report that before building further.

## Honest time estimate

| Step | Time |
|---|---|
| Task 1 counter plus baseline run | 1 h |
| Task 2 helper plus unit tests | 2 h |
| Task 3 run.js lifecycle | 1.5 h |
| Task 4 move 10 specs, 2 runs each | 4 h (CI runs dominate) |
| Task 5 ll11 | 0.5 h if quota was the cause; 2 h if not |
| Task 6 two full CI runs plus fast-forward | 2 h, if the quota day has reset |
| Total | about 11 h of work, 1.5 days with CI waits |

## Open questions for the founder

1. Is 30 the hard budget, or a target? (I will fail the run over 30.)
2. Quota reset time: the 1000/day window; may I schedule the final two full runs after it resets?
