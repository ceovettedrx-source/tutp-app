# Working style

- Don't paste large code blocks or long logs/output into chat. Summarize what changed or what a command found instead.
- Small, low-risk decisions (exact class names, styling details, minor wording, which existing pattern to reuse) — use your own judgment and proceed, don't ask.
- Large-scope changes (new pages, rewriting a file's structure/framework, anything touching many files, deploys, deletions) — show a short plan first and wait for confirmation before editing.
- After finishing a task, give a short summary (3-4 lines) of what was done — not a full diff or file dump.
- Never write or edit code through shell heredoc, sed or node -e string replacement; use the file edit tool, so escapes like \D survive.

## Review discipline

- Non-trivial feature work runs through 5 stages: idea framing →
  engineering plan review → design plan review → pre-ship review →
  post-deploy QA. Self-authored, not a third-party tool (gstack was
  evaluated and rejected — supply-chain/telemetry risk).
- Idea framing must include at least one competitive/market check
  (what similar EdTech products do, relevant stats) before building —
  not optional, not a one-off.
- A local, unversioned `.git/hooks/pre-commit` hook backs this up. It
  runs on the staged content and blocks the commit on: (1) a `node --check`
  syntax error in any staged `.js`/`.mjs`/`.cjs`, or (2) a secret-pattern hit
  in the added lines (reports file:line only; `secret-scan:allow` on the line
  suppresses a false positive). It only warns when `server.js` is staged. It
  then requires a y/n confirmation of the review checklist (an attestation —
  the stages themselves aren't verified), read from `/dev/tty`; with no
  terminal attached (agent, CI, GUI client) the commit fails closed. Bypass
  consciously with `git commit --no-verify`, which also skips the syntax and
  secret checks. Checklist content lives in the hook file itself.
  `TUTP_AGENT_COMMIT=1` skips ONLY the y/n checklist (for Claude's own
  commits); the syntax and secret checks still run and still block.
- Full cycle, run by Claude (founder decision 2026-09-28): spec → founder
  approval → build → e2e twice in a row on a no-traffic preview → commit
  with `TUTP_AGENT_COMMIT=1` (messages all lowercase, one command per line,
  no `&&`) → push the branch → founder runs the one-line traffic command →
  Claude verifies `status.traffic` → fast-forward main to the deployed
  commit and push. Claude stops only for spec approval and the traffic
  command. Never `--no-verify`, never force-push, never move traffic.
- Never refer to Tut-P as a "prototype" or "demo" in any founder-facing
  communication — it's a live production product with real users.
  (The literal file/route `public/demo/index.html` is exempt — that's
  its actual name, not a characterization of the product.)
- Definition of done for every feature or fix:
  1. Before code: read the repo and write a one-page spec (files touched,
     edge cases, test list). Founder approves before any edit.
     **Every spec has a "What can go wrong" section, written BEFORE any
     code** (founder rule, 2026-10-09; TUT-19 was a cache keyed by concept
     that showed one question's explanation under another). For each cache
     key, language rule, picture, cost and data path the feature touches:
     how it can break, and the test that catches it, including adversarial
     cases (e.g. several questions with the same concept but different
     numbers; same text in two languages; same photo twice; a free and a
     paid family). A spec without this section does not go to the founder.
  2. Done = the automated e2e suite passes on a no-traffic preview
     revision. A claim of done without a passing run is not done.
     **The feature inventory is part of the suite** (`tests/e2e/inventory.json`
     + `inventory.spec.js`, TUT-19): every required element of every surface
     (Answer, Explain, Notes, Story, EL: Listen, picture, diagram, tip,
     checked mark, print) is asserted in every language of
     `HOMEWORK_LANGUAGES`. A missing element, a new language without a
     sample, or a new surface without an entry fails the run and blocks the
     release. A new feature adds its elements to the inventory.
  3. Founder's time goes to approval and a final look only. Test numbers,
     branches, deploy and verification are Claude's job.
- The e2e suite lives in `tests/e2e/` (Playwright, devDependency only, kept
  out of the Cloud Run image by `.dockerignore`). Run it against a preview
  with `npm run test:e2e -- <base-url>`; see the header of
  `tests/e2e/login.spec.js` for the test numbers and options.
- Model spend in tests (round 2, `tests/e2e/run.js`): every run replays
  recorded model replies (`tests/e2e/recordings`, preview with
  `E2E_REPLAY=1`), and only a change to `server/prompts/`,
  `server/pointing-model.js` or `server/models.js` since the last live run
  triggers the 4-test live smoke set. The runner prints the model spend of
  every spec; put those figures in the release summary. `--record-all`
  re-records everything (about $0.10).
- The e2e test family 16 stays paid through a TEST payment row (student
  `cdfb427e-d579-44a9-b7d2-a01cbee207eb`, captured 2026-09-28,
  `period_days` 365, `note` = 'TEST'). Renew it before it expires on
  2027-09-28: without it the homework suite hits the free limit (402)
  after 5 sessions.

# Backlog

- Discussion Method and Lecture Method are backlogged for the Teacher Module, post-launch — removed from the parent-page search-bar row (which now shows only Storytelling Method, Experiential Learning, Play-Based Learning).
- TODO (founder): test real-device Web Speech API Telugu voice coverage (Android Chrome + iOS Safari at minimum) once Storytelling Method ships — browser TTS support for Telugu is inconsistent and the code falls back to text-only display when no matching voice is found, but that fallback path needs a real-device check.
- Test/Exam mode — a formal, single-child assessment format distinct from Play-Based Learning's multiplayer quiz, for parents who want to conduct a proper exam rather than a quick quiz. Not scoped or designed yet — needs a full spec from the founder before building. The "Online Exam / Test" chip added to `searchAttachChooser` (2026-09-05) is an icon + "Coming soon" placeholder only.
- Unify the two parent-page mode selectors: the top-of-page pill row (`childChipsRow` area — currently 3 chips: Storytelling, Experiential Learning, Play-Based Learning) and the separate `searchAttachChooser` popup (reached via the search-bar "+" attach icon — now 6 chips: Homework Help, Storytelling, Play-Based, Experiential, Quiz, Online Exam placeholder) show different sets of options for the same underlying capabilities. Not scoped yet — needs its own plan (which surface wins, whether the popup step gets removed) before building.
- Play-Based Learning refinements — timer correction, random question order, Player of the Day badge — logged by the founder 2026-09-05, explicitly deferred to the next session after tonight's chip additions. Not started.
- **Done (2026-09-22/23):** `/app/child/` (Child View) attach menu — decision made to use the full 6-chip `searchAttachChooser` picker, same as the parent pages, replacing the old dead decorative alert. Live since revision `tutp-demo-00179-9d8`; committed to git 2026-09-24 (it had been deployed from an uncommitted working tree until then).
- Homework Help: a parent can type a bare meta-instruction ("generate 10 questions with answers") with no actual topic and no attachment. The existing empty/empty guard (`hwModalText` + `hwUploadedBase64` both empty) doesn't catch this since the text field is non-empty — the model then invents unrelated general-knowledge trivia instead of anything tied to the child's real schoolwork. Founder decision 2026-09-05: not worth a heuristic (regex/keyword detection of "bare instruction" text) given false-positive risk — left as-is. Revisit only if this turns out to be a real recurring pattern, not just a test-scenario edge case.
- **Parent Engagement Score / "Bonding Score" is not what it's marketed as.** The live `bonding_scores` table / `/api/bonding-score` computes only a 14-day homework-completion rate — a deliberate, explicit V1 scope-down under launch pressure, not the researched design. The actual researched model (Epstein's Six Types of Involvement, a 4-factor PIS composite weighting Consistency/Quality-of-Support/Communication/Emotional-Tone, supportive-vs-intrusive involvement distinction, BKT-based child mastery tracking, Growth-Involvement Correlation Card) is entirely unbuilt. Founder's "world's first parent-engagement-scored EdTech" positioning is not yet backed by what's live. Full detail preserved in the assistant's memory (`pes-pis-mastery-research-gap`) since this has previously gone missing between sessions — read that before touching PES/bonding-score code or marketing copy. Open decision as of 2026-09-05: ship Monday as-is (Option A) vs. build one high-value researched piece first (Option B) — not yet resolved.
- **Secret rotation complete (started 2026-09-05, confirmed done 2026-09-14).** All 5 secrets flagged after the incident are now rotated and migrated to Secret Manager with `secretKeyRef` on the Cloud Run service: `ADMIN_TOKEN` → `admin-token`, `CRON_TOKEN` → `cron-token`, `SUPABASE_SERVICE_ROLE_KEY` → `supabase-service-role-key`, `GMAIL_APP_PASSWORD` → `gmail-app-password`, `RESEND_API_KEY` → `resend-api-key`. Confirmed 2026-09-14 via a metadata-only `gcloud run services describe` query (env var name → `secretKeyRef` secret name only, no values fetched or printed). Reason for the original rotation: a `gcloud run services describe --format=json` dump accidentally printed all 5 plaintext values into a chat transcript on 2026-09-05.
- **Done (round 3, 2026-09-30): add the other parent after registration.** Family page "Add the other parent" (`POST /api/family/add-parent`, mother or father only) fills an empty mother/father slot; they sign in with OTP. Changing an existing parent's phone is still a manual Supabase fix.
- **Visual tutor: mark every mistake with small numbered markers so the parent sees the true total; needs the model to return all mistake boxes.** Since 2026-09-27 image mode shows at most 2 mistakes + 1 correct step (to stay under the 8 s server budget) and says only "there are more to check" with no number, because the model miscounted the rest. A full list of mistake boxes, drawn as numbered dots and counted by the server, would give the real total.
- **Done (round 3, 2026-09-30): no duplicate families from registration.** The register page checks the number right after OTP (`/api/register/check-phone`) and `/api/register` refuses a registered mother/father phone (409 `already_registered`). Existing duplicates (e.g. the 2026-09-27 pair) were listed for the founder, never deleted.
- **Done (round 3, 2026-09-30): fast /me + loading spinner.** Sessions carry `mids`; /me reads only its own family (~400 ms server, `server-timing`), and `session-guard.js` shows a spinner after 300 ms. Family e2e test family B is family 18 (9999900004/05/06, `is_test`).
- **Visual tutor v2 server time 7956 ms on 2026-09-28, just under the 8 s budget** — look at trimming the image prompt or image size before it goes red.
- **Done (round 2, 2026-09-29):** test families are marked with `family_registrations.data.is_test = true` (family 16 so far; `server/test-families.js`) and left out of every `/api/admin/*` metric. Mark any new test family the same way.
- **Teacher features have no e2e coverage** (question paper, lesson material, lesson verifier). Round 2 moved them from sonnet-4-6 to sonnet-5 at effort low without a live check. Add at least one e2e smoke test per teacher feature (needs a teacher test login).
- **Done (round 3, 2026-09-30): removing a family member ends their sign-in.** Remove button on the Family page (mother/father only, confirm); a per-request check on `/api/*` for member sessions (cookie claim `mids`) returns 401 `member_removed`. Tested in `tests/e2e/family.spec.js` r4.
- **Done (2026-09-29, branch `cron-header-baseline-role`):** `/api/parent-involvement-baseline` refuses (403) a viewer the session doesn't hold, tested in login f/g; CRON_TOKEN rotated to the new secret `cron-token-v2` and read only from the `X-Cron-Token` header (Cloud Scheduler jobs send it). Spec: `docs/specs/small-release-cron-header-baseline-role.md`. The old `cron-token` secret stays enabled only so a rollback to an older revision still starts.
- **ADMIN_TOKEN also travels in the URL query string** (`?token=` on admin routes, `server.js` admin auth), so it lands in Cloud Run request logs the same way CRON_TOKEN did. Move it to a header and rotate it; redact `token=` in any log query until then.

# Deploying

- `deploy.sh`'s own success output is not proof the deploy is live: `tutp-demo`'s traffic is pinned to a named revision (not tracking "latest"), so `gcloud run deploy` can build and report success on a new revision while 100% traffic (and the `pdftest` tag) stay on the old one. Every `deploy.sh` run must be followed by checking which revision is actually receiving traffic:

  ```
  gcloud run services describe tutp-demo --region=us-central1 --format="value(status.traffic)"
  ```

  If the revision name shown isn't the one just built, move traffic (and the `pdftest` tag, to keep them unified) to it:

  ```
  gcloud run services update-traffic tutp-demo --region=us-central1 --to-revisions=<new-revision>=100 --update-tags=pdftest=<new-revision>
  ```

  **Previews run with `E2E_REPLAY=1`** (e2e record/replay, round 2,
  `server/model-replay.js`); the revision that gets traffic must not. Before
  the traffic command, redeploy the tested image without it (same digest,
  no rebuild) and give the founder that revision's name:

  ```
  gcloud run deploy tutp-demo --region=us-central1 --image=<image@sha256 of the tested revision> --remove-env-vars=E2E_REPLAY --update-env-vars=ANSWER_V2_ENABLED=1 --no-traffic --tag=preview --quiet
  ```

  Always set `ANSWER_V2_ENABLED` explicitly, never inherit it from the
  template: `=1` on a release revision (as above and in `deploy.sh`), and
  `--remove-env-vars=ANSWER_V2_ENABLED` on an e2e preview (the specs switch v2
  on by header). To roll v2 back, change the env var, then run `update-traffic`
  to the NEW revision it creates; an env change alone moves no traffic.

  Even if one slipped through, replay only ever answers test families.

  Always `--update-tags`, never `--set-tags`: `--set-tags` replaces the whole tag list, so every other tag (`preview`, `vtutor`, …) is deleted along with its URL (happened 2026-09-27).

## Infra known issues

- **gcloud hangs but curl works → IPv6 is broken** (seen on Vet's iPhone hotspot). gcloud's Python tries Google's IPv6 addresses first and stalls; curl falls back to IPv4. Fixed by disabling IPv6 on the Wi-Fi 5 adapter; if on Ethernet later, apply the same fix to that adapter.
- **PowerShell:** call `gcloud.cmd`, not `gcloud` — `gcloud.ps1` is blocked by the execution policy.
- **deploy.sh output piped through `tail`/`grep` shows nothing until it finishes** (and nothing at all if it hangs). Log to a file instead (`bash deploy.sh > deploy.log 2>&1`) and read that.
- **`gcloud run services update-traffic` is blocked in Claude Code auto mode** (production deploy). Vet runs it manually; Claude verifies afterwards.
- **Preview tag URLs must be in Firebase Authorized domains.** Phone-OTP login on a no-traffic tagged revision (e.g. `preview---tutp-demo-vs4743puka-uc.a.run.app`) fails with `auth/captcha-check-failed` unless that exact host is listed under Firebase Console → Authentication → Settings → Authorized domains. Each tag name gets its own host, so add the host for any new tag before testing logins on it.
- **Razorpay only accepts payments from websites registered on the merchant account** (MID in the name of Ramana Chary Sreepada, proprietor). Preview/`run.app` hosts aren't registered, so live-key checkout there fails as an unregistered website (`payment_risk_check_failed`, no fee charged; seen 2026-09-26). Test real payments only on `tutp.online`, or use Razorpay Test Mode keys on a preview revision.
