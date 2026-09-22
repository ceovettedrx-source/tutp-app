# Tut-P — Task Phases

_Last generated: 2026-09-22. Adapted to Tut-P's actual build history
(not a generic template) — source: overview.md, launch-sequencing-notes.md,
CLAUDE.md backlog, TUTP-4-FEATURES-ARCHITECTURE-EXECUTION-PLAN.md._

Status legend: ✅ done · 🟡 in progress / partial · ⬜ not started · 🚫 blocked

---

## Phase 1 — Project Setup & Infrastructure ✅

- ✅ Cloud Run service (`tutp-demo`), Node.js/Express backend
- ✅ Supabase (PostgreSQL, Mumbai region) provisioned
- ✅ Firebase Phone Auth project set up
- ✅ Anthropic Claude API integration
- ✅ Razorpay account (live keys) — international payments enabled
- ✅ Resend + Gmail-fallback transactional email
- ✅ Google Cloud Secret Manager — all secrets migrated off plaintext
  env vars (full 5-secret rotation completed 2026-09-14)
- ✅ Tailwind CLI build pipeline (replacing per-page CDN), Group A
  design tokens ported into `tailwind.config.cjs`
- ✅ GitHub repo (`ceovettedrx-source/tutp-app`), Docker/Cloud Run deploy
  pipeline (`deploy.sh`)
- ✅ `.git/hooks/pre-commit` review-discipline hook (syntax + secret
  scan + checklist attestation)

## Phase 2 — Authentication ✅

- ✅ Firebase Phone Auth (OTP login)
- ✅ Session-cookie + firebase-admin JWT verification across all 24
  backend routes (auth gap closed)
- ✅ Registration phone-verification vulnerability fixed (2026-09-14) —
  `/api/register` now requires a Firebase-verified idToken matching
  the submitted phone, plus rate limiting
- ✅ Ambiguous-phone-match guard — `findFamilyIdByPhone` returns 409 on
  multi-family collision instead of silently picking the most recent
  (recovered 2 stranded/deduped student records)
- ✅ Family dashboard privacy model — each member sees who else is in
  the family, cannot open another member's dashboard/session

## Phase 3 — Core Parent Features (the 6-option chooser) 🟡

- ✅ Homework Help — working
- ✅ Quiz — working, mode-differentiated from Homework Help
- ✅ Storytelling Method — working; 🟡 real-device Telugu TTS coverage
  (Android Chrome, iOS Safari) still unverified
- 🟡 Experiential Learning — text-only v1 shipped; ⬜ real YouTube
  video-matching + relevance verification deferred fast-follow
- 🟡 Play-Based Learning — built; refinements not yet built:
  - ⬜ countdown timer scoped to decision-window only
  - ⬜ random (not round-robin) turn order
  - ⬜ "Player of the Day" badge + share option
- ⬜ Online Exam / Test — placeholder only, needs full founder spec
  before design/build

## Phase 3.5 — Pedagogy Grounding 🟡

- ✅ Deployed for Homework Help, Quiz, Storytelling, Experiential
  Learning (revision `tutp-demo-00103-2hf` and later)
- ⬜ Panchpadi grounding completion pass — see
  `TUTP-4-FEATURES-ARCHITECTURE-EXECUTION-PLAN.md` §1

## Phase 4 — Founder / Admin Dashboard ✅

- ✅ Per-child billing (`payments.student_id`)
- ✅ `usage_events` + `feedback_events` tracking across all 6 features
- ✅ Claude-based feedback pipeline (auto-classify / auto-resolve / escalate)
- ✅ `/admin` dashboard — cookie auth + `ADMIN_TOKEN`, 6 sections (KPI
  strip, Signups+UTM, Engagement/DAU, Parent Feedback, Revenue, Failed
  Payments), real Supabase data, no third-party analytics vendor
- ⬜ Real GA4 + Search Console IDs — still placeholder (last remaining
  piece of this phase)

## Phase 5 — Parent Engagement Measurement (PES / Bonding) 🟡

- 🟡 V1 live: `bonding_scores` table, `/api/bonding-score` — 14-day
  homework-completion rate only (explicit launch-pressure scope-down)
- ⬜ PES V1.5 — emotional-tone check-in (1-tap mood question post-session,
  weighted 15% into PES) — see execution plan §3
- ⬜ Full PES/PIS model — Epstein's Six Types of Involvement, 4-factor
  PIS composite (Consistency / Quality-of-Support / Communication /
  Emotional-Tone), supportive-vs-intrusive distinction, BKT-based
  child mastery tracking, Growth-Involvement Correlation Card —
  researched, documented in `PRODUCT-RESEARCH-AND-ROADMAP.md`, not built
- Open decision (unresolved as of last note): ship as-is vs. build one
  high-value researched piece first

## Phase 6 — Payments 🚫 (blocked)

- ✅ Razorpay webhook endpoint live (`/api/razorpay-webhook`, rejecting
  unsigned requests)
- 🚫 Subscription/checkout integration on hold — Razorpay rejected
  using the VettedRx business account for Tut-P; a separate
  Tut-P-specific Razorpay account is being pursued
- ⬜ Migration `012_payments.sql` — written but must be confirmed
  executed in Supabase SQL Editor before paid-tier signups work end to
  end (re-verify current status)

## Phase 7 — Teacher Module 🟡

- ✅ Lesson/question-paper material generator (cognitive-demand
  categories: Logical/Reasoning, Understanding, Application, Skill-based)
- ✅ Teacher registration/verification (`teacher-register`,
  `register-teacher`, migration `016_teacher_verification.sql`)
- ⬜ Phase 3.7 — AI Lesson Plan Generator + YouTube Top-5 (not started)
- ⬜ Phase 3.8 — Teacher Content Channel (not started)

## Phase 8 — Android / App Store 🚫 (blocked)

- ✅ `manifest.json`, app icons generated
- 🚫 `assetlinks.json` — blocked on Play Console SHA-256 signing
  certificate fingerprint
- 🚫 Production access — blocked on either (a) 20 opted-in testers for
  14 continuous days (resets if testers drop below 20), or (b)
  registering as an Organization account (needs a D-U-N-S number)
- 🟡 ASO/SEO strategy documented (`TUTP-ASO-SEO-ANDROID-STRATEGY.md`) —
  Layer 3 (long-tail/hyperlocal) targeting is the immediate focus

## Phase 9 — Tutor Marketplace 🟡

- ✅ DB schema — `tutors` + `tutor_contact_requests` (migration `020_tutors.sql`)
- ✅ Admin tutor management — `/api/admin/tutors` (GET/POST/PATCH),
  verification workflow (pending/verified/rejected)
- ✅ Public directory — `/api/tutors` (active + verified only, phone
  number never sent to client), public `/tutors` page (no login
  required to browse)
- ✅ ₹100 contact-fee payment flow — `/api/tutor-contact/create-order`
  (Razorpay order + `tutor_contact_requests` row), wired to the
  "Contact tutor" button; status moves to `paid` via the existing
  `/api/razorpay-webhook` on `payment.captured`
- ✅ 24h refund-deadline field + auto-refund cron check (schema-level;
  confirm the cron job itself is deployed)
- ⬜ **Phase 2 — real-time masked-number calling** (Uber/Ola/Swiggy
  style) — not built. Current flow is **founder-manual-connect**: after
  payment, founder manually puts parent and tutor in touch and sets
  `status = 'connected'`
- ⬜ `/tutors` page is self-contained Tailwind Play CDN, not yet moved
  into the built `/css/tailwind.css` pipeline
- ⬜ "Ms. Sarah" / "Upcoming Live Session" dashboard card is an
  intentional placeholder for this feature — not yet swapped for the
  real thing

## Phase 10 — Other Planned Features

- 🟡 Visual homework help — backend partially built:
  `/api/homework/illustrate` (problem→JSON parsing + Open Peeps
  character SVGs) exists and works, but is **not wired into any
  frontend page** yet. Bar-model/triangle SVG generators exist but are
  currently used only by the Teacher Module (`lessonRenderer.js`), not
  this feature. Remaining: frontend UI + connecting the paid
  "Formal" bar-model tier.
- ⬜ India Learning Commons Knowledge Graph — curriculum
  structure/metadata graph, grounded in NCF-2020/NCF-SE 2023, state
  SCFs, NCTE B.Ed/D.Ed curriculum (pilot repo exists: 22 records, 6
  entity types)
- ⬜ Voice integration — cascade STT/TTS (Free/Pro), Gemini Live via
  Vertex AI (paid tiers) — post-launch, post-Google-credits
- ⬜ Board selector for lesson generation (State Board/CBSE/ICSE/IB/IGCSE)
- ⬜ Streaming responses for `/api/homework` (2–4 day redesign)
- ⬜ Discussion Method & Lecture Method (Teacher Module, backlogged)
- ⬜ Test/Exam mode formal spec

## Phase 11 — Ongoing Technical Debt / Backlog

- ⬜ Unify the two mode-selector UI surfaces (top pill row vs. attach
  popup) — needs a scoping decision first
- ⬜ `/app/child/` attach menu — needs product decision, never received
  parent-page fixes
- ⬜ `india-geo.js` full district-count audit beyond Telangana/AP
- ⬜ `/api/homework-explain` latency/token fix (low priority, `/demo/`
  only)
- ⬜ Full Homework Help / Quiz code-path split (currently shared modal
  + mode flag) — only if the shared approach causes real issues
- ⬜ Bare-meta-instruction Homework Help edge case (e.g. "generate 10
  questions with answers," no topic/attachment) — explicitly left
  as-is per founder decision, revisit only if it recurs for real users

---

*Status reflects the last confirmed state in memory/repo docs as of
2026-09-22 — re-verify against `CLAUDE.md`, `FEATURE-SPECS.md`, and
`launch-sequencing-notes` before starting work on any item marked 🟡
or 🚫, since these move fast between sessions.*
