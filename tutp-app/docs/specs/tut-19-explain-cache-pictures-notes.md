# TUT-19: Explain shows another question's explanation; generic pictures on maths; rough notes layout (includes TUT-23, code-drawn maths diagrams)

Status: DRAFT, section "What can go wrong" first. The rest of the spec (files, design) follows once the founder has seen this.

Live 2026-10-09 (Class 3-4 maths, Explain please, 8 questions): Q2 shows Q1's "9 = 3 x 3"; Q3/Q4 share one text; Q5 and Q7 show the 6 x 9 text; Q6 shows the 25 x 0 + 75 text. Arithmetic questions get one generic picture ("rice dal oil", "packets"). Notes layout is rough.

Founder decisions (2026-10-09), part of this spec:
1. Maths pictures: up to Class 5 = one AI context picture (no countable objects or numbers in it) plus an exact code-drawn diagram. Class 6+ = code-drawn diagram only.
2. TUT-23 (code-drawn SVG maths diagrams) is in this spec.
3. Every arithmetic answer is recomputed by a math engine before display. Mismatch = no answer shown, flagged. A "checked" mark shows when verified.
4. All languages Tut-P offers, not only English/Telugu. Tests run per language.
5. Feature-inventory test: every required element per surface (Answer, Explain, Notes, Story, EL: Listen, picture, diagram, tip, print, etc.) asserted in every language before any release. A missing element blocks the release.
6. Notes layout: picture on top (concept only), then one card per question (steps, checked answer, local-language memory tip, small diagram, Listen per card). Print keeps each card on one page. 360 px single column.

## What can go wrong

Code facts behind this: `explain_cache` is read and written by (`concept_key`, `language`) in `server/routes/answer-explain.js` (about lines 146-200); the picture request uses `explain.concept_key` as its key (about line 209). The model returns a concept slug per question, so two different sums that the model calls the same concept share one row and one picture.

| # | Area | How it breaks | Test that catches it |
|---|------|---------------|----------------------|
| 1 | Explain cache key | Key is the concept only, so a second question of the same concept reads the first one's explanation. | Unit: key differs for `25 x 0 + 75` vs `31 x 0` with the same concept_key. E2E (golden): one maths photo with 8 questions, every card must contain its own numbers and none may contain another card's. |
| 2 | Explain cache key (adversarial) | Same concept, different numbers (`100 x 5 = 25 x __` vs `9 = 3 x __`); same numbers with different wording; extra spaces, case, full-width digits, `x` vs `×`, `*`. | Unit table: whitespace, case and `x`/`×`/`*` normalise to one key; changed digits, operator or blanks give a different key. |
| 3 | Over-normalising | Normalising too hard merges different questions (drops digits or the blank), so we are back to bug 1. | Unit: every pair in a list of 12 near-miss questions (swap a digit, move the blank, `+` vs `-`) has a distinct key. |
| 4 | Old rows | Existing `explain_cache` rows were written under the concept-only key and are wrong. New code must never read them. | Unit: the new key has a version prefix, so an old concept-only row is never a hit. E2E: seed an old row for the concept, ask a new question, expect a fresh answer, not the seeded one. |
| 5 | Languages (all offered) | A language shares a row with another, or the question is hashed after translation so one question has two keys, or a language is missing from the tests because the list was typed by hand. | Unit: key includes language and hashes the question as asked. The test language list is read from the app's own language list (not typed into the test), so a new language is tested automatically. E2E per language: same question in each language gives its own row in its own language (existing lang-check applies). |
| 6 | Same question twice | The key is now too specific and the same question never hits the cache, so cost rises. | E2E: ask the same question twice; second call is a cache hit and model spend is 0 (`X-Model-Usd`). Report hit rate on the 8-question photo. |
| 7 | Same photo, wording drift | The model rewrites the question text slightly on a second read, so the hash changes and the cache misses. | Hash the question text from the extracted page text, not the model's reply. Unit: key is built from the extractor's text. E2E: re-upload the same photo, expect hits. |
| 8 | Explanation matches the question | Even with a correct key, the model returns a card that does not use the question's numbers. | Existing `arith-check` plus a guard: a maths card must contain every number from its question, else it is retried once, then shown as "could not explain this one" (never someone else's text). Unit with the 8 live examples. Golden e2e as in 1. |
| 9 | Math engine: wrong answer shown | The model's answer or steps are wrong (`25 x 0 + 75` shown as 100) and we display it. | Every arithmetic answer is recomputed by the math engine before display. Unit: the 8 live questions plus 20 seeded wrong model answers; each wrong one is blocked (no answer shown, a flag row written), each right one passes. E2E: a stubbed wrong model reply never reaches the page. |
| 10 | Math engine: parser limits | The engine cannot read the question (blank in the middle `25 x __ = 100`, `÷`, fractions, brackets, units, Telugu or other-script digits, word problems) and either crashes, guesses wrong, or marks "checked" on something it did not check. | Unit table of question shapes per script: parsed ones are recomputed; unparsed ones show **no** "checked" mark (never a false one) and fall back to the card guard in 8. The "checked" mark is set only by the engine's own result, never by the model. E2E: a word problem shows the card without the mark. |
| 11 | Concurrency | Two questions in the same request write the same cache row at once (upsert race). | Unit/e2e: send 8 questions in parallel, each result keyed apart; no row is overwritten (count rows = 8). |
| 12 | Picture key | Picture is cached by concept, so all sums of one concept share one picture. | Picture key is separate from the explain key and is the concept only (a picture holds no numbers). Unit: two questions with the same concept share one picture; two concepts do not. |
| 13 | Class 5 and below: AI context picture | The AI picture shows countable objects or numbers ("5 apples" on a 3 + 2 question), which contradicts the sum; or it is generated once per question and costs 8x. | The picture prompt forbids countable objects, numbers and text. Unit: prompt for each of the 8 questions contains none of the question's digits and carries the "no countable objects, no numbers, no text" rule. One picture per notes page (concept), not per card: E2E asserts image calls = 1 for the 8-question photo. Live check: one image looked at by eye before release. |
| 14 | Class 6+: no AI picture | A Class 6+ child still gets a generated picture, or the class is unknown and we guess. | Unit: class >= 6 never calls the image provider; unknown class takes the no-picture, diagram-only path (the safe side). E2E: Class 6 maths photo makes 0 image calls and still shows the diagram. |
| 15 | Code-drawn diagram (TUT-23) | The diagram shows numbers that differ from the question (drawn from the model's text, not the engine), an unsupported shape is guessed at, or model text lands inside the SVG (script/markup injection). | The diagram is drawn only from the numbers the math engine parsed, never from model text; labels are escaped plain text. Unit: for the 8 live questions the diagram's numbers equal the question's numbers; same concept with different numbers draws different diagrams; an unsupported shape returns no diagram (never a wrong one); an SVG with a `<script>` or an `onload` in a label is escaped. E2E: diagram present and non-empty on each supported card at 360 px and desktop. |
| 16 | Pictures on non-maths | The new rule is too broad and removes pictures from science or social studies. | E2E: the existing photosynthesis/geography picture tests (img1, answer-explain) still pass unchanged. |
| 17 | Picture and model cost | Image generation is paid. Per-question keys would multiply image and model calls, and the free-limit count could change. | E2E asserts image calls: 8-question maths photo (Class 5) = 1, Class 6 = 0, science photo unchanged. Model spend printed per step; the free limit still counts per Explain please action, not per card (existing tier tests). |
| 18 | Free vs paid | A free family gets a paid-tier cached explanation or the reverse (tier is not in the key). | Existing tier gate tests; add one: free then paid ask the same question, both get a correct own-question card, and the paid-only fields stay hidden for free. |
| 19 | Data path / privacy | The question hash or text leaks across families, or a child's name reaches the cache row. | Cache rows hold only the explanation (no names). Unit: the key and payload contain no student/family field. Cross-family read is allowed only because the key is the question text alone. |
| 20 | Feature inventory | An element silently disappears or arrives in the wrong language (Listen missing in one language, tip in English inside a Telugu card, picture present but empty, print button hidden). | A checked-in inventory file lists every required element per surface (Answer, Explain, Notes, Story, EL: Listen, picture, diagram, tip, checked mark, print). E2E asserts each element is present, visible, non-empty and in the page language, for every language, on every surface. A missing element fails the run and blocks the release (the release script refuses to continue without a green inventory run). Adversarial: a newly added language or surface with no inventory entry also fails. |
| 21 | Notes layout | Redesign breaks the order, the Telugu/other-script fonts, long questions or 360 px width. | E2E at 360 px and desktop, per language: picture first (concept only), then one card per question, each with steps, checked answer, memory tip in the local language, small diagram, Listen button; no sideways scroll, nothing cut off, fonts render (existing fonts check). |
| 22 | Print | A card is split across two pages, the picture repeats, or Listen buttons print. | E2E print emulation: each card has `break-inside: avoid` and fits one page, the picture appears once, interactive buttons are hidden in print. |
| 23 | Replay recordings | A new model call or changed request text makes replay recordings miss, so the suite fails with `no_recording`. | Fixture-keyed index (this round) covers photos; any new prompt text is recorded once on the next live run. The 8-question photo is added as a fixture with its own recording. |
| 24 | Live check | Proving the fix needs a live model call. | Per-step spend printed; the live check uses the existing budget only, one run of the 8-question photo, and I stop and ask before any Anthropic spend. |

Founder answers (2026-10-09): table approved; unknown class = diagram only; the language list is read from the app code.

## Facts from the code (read 2026-10-09)

- Languages the app offers: `HOMEWORK_LANGUAGES` in `server/prompts/homework-prompts.js`: English, Hindi, Telugu, Tamil, Marathi, Spanish, French, German, Arabic (9). `server/chips/log.js` keeps its own copy of the same list; both are checked against one list in a test (row 5).
- `public/app/shared/notes-card.js` has section headings for **en, te, hi only** (te and hi are drafts). The other six languages fall back to English headings today. The feature inventory will fail on this until the six are added (see Notes layout).
- `server/arith-check.js` already solves whole-number `+ - × ÷`, brackets, `expr =`, `expr = __` and one blank. It does not handle decimals, fractions, other-script digits or words. `server/answer-schema.js` already recomputes arithmetic for Answer please.
- `server/services/diagrams.js` already draws SVG from templates (`number_line`, `bar_model`, `flow_steps`, `path_vs_straight`, `vector_right_triangle`) with escaped labels; the model supplies template + params today.
- `EXPLAIN_PROMPT_VERSION = 'explain-v2.3'`; the student's `class` comes from the students row (`loadStudentContext`, `classNumber`).
- The explain route handles one question per call; `explain_cache` is unique on (`concept_key`, `language`).

## Design

### 1. Explain cache key (rows 1-7, 11)
- New key = `q2:` + first 40 hex of SHA-256 of `normalizeQuestion(extractedQuestionText)`; language stays a separate column. The version prefix `q2:` means old concept-only rows are never read; they are left in place (no delete) and cleaned up later by the founder's call.
- `normalizeQuestion`: Unicode NFKC (full-width digits to ASCII, but not other scripts' digits to ASCII, which are mapped by the engine), lower-case, collapse whitespace, strip a leading "Q2." / "2)", map `x X * ×` to `×`, `/ ÷` to `÷`, `− – —` to `-`, all blank marks (`__ ? □ [ ] ( ) …`) to one `_`. Nothing else is touched: digits, operators and the blank's position are kept.
- The route hashes the **question text the client sends** (the extractor's text), not any model reply. The `concept_key` stays as a tag on the row and for the picture, and the signed-concept check stays.
- Write path: `insert ... on conflict do nothing` on (`q_key`, `language`), then read back, so 8 parallel questions never overwrite each other. The existing "concept-hit: keep the stored one" step is **removed**.
- Cache rows hold the explanation only; `q_key` and `language` are the only identifiers. Migration: add a nullable `q_key` column is **not** needed; the new key goes in the existing `concept_key` column with its prefix (no schema change, so no migration step for the founder).

### 2. Math engine (rows 8-10)
New `server/math-engine.js`, pure functions, no model:
- `parseQuestion(text)` -> `{ kind, numbers[], operands, blankAt, answer }` or `null`. Reuses `solveArithmetic`; adds: digits of Devanagari, Telugu, Tamil and Arabic-Indic scripts mapped to ASCII, `x` between digits, and simple decimals (up to 2 places) and simple fractions `a/b` with the same four operations. Word problems are **not** parsed in this release (null = no mark).
- `verifyCard(question, card)` -> `{ status: 'checked' | 'unchecked' | 'mismatch' }`. `checked`: the question parsed and the card's final answer (read from the card's answer field, digits normalised) equals the engine's. `unchecked`: the question did not parse (no mark, the card guard in row 8 still applies). `mismatch`: parsed but the answer differs, or the card's text contains a different result for the same sum.
- Route behaviour: `mismatch` -> retry once with a correction hint ("the answer to X is N"); still a mismatch -> no answer shown for that card ("could not check this one"), a row in `usage_events` (`explain.mismatch`, with question hash, language, no names), and the card is not cached. `checked` -> the view gets `checked: true`, which the page renders as a small "checked" mark with an accessible label in the page language. The mark can only come from this function; the model's JSON field `checked` (if any) is dropped by the schema.
- The number guard (row 8) uses the same parser: every number of the question must appear in the card text.

### 3. Pictures by class (rows 12-17)
- `pictureMode(classNumber)`: class 1-5 -> `context+diagram`; class 6 or higher or unknown -> `diagram`; non-maths subjects keep today's picture rule (unchanged, row 16).
- Context picture (class 1-5 maths only): one per notes page, keyed by **concept only** (`pic:` + concept_key). The prompt gets a fixed suffix: scene of the setting only (kitchen, market, classroom), no countable objects (no fruit, coins, sweets, tallies), no numbers, no text. `cleanScenePrompt` already drops sentences with digits or text words; a new `COUNTABLE` word list also drops them, and the unit test fails if any of the 8 live questions' digits reach the prompt.
- Diagram (all classes): drawn by `diagrams.js` from engine numbers, see 4.
- Per-card pictures are removed for maths; the old per-question `illustration` is not requested when `pictureMode` says diagram-only.

### 4. Code-drawn diagram, TUT-23 (row 15)
- `diagrams.js` gets two new templates and an engine-driven entry: `buildMathDiagram(parsed, { font })`.
  - addition/subtraction: `number_line` with jumps from the engine's operands;
  - multiplication: an array/grid of rows x columns (capped at 12 x 12, bigger shows a labelled bar model);
  - division: equal groups bar model;
  - missing-number sums: `bar_model` with the blank drawn as "?".
- All numbers come from `parseQuestion`; the model's own diagram params are ignored for maths. No parse = no diagram. Labels (units, names) are escaped plain text, cut to length, as today. Fonts: `lang-fonts.js` per script, so Telugu, Devanagari, Tamil and Arabic labels render.
- Arabic: diagram `direction` stays left-to-right for number lines (maths reads LTR); text labels carry `dir=auto`.

### 5. Notes layout (rows 21-22)
- Order per page: concept picture (class 1-5 maths, or the existing concept picture for other subjects) at the top; then one card per question: question text, steps, answer with the "checked" mark when set, memory tip in the page language, the small diagram, Listen button for that card.
- Single column, `max-width: 100%`, 360 px first; cards `break-inside: avoid; page-break-inside: avoid`; the picture prints once; Listen and other buttons get `.nd-noprint`.
- Headings table in `notes-card.js` extended from 3 to all 9 languages (ta, mr, es, fr, de, ar added; drafts for native review, marked as drafts like te/hi). Arabic page gets `dir="rtl"` for text, with maths and diagrams kept LTR.
- Listen per card uses the existing TTS path (Google TTS, TUT-7), one request per card, language of the card.

### 6. Feature inventory (row 20)
- File `tests/e2e/inventory.json` (checked in), shape:
  `{ "surfaces": { "notes": { "required": ["picture", "card", "steps", "answer", "checked", "tip", "diagram", "listen", "print-button"], "perCard": ["steps","answer","tip","diagram","listen"] }, "explain": {...}, "answer": {...}, "story": {...}, "el": {...} }, "languages": "from-code" }`.
  Each element name maps to a selector in `tests/e2e/inventory-selectors.js` (a `data-inv="notes.card.listen"` attribute on the element in the page).
- `tests/e2e/inventory.spec.js`: for every language in `HOMEWORK_LANGUAGES` x every surface x every required element: element exists, is visible, text/media non-empty, and for text elements the script matches the page language (existing `lang-check`). Failure prints surface, language, element.
- A unit test fails if a surface in the page code has no inventory entry, or a language in code has no message table (this is how a seventh language added later is caught).
- Release gate: `run.js` runs the inventory spec in replay mode as part of the full suite; the release script and my own definition of done refuse to continue on a red inventory. Recorded model replies cover the model-backed elements, so it costs $0 per run; any element that needs a new model reply is recorded once, and I stop and ask before that spend.

## Files touched

New: `server/math-engine.js`, `server/question-key.js`, `tests/e2e/inventory.json`, `tests/e2e/inventory.spec.js`, `tests/e2e/inventory-selectors.js`, `tests/e2e/fixtures/maths-8-questions.jpg` (+ its recording), tests listed below.
Changed: `server/routes/answer-explain.js` (key, write path, engine, picture mode), `server/explain-schema.js` (drop model `checked`, picture suffix, countable words), `server/services/diagrams.js` (math templates), `server/services/concept-picture.js` (concept-only key `pic:`), `server/prompts/explain-prompts.js` (version bump to `explain-v2.4`, correction hint), `public/app/shared/notes-card.js`, `explain-panel.js`, `answer-cards.js` (checked mark, per-card diagram and Listen, `data-inv` attributes, headings for 9 languages), `server/chips/log.js` (use the shared language list), `tests/e2e/run.js` (inventory in the full suite), `CLAUDE.md` (one line on the inventory gate).
No database migration. Prompt change (`server/prompts/`) triggers the live smoke set under the current rule; the founder has said to skip the Anthropic smoke set this round, so I will ask before any spend and use the single 8-question photo run only.

## Test list

Unit (all $0):
1. `question-key`: normalisation table (spaces, case, `x × *`, full-width digits, leading numbering) -> one key; 12 near-miss pairs -> distinct keys; key has `q2:` prefix; includes no student or family field; language not part of the hash.
2. `math-engine`: the 8 live questions; 20 seeded wrong answers blocked; per-script digits (Devanagari, Telugu, Tamil, Arabic-Indic); blank positions; decimals, fractions; word problem -> unchecked (no mark); mark only from the engine.
3. `math-diagram`: diagram numbers equal question numbers for the 8 questions; same concept with different numbers gives different SVG; unsupported shape -> null; `<script>`/`onload` in a label is escaped; 12 x 12 cap.
4. `picture-mode`: class 1-5 -> context+diagram; 6+, empty, "KG", "Class ten" -> diagram only; context prompt has no digit of the question and carries the no-countable/no-number/no-text rule.
5. `explain-route` (stubbed supabase and model): 8 parallel questions -> 8 rows; same question twice -> hit and $0; seeded old concept-only row not read; engine mismatch -> retry then "could not check", not cached, event written; free vs paid same question.
6. `languages`: `HOMEWORK_LANGUAGES` equals the list in `chips/log.js`; every language has a notes headings table and a font; inventory has an entry for every surface.

E2E (replay, $0 per run; run twice in a row on the no-traffic preview):
7. `answer-explain` golden: the 8-question maths photo, class 4: each card has its own numbers, a "checked" mark where the engine parsed it, no other card's numbers, 1 image call, a diagram per card.
8. Class 6 child: same photo, 0 image calls, diagrams present.
9. Re-upload the same photo: all cache hits, spend $0.
10. Per language (9): one maths question: card in that language, tip in that language, Listen present.
11. `inventory.spec.js`: every surface x language x element, as in 6 above.
12. Notes at 360 px and desktop: no sideways scroll, order picture -> cards, each card complete; print emulation: one card per page block, picture once, buttons hidden. Arabic RTL page checked too.
13. Existing suites unchanged and green: img1 (photosynthesis/geography), answer-explain tier tests, homework, story, el.

Live (the only paid step, asked first): one run of the 8-question photo, Anthropic spend estimated under $0.10; plus one image looked at by eye; Google TTS for one Telugu card Listen ($0 Anthropic).

## Risks I could not remove

- Native review: the six new notes-heading tables and the memory-tip wording in Tamil, Marathi, Spanish, French, German, Arabic are machine drafts until a speaker reads them (as te/hi are today).
- Word problems get no "checked" mark in this release; only parseable sums do. The card says nothing about this to the child.
- Old `explain_cache` rows stay in the table, unused.

No code is written until you approve.
