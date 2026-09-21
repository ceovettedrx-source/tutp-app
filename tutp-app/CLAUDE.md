# Working style

- Don't paste large code blocks or long logs/output into chat. Summarize what changed or what a command found instead.
- Small, low-risk decisions (exact class names, styling details, minor wording, which existing pattern to reuse) — use your own judgment and proceed, don't ask.
- Large-scope changes (new pages, rewriting a file's structure/framework, anything touching many files, deploys, deletions) — show a short plan first and wait for confirmation before editing.
- After finishing a task, give a short summary (3-4 lines) of what was done — not a full diff or file dump.

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
- Never refer to Tut-P as a "prototype" or "demo" in any founder-facing
  communication — it's a live production product with real users.
  (The literal file/route `public/demo/index.html` is exempt — that's
  its actual name, not a characterization of the product.)

# Backlog

- Discussion Method and Lecture Method are backlogged for the Teacher Module, post-launch — removed from the parent-page search-bar row (which now shows only Storytelling Method, Experiential Learning, Play-Based Learning).
- TODO (founder): test real-device Web Speech API Telugu voice coverage (Android Chrome + iOS Safari at minimum) once Storytelling Method ships — browser TTS support for Telugu is inconsistent and the code falls back to text-only display when no matching voice is found, but that fallback path needs a real-device check.
- Test/Exam mode — a formal, single-child assessment format distinct from Play-Based Learning's multiplayer quiz, for parents who want to conduct a proper exam rather than a quick quiz. Not scoped or designed yet — needs a full spec from the founder before building. The "Online Exam / Test" chip added to `searchAttachChooser` (2026-09-05) is an icon + "Coming soon" placeholder only.
- Unify the two parent-page mode selectors: the top-of-page pill row (`childChipsRow` area — currently 3 chips: Storytelling, Experiential Learning, Play-Based Learning) and the separate `searchAttachChooser` popup (reached via the search-bar "+" attach icon — now 6 chips: Homework Help, Storytelling, Play-Based, Experiential, Quiz, Online Exam placeholder) show different sets of options for the same underlying capabilities. Not scoped yet — needs its own plan (which surface wins, whether the popup step gets removed) before building.
- Play-Based Learning refinements — timer correction, random question order, Player of the Day badge — logged by the founder 2026-09-05, explicitly deferred to the next session after tonight's chip additions. Not started.
- `/app/child/` (Child View) still has the original dead decorative attach-menu alert — never received the attach-menu fixes/chip work the parent pages got. Needs a product decision on what child-side attach should actually do (same 6 options? different scope?) before fixing — not a copy-paste of the parent fix without that decision.
- Homework Help: a parent can type a bare meta-instruction ("generate 10 questions with answers") with no actual topic and no attachment. The existing empty/empty guard (`hwModalText` + `hwUploadedBase64` both empty) doesn't catch this since the text field is non-empty — the model then invents unrelated general-knowledge trivia instead of anything tied to the child's real schoolwork. Founder decision 2026-09-05: not worth a heuristic (regex/keyword detection of "bare instruction" text) given false-positive risk — left as-is. Revisit only if this turns out to be a real recurring pattern, not just a test-scenario edge case.
- **Parent Engagement Score / "Bonding Score" is not what it's marketed as.** The live `bonding_scores` table / `/api/bonding-score` computes only a 14-day homework-completion rate — a deliberate, explicit V1 scope-down under launch pressure, not the researched design. The actual researched model (Epstein's Six Types of Involvement, a 4-factor PIS composite weighting Consistency/Quality-of-Support/Communication/Emotional-Tone, supportive-vs-intrusive involvement distinction, BKT-based child mastery tracking, Growth-Involvement Correlation Card) is entirely unbuilt. Founder's "world's first parent-engagement-scored EdTech" positioning is not yet backed by what's live. Full detail preserved in the assistant's memory (`pes-pis-mastery-research-gap`) since this has previously gone missing between sessions — read that before touching PES/bonding-score code or marketing copy. Open decision as of 2026-09-05: ship Monday as-is (Option A) vs. build one high-value researched piece first (Option B) — not yet resolved.
- **Secret rotation complete (started 2026-09-05, confirmed done 2026-09-14).** All 5 secrets flagged after the incident are now rotated and migrated to Secret Manager with `secretKeyRef` on the Cloud Run service: `ADMIN_TOKEN` → `admin-token`, `CRON_TOKEN` → `cron-token`, `SUPABASE_SERVICE_ROLE_KEY` → `supabase-service-role-key`, `GMAIL_APP_PASSWORD` → `gmail-app-password`, `RESEND_API_KEY` → `resend-api-key`. Confirmed 2026-09-14 via a metadata-only `gcloud run services describe` query (env var name → `secretKeyRef` secret name only, no values fetched or printed). Reason for the original rotation: a `gcloud run services describe --format=json` dump accidentally printed all 5 plaintext values into a chat transcript on 2026-09-05.

# Deploying

- `deploy.sh`'s own success output is not proof the deploy is live: `tutp-demo`'s traffic is pinned to a named revision (not tracking "latest"), so `gcloud run deploy` can build and report success on a new revision while 100% traffic (and the `pdftest` tag) stay on the old one. Every `deploy.sh` run must be followed by checking which revision is actually receiving traffic:

  ```
  gcloud run services describe tutp-demo --region=us-central1 --format="value(status.traffic)"
  ```

  If the revision name shown isn't the one just built, move traffic (and the `pdftest` tag, to keep them unified) to it:

  ```
  gcloud run services update-traffic tutp-demo --region=us-central1 --to-revisions=<new-revision>=100 --set-tags=pdftest=<new-revision>
  ```
