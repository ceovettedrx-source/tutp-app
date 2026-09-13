# Tut-P: Architecture & Execution Plan — 4 Remaining Features

**Status:** Ready for Claude Code execution
**Scope:** (1) PES V1.5 Emotional Check-in, (2) Play-Based Learning Refinements, (3) Panchpadi Grounding Completion, (4) Founder/CEO Dashboard
**Written for:** Sequential execution via Claude Code CLI, incremental review at each checkpoint
**Companion docs:** `CLAUDE.md`, `FEATURE-SPECS.md`, `PRODUCT-RESEARCH-AND-ROADMAP.md`

---

## 0. Execution Order & Why

Dependencies force this order — building out of sequence causes rework:

1. **Panchpadi grounding completion** first — smallest, most isolated, no schema changes, unblocks nothing else but blocks quality bar for launch.
2. **Play-Based Learning refinements** second — isolated to one feature's frontend/API, no shared schema.
3. **PES V1.5** third — touches the PES scoring engine and cron job, which the Founder Dashboard will later read from. Must exist before dashboard shows PES-derived metrics.
4. **Founder/CEO Dashboard** last — depends on `usage_events` instrumentation being added to *all* features (including the three above, once they're done) and depends on the payments schema. This is intentionally the biggest, most infrastructural piece, done once everything upstream is stable.

Items 1–3 are launch-blocking (parent-facing). Item 4 is founder-only and can slip a few days past Sept 10 without affecting parent experience — **except** `migration_012_payments.sql`, which must run before Sept 10 regardless, or paid-tier signups silently fail on launch day.

---

## 1. Panchpadi Grounding Completion

### 1.1 Architecture
No new schema. This is a prompt-engineering + verification completeness task across the remaining content-generation routes that don't yet apply the 5-stage Panchpadi structure (Aditi → Bodha → Abhyasa → Prayoga → Prasara).

### 1.2 Execution steps

**Step 1 — Audit (read-only, no code changes):**
```
Read server/references/pedagogy-nep-ncf.md and FEATURE-SPECS.md.
Then grep server.js and all client-facing HTML files under public/ for every
content-generation prompt (Homework Help, Quiz, Storytelling, Experiential Learning,
Play-Based Learning, Question Paper Generator if it exists).

For each one, report: does the system prompt currently reference Panchpadi stages
explicitly? Does it follow the "determine which of the 3 grounding sources apply,
then determine what's implementable" pattern from CLAUDE.md, or is it a generic
prompt with no pedagogy layer? List each route/file with a YES/NO/PARTIAL status.
Do not edit anything yet.
```

**Step 2 — Fix, one feature at a time (never batch-edit all at once):**
For each route flagged NO/PARTIAL, a separate prompt:
```
For [FEATURE_NAME]'s prompt in [FILE_PATH]:
Add Panchpadi grounding following the pattern in server/references/pedagogy-nep-ncf.md —
determine which of the 5 stages apply to this content type, then ground the system
prompt in NEP-2020/NCF-SE 2023 + B.Ed teacher-training pedagogy (connect to sourced
TeacherTrainingUnit KG records where a match exists — search the KG first, never
fabricate a connection). State grounding sources explicitly in the generated output
where relevant, not as boilerplate. Show me the diff before applying.
```

**Step 3 — Verification pass:**
```
For each feature just updated, generate one sample output (use a real grade/subject
combination) and confirm: (a) the Panchpadi stage(s) used are appropriate to the
content type, not forced; (b) no fabricated TeacherTrainingUnit citations; (c) output
quality/length is unchanged from before this change. Report results per feature.
```

### 1.3 Testing checklist
- [ ] Every content feature's system prompt references Panchpadi appropriately (not uniformly — some content types only need 2–3 stages)
- [ ] No fabricated KG citations introduced
- [ ] Spot-check 3 grade/subject combos per feature for output quality regression

---

## 2. Play-Based Learning Refinements

### 2.1 Architecture
Frontend-heavy: timer component, question-order randomization, badge computation. Minimal backend — likely one new field on the session/attempt record (`answer_time_seconds`) and a `daily_player_badge` computation, either as a lightweight query or a small cron.

### 2.2 Schema (if not already present)
```sql
-- Only if play_sessions or equivalent table lacks these columns:
ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS answer_time_seconds INTEGER;
ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS question_order JSONB;
```
(Claude Code should confirm actual existing table name/schema before assuming — do not guess the table name.)

### 2.3 Execution steps

**Step 1 — Audit current implementation:**
```
Show me the current Play-Based Learning feature: the client HTML/JS file, the API
route it calls, and the DB table(s) it writes to. I need to see current timer
behavior (if any), current question-order logic (if any), and whether any
per-player daily record already exists, before making changes.
```

**Step 2 — Timer (30/45/60s, answer-only):**
```
In [PLAY_BASED_FILE]: add a per-question countdown timer with three difficulty-based
durations — 30s, 45s, 60s (confirm with me which maps to which difficulty tier before
implementing, based on existing difficulty labels in the KG). Timer should run only
during the answer phase (not during question-reveal/instruction phase). On timeout,
auto-submit as unanswered/incorrect and advance. Show diff before applying.
```

**Step 3 — Random question order:**
```
Randomize question order per session (Fisher-Yates shuffle client-side or server-side
— tell me which is simpler given current architecture) so repeat play doesn't show
the same sequence. Persist the shuffled order used for that session in
question_order JSONB for later analysis. Show diff before applying.
```

**Step 4 — Player-of-the-Day badge:**
```
Design and implement a "Player of the Day" badge: highest score (or fastest
average-correct-answer-time as tiebreak) among all play_sessions for a given
child/day, computed [as a query on dashboard load / as a nightly cron — recommend
which fits our existing CRON_TOKEN infrastructure better] and displayed on the
Play-Based Learning screen. Show diff before applying.
```

### 2.4 Testing checklist
- [ ] Timer fires correctly for all 3 durations, auto-submits on timeout
- [ ] Same child playing twice in a row gets different question order
- [ ] Badge correctly identifies top performer, ties broken consistently
- [ ] No regression in existing Play-Based Learning scoring

---

## 3. PES V1.5 — Emotional Tone Check-in

### 3.1 Architecture

**New table:**
```sql
CREATE TABLE IF NOT EXISTS emotional_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  child_id UUID NOT NULL REFERENCES children(id),
  mood_value SMALLINT NOT NULL CHECK (mood_value BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emotional_checkins_child ON emotional_checkins(child_id, created_at);
```
(Claude Code must confirm actual `sessions`/`children` table names and PK types against the live schema before running this — do not assume UUID vs serial without checking.)

**PES formula impact:** per `PRODUCT-RESEARCH-AND-ROADMAP.md`, this check-in is weighted **15%** into the overall PES calculation. The existing PES cron job (`CRON_TOKEN`-authenticated, per CLAUDE.md) must be updated to pull from `emotional_checkins` and re-weight the formula — this is the highest-risk part of this feature since it touches a formula already in production.

### 3.2 Execution steps

**Step 1 — Confirm current PES formula implementation:**
```
Show me the current PES calculation logic — which file/function computes it, what
inputs it currently uses, and where the weights are defined. I need to see this
before adding the 15%-weighted emotional check-in, since re-weighting an existing
production formula is high-risk. Also show the cron job definition that triggers it
(Cloud Scheduler + CRON_TOKEN per CLAUDE.md).
```

**Step 2 — Migration:**
```
Write migration_013_emotional_checkins.sql creating the emotional_checkins table
[use the exact schema I'll confirm after your Step 1 report]. Do NOT run it — per
our standing rule, I run all migrations manually via Supabase SQL Editor.
```

**Step 3 — 1-tap mood UI:**
```
Add a 1-tap mood question immediately after a learning session ends (which
feature(s) trigger this — confirm: all 6 chooser options, or specific ones?).
Use 5 simple mood states (recommend emoji-based: 😞😕😐🙂😄 or similar,
confirm visual style against Group A design system). On tap, POST to a new
/api/emotional-checkin route, store in emotional_checkins, and dismiss —
must be genuinely 1-tap, no confirmation step. Show diff before applying.
```

**Step 4 — Re-weight PES formula:**
```
Update the PES calculation to incorporate emotional_checkins at 15% weight per
PRODUCT-RESEARCH-AND-ROADMAP.md. Show me the exact before/after weight
distribution across all PES components before applying — I need to approve the
re-weighting explicitly since this changes a live scoring formula. Update the
CRON_TOKEN-authenticated cron job accordingly.
```

**Step 5 — Backfill/default handling:**
```
For children with zero emotional_checkins so far (all of them, pre-launch), confirm
how the 15% weight is handled — should it be excluded from the denominator until
first check-in, or defaulted to a neutral midpoint? Recommend the statistically
sounder option and explain the tradeoff before implementing.
```

### 3.3 Testing checklist
- [ ] Mood tap UI appears post-session, is genuinely 1-tap
- [ ] `/api/emotional-checkin` writes correctly, rejects invalid mood_value
- [ ] PES formula re-weight verified against 2–3 manual hand-calculations
- [ ] Cron job runs successfully post-change (check Cloud Scheduler logs, not just deploy.sh output — per standing verification rule)
- [ ] No regression in PES scores for children with no check-in data yet

---

## 4. Founder/CEO Dashboard — Full Architecture

This is the big one. Researched against what top SaaS founder dashboards (Baremetrics-class tools) surface as of 2026: the consistent pattern across best-in-class tools is **MRR, churn, failed-payment recovery, active-user trends, and conversion funnels in one view — because founders lose an average of 9% of MRR monthly to failed payments alone when this isn't visible.** That failed-payment visibility point directly matches what you asked for, so it's treated as first-class here, not an afterthought.

### 4.1 Information Architecture — What The Dashboard Shows

Organized into 5 sections, matching how top SaaS dashboards structure themselves:

**A. Overview (top of page, glanceable in 5 seconds)**
- Today's signups, DAU, revenue-today, failed-payments-today (4 big numbers)
- 7-day and 30-day trend sparkline for each

**B. Revenue**
- MRR-equivalent (since Tut-P is one-time payments not subscriptions per settled decision — track **Gross Revenue** and **Revenue per period** instead of true MRR)
- Successful payments count + total value (daily/weekly/monthly toggle)
- **Failed payments count + total value + failure reason breakdown** (this is the #1 thing top tools flag as commonly invisible and costly)
- Revenue by feature/tier if multiple price points exist

**C. Users & Growth**
- Signups over time (daily/weekly/monthly)
- DAU/WAU/MAU
- Signup-to-first-session conversion rate (a funnel step — signup alone is a vanity metric without this)
- Signup source breakdown (via UTM capture — see 4.4)

**D. Feature Usage**
- Per-feature usage counts (all 6 chooser options): Homework Help, Quiz, Storytelling, Experiential Learning, Play-Based Learning, Online Exam
- Per-feature completion rate (started vs. finished — surfaces silent drop-off)
- PES distribution (average, trend) — ties back to Feature 3 above

**E. System Health / Failures**
- API error rate (last 24h, last 7d) by route
- Razorpay webhook failure log (unsigned/rejected requests already logged per current implementation — surface count here)
- Cron job last-run status (PES cron, any others) — surfaces silent cron failures like the CRON_TOKEN 403 issue that already happened once

### 4.2 Data Architecture

**New tables:**
```sql
-- Generic event stream: every meaningful user action across all 6 features
CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                          -- parent account, nullable for pre-auth events
  child_id UUID,                         -- nullable, not all events are child-scoped
  event_type TEXT NOT NULL,              -- 'session_started','session_completed','payment_attempted', etc.
  feature TEXT,                          -- 'homework_help','quiz','storytelling','experiential','play_based','online_exam', null for non-feature events
  metadata JSONB,                        -- flexible per-event-type payload
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_type_time ON usage_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_feature_time ON usage_events(feature, created_at);

-- Payments (referenced in existing pending scope as migration 012 — confirm not duplicating)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_order_id TEXT,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL,                  -- 'captured','failed','refunded'
  failure_reason TEXT,                   -- populated from Razorpay webhook payload on payment.failed
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_status_time ON payments(status, created_at);

-- UTM/referrer capture on landing
CREATE TABLE IF NOT EXISTS signup_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  landing_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Auth for /admin:** per existing decision, `ADMIN_TOKEN` (already in Secret Manager post-rotation) gates the dashboard route. No new auth mechanism needed.

### 4.3 Instrumentation — the part most likely to be underscoped

Every one of the 6 features needs a `usage_events` write at minimum on: `session_started`, `session_completed` (or `session_abandoned` if detectable). This is cross-cutting — touches all 6 feature routes, not a single file. **This is the largest single piece of work in this entire document** — budget accordingly, do not compress it into one Claude Code turn.

```
Step-by-step, one feature at a time (6 separate Claude Code turns, not one mega-turn):

For [FEATURE_NAME]'s route(s) in [FILE_PATH]:
Add a usage_events INSERT at session start (event_type='session_started',
feature='[feature_key]', include child_id/user_id/relevant metadata) and at
session completion (event_type='session_completed', include duration if
computable). Do not block the main response on this write — fire-and-forget
with error logging, never let an analytics write fail the user-facing request.
Show diff before applying.
```

Repeat for: Homework Help, Quiz, Storytelling, Experiential Learning, Play-Based Learning, Online Exam (or its current placeholder state).

**Payments instrumentation:**
```
Wire payments table writes into the existing Razorpay webhook handler
(/api/razorpay-webhook). On payment.captured: insert status='captured'. On
payment.failed: insert status='failed' with failure_reason from the webhook
payload. Confirm the webhook signature verification (already live and rejecting
unsigned requests) is unaffected. Show diff before applying.
```

**UTM capture:**
```
On the landing page(s), capture utm_source/utm_medium/utm_campaign/referrer from
query params + document.referrer at first visit (client-side), persist to
sessionStorage, and send to signup_attribution on signup completion (not on every
page load). Show diff before applying.
```

### 4.4 GA4 + Search Console — real IDs

```
Check current GA4 and Search Console integration: are the tracking IDs currently
real or placeholder? If placeholder, I need to provide the real Measurement ID
(GA4) and verify domain ownership (Search Console) before you wire them in — tell
me exactly what values you need from me and where to get them from my Google
account, then I'll provide them in our next message.
```
(This step requires Vet's input — Claude Code cannot self-serve real GA4/Search Console IDs.)

### 4.5 /admin Dashboard UI

```
Build /admin as a server-rendered or lightweight client page (match existing
public/ HTML+Tailwind pattern, no new framework), gated by ADMIN_TOKEN
(existing auth pattern — check how ADMIN_TOKEN currently gates other routes and
match that pattern exactly).

Sections, in this order top to bottom: Overview (4 today-numbers + sparklines),
Revenue (successful/failed payments, failure reasons), Users & Growth (signups,
DAU/WAU/MAU, conversion funnel), Feature Usage (per-feature counts + completion
rate + PES trend), System Health (API error rate, webhook failures, cron status).

Pull all data from usage_events, payments, and signup_attribution via Supabase
queries — replace any remaining mock dashboard data. Show me a wireframe/rough
layout description before building the full UI.
```

### 4.6 Execution sequencing (do not skip order)
1. `migration_012_payments.sql` (if not already the payments table above) + `migration_013_usage_events.sql` + `migration_014_signup_attribution.sql` — written, then **you run manually in Supabase SQL Editor** per standing rule
2. Razorpay live keys → Secret Manager + Cloud Run wiring (if not already done — confirm current state first)
3. Payments webhook instrumentation (4.3)
4. Usage_events instrumentation, one feature at a time — 6 turns (4.3)
5. UTM capture (4.3)
6. GA4/Search Console real IDs (4.4 — needs your input)
7. /admin UI build (4.5)
8. Replace remaining mock data (final cleanup pass)

### 4.7 Testing checklist
- [ ] Every one of the 6 features writes `session_started`/`session_completed` correctly — verify by manually triggering each feature once and querying `usage_events`
- [ ] A test failed payment (Razorpay test mode) correctly populates `payments` with `failure_reason`
- [ ] UTM params on a test landing URL correctly flow through to `signup_attribution` after signup
- [ ] `/admin` route rejects requests without valid `ADMIN_TOKEN`
- [ ] All dashboard numbers cross-checked against a manual Supabase SQL query for at least one metric per section (don't trust the UI blindly on first load)
- [ ] Cron job status section correctly shows a failure if you manually break the PES cron temporarily (then restore it)

---

## 5. What NOT To Do

- Do not batch all 6 feature-instrumentation changes into a single Claude Code turn — six separate reviewable diffs, per the working-style rule of incremental review.
- Do not run any migration automatically — all migrations are written, then manually run in Supabase SQL Editor per standing rule.
- Do not let analytics/usage_events writes block or fail user-facing requests.
- Do not re-weight the PES formula without showing the exact before/after weight breakdown for explicit approval first — it's a live production formula.
- Do not fabricate GA4/Search Console IDs or proceed with placeholders silently — this step explicitly needs Vet's real values.
