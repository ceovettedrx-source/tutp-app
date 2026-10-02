# Notes design v2: structured "Notes please" output (spec, approved 2026-10-01)

Founder approved this message as the spec. Branch `notes-design-v2` in `C:\Users\user\wt-notes-design`, stacked on `search-box-v2` (not on main yet). Round 4 files, Bonding Report logic, release-sb2.ps1 and every existing tag are untouched; the preview is a no-traffic revision with the new tag `nd1`.

## Problem

The notes are 4-7 same-level paragraphs in a beige box titled "Math · Notes please" (the chip label, not the topic). The cause is our own format (plain paragraphs rendered as they come), not the model.

## Decision

The model returns structured JSON; our UI renders a designed component. The model is never asked for HTML and no model text goes into `innerHTML` (createElement / textContent only).

Schema (short strings, in the existing output-language rule; an empty field is omitted, never padded):
`{ title, key_idea, method[2-5], worked_example{problem, steps[], answer}, key_terms[{term, meaning}] (0-4), common_mistakes[1-3], remember, quick_check[{q, a}] (2), tell_your_child }`.
Rules: only numbers and facts from the homework text; no invented curriculum or board claims; no LaTeX; about 250 words; haiku-4-5, the 24 h cache and the caps (20 / 10 min, 30 / day per family) stay.

## Files

- `server/prompts/notes-prompts.js` (prompt rewrite; same two exports)
- `server/notes-schema.js` (new, pure): `normalizeNotes(obj)` validate + clamp + strip tags/LaTeX; `plainNotes(obj)` for the fallback
- `server/routes/chips.js` (`parseNotes` uses the schema; plain fallback and a log line)
- `public/app/shared/notes-card.js` (new, reusable: `TutpNotesCard.render(data, {lang})`, own `{en,te,hi}` heading table, own injected CSS incl. `@media print`)
- `public/app/shared/search-chips.js` (shows the card; keeps the current plain renderer as the fallback; adds `no-print` to the chip row; opens quick-check answers for printing)
- the four `index.html` pages (one script tag each)
- tests: `tests/unit/notes-schema.test.js`, `tests/e2e/chips.spec.js` (notes cases), `tests/e2e/run.js` (nothing new: `notes-prompts.js` already counts as a model file)

## Rendering

Topic title; key idea in a highlighter band; numbered method; worked-example card (problem, steps, answer chip); key-term rows; caution-styled common mistakes; accent "remember" box; quick check with answers behind `<details>`; "say it to your child" speech bubble. Warm paper palette from the existing tokens (secondary amber, primary blue, tertiary green, error container). Material Symbols icons already loaded by the pages. Headings from a `{en, te, hi}` table with English fallback (decision 2). Telugu/Devanagari: `lang` attribute on the card, line-height 1.7, long words wrap, no horizontal scroll at 360 px. Print: single column, white, no buttons, quick-check answers shown. Invalid or missing JSON: the current plain rendering, and a server log line.

## Cost

Measured per notes call before (record mode, $0.00118-$0.00287 on the old prompt) and after. If after is more than 2x, trim fields.

## Tests

Unit: valid, missing fields (omitted, not padded), clamping, tag/LaTeX stripping, quick_check capped at 2, invalid JSON falls back to plain, nothing usable gives null. E2E: structure present, quick-check toggle, print view, 360 px en/te/hi (screenshots), cached repeat makes no call. E2E twice in a row on `nd1`.
