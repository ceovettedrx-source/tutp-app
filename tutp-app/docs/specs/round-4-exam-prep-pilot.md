# Round 4 — exam prep pilot on a verified answer cache (2026-09-30)

> **Status (2026-10-03):** rebased onto main `be0cc4f`. No-traffic preview `ep4`
> (revision `tutp-demo-00370-feb`). The exam-prep e2e has NOT been run.
> Migration 028 and `supabase/test-data/028_family16_class5.sql` are NOT applied.
> `E2E_ADMIN_TOKEN` was not provided. `CAPABILITIES.exam_prep` stays `false`.
> The other e2e specs (cache, cron, login, family, visual-tutor, homework,
> chips, story) passed in replay on `ep4`, once.

Scope and decisions 1-5 were approved by the founder on 2026-09-28 (kept in
memory as `kg-cache-exam-prep-spec`). This page turns them into files, edge
cases and tests. Branch `round-4-exam-prep` from main `16e92bb` (rounds 2+3
live on 00315-qam).

## Founder answers (approved 2026-09-30) — these override the text below
- **Needs fix on a served note**: parents keep getting the old approved
  version by default. A **"hide now"** checkbox (for real errors) switches
  that note to "coming soon" until the new version is approved.
- **Undo on approve**: brings back the version that was approved before.
- **1. No auto-publish during the pilot**: English also waits for the
  founder's review; every generated version lands in "needs your review".
  Revisit after the pilot.
- **2. AP edition**: the founder checks the AP textbook edition by hand;
  until then the AP page says "based on the 2019 edition".
- **3.** Family 16's test child is set to Class 5, Telangana (test data
  only), in migration `028_answer_cache.sql`.
- **4.** One round.

Consequences for the build: x9 (a failed gate lands in review, never
rejected) is a unit test of the pipeline with a stubbed model, since a
failure can't be forced on a real model call. The e2e generates and
approves **test notes** only (`is_test`, their own keys), through the admin
API with the admin cookie (`E2E_ADMIN_TOKEN` in the runner's environment,
never printed). The migration is run once in the Supabase SQL editor.

## AI review (founder correction, 2026-09-30) — replaces "no auto-publish"
The founder's answer 1 above ("English also waits for my review") is
replaced by these rules; `agent_reviewed` on the KG LCs is a separate,
unchanged thing.
- **Auto-approve** a version only when **every gate passes and Haiku
  (attempt 1) wrote it**. If Sonnet wrote it (Haiku's attempt failed a
  gate) or any check fails, it goes to the founder's review queue. Applies to
  English and Telugu. A version written for a **needs fix** always goes to
  the founder's queue (the founder already flagged that note as wrong).
- **`reviewed_by`** (`'ai'` or `'founder'`) is stored on every approval, on
  the version row and on its decision row (`decided_by`). Never sent to
  parents (the parent routes return the content only).
- An AI approval is a normal decision row (`action` approve, `decided_by`
  ai), so **Undo works on it**: the previous approved version comes back.
- **"Report a mistake"** button on every note for parents
  (`POST /api/exam-prep/report`, optional text up to 500 characters, one
  open report per child per version). One report puts that note into the
  founder's "Needs your review" list (marked "reported by a parent") and
  **keeps serving the current version**. The founder then picks **Keep**
  (the note is fine: reports closed, `reviewed_by` becomes `founder`),
  **Needs fix** or **Reject** as before. Undo on a Keep re-opens the reports.
- **Weekly sample**: the admin page shows **2 random Telugu notes approved
  by AI** each week (fixed for the week, Monday IST), with **Keep**, Needs
  fix, Reject.
- **Teacher queue**: every AI-approved note not yet reviewed by a teacher is
  listed as "waiting for a teacher"; the page says whether a teacher account
  exists (approved row in `teachers`). The teacher's own screen is round 6;
  the queue holds until then, nothing is lost. Columns:
  `teacher_reviewed_at`, `teacher_reviewed_by`.
- Tables (migration 028, edited before it was run): `answer_cache.reviewed_by`,
  `.teacher_reviewed_at`, `.teacher_reviewed_by`; `answer_cache_decisions.decided_by`,
  `.reviewed_by_before`, action `keep`; new `answer_cache_reports`.
- Tests: unit (Haiku pass -> approved by ai; Sonnet pass -> needs_review; a
  failed check -> needs_review; a fix version -> needs_review; undo of an ai
  approval; a report keeps serving and queues; Keep closes it, Undo
  re-opens; the weekly sample is 2 Telugu ai notes and stable within the
  week). e2e: generated test note is approved by ai exactly when the gates
  passed at attempt 1; `reviewed_by` absent from parent responses; the report
  button keeps the note served and lists it for review; Keep and Undo.

## Market check
Revision notes, flashcards and chapter mind maps are standard in Indian
EdTech (BYJU'S, Vedantu, Toppr, and free "revision notes" sites for CBSE),
but almost all of it is CBSE/NCERT and English-first. State-board Telugu
content is thin and rarely checked. Tut-P's angle: state syllabus, the
parent's language, and every note verified before any child sees it.
(From general knowledge, not a fresh survey.)

## What the parent sees
- Parent dashboard, child card: **"Exam prep"** button when the child is
  Class 5 in Andhra Pradesh or Telangana (from `students.class/state`).
  Every other child or chapter: "coming soon", no model call, never an
  ungrounded note.
- Opens a chapter page: "Chapter 13: Fractions (AP/TS State Board, Class 5)".
  Tabs: Revision notes (free) · Key points + formula sheet · Flashcards
  (10-15) · Practice questions in the exam pattern · Mind map.
  Only Revision notes is free. The rest are the **chapter exam prep pack**,
  open when the child has an active paid period (`getPaidStatusForStudents`);
  otherwise a lock with the existing per-child purchase button.
- **"Hand to child"** (decision 1): the same page full screen in child mode
  on the parent dashboard (large type, no parent menus, exit button). Not
  `/app/child/`.
- Language: English or Telugu, the parent's current language. Telugu shows
  only after the founder approves it (decision 5); before that, "coming
  soon in Telugu" with the English version offered.
- Dashboard card **"Exam prep this week"**: minutes opened (visible time,
  capped 30 min per open), flashcards and questions answered, per child.

## Content pipeline (no content is generated on a parent's request)
- New table `answer_cache` (Supabase migration, `db/` SQL file), one row
  per **note version**: `id`, `key` (sha-256 of mode, board, class, chapter,
  language, prompt_version, kg_version), those fields as columns, `version`,
  `content jsonb`, `status`, `model`, `usd`, `checks jsonb` (every gate's
  result), `fix_reason`, `is_test`. A "note" = one key (one mode of one
  chapter in one language for one board).
- Statuses: `needs_review` (waiting for the founder) · `approved` (served) ·
  `needs_fix` (regenerating) · `rejected` · `superseded` (an older version).
  At most one `approved` version per key; parents are served only that
  one. No approved version -> "coming soon" (HTTP 200 with
  `status: "coming_soon"`), never an error.
- Grounding: `knowledgeGraph.js` gets `getChapter(state, grade, subject,
  chapter)`: StateMappings -> LearningComponents -> Misconceptions, plus the
  new `key_terms_en/te`. No chapter match -> not sourced -> nothing generated.
- Generation is started from the admin review page ("Generate" per mode and
  language), with a neutral context ("your child · Class 5"), never a child's
  name, photo or PDF. Model: Haiku 4.5; if the gate fails, one retry on
  Sonnet 5; if that fails too, the version goes to **needs your review**
  with the failed checks shown. A gate never rejects anything by itself.
- Gate:
  1. Deterministic: JSON shape, counts (flashcards 10-15, questions 8-12),
     every fraction stated is arithmetically true (`server/fraction-check.js`),
     Telugu mode is in Telugu script, no text longer than 12 words copied
     from any KG source field marked tier-3.
  2. An independent Sonnet 5 check against the KG content (correct, on
     syllabus, age-appropriate), strict JSON verdict.
  3. `lessonVerifier` Gates A/B on every multiple-choice question.
  English: all three pass -> `approved` (open question 1). Telugu, and
  anything with a failed check: `needs_review`.
- Practice questions are written fresh, never copied, each tagged
  logical_reasoning / understanding / application / skill_based.
- Mind map is drawn by the server as SVG from the key points (no model call).

## Admin
- New page `/admin/exam-prep` (admin cookie only, token never in the URL):
  each note with its gate results, cost, status and a preview exactly as
  the parent sees it. A "Needs your review" list comes first. Generate
  starts a missing note.
- Three actions per note (founder, 2026-09-30), each acting on **that one
  note only** (one version id per request; the server accepts no list and
  has no bulk endpoint, the page has no multi-select):
  - **Approve**: this version becomes the served one; the previously
    approved version of the same note becomes `superseded`.
  - **Needs fix**: reason required. Only this note is regenerated, with
    the reason added to its prompt; the new version goes through the
    gates and then always to "needs your review", never straight to
    parents. If the note was being served, it goes to "coming soon"
    until you approve the new version (you flagged it as wrong).
  - **Reject**: reason required, plus a second confirm ("Reject this one
    note? Parents will see coming soon for it."), for when you're
    certain. Only that version changes. Other notes, other chapters and
    other approved entries are never touched; parents see "coming soon"
    for that note, never an error.
- **Decision history with undo**: table `answer_cache_decisions` (note
  key, version id, action, reason, status before and after, time,
  `undone_at`). The page shows each note's history. Undo reverts the
  latest decision on that note: status goes back to what it was; undoing a
  needs-fix also sets the regenerated version to `superseded` (kept, not
  deleted). Undoing an approve puts back the version approved before it.
  Nothing is ever deleted.
- `/api/admin/costs` gains a card: cache hits vs model calls, spent vs saved
  (a hit counts the item's own generation cost as saved).
- Decision 3: typed Homework Help questions are **counted only** for two
  weeks: a `hw.typed_repeat` usage row with the hash of the normalized
  question + class + language (never the text), and an admin line "typed
  questions asked before: N of M". No cache serving yet.

## Pre-pilot data work (in this round, before any generation)
- Review the 3 `placeholder` LearningComponents (lc-01 g4, lc-02 g5, lc-03
  g5); rewrite in own wording where needed, mark `agent_reviewed` (founder
  2026-09-30): the review is the AI agent's, checked against the state
  chapter mapping, not a person's, so the status says so. They stay at
  `agent_reviewed` in this round; only a human review moves them on.
- Add `key_terms_en` / `key_terms_te` (own wording).
- The AP edition (2019 mirror) can't be re-checked automatically:
  cse.ap.gov.in blocks automated fetches. **You check it by hand once**
  (link in the KG file); until then the AP page says "based on the 2019
  edition".
- Honest limit: the KG covers only 2 skills of the chapter (equivalent
  fractions, comparing unlike fractions). Notes cover those 2 and say so;
  they don't pretend to cover the whole chapter.

## Files
`server.js` (routes: `GET /api/exam-prep/:studentId`, `GET
/api/exam-prep/:studentId/:mode`, `POST /api/exam-prep/event`, admin
routes, typed-repeat count), new `server/exam-prep.js` (keys, gate,
generation via `server/anthropic.js`), `server/prompts/exam-prep-*.js`,
`server/fraction-check.js`, `server/mind-map-svg.js`,
`server/services/knowledgeGraph.js`, KG JSON files, `db/answer_cache.sql`,
`public/app/mother/` + `father/` (button, chapter page, child mode, weekly
card), new `public/admin/exam-prep/`, unit tests, `tests/e2e/exam-prep.spec.js`.

## Edge cases
Child not Class 5 or not AP/TS; family registered as CBSE/ICSE (family data
`children[].curriculum`) -> "coming soon" (the KG maps only state books);
item rejected; Telugu not yet approved; paid period ended mid-session
(pack locks on next open, revision notes stay); member session (read-only
view, same rules as the child's plan); two tabs sending events; an open tab
left for hours (time capped at 30 min per open).

## Tests
- Unit: cache key stability, gate (bad fraction, wrong count, copied text,
  English in Telugu mode), fraction checker, mind map SVG, KG `getChapter`.
- e2e (`exam-prep.spec.js`, replayed model calls): x1 family 16's paid Class 5
  child (state set by the test data) sees all 5 modes; x2 a family 18
  free child sees revision notes and a locked pack; x3 a non-pilot child
  sees "coming soon" and no model call happens; x4 child mode opens and
  exits; x5 events -> weekly card shows minutes and counts; x6 admin page
  refuses a non-admin, approve makes Telugu visible; x7 **one reject
  leaves every other note served**: reject one note (reason + second
  confirm) -> the parent gets "coming soon" (200) for that mode and every
  other note's served version id is unchanged; the other chapter's and
  language's notes too; undo -> served again; x8 needs fix -> only that
  note gets a new version, in "needs your review", other version ids
  unchanged; reject without a reason or with a list of ids -> 400; x9 a
  forced gate failure lands in "needs your review", not rejected.
- The e2e works only on **test notes** (`is_test`, generated for the test
  families; test families are served test notes only), so a test reject
  never touches a note real parents see. Decision 4 needs no SQL
  now: family 18 (all free, `is_test`) is the unpaid family; family 16 is
  left as it is, so login/homework tests are unchanged.

## Spend
Generation for the pilot: 2 boards x 5 modes (4 by model) x 2 languages,
about 16 items, each Haiku + one Sonnet 5 check: estimated under $1.
Tests replay: $0. Model file changes trigger the 4-test live smoke set once
(about $0.03).
