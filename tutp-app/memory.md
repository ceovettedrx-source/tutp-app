# Tut-P — Project Memory / Status

_This file is the concise "where are we right now" snapshot. Keep it
short — full detail lives in `task.md` (phases), `CLAUDE.md` (infra +
rules), `FEATURE-SPECS.md` (feature specs), and
`PRODUCT-RESEARCH-AND-ROADMAP.md` (research). Update this file at the
end of every significant session; don't let it go stale._

**Last generated: 2026-09-22** (from memory + repo state — re-verify
before trusting fully; things move fast between sessions).

---

## Current Status

- **Product state:** live production app (tutp.online), not a
  prototype — real families using it.
- **Core loop (6-option parent chooser):** 4 of 6 modes fully working
  (Homework Help, Quiz, Storytelling, Play-Based Learning-basic); 1
  partially built (Experiential Learning — text-only); 1 not started
  (Online Exam/Test — needs founder spec).
- **Founder/Admin Dashboard:** complete and live on real Supabase data
  — only real GA4/Search Console IDs remain as placeholders.
- **Parent engagement scoring (PES/Bonding):** live version is a
  simplified 14-day homework-completion rate, not the full researched
  model. This gap between marketing positioning ("world's first
  parent-engagement-scored EdTech") and what's actually live is an
  **open, unresolved decision** — read `PRODUCT-RESEARCH-AND-ROADMAP.md`
  and `CLAUDE.md` backlog before touching PES code or marketing copy.
- **Payments:** webhook live; full checkout blocked — Razorpay
  rejected the VettedRx business account for Tut-P, separate account
  in progress.
- **Android:** blocked on Play Store testing/organization-account
  requirements — separate workstream from web.
- **Security:** all secrets rotated to Secret Manager and confirmed
  (2026-09-14); registration phone-verification and ambiguous-phone-
  match bugs fixed the same day.

## Completed (high-confidence, don't re-litigate)

- Auth: OTP login, 24-route auth gap closed, registration
  vulnerability fixed, ambiguous-phone-match guard
- Secret rotation: all 5 flagged secrets migrated to Secret Manager
- Homework Help: root-cause bug (ignoring attachments) fixed,
  truncation bug fixed (max_tokens 3000)
- District dropdown regression fixed (india-geo.js, Telangana 33 /
  AP 28)
- Razorpay webhook live and correctly rejecting unsigned requests
- Pedagogy grounding deployed for 4 of 6 chooser features
- Founder Dashboard bundle (billing, usage/feedback tracking, /admin
  UI) — complete
- Mode-selector carrying (photo attach → mode pick → login → correct
  dashboard modal) — confirmed working end-to-end

## In Progress / Open

- Play-Based Learning refinements (timer, random order, Player-of-the-
  Day badge) — designed, not built
- Experiential Learning YouTube video-matching — deferred fast-follow
- Storytelling real-device Telugu TTS coverage — needs founder
  device-testing, not done
- Razorpay Tut-P-specific account setup — founder-side, pending
- Remaining Cloud Run env vars still plaintext (SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_TOKEN, GMAIL_APP_PASSWORD, RESEND_API_KEY, CRON_TOKEN) —
  re-check against the "Secret rotation complete" note in `CLAUDE.md`,
  which may supersede this if not yet reconciled
- PES/Bonding Score — ship-as-is vs. build-one-high-value-piece-first
  decision unresolved
- Phase 3.7 (AI Lesson Plan Generator + YouTube Top-5) and Phase 3.8
  (Teacher Content Channel) — not started
- Migration `012_payments.sql` — confirm it has actually been run in
  Supabase SQL Editor (was last noted as written but not yet executed)

## Not Started

- India Learning Commons Knowledge Graph (beyond 22-record pilot),
  voice integration, board selector

## Partially Built (backend exists, not user-facing yet)

- **Visual homework help** — `/api/homework/illustrate` (problem→JSON
  parsing + character SVGs) works but has no frontend page calling it
  yet; paid-tier bar-model generators exist but are wired only into
  the Teacher Module currently.

## Corrected 2026-09-22 (was wrongly marked "not started")

- **Tutor marketplace is built (Phase 1)** — DB schema
  (`020_tutors.sql`), admin CRUD, public `/tutors` directory page,
  ₹100 Razorpay contact-fee flow, all live in `server.js`. Only
  **Phase 2 (real-time masked-number calling)** is missing — current
  flow is founder-manual-connect after payment. See `task.md` Phase 9
  for full detail.

## Known Traps for Future Sessions (read before assuming)

- `deploy.sh` success ≠ live — always verify traffic via
  `gcloud run services describe`
- Homework Help prompt logic lives **client-side**
  (mother/father/family-member HTML), not in `server.js`
- `/app/child/` attach menu is still the old dead decorative one — not
  yet fixed, needs a product decision first
- Two separate mode-selector UI surfaces still exist (top pill row +
  attach popup) — not unified yet
