# TUT-19: Explain shows another question's explanation; generic pictures on maths; rough notes layout

Status: DRAFT, section "What can go wrong" first. The rest of the spec (files, design) follows once the founder has seen this.

Live 2026-10-09 (Class 3-4 maths, Explain please, 8 questions): Q2 shows Q1's "9 = 3 x 3"; Q3/Q4 share one text; Q5 and Q7 show the 6 x 9 text; Q6 shows the 25 x 0 + 75 text. Arithmetic questions get one generic picture ("rice dal oil", "packets"). Notes layout is rough.

## What can go wrong

Code facts behind this: `explain_cache` is read and written by (`concept_key`, `language`) in `server/routes/answer-explain.js` (about lines 146-200); the picture request uses `explain.concept_key` as its key (about line 209). The model returns a concept slug per question, so two different sums that the model calls the same concept share one row and one picture.

| # | Area | How it breaks | Test that catches it |
|---|------|---------------|----------------------|
| 1 | Explain cache key | Key is the concept only, so a second question of the same concept reads the first one's explanation. | Unit: key differs for `25 x 0 + 75` vs `31 x 0` with the same concept_key. E2E (golden): one maths photo with 8 questions, every card must contain its own numbers and none may contain another card's. |
| 2 | Explain cache key (adversarial) | Same concept, different numbers (`100 x 5 = 25 x __` vs `9 = 3 x __`); same numbers with different wording; extra spaces, case, full-width digits, `x` vs `×`, `*`. | Unit table: whitespace, case and `x`/`×`/`*` normalise to one key; changed digits, operator or blanks give a different key. |
| 3 | Over-normalising | Normalising too hard merges different questions (drops digits or the blank), so we are back to bug 1. | Unit: every pair in a list of 12 near-miss questions (swap a digit, move the blank, `+` vs `-`) has a distinct key. |
| 4 | Old rows | Existing `explain_cache` rows were written under the concept-only key and are wrong. New code must never read them. | Unit: the new key has a version prefix, so an old concept-only row is never a hit. E2E: seed an old row for the concept, ask a new question, expect a fresh answer, not the seeded one. |
| 5 | Language | Telugu and English share a row, or the question text is hashed after translation so one question has two keys. | Unit: key includes language and hashes the question as asked. E2E: same question in English then Telugu gives two rows, each in its own language (existing lang-check still applies). |
| 6 | Same question twice | The key is now too specific and the same question never hits the cache, so cost rises. | E2E: ask the same question twice; second call is a cache hit and model spend is 0 (`X-Model-Usd`). Report hit rate on the 8-question photo. |
| 7 | Same photo, wording drift | The model rewrites the question text slightly on a second read, so the hash changes and the cache misses. | Hash the question text from the extracted page text, not the model's reply. Unit: key is built from the extractor's text. E2E: re-upload the same photo, expect hits. |
| 8 | Explanation matches the question | Even with a correct key, the model returns a card that does not use the question's numbers. | Existing `arith-check` plus a new guard: a maths card must contain every number from its question, else it is retried once, then shown as "could not explain this one" (never someone else's text). Unit with the 8 live examples. Golden e2e as in 1. |
| 9 | Concurrency | Two questions in the same request write the same cache row at once (upsert race). | Unit/e2e: send 8 questions in parallel, each result keyed apart; no row is overwritten (count rows = 8). |
| 10 | Picture key | Picture is cached by concept, so all sums of one concept share one picture, with labels that mean nothing. | Picture key is separate from the explain key. Unit: arithmetic/numerical questions never request a picture. |
| 11 | Pictures on maths | Generated picture on an arithmetic question ("rice dal oil" labels). | Rule: numerical or arithmetic question gets no generated picture (a plain number-line/array SVG or none). Unit: classifier on the 8 live questions returns "no picture". E2E: the 8-question photo makes 0 image-generation calls (spend $0 on images). |
| 12 | Picture on non-maths | The new rule is too broad and removes pictures from science or social studies. | E2E: the existing photosynthesis/geography picture tests (img1, answer-explain) still pass unchanged. |
| 13 | Picture cost | Image generation is paid. A fix that keys pictures by question would multiply image calls. | Pictures stay keyed by concept for non-maths only; E2E asserts the image-call count for the 8-question photo (0) and for a science photo (unchanged). |
| 14 | Model cost | Per-question keys raise model calls and the free-tier limit counts wrongly. | Report model spend per step; the free limit still counts per Explain please action, not per card (existing tier tests). |
| 15 | Free vs paid | A free family gets a paid-tier cached explanation or the reverse (tier is not in the key). | Existing tier gate tests; add one: free then paid ask for the same question, both get a correct, own-question card, and the paid-only fields stay hidden for free. |
| 16 | Data path / privacy | The question hash or text leaks across families, or a child's name reaches the cache row. | Cache rows hold only the explanation (no names). Unit: the key and payload contain no student/family field. Cross-family read is allowed only because the key is the question text alone. |
| 17 | Notes layout | Redesign breaks printing, Telugu fonts, long questions or 360 px width. | E2E at 360 px and desktop: no sideways scroll, nothing cut off, Telugu renders (existing fonts check), print stylesheet keeps one question per block. |
| 18 | Replay recordings | A new model call or changed request text makes replay recordings miss, so the suite fails with `no_recording`. | Fixture-keyed index (this round) covers photos; any new prompt text is recorded once on the next live run. The 8-question photo is added as a fixture with its own recording. |
| 19 | Live check | Proving the fix needs a live model call. | Per-step spend printed; the live check uses the existing budget only, one run of the 8-question photo, and I stop and ask before any Anthropic spend. |

## Still to write (after you have seen the section above)

Files touched, the key design (version prefix + hash of the exact question text + language), the picture rule, notes layout design, and the full test list. No code is written until you approve.
