# img1: real Explain pictures, one language per reply, Telugu text quality

Branch `img1`, cut from main `3ecf7de` (upload security and answer v2 live on 00407-gev). Status: SPEC, waiting for founder approval. No code edited yet.

## Idea framing (competitive check)

- Photomath and Google Lens show worked steps in one chosen language and keep the page's own text as a quoted source; Byju's and Khanmigo pick one tutor language per session. None of them mixes two languages inside one answer block, which is what a parent sees today when a Telugu page is explained in English (quoted question, English commentary, Telugu answer).
- Generated concept pictures are common (Khanmigo, Gauth). The known failure is text inside the picture; our rule stays: no text in the picture, labels are an HTML overlay.
- Cost: one image about 0.04 USD, once per concept (cached across families), daily cap 50 by default.

## A. Gemini image key (no new secret)

- Bind `GEMINI_IMAGE_API_KEY` from the existing secret `gemini-api-key` (the imglib pipeline and `server/video/segments.js` already use it). `gemini-image-api-key` is never created.
- The code already reads `GEMINI_IMAGE_API_KEY` (`server/services/image-provider.js`); only the binding and `IMAGE_GEN_ENABLED=1` are missing.
- Checked read-only today: secret `gemini-api-key` exists; the service account `1096750497923-compute@developer` already holds `secretAccessor` on it, so no IAM change.
- Deploy: previews and release use `--update-secrets=GEMINI_IMAGE_API_KEY=gemini-api-key:latest` and `--update-env-vars=IMAGE_GEN_ENABLED=1` (update flags only, never `--set-*`). `deploy.sh` and `scripts/release-img1.ps1` carry them explicitly, with a pre-check that the secret exists and a post-check that the revision lists the binding (name only, no values).
- Previews run with `E2E_REPLAY=1` and `IMAGE_PROVIDER=mock`; one live check on the preview with the real key makes a single picture (about 0.04 USD) and confirms a signed URL opens. The traffic revision keeps no mock and no replay.
- Fix the stale text in `docs/CHANGES-EXPLAINED.md` line 60 and the header comment of `image-provider.js` that name `gemini-image-api-key`.

## B. One language per reply (decision needed, see end)

Today, for one photo: question text, answer blocks and idea cards stay in the page's language, commentary (`why_text`, notes, explain) is in the parent's language. Result: two languages in one card.

Rule (one function, `server/reply-language.js`, used by answer, content/idea-card, notes and explain prompts):
- reply language L = a single value per photo, chosen once and sent to every call for that photo.
- everything the model writes for the parent in that reply, the idea cards, the answers and the notes, is in L, in L's own script.
- what stays verbatim and is shown as a quote: the question text as printed, technical terms and names, numbers (digits 0-9). Those are quotes, not reply text.
- a photo in a language with no parent setting keeps L = the parent's explain-in language; mixed-language pages follow L too.
- tests: golden checks that no field outside the quote list contains a script other than L's (script ratio check by Unicode block).

## C. Telugu text quality pass

Prompt edits in `server/prompts/answer-prompts.js`, `explain-prompts.js`, `notes-prompts.js`, `notes-glossary.js` (and the idea-card block):
- write textbook Telugu a school teacher would say (spoken school register), not translation Telugu; no English-sentence word order.
- consistent term handling: the glossary term first, English term in brackets only the first time it appears.
- full sentences with a verb in every step; no half-translated phrases; numerals as digits 0-9; units as printed.
- no mixed-script words, no Hindi or Sanskrit-heavy words where the common Telugu word exists, no transliterated English when a standard Telugu school term exists (extend the glossary with the missing ones; list for your review).
- three Telugu golden cases (added to `tests/golden/cases.js`, live-recorded, then handed to you as a plain page `docs/golden-telugu-review.md` with the photo text, the reply and a checklist): (1) Class 6 science, content page with idea cards and notes (photosynthesis), (2) Class 7 maths worksheet with a numerical word problem and a fraction, (3) Class 9 social studies content page. You review them by hand; I do not mark them as correct myself, and no release happens until you say so.
- prompt files change, so the 4-test live smoke set runs, and the runner prints the model spend.

## D. Standing rule: every surface that explains a concept to a child gets an illustration

Founder rule (2026-10-07): an illustration is the default on every explaining surface; the founder never names each feature. This spec is the first list; any new explaining surface is added to it by default.

**img1 covers (6 surfaces):**
1. Explain please (`/api/explain-please`, already has `scene_prompt`; only the key and flag were missing).
2. Notes please (`/api/homework-notes`, `notes-card.js`): one picture per notes card, under the key idea.
3. Storytelling (`validateStory` in `server.js`, `story-modal.js`): one picture for the big-idea scene. Curated library images (`server/image-library.js`, approved, free) win over generated ones; the story's SVG visuals (number line, bar model, venn) stay as they are.
4. Answer cards (`answer-cards.js`): a theory question (`q_type` not numerical) gets a small illustration; a numerical question keeps its SVG diagram template and gets no generated picture.
5. Exam-prep notes: the `round-4-exam-prep` branch (exam prep, KG cache) is not in main, so it is not buildable here. img1 ships the shared service so that branch only calls it; I add the call when it merges, and list it as pending in the summary.
6. Experiential Learning lessons (`/api/el/lesson/:id`, `server/el`, `el-guided.js`): one picture for the lesson's concept; EL concept ids are the keys.

**One cached picture per concept, shared across all six** (new `server/services/concept-illustration.js` in front of the existing `illustration-service.js`, same `illustrations` table and private bucket, no migration):
- key order: curated library id if one exists (no generation) → EL concept id → the model's `concept_key` (`class-subject-concept` slug, normalised by the server) from the call the surface already makes. No extra model call per surface: the existing replies gain two fields, `concept_key` and `scene_prompt`.
- first surface to ask claims the row and generates; the others reuse it (claim-then-generate already exists). Same picture on Explain, Notes, Story, Answer card and EL for the same concept; the picture holds no text and no language, so it is shared across Telugu, Hindi and English.
- pending shows a shimmer, fallback is the SVG or no picture; no surface ever waits for a picture. Print uses the picture only when ready.
- tier: same gate as today (generated pictures are Pro only; curated library images stay for everyone). Say if you want free families to get one generated picture too.
- cost: unchanged cap of 50 new pictures per day (about 2 USD a day at most); a repeat concept costs nothing.

**Next round (not in img1):** quiz (`/api/game-sessions` questions), teacher lesson planner (`/api/teacher/create-material` worksheet, question paper, notes; `/api/question-paper-generate`).

**Explaining surfaces I found that are NOT in your list** (each with my default; tell me to move any into img1):
- Explain on photo / Check mistakes (`/api/homework-explain`, visual tutor): marks the child's own photo, already visual. Default: excluded.
- Homework Help typed or photo answer (`/api/homework`, and the public `/api/homework-demo` on `public/demo`): the plain reply before Answer cards. Default: covered through Answer cards when v2 is on; the old plain path gets nothing.
- Experiential Learning teach-back and revisits (`/api/el/teachback`, `/api/el/revisits`): they quiz and revisit the same EL concept, so they show the lesson's picture. Default: reuse, no extra work.
- EL videos and the ad-free video library (`/api/el/videos`, `/api/videos`): already moving pictures. Default: excluded.
- Knowledge-graph prev/next tiles in Explain: links, no explanation. Default: excluded.
- Lesson verifier (`lessonVerifier.js`): checks teacher MCQs, not a surface. Excluded.
- Labs page `public/labs/visual-tutor-test.html`: test page. Excluded.
- Tutor contact, billing, family, referrals, game invites: no explanation.

## Files touched

New: `docs/specs/img1.md`, `server/services/concept-illustration.js`, `public/app/shared/concept-picture.{js,css}` (one small component all six surfaces use), `server/reply-language.js`, `scripts/release-img1.ps1`, `tests/unit/reply-language.test.js`, `docs/golden-telugu-review.md`.
Edited: `server/prompts/answer-prompts.js`, `explain-prompts.js`, `notes-prompts.js`, `notes-glossary.js`, `server/routes/answer-explain.js` and the notes route (pass L), `public/app/shared/*` only where a language label is shown, `deploy.sh`, `server/services/image-provider.js` (comment), `tests/golden/cases.js`, `tests/e2e/answer-explain.spec.js` + recordings, `tests/e2e/run.js`, `docs/CHANGES-EXPLAINED.md`.
Not touched: upload/storage code, payments, login, migrations (no new table: `illustrations` and `explain_cache` from migration 031 already exist).

## Test list

- Unit: reply-language selection (all combinations of page language and parent language, mixed page), script-ratio checker, image-provider with the key bound (key present, flag on, cap, error), deploy flag check.
- Golden: existing 10 re-run replayed, plus 3 Telugu cases recorded live; script-ratio check on every field.
- E2E on a no-traffic preview, twice in a row: one photo in Telugu with parent language English, and the reverse: idea cards, answers and notes all in L; picture pending then ready (mock); fallback to SVG with no key; free family never sees the picture fields.
- Standing rule: unit tests for key order (library, EL id, model key), one generation for the same concept asked by two surfaces at once, numerical answer card gets SVG and no picture, free family payload carries no generated picture. E2E: the same concept on Explain, Notes, Story, Answer card and EL shows one picture (one `illustrations` row).
- Edited files also include `server.js` (story and notes calls, minimal), `server/routes/el.js`, `public/app/shared/{notes-card,story-modal,answer-cards,explain-panel,el-guided}.js` and the prompts that gain `concept_key` and `scene_prompt`.
- One live picture on the preview (about 0.04 USD).
- Release as in CLAUDE.md: commit with `TUTP_AGENT_COMMIT=1`, push the branch, you run the traffic command, I verify `status.traffic` and fast-forward main.

## Risks

- Changing L for existing cached explanations: `explain_cache` is keyed by concept and language, so no stale mix, only a cold cache for pairs that changed.
- Telugu quality is a judgement; the 3 cases are for your eyes, not an automatic pass.
- Server time budget (8 s) must not grow: the rule adds a sentence to the prompts, measured in the live smoke run.

## Decision needed from you

Which language is L when the page and the parent setting differ (for example an English textbook page, parent set to Telugu)?
- Option A (recommended): L = the parent's explain-in language. The parent can read all of it; the page's own sentence is quoted once. A child copying the model answer into an English exam gets the English wording from the quote and key terms in brackets.
- Option B: L = the page's language. The child can copy the answer, but a parent who is not fluent in that language cannot read it.
