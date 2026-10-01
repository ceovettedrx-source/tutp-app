# Search box v2: mode chips + chip logging base (spec, approved 2026-10-01)

Founder approved this together with the base task and addendum A-G (2026-10-01). Record of what is built. Branch `search-box-v2` in its own worktree from `main` (16e92bb). Round 4 files and the uncommitted migration 028 are not touched; nothing is copied from the dirty tree. The deferred adaptive engine spec (`adaptive-chips.md`) builds on this later.

## Behavior

- Chips (config-driven, i18n keys, English source text, draft te/hi): **Answer please** (`answer`), **Explain please** (`explain`), **Notes please** (`notes`), **Exam prep** (`exam_prep`, hidden: its backend is round 4's, not on main).
- A chip only sets the mode (single select; tapping the selected chip again clears it = default). It never prefills the input and never submits by itself before a result exists. The existing submit button submits with the selected mode.
- After a result: tapping a chip re-renders the same result. `answer`/`explain` = UI-only toggle of the existing collapsed "Why?" `<details>` on every question card (the reasoning is always generated, so no call and no re-upload / re-OCR). `notes` = ONE new server call (`POST /api/homework-notes`) using the already-extracted question text. Notes are cached per language so toggling back and forth costs nothing.
- Notes selected before the first result: the normal homework call runs (it extracts the question text), then the notes call runs automatically.
- A typed or spoken instruction overrides the selected chip. The server classifies the typed text (rules only, no model call) and returns it in the `X-Chip-Intent` header; the client applies it. `exam_prep` classified while that chip is hidden is only logged, never acted on.
- Layout: existing `searchAttachChooser` unchanged (step 0) -> input box -> chip row (its own separate row, below the attach row, above the submit button; moves to the top of the result view once a result exists) -> result. Homework Help mode only (the Quiz mode of the same modal has no chips).

## Pages (found by grep of `homework-modal.js` and `searchAttachChooser`)

The chip row is added to the four pages that load `/app/shared/homework-modal.js` and carry the modal markup: `public/app/mother/index.html`, `father`, `family-member`, `child` (the child page uses the same component). Unchanged: the landing-page attach box and `/demo/` (they use `/api/homework-explain`).

## Files

New: `server/chips/chip-config.js` (chip list: id, intent, i18n key, capability flag), `server/chips/intent.js` (rules classifier en/te/hi/transliterated), `server/chips/scrub.js`, `server/chips/log.js` (family hash, band, board, insert, 30-day prune), `server/prompts/notes-prompts.js`, `public/app/shared/search-chips.js` (chip row, i18n, mode, notes view, logging calls), `supabase/migrations/030_search_chip_events.sql`, `tests/unit/chips-*.test.js`, `tests/e2e/chips.spec.js`.
Edited (minimal): `server/prompts/homework-prompts.js` (dispatcher hook: `notes` feature, nothing else), `server.js` (mount `/api/homework-notes`, `/api/chip-events`, `X-Chip-Intent` + submit log in `/api/homework`), `public/app/shared/homework-modal.js` (read the selected mode, header, hook after render), the four `index.html` pages (chip row markup + script tag), `tests/e2e/run.js` (register spec; add notes-prompts to model files), `tests/e2e/e2e-mode.js` (route regex).

## Logging (migration 030 `search_chip_events`; code tolerates its absence)

One row per event: kind (`impression` | `tap` | `submit`), chip id, classified intent, language, class band, board, date (IST), family hash (HMAC, never the raw id), scrubbed phrase <= 6 words only when intent is `other`, deleted after 30 days (opportunistic prune, at most hourly per instance, on any insert). Impressions and taps come from the browser via `POST /api/chip-events` (session required, rate limited, at most 12 events per request, chip ids whitelisted); `submit` is written by `/api/homework`. Tap-through = taps / impressions is computed later by the engine. No images, no full text, no model calls. Test families (`is_test`) are not logged. Nothing is sent to the Bonding Report.

## Review changes (founder, 2026-10-01)

Family hash key = Secret Manager env `CHIP_HASH_SALT`, no fallback (logging off without it). Notes: 20 / 10 min and 30 / day per family plus a 24 h server cache. Chip strings use the `{en, te, hi}` table pattern of `auth-messages.js` (`window.TUTP_CHIP_MESSAGES`). Preview tag `sb2`. All in `docs/search-box-decisions.md` (8, 13-15).

## Tests

Unit: classifier (en/te/hi/transliterated, priority, unknown -> other, empty -> none); scrub (names, digits, phones, emails, urls, <= 6 words); family hash (stable, not the raw id); chip config (exam_prep hidden, notes shown); notes prompt shape; chip-events validation. E2E (`chips.spec.js`, replay on preview): chips render in the four pages' modal, in the order chooser -> input -> chips -> result; select/deselect; chip never submits alone; answer/explain toggle opens/closes the Why details with no new network call; notes tap = one `/api/homework-notes` call, no `/api/homework` call; typed instruction overrides the chip; 360px layout (screenshot in `tests/e2e/output/`); axe-free basics (buttons have names, aria-pressed, 44px targets). Done = e2e suite twice in a row on the no-traffic preview.

## Cost

Chips and logging: no model calls. Notes: one haiku-4-5 call per notes tap (about $0.002), cached per language in the page.
