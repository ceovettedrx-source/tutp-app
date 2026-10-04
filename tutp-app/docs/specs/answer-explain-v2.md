# Homework Help v2: "Answer Please" + "Explain Please" (round: answer-explain-v2)

Status: **approved 2026-10-04 with the changes in "Founder decisions" below.** Written from the founder's brief. The Notes tab is not touched.

## Founder decisions (2026-10-04, override anything below that differs)

1. Paid check: accepted (any child with an active `paid_until`).
2. Signed URLs: a shared module `server/lib/signed-url.js` (reused later by the upload-security fix). `/api/upload` is NOT changed this round.
3. Migration 031 is accepted and must not depend on 029 or 030 (self-contained, `if not exists`, safe in any order).
4. Explain = Sonnet 5 low effort. Answer = Sonnet 5 low effort; if any golden-set numerical case fails, switch Answer to medium effort and re-run; the release summary says which setting passed.
5. Entry point: Answer v2 replaces the cards behind env flag `ANSWER_V2_ENABLED`. Flag off = the old `/api/homework` path and old UI, unchanged (rollback).
6. The "Tut-P Knowledge Graph" label shows ONLY when `source="kg"`. For `source="model"` no source label is shown.
7. Latency: measure the 8-question Telugu photo case on the preview. If it goes over the time budget or truncates, split the questions into parallel batches of 4 and merge in order.

## What exists today (read 2026-10-04)

- `/api/homework` (`server.js:6339`) returns `{mode, extracted_questions[{question, answer, reasoning, photo?, box?}], concept_explanation, aditi*}`. The prompt is `homeworkHelpPrompt` in `server/prompts/homework-prompts.js`; JSON retry is `server/homework-reply.js` (`callWithJsonRetry`).
- The UI is `renderHwModalHomeworkResult` in `public/app/shared/homework-modal.js:436`: a plain card per question with a `<details>` "Why?", plus "Explain on photo" and "Check mistakes" (round B). **These stay.**
- Models: `server/models.js` (homework typed = haiku-4-5; photo calls use `POINTING_MODEL`).
- Gating today: only the free cap (5 homework lifetime, 402 `free_limit_reached`) and `paid_until`. **Per-tier gating is not built** (`docs/pricing-tiers-spec.md` is spec only). `PAID_PLANS` sells only `pro`; `payments.tier` also allows `ultrapro` and `max`.
- `usage_events` columns are `event_name`, `family_id`, `student_id`, `properties` (migration 018). The brief's "type" maps to `event_name`.
- KG: `server/services/knowledgeGraph.js` returns Misconceptions and prerequisites, but data exists only for Fractions G4-G6 and Math G5 SCF mappings. Most concepts have no KG record.
- No image-generation code, no Gemini code, no `illustrations` table. `server/services/illustration/` is the older story-picture parser (unrelated).

## Things I need you to confirm (defaults chosen, shout if wrong)

1. **"Pro and above" = any family child with an active paid period** (`paid_until` in the future, tier pro, ultrapro or max). Finer per-tier limits stay out of scope (pricing spec).
2. **Signed-URL pattern:** the brief says "same pattern as the upload-security fix", but `/api/upload` on this branch still uses `getPublicUrl` on a public bucket. I found no signed-URL helper on any local branch. I will write a small `createSignedUrl` helper (5 min expiry) for the new private bucket `illustrations`, and not touch `/api/upload`.
3. **Migration number 031.** 028 is used by round 4 (`answer_cache`, unmerged branch), 030 is on main, 029 is unused. I take 031 to be safe.
4. **Model:** Answer Please on Sonnet 5 at effort low (numerical correctness matters; haiku is the risk). Explain Please also Sonnet 5, low. Cost shown by the e2e runner; per-session cost to be reported with the release.
5. **Entry point:** Answer Please replaces the question cards in the Homework Help result (same `/api/homework` call, new response shape, versioned `schema: 2`). The old shape stays for non-question (concept) mode.

## Plan

### A. Answer Please (server-validated JSON, one retry)

- Prompt: new `server/prompts/answer-prompts.js` (the typed and photo paths share it). Per question: `q_text, q_type (short|difference|numerical|mcq|fill|diagram|long), marks, blocks[], keywords[], diagram{template,params}|null, unit_direction_note`.
- Blocks: `compare_table` (2 columns, numbered rows), `steps` (`given, find, formula[{text, why_text}], substitution[], final_answer`), `text`.
- Marks: read from the text; else default by `q_type` and board (from registration: TS, AP, CBSE). Length and format follow the board marks pattern, kept in one table `server/answer-marks.js`.
- Validator `server/answer-schema.js` (like `notes-schema.js`): types, enums, block shape, at most 8 questions, keywords must be substrings of the answer text, numerical `steps` recomputed with the existing `arith-check.js` where the arithmetic is plain. Invalid reply: retry once with a correction hint, then a graceful "try again".
- Unreadable photo: reply `{unreadable:true}`, the UI asks for a clearer photo and shows no guess. Non-academic photo: `{not_homework:true}`. Question with no numbers: `steps` is optional, `text` or `compare_table` used. Mixed-language page: each question keeps its own language (existing rule, no translation).
- UI (`public/app/shared/answer-cards.js` + `.css`, new): card per question, marks chip, keywords as highlighted chips, "why" toggle per formula, Notebook toggle (ruled-line + margin style, same CSS in print), voice (existing browser TTS pattern from `story-modal.js`), PDF/Print, CTA "Did <child> understand? Explain".
- "Coming soon: check <child>'s written answer" card: tap logs `usage_events` `answer_check_interest`. Nothing else built.

### B. Explain Please (on tap, per question, cached by `concept_key`)

- New `POST /api/homework/explain-concept` (own-student check like `/api/homework-explain`). Input: question text, `q_type`, class, board, subject, language. Output fields exactly as the brief: `concept_key, title, quick, full, traps[3], misconception{text, source: kg|model}, prev_link, next_link, parent_questions[2] + expected_answer_hint, check_question{q, options[3], correct_index, right_feedback, wrong_feedback}, illustration{scene_prompt, labels[{text, position}]}`.
- `concept_key` = lowercase slug of board-agnostic concept (`class-subject-concept`), set by the model, normalised by the server. Cache in new table `explain_cache(concept_key, language, payload, ...)` (migration 031). Cached payload is language-specific for parent commentary only; example text follows the auto-detect-and-preserve rule.
- KG: Misconception, `prev_link` and `next_link` come from the KG when a record matches (reuse `knowledgeGraph.js`), else `source:"model"` for misconception, and prev/next are omitted.
- Language: question language is preserved; the explain-in language applies to parent commentary only (existing rule).
- UI (`public/app/shared/explain-panel.js` + `.css`): hero illustration with HTML label chips, layer tabs (30 sec / full / exam traps), misconception box, prev/next tiles, dark "tonight, 2 minutes" parent card with "I asked" (logs `parent_asked`), one-question check with feedback (logs `explain_check` with `correct`), Save to notes (existing notes store), PDF.

### C. Diagram templates (server-side SVG, never model-drawn)

`server/services/diagrams/` : `vector_right_triangle` (reuse `triangleSvgGenerator.js`), `path_vs_straight`, `number_line`, `bar_model` (reuse `barModelSvgGenerator.js`), `flow_steps`. Params validated per template (numbers finite, lengths bounded, label strings escaped and length capped). Unknown template or bad params: `diagram:null`. Labels use Noto Sans for the answer's script, loading only that script's font.

### D. Image provider

- `server/services/image-provider.js`: `generate(scene_prompt) -> Buffer`. Gemini implementation reads secret `gemini-image-api-key`, env `GEMINI_IMAGE_MODEL`, flag `IMAGE_GEN_ENABLED`, env `IMAGE_GEN_DAILY_CAP`. Prompt suffix always: "no text, no letters, no numbers, no labels". Mock provider for tests (env `IMAGE_PROVIDER=mock`).
- Async: answer and explain return immediately with `illustration:{status:"pending"|"ready"|"fallback"}`. Client polls `GET /api/illustration/:concept_key` (shimmer while pending). Dedupe by `concept_key` across questions and families (unique row, claim-then-generate so concurrent calls do one generation).
- Storage: table `illustrations(concept_key unique, status, storage_path, provider, model, created_at)` and private bucket `illustrations`; the poll route returns a short-lived signed URL.
- No key, flag off, cap hit or error: status `fallback`, SVG template is used, reason logged (`usage_events` `illustration.fallback`). The answer never waits. Print uses the SVG when the image is not ready.
- The Cloud Run env and the secret binding are yours to set; the code works the moment they exist, no change needed. I do not run any `gcloud` write.

### E. Tier gating (server-side)

- Helper `server/tier-gate.js`: `isPaidFamilyChild(student_id)` from `paid_until`.
- Free payload: full Answer Please, Explain with `title`, `quick`, `concept_key` only. The fields `full, traps, parent_questions, check_question, illustration, misconception, prev/next` are **never in the response** for free, and the cache holds the full object server-side. Pro payload: everything. Free UI gets one upsell card "Pro ₹500/month".

### F. Design tokens

Brand `#005bbf`, ink `#0F1B2D`, ground `#F4F6FA`, keyword chip `#FFF1E6` / `#9A3F07`, misconception `#FFF4EC`, success `#1E7B4A`; Plus Jakarta Sans plus Noto Sans per script. Targets 44px or more, contrast 4.5:1 or more (checked for every pair in the unit test), real `<button>`s, no emoji (existing "Explain on photo" button's emoji stays, outside this work).

## Files touched

New: `docs/specs/answer-explain-v2.md`, `server/prompts/answer-prompts.js`, `server/prompts/explain-prompts.js`, `server/answer-schema.js`, `server/explain-schema.js`, `server/answer-marks.js`, `server/tier-gate.js`, `server/services/image-provider.js`, `server/services/diagrams/*`, `server/routes/answer-explain.js`, `public/app/shared/answer-cards.{js,css}`, `public/app/shared/explain-panel.{js,css}`, `supabase/migrations/031_answer_explain_v2.sql` (explain_cache, illustrations, indexes; I never run it), `tests/golden/*`, `tests/unit/*`, `tests/e2e/answer-explain.spec.js` + recordings.
Edited: `server/prompts/homework-prompts.js` (questions-mode shape), `server.js` (mount routes, `/api/homework` v2 path, minimal), `public/app/shared/homework-modal.js` (call the new renderer; Explain on photo and Check mistakes kept), `server/models.js`, `tests/e2e/run.js` (new spec), `docs/CHANGES-EXPLAINED.md`.
Not touched: Notes tab (`notes-*`), `/api/upload`, payments.

## Test list

- Unit: answer and explain schema validators (valid, each invalid kind), marks defaults by board, diagram templates (params, unknown template, escaping), tier gate payload stripping, image-provider fallbacks (no key, flag off, cap, error), contrast pairs.
- Golden set (10, record and replay, `tests/golden`): Class 3-10; maths, physics, biology, social, English grammar; Telugu, Hindi, English; TS, AP, CBSE. Checks: schema valid, numerical answers correct with units, keywords present in the answer, `scene_prompt` has no text instruction missing (suffix present, no label words), explain language equals question language.
- E2E on a no-traffic preview, run twice in a row: answer cards render; why and Notebook toggles; explain tabs; free vs pro (payload inspected, gated fields absent for free); image fallback with no key; image path with mock provider and a cache hit on the second call; print view; 8 questions in one photo (answer all, explain on tap); unreadable photo; non-academic photo; "answer_check_interest", `parent_asked`, `explain_check` events logged.
- Then the usual: commit with `TUTP_AGENT_COMMIT=1`, push, fast-forward main, summary in `docs/CHANGES-EXPLAINED.md`. You run migration 031, the phone check and the traffic command.

## Risks

- Sonnet 5 output size for 8 questions with blocks in Telugu may hit the token budget; mitigation: compact JSON, `max_tokens` raised, one-retry rule, and an e2e case with 8 questions.
- Server time budget for photo calls (about 8 s noted in CLAUDE.md) may be exceeded by the richer schema; to be measured in the first live run, and the prompt trimmed if red.
- Explain cache holds model text for all families: content is shared per concept and language, never personal.
