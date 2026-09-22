# Tut-P — Product Requirements Document (PRD)

_Last generated: 2026-09-22. Source: overview.md, FEATURE-SPECS.md,
PRODUCT-RESEARCH-AND-ROADMAP.md, CLAUDE.md, TUTP-4-FEATURES-ARCHITECTURE-EXECUTION-PLAN.md._

---

## 1. Product Overview

**Tut-P** (tutp.online) is a parent-centered EdTech platform for Indian
families, grades 1–12. Its core differentiator: it measures and improves
**parental involvement** in a child's education — it grades the parent,
not the child.

**Signature concept:** *"Children are passengers, Parents are the boat,
Tut-P is the engine."*

Tut-P is a three-sided ecosystem, not a parent-only tool:
- **Family** is the entry point — a child feels supported at home.
- Meaningful home support requires **school context** (what the teacher
  actually taught, not just a homework page number) — so **teachers**
  are drawn in via real utility: lesson planning support, homework
  audit reports, homework status, classwork uploads, homework
  guidance, exam paper prep.
- Teacher adoption requires **school management** buy-in, delivered via
  value (digital-classroom/curriculum trend updates) and revenue-sharing
  with teachers/schools.

Founder: Sreepada Ramana Chary ("Vet") — Telugu journalism and
government communications background, solo technical direction via
Claude. Co-founder Safia Begum brings HR, marketing, finance, and
tutoring domain expertise. Entity: Medsurs Concepts LLP.

---

## 2. Problem Statement

Indian parents — especially in Tier-2/3 cities and regional-language
households — struggle to help their children with schoolwork because:

1. **Language/subject gap** — parents may not be fluent in the medium
   of instruction or the subject matter itself.
2. **No visibility into the classroom** — parents only see the
   homework page number, not what was actually taught, or how it
   connects to what came before.
3. **Existing EdTech targets the child, not the parent** — tools grade
   and gamify for the student, leaving the parent as a passive
   bystander rather than an active, measured participant.
4. **No accountability loop for parental involvement itself**, even
   though parental involvement is one of the strongest predictors of a
   child's academic outcomes.

Tut-P's bet: fixing the *parent's* side of the equation — explaining,
engaging, and being measured on it — moves the needle further than
another child-facing app.

---

## 3. Goals

- **Primary:** Y Combinator (or equivalent top-tier accelerator/grant)
  — apply YC philosophy throughout: plain language, no jargon,
  obsessive product/user focus, one clear weekly growth metric, do
  unscalable things early.
- Ship and sustain a **live, revenue-generating production product**
  (not a prototype/demo) serving real Indian families.
- Build genuine parent-engagement measurement (Parent Engagement
  Score / bonding score) as a defensible, differentiated positioning —
  not just a homework-completion counter.
- Reach seed-fundable traction: target ask is INR 1–1.5 Crore at INR 7
  Crore pre-money valuation.
- Expand into a three-sided ecosystem: parents → teachers → school
  management, each with real utility, not just parent-only tooling.
- Ground all content-generation features in real Indian pedagogy
  (NEP-2020 / Panchpadi / NCF-SE 2023 / state curricula) so grounding
  claims are genuine, not marketing decoration.

---

## 4. Target Users

| Segment | Description | Primary need |
|---|---|---|
| **Parents (mother/father/family member)** | Indian families, grades 1–12, often not fluent in the subject or medium of instruction | Understand and help with their child's homework; be recognized/measured for their involvement |
| **Children (indirect users)** | The "passengers" — benefit from a more-engaged parent, not a direct product user in the primary flows | Supported home environment |
| **Teachers** | School teachers, drawn in via utility features | Lesson planning support, homework audit reports, classwork uploads, exam paper prep |
| **School management** | Institutional buy-in layer | Digital-classroom/curriculum trend visibility, revenue-share model |
| **Tutors** (emerging) | Independent tuition teachers | Parent-lead marketplace (masked-number contact, ₹100 contact fee) — planned feature, not yet built |

Geography/language: India-wide, strong Telugu/Telangana-region focus in
current content and go-to-market; UI supports multiple regional
languages for parent-facing explanation only (source-language child
content is never translated).

---

## 5. Core Features

### 5.1 The 6-option parent chooser (source of truth: `FEATURE-SPECS.md`)

All 6 require an explicit parent selection — no silent default.

1. **Homework Help** — plain explanation of homework content in the
   parent's chosen language. No quiz. *(built, working)*
2. **Quiz** — 5–10 assessment questions spanning Bloom's Taxonomy
   levels (recall/understanding/application), single-child,
   no timer. Shares a modal/API with Homework Help
   (`/api/homework`), differentiated by a mode flag. *(built, working)*
3. **Storytelling Method** — turns a lesson into a memorable story,
   read aloud via Web Speech API (browser TTS); falls back to
   text-only when no matching Telugu voice is available. *(built,
   working; real-device Telugu TTS coverage not yet verified)*
4. **Experiential Learning** — infers the prior curriculum topic,
   generates step-by-step notes; YouTube video-matching for real
   demonstrations is planned but not yet built. *(built, text-only v1)*
5. **Play-Based Learning** — multiplayer family quiz game (2–4 real
   family members), 3 questions per player. Countdown-timer,
   random turn order, and "Player of the Day" badge are designed but
   not yet built. *(built, refinements pending)*
6. **Online Exam / Test** — formal, single-child assessment distinct
   from Play-Based Learning. *(placeholder only — "Coming soon," not
   designed)*

### 5.2 Parent engagement measurement

- **Parent Bonding Score / Report**, **Student Progress Card**,
  **Teacher Dashboard** — participation-based bonding model (see
  `bonding-and-teacher-dashboard.md` for settled design).
- Current live version (`bonding_scores` table, `/api/bonding-score`)
  is a 14-day homework-completion rate — an explicit V1 scope-down.
  The fully researched model (Epstein's Six Types of Involvement, a
  4-factor PIS composite: Consistency / Quality-of-Support /
  Communication / Emotional-Tone, supportive-vs-intrusive involvement
  distinction, BKT-based child mastery tracking, Growth-Involvement
  Correlation Card) is documented in `PRODUCT-RESEARCH-AND-ROADMAP.md`
  but not yet built.

### 5.3 Founder / admin tooling

- Founder Dashboard: per-child billing, usage/feedback event tracking
  across all 6 features, Claude-based feedback auto-classification,
  `/admin` dashboard (KPI strip, Signups+UTM, Engagement/DAU, Parent
  Feedback, Revenue, Failed Payments) — all on real Supabase data, no
  third-party analytics vendor.

### 5.4 Teacher module

- Lesson/question-paper material generator (cognitive-demand
  categories: Logical/Reasoning, Understanding, Application,
  Skill-based), teacher registration/verification.
- Phase 3.7 (AI Lesson Plan Generator + YouTube Top-5) and Phase 3.8
  (Teacher Content Channel) — planned, not yet started.

### 5.5 Payments

- Razorpay — full integration (not the Payment Links shortcut),
  one-time payments (not recurring subscriptions) by design decision.
  Currently blocked: Razorpay rejected using the VettedRx business
  account for Tut-P; a separate Tut-P-specific account is in progress.

### 5.6 Planned / not yet built

- **Tutor marketplace** — Uber/Swiggy-style masked-number contact
  between parents and tuition teachers, ₹100 contact fee.
- **Visual homework help** — 🟡 partially built, not "not started."
  `/api/homework/illustrate` backend endpoint exists (Claude parses a
  math word problem into structured JSON; Open Peeps character SVGs
  generated deterministically, placeholder SVGs for objects until a
  real object library exists) — but it is **not called from any
  frontend page**, so no parent can see it yet. The paid "Formal"
  bar-model tier's generators (`barModelSvgGenerator.js`,
  `triangleSvgGenerator.js`) exist but are currently wired only into
  the Teacher Module's `lessonRenderer.js`, not this feature. Remaining
  work is frontend wiring + the paid-tier bar-model integration, not a
  from-scratch build.
- **India Learning Commons Knowledge Graph** — curriculum
  structure/metadata graph (not textbook hosting, to avoid copyright
  risk), grounded in NCF-2020/NCF-SE 2023, state SCFs, NCTE B.Ed/D.Ed
  curriculum.
- **Android TWA / Play Store submission** — separate workstream;
  blocked on 20-tester 14-day requirement or Organization account
  (D-U-N-S number).
- **Voice integration** — cascade STT/TTS (Free/Pro), Gemini Live via
  Vertex AI (paid tiers) — post-launch, post-Google-credits.

---

## 6. Non-goals (explicitly out of scope / rejected)

- Recurring subscription payments (one-time payments only, by decision).
- Textbook PDF hosting (copyright risk — Knowledge Graph is metadata
  only).
- Translating original child-facing source-language content (the
  language selector applies only to parent-facing commentary).
- Third-party analytics vendors (in-house event tracking + Claude
  feedback pipeline instead).
- Using a third-party review/checklist tool for the release-discipline
  process (gstack — rejected over supply-chain/telemetry risk; a
  self-authored git hook is used instead).

---

*This document reflects the state of the project as understood from
memory and the `tutp-app` repo as of 2026-09-22. Re-verify against
`FEATURE-SPECS.md`, `PRODUCT-RESEARCH-AND-ROADMAP.md`, and
`TUTP-4-FEATURES-ARCHITECTURE-EXECUTION-PLAN.md` before relying on any
single line here — those repo files are the authoritative source,
this PRD is a consolidated summary of them.*
