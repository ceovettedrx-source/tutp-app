# TUT-43: Singapore Maths Method (10-minute daily word-problem practice, grades 1-6)

Status: **spec only, awaiting Vet's approval. No code written.** Branch `tut-43-singapore-maths-spec`
(from main 15e2f7b). Read first: CLAUDE.md, FEATURE-SPECS.md, docs/pricing-tiers-spec.md,
docs/answer-cache-knowledge-graph-spec.md, Linear TUT-43 / TUT-23 / TUT-20.

## 0. Framing

**Problem.** The "10-minute Math Session" card on the mother, father and family-member dashboards
runs `onclick="openHomeworkModal()"`, the same modal as Homework Help (`public/app/{mother,father,
family-member}/index.html`, the STANDARD card tier). A duplicate button. The card becomes a real,
different product: Homework Help answers tonight's homework (reactive); this builds word-problem skill
every day (proactive).

**Market check (2026-10-10, two searches, limited).** Bar-model practice exists: Thinking Blocks
(interactive bar-model builder, free, web, English) and the Houghton Mifflin Harcourt "Singapore Math
Bar Models" iPad app (per grade, English); Bhanzu publishes parent explainers on the method. The
searches found no product that (a) has the parent do the Concrete step with the child, (b) runs in
Telugu and Hindi, (c) follows the CPA order in one session, and (d) shows a parent a per-model mastery
map. That is the gap, not the bar model itself. Not found, so **not claimed**: any effect size for CPA
or bar models on marks. The card makes no result claim (section 9).

**Success metric (TUT-43):** weekly sessions per active child, and free-session to Max upgrade rate;
keep or cut after 6 weeks of real families.

## 1. Session flow (CPA), about 10 minutes

Page `/app/singapore-maths/` (new), opened from the card with the selected child. One session = one
focus model type (section 2), 3 problems.

1. **Concrete (about 2 min, parent + child).** One screen: the first problem's story with a household
   version ("Put 12 spoons on the table. 7 go to Amma ..."): items, numbers and a one-line instruction
   for the parent. Two buttons: "We did it" and "Skip". "We did it" is tapped by the parent and writes
   the `sgmath.concrete_done` usage event with `viewer_key` (the signed-in parent/member) as the
   participation signal TUT-20 will read. Skipping is allowed and recorded (`skipped: true`); the
   session still counts.
2. **Pictorial (about 4 min).** The child builds the bar model for each of the 3 problems: drag bar
   ends to resize, tap a bar to split it into equal parts, tap a part to label it with a number from the
   story. Check shows green/red per bar with the reason ("the 5 part is longer than the 7 part").
3. **Abstract (about 3 min).** For the same problems: the child picks or types the equation, then the
   answer with its unit. The finished bar model stays on screen above the equation.
4. **Finish.** Time taken, a bar-model replay of problem 1, the model type practised, one next step.
   No score shown as a grade; no claim about marks.

The 10 minutes is a target, not a hard timer: nothing cuts a child off. The summary shows real minutes.

## 2. Model ladder and diagnostic

Order: part-whole, comparison, before/after, fractions, ratio. Grade ranges: part-whole 1-6,
comparison 2-6, before/after 3-6, fractions 3-6, ratio 5-6 (21 grade x type cells).

- **First session per child = diagnostic:** one problem per model type available for the child's grade
  (3 to 5 problems), pictorial step only, no Concrete. Output seeds `mastery` per type.
- **After that:** the focus type is the child's weakest with at least 2 attempts; a type never
  attempted is tried before a repeat. Difficulty 1-3 steps up after 2 correct in a row, down after 2
  wrong.
- **Mastery** per child and type = exponentially weighted success rate (weight 0.3 on the latest
  attempt) over pictorial-correct and abstract-correct, with an attempt count. Simple on purpose; the
  BKT model in the TUT-20 research notes is a later upgrade, not this release.
- Problems are chosen **server-side**; the client never picks a problem id. A problem done in the last
  30 days is not repeated while others exist.

## 3. Bar-model renderer (first module of the shared TUT-23 diagram engine)

What exists: `server/services/diagrams.js` (`buildDiagram`, templates incl. `bar_model`) and
`server/services/barModelSvgGenerator.js` (fraction bar), both static and server-side only. No second
engine: the new module is registered in `diagrams.js` and replaces the internals of its `bar_model`
template, same entry point and same unit tests kept green.

- New isomorphic file `public/app/shared/diagram/bar-model.js` (plain ES module, no DOM, so Node and
  the browser import the same code; `server` imports it by relative path).
- `layoutBarModel(spec) -> { width, height, bars:[{x,y,w,h,segments:[{x,w,label,value}]}], brackets }`:
  pure arithmetic; a segment width is exactly `value / maxTotal * trackWidth`. `renderSvg(layout)` turns
  the layout into SVG (escaped labels, explicit fills, `role="img"`, `aria-label`). No model-drawn SVG,
  no image generation.
- `validateModel(spec)`: every number finite and bounded, at most 4 bars and 12 segments, segment
  widths proportional to values within 0.5 percent, brackets reference existing segments.
- `compareBuilt(built, spec)`: how the child's build is judged. Both are normalised to segment
  ratios per bar; correct if each bar's ratios match the canonical ones within half a unit-step or an
  equivalent split (a 12-part bar shaded 6 equals a 2-part bar shaded 1).
- The child's builder (`public/app/singapore-maths/builder.js`) uses the same `layoutBarModel` for
  rendering, with pointer-event handles (44 px hit targets, `touch-action: none`, snap to the unit
  grid, arrow keys move a handle) and the **tap-to-split fallback** always visible (a "Split into N
  parts" stepper), so a phone never depends on precise dragging.
- Homework Help's existing bar-model diagrams get the better renderer for free; no behaviour change
  to its payload.

## 4. Content: pre-generated once, cached, almost no live AI

Pattern reused: `explain_cache` (unique key + `payload jsonb` + `prompt_version`, migration 031) and
`server/question-key.js`. The answer cache of migration 028 lives only on `round-4-exam-prep`, not on
main, so this spec does not depend on it.

**Language-neutral problem, separate text per language.** The numbers and structure are stored once;
each language adds only wording. A translation can never change a number (checked, section 10).

- `sgmath_problems`: grade, model_type, difficulty (1-3), `spec jsonb` (the bar model: bars, segments,
  values, unknown), `answer numeric`, `answer_unit`, `equation`, `chapter_tag` (nullable), `status`
  (`draft | verified | quarantined`), `prompt_version`.
- `sgmath_problem_texts`: problem_id, `language`, `question_text`, `concrete_script jsonb` (household
  version), `hint_ladder jsonb` (3 stored hints, no final answer), unique (problem_id, language).
- **Board / grade / chapter.** Grade comes from the child's `class` (students table). The registration
  form holds "Class / Grade" and "Curriculum" (no board/medium column on `students`; the KG spec's
  prerequisite is still open). Bar-model problems are skill-based, so the bank is keyed on grade x model
  type x difficulty, with board only changing contexts (names, rupee amounts, units, festivals,
  foods) through a `context_pack` of `cbse | ap_ts | general`, and `chapter_tag` used only where the
  knowledge-graph pilot data (22 records) maps a chapter. No chapter match = grade and type only. Said
  plainly: full per-board, per-chapter coverage is not in this release.
- **Pilot scope:** 21 cells x 24 problems (8 per difficulty) = 504 problems; languages English,
  Telugu, Hindi (the KG pilot languages). Indian contexts: rupees, laddus, rotis, auto fares, cricket
  runs, bus seats. Names varied; no child names stored (`{{CHILD}}` placeholder only if used).
- **Live AI: one hint, after 2 wrong tries, at most 1 per session** (section 5 gate). Everything else
  is read from the tables. The live hint gets the problem, the child's built bar and the wrong
  answers, and returns one sentence (at most 25 words) in the child's language. Checks: the reply must not
  contain the answer number; otherwise the stored hint from `hint_ladder` is shown. Model: Sonnet 5
  for Telugu/Hindi, Haiku 4.5 for English (same routing idea as notes), logged as `model.call`.

## 5. Gating and the free session

Billing in the repo is **per child** (`payments.student_id`, `tier in pro|ultrapro|max`, access derived
from captured payments, `server.js` `getPaidStatusForStudents`). Today only Pro is sold
(`PAID_PLANS`); Max is "Coming soon" (pricing spec).

| Child's tier | Singapore Maths |
|---|---|
| Max | unlimited sessions |
| Pro, UltraPro | 1 free session per child per IST week (Monday start) |
| Free | locked card with the lock and "Unlock with Pro", plus one static preview (decision 1) |

**Decision 1 (founder, 2026-10-10): no lifetime free session.** A Free-tier child sees the locked card and
one pre-cached, non-AI bar-model preview: a single fixed problem per grade band (1-2, 3-4, 5-6) shown as
a static picture (the shared renderer output, stored in `sgmath_problems` with `preview = true`), no
builder, no answer check, no model call, zero cost. The preview carries "Unlock with Pro"
(`sgmath.upgrade_clicked`, source `free_preview`). `POST /api/sgmath/session/start` for a Free child
returns 402 `locked`; the preview comes from `GET /api/sgmath/preview`, which returns only the picture
and the question text, never an answer key.

- New server helper `tierForStudent(studentId)`: the tier of the captured payment whose period covers
  now (latest wins). A new function, because `getPaidStatusForStudents` returns only active/inactive.
- The count is **server-side and atomic**: table `sgmath_sessions` with `week_start date` (IST Monday,
  computed on the server) and a partial unique index on `(student_id, week_start)` where
  `gate = 'free_weekly'`. Starting a free session is one insert; the second concurrent start fails the
  index and returns 409 `free_used` with the upsell. A free session is consumed when the **Pictorial
  step starts** (not when the page opens); an open session can be resumed for 24 h without using another.
- The client sends nothing about tier, gate or week; they are read from the session cookie, the
  payments table and the server clock.
- Upgrade click: `sgmath.upgrade_clicked`, then the existing billing flow. No change to billing code.

## 6. Parent view

A new "Singapore Maths progress" block on the three parent dashboards (per selected child), shown when
the child has at least one finished session:
- **Mastery map:** five rows (one per model type), a bar 0-100 percent with attempts count and a plain
  label (Not tried, Learning, Getting there, Strong), derived from `sgmath_attempts` at read time.
- **Weekly growth line:** one small SVG line, average mastery per week for the last 8 weeks (a week
  with no sessions is a gap, not a zero).
- Family members see it only if the visibility rules allow (new key `maths_practice`, default on;
  `VISIBILITY_FEATURES` in `server.js`).
- Read-only API `GET /api/sgmath/progress?studentId=`, family-checked like the other routes.

## 7. Tracking and /admin

- Reuse `tracking/tracking.js` and `usage_events`: `session.started` / `session.completed` with
  `feature: 'singapore_maths'` (add to `FEATURES`, so the existing engagement bars count it) plus new
  events `sgmath.concrete_done` (properties `viewer_key`, `skipped`), `sgmath.free_used`,
  `sgmath.upgrade_clicked`, `sgmath.hint_ai`. Test families are left out of every admin figure as
  elsewhere (`testFamilyIds`).
- New `GET /api/admin/singapore-maths` and a panel on `/admin/dashboard` ("Singapore Maths"): sessions
  started/completed (14 days), weekly sessions per active child, free sessions used, upgrade clicks,
  and the free-session to Max rate (children who used a free session and later got a captured Max
  payment within 30 days; shows "n/a, Max not on sale" while no Max payment exists), AI hints per session.

## 8. Schema

Next free migration: highest on main is **032**; 028 exists only on `round-4-exam-prep` (not applied),
029 is unused anywhere. Use **033_singapore_maths.sql**; renumber at merge if another branch takes it.
Key types as in the repo: `family_id bigint references family_registrations(id)`, `student_id uuid
references students(id)`.

- `sgmath_problems`, `sgmath_problem_texts` (section 4)
- `sgmath_sessions`: id uuid, family_id bigint, student_id uuid, focus_model_type, `gate text`
  (`max | free_weekly`), `week_start date`, status (`open | completed | abandoned`), `ai_hints_used
  smallint default 0`, started_at, pictorial_started_at, completed_at; partial unique index (section 5)
- `sgmath_attempts`: id, session_id, problem_id, step (`pictorial | abstract`), correct, tries,
  hint_used, built_spec jsonb, ms
- `sgmath_languages` (code, label, script, enabled; seeded en/te/hi) and `sgmath_strings` (lang, key,
  text; primary key lang+key), so a new language is rows only (decision 3). `sgmath_problems` gets
  `preview boolean default false` for the Free-tier static preview (decision 1).
- Indexes on (student_id, started_at), (session_id), problem selection (grade, model_type, difficulty,
  status). Run in the Supabase SQL editor; the app answers 503 `not_ready` with a plain message until
  the tables exist. No data deleted, no existing table changed.

## 9. Card copy (all three dashboards)

- Eyebrow "Daily practice". Title **Singapore Maths Method**. Subtitle: "Word problems seen as pictures,
  then solved. 10 minutes a day, grades 1 to 6." Button "Start session" (or the lock state in section
  5). It opens `/app/singapore-maths/`, never `openHomeworkModal()`.
- The name is descriptive ("Singapore Maths Method"), not the exact brand string "Singapore Math".
- **Languages:** the repo has no UI i18n layer; dashboard text is English and only AI content follows
  the language dropdown. Plan: a small string table `public/app/singapore-maths/strings.js` (about 30
  strings) with English, Telugu and Hindi, falling back to English; the problem texts come from
  `sgmath_problem_texts`. The Telugu and Hindi strings are for Vet to review before release. If Vet
  wants the dashboard card itself translated, that needs a site-wide i18n decision, outside this task.
- **No claim we do not track:** no "improves marks", no "proven", no percentages. Allowed: what the
  child did (sessions, minutes, mastery from our own attempts).

## 10. What can go wrong (risk -> the test that catches it)

| # | Risk | Test |
|---|---|---|
| 1 | Bar lengths not proportional to numbers | `tests/unit/bar-model.test.js`: for every model type, 200 random specs lay out with exact ratios; a spec whose widths are off by more than 0.5 percent is rejected by `validateModel`; the generation pipeline stores nothing that fails it |
| 2 | Wrong answer key in cached content | `tests/unit/sgmath-solver.test.js`: a solver recomputes the unknown from `spec` with exact rationals (reusing `server/math-engine.js`); it must equal `answer`; a deliberately wrong key fails; the question text must contain every given number and no other; a second independent check (a Haiku solve in the same batch) must agree, else `quarantined`; a re-audit script re-solves every stored row |
| 3 | Translation changes a number | the same test: digits of each Telugu/Hindi text, read with `asciiDigits`, must equal the base numbers; Telugu script ratio via `lang-check.js` |
| 4 | Card still routes to Homework Help | `tests/e2e/singapore-maths.spec.js`: on mother, father and family-member the card's click lands on `/app/singapore-maths/`, the homework modal never opens |
| 5 | More than 1 AI call per session | e2e counter: after a full session with forced wrong answers, `model.call` rows for that session are at most 1; after an all-correct session, 0; the server refuses a second hint (`ai_hints_used`) |
| 6 | Free-gate bypass | integration test: second free start in the same IST week gives 409 `free_used`; 2 parallel starts leave exactly 1 row; a forged `gate`/`tier`/`week` in the body is ignored; Monday 00:00 IST boundary with a mocked clock |
| 7 | Drag fails on a phone | e2e at 390 x 844 with touch: a drag with the touchscreen builds the model, and the same problem is solved with taps only through tap-to-split; every handle is at least 44 x 44 px |
| 8 | Live hint reveals the answer | unit test of the hint guard: a reply containing the answer number is replaced by the stored hint |
| 9 | Max is not for sale, so "unlimited" is unreachable | decision 2: traffic ships with TUT-45; e2e uses a TEST payment row for a Max child (unlimited starts, no 409); release checklist item "TUT-45 built and tested" before the traffic command |
| 14 | A Free child gets a session or an answer key from the preview | e2e: Free child start gives 402 `locked`; the preview payload has no `answer`/`spec` fields; `model.call` count stays 0 |
| 15 | A new language needs a code change | e2e + unit: dummy `zz` language rows render without edits; missing string key falls back to English |
| 10 | The parent signal is gamed (child taps "We did it") | the button sits under a parent-only line and records the signed-in `viewer_key`; TUT-20 owns the weighting; unit test that a missing viewer key is not recorded as participation |
| 11 | Content bank missing for a grade | e2e precondition fails loudly when the test child's grade has no verified problems; the page shows "Practice for this grade is being prepared", never an empty session |
| 12 | Test families pollute the admin figures | admin endpoint test with a test family's events excluded |
| 13 | A family member sees data they should not | progress API refuses a student outside the session's family (403), tested like the bonding-score route |

E2E runs twice in a row on a no-traffic preview (`E2E_REPLAY=1`); the live hint is the only model call
and is replayed.

## 11. Cost

Prices from `server/model-cost.js` (USD per million tokens): Sonnet 5 in $2 / out $10, Haiku 4.5 in $1 /
out $5. Batch API is 50 percent off; the repo does not call it yet, so a small one-off script
(`scripts/sgmath-generate.mjs`) is part of the build. ₹88 per dollar for the rupee figures.

**Per session (what a family costs us):**
- Content reads: database only, ₹0 of model cost.
- At most 1 live hint: about 600 tokens in, 120 out. Sonnet 5: $0.0024 (about ₹0.21); Haiku 4.5:
  $0.0012 (about ₹0.11). Most sessions have none. Worst case about ₹0.21, against the ₹1.5 target in the
  pricing spec.

**One-time content (504 problems x 3 languages, Batch API):**

| Step | Tokens | List price | Batch (50 percent) |
|---|---|---|---|
| English problems: 504 x (about 800 in, 400 out), Sonnet 5 | 403k in, 202k out | $0.81 + $2.02 = $2.83 | $1.41 |
| Independent solve check, Haiku 4.5: 504 x (300 in, 100 out) | 151k in, 50k out | $0.15 + $0.25 = $0.40 | $0.20 |
| Telugu + Hindi texts: 1,008 x (350 in, 220 out), Sonnet 5 | 353k in, 222k out | $0.71 + $2.22 = $2.93 | $1.47 |
| Retries and rejected items, about 30 percent | | | about $0.90 |
| **Total** | | about $8.0 | **about $4.0 (about ₹350)** |

An estimate, to be replaced by the real figure printed at the end of the generation run. More languages
cost about $0.75 each at batch price.

## Decisions (founder, 2026-10-10)

1. **Free-tier children:** locked card plus one static, pre-cached, non-AI preview with "Unlock with
   Pro". No lifetime free session. Specified in section 5.
2. **Max:** build and test the gating with a TEST payment row for a Max child, but **production traffic
   for this release ships together with TUT-45 (Max on sale).** Dependency: TUT-43 cannot take traffic
   before TUT-45 is built, tested and ready, otherwise "unlimited" is unreachable and the Max promise on
   the pricing page is empty. Order: TUT-43 and TUT-45 are built and e2e-tested separately; both go
   live in one traffic move (one revision containing both), so the build branches are merged before the
   final preview. Risk 9 above is closed by this dependency.
3. **Languages:** English, Telugu, Hindi for the pilot. **A new language must need only content rows and
   string-table entries, no code change.** The language list is therefore data: a `sgmath_languages`
   table (`code`, `label`, `script`, `enabled`) read by the API and the page; the page picks its string
   table from rows served by `GET /api/sgmath/strings?lang=` (stored as rows in
   `sgmath_strings(lang, key, text)`, seeded from `strings.js` content for en/te/hi); no `if lang ===`
   branch anywhere. New test (unit + e2e `singapore-maths.spec.js`): insert a dummy language row
   (`zz`, with its strings and one problem text), open the page with that language and check it renders
   the dummy strings and problem, with no code edit and no redeploy; the test removes the rows after.
   Missing string keys fall back to English per key, tested.
4. **Card placement:** replaced in place now. **TUT-42 item map:** the Singapore Maths card is an item
   the TUT-42 redesign must keep (card title "Singapore Maths Method", eyebrow "Daily practice", route
   `/app/singapore-maths/`, the locked state, and the per-child progress block of section 6). Recorded
   here as the map entry; add the same line to the TUT-42 item map when that document exists (no
   TUT-42 file is in the repo yet).

## Files (when built)
New: `supabase/migrations/033_singapore_maths.sql`, `public/app/shared/diagram/bar-model.js`,
`public/app/singapore-maths/{index.html,builder.js,strings.js}`, `server/routes/singapore-maths.js`,
`scripts/sgmath-generate.mjs`, `tests/unit/{bar-model,sgmath-solver}.test.js`,
`tests/e2e/singapore-maths.spec.js`. Changed: `server/services/diagrams.js`, `server.js` (route mount,
admin endpoint and panel, `VISIBILITY_FEATURES`, `tierForStudent`), `tracking/{events,tracking}.js`,
the three dashboards (card + progress block), `tests/e2e/run.js`, `docs/CHANGES-EXPLAINED.md`.
