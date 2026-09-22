# Tut-P — Development Rules

_Last generated: 2026-09-22. Source: CLAUDE.md, ways-of-working.md,
launch-sequencing-notes.md. This file is the working-rules counterpart
to `prd.md`/`architecture.md` — update it directly when a rule
changes, don't just discuss it in chat._

---

## 1. Development Rules

### Working style
- Don't paste large code blocks or long logs/output into chat —
  summarize what changed or what a command found instead.
- Small, low-risk decisions (exact class names, styling details, minor
  wording, which existing pattern to reuse) — use judgment and
  proceed, don't ask.
- Large-scope changes (new pages, rewriting a file's
  structure/framework, anything touching many files, deploys,
  deletions) — show a short plan first, wait for confirmation.
- After finishing a task: a short 3–4 line summary, not a full diff or
  file dump.
- No large code dumps at once — incremental changes reviewed before
  deployment.
- Token-consciousness: keep Claude Code CLI prompts concise — no
  padding, no redundant context repetition. When referencing an
  earlier prompt, give its subheading/first line, don't repaste it.
- Pace: default to bundling investigation + report + an actual fix (or
  actionable next prompt) together. Only stop to ask when something is
  genuinely ambiguous, high-risk, or touches auth/payments/student
  data. A narrow "don't fix X without telling me" about one specific
  thing does not generalize into waiting for permission on every small
  step.

### Review discipline (mandatory, standing rule)
Non-trivial feature work runs through **5 stages**:
1. Idea framing — must include at least one competitive/market check
   (what similar EdTech products do, relevant stats/trends). Not
   optional, not a one-off. Expanded to: genuine 360° research
   (competitive + engineering + reverse-engineering of how similar
   products implement the thing) and critical thinking **before**
   writing code.
2. Engineering plan review
3. Design plan review
4. Pre-ship review
5. Post-deploy QA

Self-authored process — not a third-party tool (`gstack` was evaluated
and rejected over supply-chain/telemetry risk). Backed by a local,
unversioned `.git/hooks/pre-commit` hook that:
- Blocks on a `node --check` syntax error in staged `.js`/`.mjs`/`.cjs`
- Blocks on a secret-pattern hit in added lines (reports file:line;
  `secret-scan:allow` suppresses a false positive)
- Warns when `server.js` is staged
- Requires a y/n confirmation of the review checklist, read from
  `/dev/tty` (an attestation — stages aren't independently verified)
- Fails closed with no terminal attached (agent/CI/GUI commits)
- Bypass consciously with `git commit --no-verify` (also skips syntax
  and secret checks)

Also required alongside the competitive check: a technical-marketing
lens — what parents are actually searching for (public
search-trend/keyword signals), and design revenue-facing features so
their *presentation* itself feels like genuine, aspirational support,
not something "built because it had to be." Roughly 75–80% of the
site's features are revenue features — on first sight, a user should
think "this is really useful," in both content and presentation.

### Proactive practices (standing, not on-request)
- Raise realistic edge-case questions during feature work (e.g. "what
  if the password is forgotten") without waiting to be asked.
- Periodic technical audits (PageSpeed/performance, accessibility,
  security posture) without being asked.

---

- **Status claims must be code-verified, not memory-verified.** Any
  "is X built / not built" answer must come from checking the repo
  (routes, migrations, schema) directly before answering — a memory
  note or an earlier session's note is a lead, never the final source
  of truth, however recent it looks. This rule exists because a stale
  memory note (tutor marketplace marked "not built") was repeated into
  `task.md`/`memory.md` without a repo check on 2026-09-22, and was
  wrong — Phase 1 was already live in `server.js`.



- **Never** call Tut-P a "prototype" or "demo" in founder-facing
  communication — it is a live production product with real users.
  (`public/demo/index.html` is exempt — that's its literal route name,
  not a characterization of the product.)
- Design output must be genuinely distinctive and best-in-class, not a
  generic/templated default — avoid rounded-card SaaS-kit defaults,
  fabricated data/reviews, wrong-context content. Grounded in real
  subject matter and correct facts, reviewed critically before
  presenting.
- Claude acts as technical co-founder and technical marketing head —
  owns market fit and revenue outcome end-to-end (research + build),
  not just executing specs.
- Settled decisions are not re-litigated. Don't offer shortcuts when a
  full implementation has already been agreed.
- Don't over-generalize a narrow correction into a blanket rule beyond
  its stated context (e.g. a diagram-generation principle, a
  copywriting-voice rule, the YC plain-language rule each apply only
  where stated).

---

## 3. Technology & Coding Standards

- **Language of code:** always English — variable names, comments,
  commit messages, all code artifacts. Conversation with the founder
  can be in Telugu; code and commands stay in English.
- **Secrets:** never print secret values to chat; never run
  `gcloud run services describe --format=json` in chat (exposes all
  env vars in plaintext) — metadata-only queries (env var name →
  secret name) are fine. All secrets live in Secret Manager. Only
  public-safe values (e.g. Razorpay Key ID) may appear in
  conversation.
- **Database migrations:** run manually via the Supabase SQL Editor —
  consistent with the existing 001–021 pattern. No migration tooling
  automation.
- **Homework Help routing:** client-built prompt in
  `mother/father/family-member/index.html`, not
  `buildTeacherSystemPrompt` in `server.js`. `/api/homework-explain` is
  a separate route used only by `/demo/`.
- **Deploy verification is mandatory** — `deploy.sh`'s own success
  output is not proof of a live deploy (`tutp-demo` traffic is pinned
  to a named revision, not "latest"). Always verify independently:
  `gcloud run revisions list` and
  `gcloud run services describe tutp-demo --region=us-central1 --format="value(status.traffic)"`.
  If the new revision isn't receiving traffic, move it explicitly
  (keeping the `pdftest` tag in sync).
- **Payments:** Razorpay full integration only (not Payment Links
  shortcut); one-time payments only (no recurring subscriptions) — a
  settled decision, not to be revisited casually.
- **Pedagogy grounding:** reuse the Teacher Module's existing
  infrastructure (`server/references/pedagogy-nep-ncf.md`,
  read-and-inject pattern in `lessonMaterialGenerator.js`). Each
  feature gets a targeted, relevant slice, not a one-size-fits-all
  full-file injection (token budget). Never fabricate a grounding
  claim — if content doesn't genuinely map to a pedagogy principle,
  don't force it.
- **Token budget:** broad/unspecific lesson content + Telugu output +
  injected reference text can hit token limits and truncate responses
  (happened once with Quiz/Homework Help — fixed via `max_tokens: 3000`
  + compact JSON). Test any prompt change against this failure mode.
- **Explicit-selection UI rule:** none of the 6 chooser modes may ever
  silently default — the active mode must always be unambiguous to
  the parent, before and after submitting.
- **Family dashboard privacy:** each family member sees *who else* is
  in the family (names/roles) but must never be able to open another
  member's dashboard/login/homework session from within their own
  login.

---

## 4. Project Structure

See `architecture.md` §3 for the authoritative, current folder tree.
Key structural conventions:
- Parent-facing surfaces live under `public/app/<role>/index.html`
  (mother, father, family, family-member); child view under
  `public/app/child/`.
- Backend route handlers under `server/routes/`; shared generation
  logic under `server/services/`.
- Pedagogy/reference material lives in `server/references/` and is
  read fresh, not cached in conversation memory.
- All database schema changes are additive migration files under
  `supabase/migrations/`, numbered sequentially, never edited after
  being applied.

### Authoritative repo documents — always read fresh, never rely on conversation memory alone
- `FEATURE-SPECS.md` — 6-chooser-option specs (source of truth)
- `PRODUCT-RESEARCH-AND-ROADMAP.md` — PES/PIS research vs. what's built
- `CLAUDE.md` — critical infra facts, working rules
- `TUTP-ASO-SEO-ANDROID-STRATEGY.md` — ASO/SEO/Android strategy
- `docs/india-education-boards-taxonomy.md` — board taxonomy
- `server/references/pedagogy-nep-ncf.md` — Panchpadi/NEP pedagogy reference
