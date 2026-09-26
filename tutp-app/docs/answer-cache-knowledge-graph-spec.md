# Answer cache and Knowledge Graph: spec for the cost-reduction task

Status: **spec only, not built.** Founder decision, recorded 2026-09-26.

Build order: this is the cost-reduction task. It comes after (1) the AI-route security fix and (2) the billing stopgap. When its turn comes, **Stage 1 (plan) comes first**, before any code.

## Goal

Generate an answer once and serve it to every child who asks the same question, pan-India.

- All 66 boards are reachable from day one.
- Content depth is prioritized by how many students each board covers.

## Prerequisite: board, medium and grade per child

**This is the first item of the cost-reduction task.** The cache and Knowledge Graph key every answer on board, medium and grade, so every child profile must carry all three.

If they aren't stored today:

- Make them **required at registration**.
- Add a **one-time dashboard prompt** for existing families to fill them in.

## Pipeline (Homework Help, photo or typed text)

| Layer | What it does | Model | Cost |
|---|---|---|---|
| 0. Read | Extract the question text, subject and every number from the photo into a small JSON. Board, grade and medium come from the child's profile. Skipped for typed questions. | Claude Haiku 4.5 | Small |
| 1. Knowledge Graph | Look up board > grade > subject > chapter > exercise > question > answer, per explanation language. **Verified answers only.** | none | ₹0 |
| 2. Exact match | Hash lookup on the normalized question, board, grade, explanation language and numeric signature. Normalizing strips numbering, whitespace, punctuation and case, and unifies scripts where that's safe. **Numbers must match exactly.** | none | ₹0 |
| 3. Near-duplicate | Postgres `pg_trgm` similarity within the same board, grade, subject and language, with identical numbers. A high score reuses the answer; a grey-zone score gets a Haiku yes/no check; anything lower is a miss. | Haiku only in the grey zone | Near ₹0 |
| 4. Generate | First-time answers use the best model, since the cost is spread over many children. Stored with `status = unverified`. | Sonnet | Full |

## On-demand "why"

- Each question and answer shows **"Show how this answer was reached"**.
- The explanation is generated only when tapped (Sonnet), then cached per question and language.
- **Remove the always-generated `reasoning` field** from Homework Help output.

## Quality loop

- **Any thumbs-down quarantines** that cached answer, and the next person to ask gets a fresh generation.
- **Promotion to `verified`** needs either K thumbs-up with zero thumbs-down, or teacher approval through the Teacher Module. K is decided in Stage 1.
- **Only verified answers enter the Knowledge Graph.**

## Never cached

- **Child names:** only the `{{CHILD}}` placeholder is stored. The server substitutes the real name on the way out; the demo route already works this way.
- **Parent custom instructions:** any request with one bypasses the cache entirely.
- **Storytelling, Play-Based, and anything personalized.**
- **Textbook passages:** store only the question text and our own explanation.

## Pan-India content rollout

Pre-generation uses the Batch API (50% off).

| Phase | Scope |
|---|---|
| 1 | NCERT: CBSE, plus about 19 boards in 14 states that adopt or adapt NCERT. **Pilot first:** NCERT Class 6–8 Maths and Science in English, Hindi and Telugu. Measure hit rate, quality and cost before going further. |
| 2 | The largest state boards by enrolment (the top 33 boards cover 97% of students). |
| 3 | CISCE and NIOS. |
| 4 | The rest fill in organically through layers 2–4. |

**Board taxonomy:** reuse the existing India board taxonomy in the repo or docs. **The child profile must carry board, medium and grade.**

## Metrics

Recorded in `usage_events` (`ai.call`, plus new cache events):

- Hit rate per layer
- Cost per session
- Time to answer
- Thumbs-down rate per layer

## Stage 1 must include

- **A count of NCERT Class 1–10 exercise questions**, to size the pre-generation budget.
- **A legal note on textbook copyright:** what storing question text and our own explanations means, and what must never be stored.

## Sources

- **66 school boards (3 national + 63 state); the top 33 boards cover 97% of students.** PTI, via Careers360, 19 Jun 2025, quoting the Ministry of Education's School Education Secretary: https://news.careers360.com/centre-recommends-7-states-adopt-common-board-for-class-10-12-pgi-d-school-education-analysis-flags-poor-outcomes
- **NCERT textbooks are prescribed by CBSE for classes 1–12, and about 19 boards in 14 states have adopted or adapted them.** https://en.wikipedia.org/wiki/National_Council_of_Educational_Research_and_Training

## Found while writing this (2026-09-26), for Stage 1 to resolve

- **No 66-board taxonomy exists in the repo yet.** What exists:
  - `VALID_BOARDS` in `server/routes/teacher/create-material.js`: 5 generic values (`state_board`, `cbse`, `icse`, `ib`, `igcse`).
  - `QP_BOARDS` in `server.js`: 3 values.
  - The Knowledge Graph pilot data in `server/knowledge-graph-data/` (22 records, per `task.md`).

  A full list of all 66 boards has to be built or sourced.
- **The child profile doesn't clearly carry board and medium today.** The registration page mentions school-board options, but I haven't confirmed that board and medium are stored per student. Stage 1 verifies this first (see the prerequisite above).
- **Cost dependency:** the ₹1.5 per-session target in `docs/pricing-tiers-spec.md` depends on this task's measured hit rates.
