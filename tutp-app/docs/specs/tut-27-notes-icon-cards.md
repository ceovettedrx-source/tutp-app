# TUT-27: Notes as icon cards (fixed block types, importance levels). Replaces TUT-19 item 3.

Status: DRAFT for founder approval. No code until approved. Moved from polish1 to branch `polish2` (polish1 shipped without it, revision 00429-cik). No live spend.
Scope note: TUT-28 changes the Answer please cards (own block types); this spec changes Notes, Explain and exam prep. The two touch different files except `inventory.json` and `run.js`, so they build one after the other on polish2.
Issue: TUT-27 (reference: the Telugu "7 steps of a survey" screenshot).

## What exists today (read 2026-10-09)

- `POST /api/homework-notes` (`server/routes/chips.js`) returns structured notes version 2 (`server/notes-schema.js`: title, key_idea, method[], worked_example, key_terms[], common_mistakes[], remember, quick_check[], tell_your_child) or `{ plain: [string] }` when the model gave no usable structure. Results sit in an in-memory notes cache.
- `public/app/shared/notes-card.js` renders that as one article of sections (already 9 languages for headings, Listen, picture on top, print CSS, `data-inv` markers from TUT-19).
- Explain (`explain-panel.js`) shows layers (30 seconds / full / traps), not cards. Exam prep goes through the same chip path as Notes (`search-chips.js` calls `TutpNotesCard.render`).
- TUT-15 (textbook notes) and the teacher lesson planner do not exist yet.

## Design

1. **Block shape.** `[{ type, importance, title, body }]`, JSON only, never HTML. The renderer draws; the model never picks an icon, colour or markup.
2. **Nine fixed types** (`server/notes-blocks.js`): `key_idea`, `definition`, `steps`, `example`, `formula`, `compare`, `remember`, `common_mistake`, `exam_question`. Icon by type, Lucide (ISC), inline SVG: lightbulb, book-open, list-ordered, pencil-line, sigma, arrow-left-right, pin, triangle-alert, circle-help.
3. **Importance** `exam` / `core` / `extra`: a text badge (in the page language) + a left accent line + a different border style, never colour alone. `extra` cards are collapsed (`<details>`), open when printed. At most 30% of cards are `exam` (rounded down, but a note of 1-3 cards may have one); the code demotes the extra ones to `core` (the first ones in model order keep `exam`).
4. **Card.** Number, icon, bold one-line title (cap 70 characters), body at most two short lines (cap 140 characters; the cap counts characters, not words, because Telugu wraps long). A type label (text) sits beside the icon so meaning is never icon-only (screen readers, black-and-white print).
5. **Validation (`normalizeBlocks`).** Unknown type -> `key_idea`. Unknown/missing importance -> `core`. Text cleaned by the existing `cleanText` (tags, LaTeX markers, control characters removed). Empty title and empty body -> block dropped. At most 8 blocks. No usable block -> the note falls back to the plain path (today's behaviour).
6. **Model.** `server/prompts/notes-prompts.js` asks for `blocks` in addition to the version 2 fields (the model writes both in one reply; the fields stay the safety net). If the model returns only the old fields, or an old cached note comes back, the server **derives blocks deterministically** from them (key_idea -> `key_idea` exam/core, method -> `steps`, worked_example -> `example`, key_terms -> `definition`, common_mistakes -> `common_mistake`, remember -> `remember`, quick_check -> `exam_question`, tell_your_child dropped). So every note renders as cards whether or not the model followed the new format. `{ plain: [...] }` renders as one card (type `key_idea`, importance `core`).
7. **One renderer, many surfaces.** New `public/app/shared/notes-blocks.js` (`TutpBlocks.render(blocks, { lang })`, plus `TutpBlocks.fromExplain(view)` mapping Explain's quick/full/traps/tip to blocks). Wired now: Notes (`notes-card.js`), Explain (`explain-panel.js`), exam prep (already via the notes path). Ready for TUT-15 and the teacher planner when they exist (not wired this release; no code exists to wire).
8. **Icons.** The nine Lucide SVG files vendored in `public/vendor/lucide/` with the ISC licence text, and one generated `public/app/shared/notes-icons.js` (a map type -> inline `<svg>` string, built by `tests/e2e/fixtures`-style script `scripts/build-notes-icons.js`). No icon font, no CDN, no emoji. `aria-hidden="true"`, `stroke="currentColor"` so print B/W works.
9. **Languages.** Type labels (9) and importance badges (3) in all 9 languages in one table; Telugu/Hindi follow the existing drafts, the other languages are drafts for TUT-24. The `exam` badge in Telugu: "పరీక్షకు ముఖ్యం".
10. **Print.** B/W safe: icon strokes black, badges with a text word and a border (not a fill), cards `break-inside: avoid`, `extra` opened, no colour needed to tell the types apart (label + icon).
11. **Inventory (TUT-19 rule).** `inventory.json` gets `notes.block`, `notes.block.icon`, `notes.block.type-label`, `notes.block.badge` for Notes and the same for Explain; asserted in all 9 languages.
12. **Docs.** Summary in `docs/CHANGES-EXPLAINED.md`.

## What can go wrong (risk -> test that catches it)

| # | Risk | Test |
|---|------|------|
| 1 | The model invents a type or returns prose. | Unit: unknown type -> `key_idea`; non-array / strings / nested objects -> no blocks -> plain fallback. E2E: every rendered card has `data-type` in the nine. |
| 2 | Everything marked `exam` (badge means nothing). | Unit: 10 of 10 `exam` -> at most 3 stay; 1-3 cards -> at most 1; first in model order keep it. Golden: ratio asserted on the recorded notes and on the synthetic Telugu blocks. |
| 3 | Long Telugu bodies overflow on a 360 px phone. | Unit: title and body caps count characters (Telugu combining marks counted as typed characters, cut only at a character boundary that is not inside a conjunct: cut at a space or whole code point). E2E: 360 px screenshot, Telugu golden case: no sideways scroll, no clipped card; I look at the screenshot myself. |
| 4 | Old cached notes (plain text or version 2) break the new renderer. | Unit: `{plain}` and a version 2 object both give valid blocks. E2E: a pre-change cache row (the recorded notes, old shape) renders as cards. |
| 5 | Print shows empty icon boxes or loses meaning in black and white. | E2E with print media: every card shows an SVG with non-zero size and a type label; `extra` cards open; colours forced to black/white in the check (grayscale filter: labels and badges still readable text). |
| 6 | Wrong icon meaning (compare vs steps) in Telugu. | The icon is chosen by type in code and a text type label always sits beside it. Founder Telugu review in TUT-8 batch. |
| 7 | Meaning carried by colour or icon alone. | Test: badge and type label are text in the DOM for every card in all 9 languages (inventory). |
| 8 | Model text becomes markup (XSS). | Unit: `<script>`, `<img onerror>`, `javascript:` in title/body are stripped; renderer uses `textContent` only; SVGs come only from the bundled map, never from the reply. |
| 9 | Icon licence or CDN: a runtime fetch is blocked by the CSP or slows PageSpeed. | Test: the page makes no request outside its own origin for icons; `public/vendor/lucide/LICENSE` exists; unit checks the nine icons are in the map and each is well-formed SVG. |
| 10 | Many blocks, huge notes, tiny notes. | Unit: 30 blocks -> 8; a 1-block note renders; empty list -> plain path. |
| 11 | Arabic reads wrong (RTL), badges mirrored. | Inventory per language incl. Arabic `dir=rtl`; numbers/formula blocks stay LTR. |
| 12 | The numbering breaks when `extra` cards are collapsed. | E2E: numbers run 1..n in order, collapsed cards keep their number; print opens them. |
| 13 | Cache key / picture rules regress (TUT-19 rules). | The notes cache key does not change; the one concept picture stays on top; unit and the existing img1 notes tests must stay green. |
| 14 | The prompt change is never seen from a real model (no live spend this round). | The deterministic derivation (6) is the safety net and is what the recorded replies exercise; hand-written new-shape replies cover the parser. First real new-shape reply is seen at your phone check; I report what the model returned then. |
| 15 | Replay recordings: a changed request text misses recordings. | Recordings are keyed by the user message, which this change does not touch (only the system prompt changes), so existing recordings keep replaying. |

## Files

New: `server/notes-blocks.js`, `public/app/shared/notes-blocks.js`, `public/app/shared/notes-icons.js`, `public/vendor/lucide/*.svg` + `LICENSE`, `scripts/build-notes-icons.js`, `tests/unit/notes-blocks.test.js`, `tests/e2e/blocks.spec.js` (or cases in `inventory.spec.js`), a Telugu golden fixture of blocks.
Changed: `server/notes-schema.js` (blocks next to version 2), `server/routes/chips.js` (attach blocks, header), `server/prompts/notes-prompts.js`, `public/app/shared/notes-card.js`, `explain-panel.js`, `search-chips.js` (version check), `tests/e2e/inventory.json` + spec, `tests/e2e/run.js`, `docs/CHANGES-EXPLAINED.md`.

## Tests

Unit ($0): the table above rows 1-4, 8-10 plus the ratio and cap rules, derivation from version 2 and plain.
E2E replay ($0, twice in a row on the no-traffic preview, and twice in Cloud Build): notes on the recorded maths and science notes (cards, types, ratio), the Telugu golden at 360 px with a screenshot, print emulation, inventory in 9 languages, the legacy row.

## Decisions I need from you

1. The prompt change (6) cannot be tried on the real model without spend. I recommend shipping it, because the code falls back to deriving the same cards from the old fields. If you prefer, I leave the prompt alone this release and ship only the renderer + derivation (identical look, zero model risk), and the model change goes in the next round with one approved live run (about $0.05).
2. Explain: I map its layers to cards (30 seconds -> key idea, full explanation -> steps/example, exam traps -> common mistake, tip -> remember). Say if Explain should stay as layers.
