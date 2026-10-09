# TUT-28: Answer please (maths): raw reasoning, wrong answer, two card formats, pictures on arithmetic

Status: DRAFT for founder approval. No code until approved. Branch `polish2` (from main 813625b). Priority Urgent.
Issue: TUT-28 (found on preview 00429-cik, 2026-10-09, 8-question maths photo).

## What exists today (read 2026-10-09)

- `/api/homework` with ANSWER_V2_ENABLED runs `server/answer-run.js`. With an attachment it makes **two parallel model calls** (questions 1-4 and 5-8, `ANSWER_V2_BATCH`), merged in order. Each call is validated by `server/answer-schema.js`.
- The only maths check is `fixArithmetic()` in `answer-schema.js`: it uses the old whole-number `solveArithmetic` and overwrites **only the last number** of the model's `final_answer`. It cannot read decimals, fractions or blanks ("6 × 9 = 6 × 3 × __" gets handled only through a side path), so a wrong answer, or the model's own working text, survives. This is how raw reasoning ("so missing number is 14 ... Answer: 0") and "6 × 3 × 3" reach the card. The TUT-19 math engine (`server/math-engine.js`) is used by Explain only, not here.
- The card format (a `steps` block with Given / To find / Formula / Substitute, or a one-line `text` block) is **chosen by the model per call**. The two batches get the same rules but decide differently, so Q1-4 and Q5-8 can differ.
- Every question that is not `q_type: numerical` keeps a `scene_prompt`; the route signs a `picture` for it (`server.js` around line 6650) and the card mounts it. The model often types plain arithmetic as `short` or `fill`, so it still gets a picture, with countable objects (apples). TUT-19's picture rule (`server/picture-rule.js`) is not applied to Answer please.
- `keywords` ("Words examiners look for: 10") are the model's, filtered only to words that appear in its own answer text.
- Answer cards have **English-only labels** ("Given", "Answer:", "Words examiners look for:"); Explain has the 9-language table.

## Design

1. **Engine-built arithmetic cards.** For each question, run `parseQuestion(q_text)`. When the engine reads it (whole numbers, decimals, fractions, one blank, compound sums), the card is **built in code**, and the model's blocks for that question are discarded:
   - one `steps` block: `given: []`, `find: ''`, `formula: []`, `substitution: [the question with the answer filled in, e.g. "6 × 9 = 6 × 3 × 3"]`, `final_answer`: **the value of the blank, or the result** ("3", "0", "28.5", "3/4"), never an expression;
   - `keywords: []` for these cards (examiner words make no sense on a sum);
   - `unit_direction_note` kept only if the model gave one, else `''`;
   - `checked: true` on the question. The mark comes only from the engine, as in Explain.
   The model's text is used for questions the engine does not read (word problems, science), unchanged.
2. **One format for arithmetic, in every batch.** Because the card is built in code, batch 1 and batch 2 cannot differ for arithmetic. The renderer shows an arithmetic card as: question, the working line, "Answer: 3" with the checked mark. No Given / To find / Formula rows (those labels only appear when the block has them; the empty "Substitute" label becomes "Working" when there is no formula).
3. **Non-arithmetic cards.** The prompt (`answer-prompts.js`, new rule) says: the format is decided by `q_type` only, the same in every part of the page: a numerical question always gets a `steps` block, a short/long/fill/mcq always a `text` block. After the merge, a cheap code check counts questions whose block kind does not match their `q_type` and logs `X-Answer-Format-Mixed`. No retry (no extra spend); the check makes a regression visible.
4. **Mismatch policy.** When the model's own `final_answer` disagrees with the engine, the engine's value is shown (the parent never sees the model's wrong value) and a usage event `answer.mismatch` is logged. This differs from Explain (retry, then "could not check") on purpose: here the engine already has the exact answer, so refusing would be worse than correcting. Say if you want the Explain behaviour here instead.
5. **Raw-reasoning guard (all cards).** A block whose text contains working-out markers ("so the missing", "let me", "wait", "check:", "hmm", "= ?", repeated "Answer:") is a hard issue: the existing one retry asks the model again with the issue text. After the second failure the card for that question is the plain fallback (question + final answer only) instead of the rambling text. Engine-built cards never reach this guard.
6. **Pictures.** `pictureRule` is applied per question: no `picture` on any engine-built arithmetic card, and no per-card picture on a maths page (subject label contains "math"). Non-maths pages keep today's behaviour. Class 1-5: Answer please shows **no** AI picture of its own on an arithmetic page (the one context picture per page lives on the Explain page, TUT-19). A code-drawn diagram on Answer cards is **not** added in this round (separate decision, below).
7. **Labels in all 9 languages.** "Answer", "Working", "Checked", "Question", "Words examiners look for" move to one 9-language table shared with Explain (`explain-panel.js` MSG), so the checked mark is readable in every language. Drafts for the six languages go into TUT-24, as before.
8. **Inventory (TUT-19 rule).** `inventory.json` gets `answer.card`, `answer.card.answer`, `answer.card.checked` for arithmetic cards; asserted in all 9 languages by `inventory.spec.js`.

## What can go wrong (risk -> test that catches it)

| # | Risk | Test |
|---|------|------|
| 1 | The engine reads the question wrongly and overwrites a right answer with a wrong one (worse than today). | Unit: every question shape the engine reads (blank left/right, compound, decimals, fractions, other-script digits, "x" as multiply, "-" as minus); the existing math-engine tests stay green. A shape the engine does not read returns null and keeps the model's card. A question with several numbers/blanks it cannot be sure of is **not** engine-built. |
| 2 | The engine reads a word problem or a science line as arithmetic ("5 apples + 3"). | Unit: a word problem, a question with units, and a question with letters are `null` (not built). E2E golden includes one word problem that must keep the model's text. |
| 3 | Raw reasoning still reaches a card (non-arithmetic question). | Unit: reasoning markers in a text block, a steps block, a `final_answer` and a keyword each raise an issue; after two failures the fallback card has no reasoning text. |
| 4 | Answer shown as an expression ("6 × 3 × 3"). | Unit and golden: `final_answer` for blank questions is the blank's value only; the working line carries the filled equation. |
| 5 | Two formats in one reply. | Unit: two batches (one short style, one steps style) of arithmetic merge into identical block shapes. Golden: all 8 cards have the same block kinds and labels. |
| 6 | Non-arithmetic questions still differ between batches. | Prompt rule + `X-Answer-Format-Mixed` header test on a hand-made mixed reply. Not fixable in code without a model retry; live check below shows the real result. |
| 7 | Picture with countable objects on arithmetic. | Unit: no `picture` for engine-built cards, none on a maths page; e2e: the 8-question golden has zero `[data-inv="picture"]` in Answer cards. Existing img1 tests for theory questions stay green. |
| 8 | A card is marked "checked" that was not checked. | `checked` is set only in the engine branch; unit: a model-built card never has it; a tampered request cannot set it (the server builds the reply). |
| 9 | Keywords removed from non-arithmetic cards by mistake. | Unit: keywords only cleared on engine-built cards. Existing answer-schema tests stay green. |
| 10 | Old clients / old cached replies without `checked`. | The field is optional; the page shows the mark only when `checked === true`. E2E on a reply without it. |
| 11 | Labels untranslated or clipped (Telugu, Arabic RTL) on 360 px. | Inventory spec in 9 languages incl. Arabic `dir=rtl`; 360 px screenshot of a Telugu arithmetic card that I look at. |
| 12 | Print / PDF of the arithmetic card loses the checked mark or the answer. | E2E print-media check: the answer line and the mark are text in the DOM, not colour. |
| 13 | Listen reads the filled equation badly ("six times nine equals six times three times three"). | Unit on `spokenText`: it reads "question, answer is 3". Telugu TTS wording is one of the TUT-24 items. |
| 14 | The founder's own 8-question photo differs from my golden photo (his Q4 answers 0; my fixture's Q4 is "6 × 9 = 6 × 3 × __" = 3). | I need his photo or the 8 question texts before I call it done: the golden is built from them (see question 1). |
| 15 | Prompt change cannot be proven without the real model. | Replay recordings are keyed by the user message, not the system prompt, so they keep replaying. The code path (engine-built cards) is proven on the recorded replies at $0. The new prompt rule 3 is proven only by one approved live run (below). |
| 16 | The engine path changes the tier or the Explain flow (`concept_key`, `concept_sig`, Explain button). | The question object keeps `q_text`, `concept_key`, `concept_sig`; unit and the a15 golden (Explain from the Answer cards) stay green. |
| 17 | Cost or time grows. | No new model call anywhere. The engine is local, microseconds. `Server-Timing` unchanged. |

## Files

New: `tests/unit/answer-arithmetic.test.js`, the founder's golden photo (or its text) under `tests/e2e/fixtures/`.
Changed: `server/answer-schema.js` (engine step replaces `fixArithmetic`; reasoning guard; `checked`), `server/prompts/answer-prompts.js` (format rule, arithmetic note), `server.js` (picture rule per question; `answer.mismatch` event; format-mixed header), `server/answer-run.js` (only if the merge check lives there), `public/app/shared/answer-cards.js` (checked mark, "Working" label, 9-language labels, `data-inv`), `public/app/shared/explain-panel.js` (export the label table), `tests/e2e/inventory.json` + spec, `tests/e2e/answer-explain.spec.js` (golden), `docs/CHANGES-EXPLAINED.md`.

## Tests

Unit ($0): rows 1-5, 7-9, 13, 16.
E2E replay ($0, twice in a row on a no-traffic preview, and twice in Cloud Build): the 8-question golden (one format, no pictures, answers equal the engine's, Q-with-blank value only), a word-problem card unchanged, inventory in 9 languages, print check, 360 px Telugu screenshot, reply without `checked`.
Live ($, ask first): one run of the same 8-question photo on the real model, to see rule 3 and the batch formats. About $0.15 (two answer calls, no explain). Skippable: the code path does not depend on it.

## Decisions I need from you

1. **Your 8-question photo.** Send the photo (or the 8 question texts). My fixture is a made-up worksheet whose Q4 is not the one in the ticket, so I cannot promise "Q4 = 0" on yours without it.
2. **Mismatch policy:** show the engine's answer and log it (my recommendation), or refuse like Explain ("could not check").
3. **Diagrams on Answer cards:** leave out this round (my recommendation, smaller change), or add the code-drawn diagram from Explain to arithmetic cards.
4. **One live run** of the 8-question photo (about $0.15), after the replay passes: yes / skip.
5. **Order:** TUT-28 first as its own release (Urgent, small, no UI redesign), then TUT-27 (recommended); or both in one release.
