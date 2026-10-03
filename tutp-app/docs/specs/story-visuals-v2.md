# Story visuals v2 (spec, awaiting founder approval)

Founder feedback: a live Class 9 Telugu maths story had no picture. Today `visual` is only `groups` and the model leaves it null for anything that is not counting or grouping (`server/prompts/homework-prompts.js` rule 2), so algebra, inverse operations and number-line lessons come back as plain text.

## Base branch (needs a decision)
Branch `story-visuals-v2` is cut from origin/main `d272143`. That does not contain `storytelling-quality` (`3c06cc8`: sonnet-5 for non-English, one-word vocabulary check, inline feedback, JSON-retry hint). It edits the same files (`story-schema.js`, `story-modal.js`, `story-modal.css`, the prompt, `story.spec.js`). Proposal: merge `storytelling-quality` into this branch first, so the new work builds on it and the final release carries both. Main is not moved by either branch until you run a traffic command.

## Design
1. `visual` becomes `{type, ...}` or null. Types, all drawn in code (no extra model call):
   - `groups` `{itemNoun, icon, total, groups[]}` as today, with item icons instead of dots.
   - `numberLine` `{from, to, marks[], jumps[{from,to,label}]}` (add, subtract, skip counting; to 20 marks).
   - `barModel` `{parts[{label,value}], total}` (part-whole, comparison, fractions of a whole).
   - `factFamily` `{a, b, total, op: "add"|"multiply"}` triangle of a, b, total plus the two inverse sentences (a+b=t, b+a=t, t-a=b, t-b=a; or the multiply/divide pair).
   Null only for non-maths lessons (science, language). Prompt rule 2 is rewritten to name the four types and when to use each; schema example gets one per type.
2. Fallback so every maths story gets a picture even if the model returns null: when `visual` is null and the equations list has a plain-arithmetic equation, the server builds `factFamily` (whole numbers, a op b = c) in code. No model call. Marked in `X-Story-Visual: model|derived|none`.
3. Item icons: the model adds `icon` (one emoji). Validation: exactly one emoji grapheme, else a curated map keyed by `itemNoun` stems (mango, laddu, banana, pencil, ball, diya, flower, apple, book, coin, mix of en/te/hi/ta names), else a neutral dot. Cap 60 items drawn; the rest is counted in the caption.
4. Scene arithmetic check (`story-schema.js`): find every `a op b = c` in scene texts (digits, × x * ÷ / + - −, Telugu/Hindi/Tamil digits normalised first), recompute with `solveArithmetic`. A mismatch is an issue and goes through the existing one-retry path (`storyHint`). A stated result that disagrees with the `equations` list is also an issue. After the retry, a salvaged story is kept as today.
5. Modal (`story-modal.js`, `story-modal.css`): one renderer per type, placed between scene 3 and the equations (already the place for groups). Printed with Save as PDF / Print (print CSS keeps the figure, no page break inside it). `aria-label` text per type; works at 360 px; no new fonts.

## Files
`server/story-schema.js`, `server/prompts/homework-prompts.js`, `server.js` (header only), `public/app/shared/story-modal.js`, `public/css/story-modal.css`, new `server/story-icons.js`, tests `tests/unit/story-visuals.test.js`, `tests/e2e/story.spec.js` (+ recordings).

## Edge cases
Old replies with `visual.type: "groups"` and no icon still render (dot fallback). Totals or numbers over the caps: drawn partly and captioned. Division with remainder, negative numbers, decimals: no factFamily (fall back to no picture, not a wrong one). Groups that do not add up are dropped as today. Telugu digits in scene text.

## Tests
Unit: each type validates and bad data is dropped; emoji check; icon map; derived factFamily; scene equation mismatch makes issues; scene vs equations list disagreement; digit normalisation.
E2E (once, no-traffic preview, record then replay): groups story renders icons (not dots); an inverse-operation story renders factFamily; a wrong in-scene equation triggers the retry (X-Story-Retry 1); print view contains the figure; 360 px no overflow; Telugu inverse-operations story screenshot saved under `tests/e2e/output/`. Fresh live recordings for the new prompt (live smoke set also runs because the prompt changes).
