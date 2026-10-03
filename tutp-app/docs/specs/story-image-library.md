# Story image library (round "story-image-library"; design pre-approved by the founder, built without a wait)

Goal: every story gets a correct, good-looking picture at about zero running cost, with no per-image human approval. Pictures are made once, offline, checked by two models, stored, and then only looked up at run time. Labels are drawn by code on top of a label-free image, so a Telugu, Hindi or Tamil legend never needs a new picture.

## Research (10 lines; web search was thin, so only the first line is sourced)
1. Khan Academy (Khanmigo) now generates interactive diagrams for math and science and reacts to what the student does; it treats a diagram as a tool inside a conversation, not a fixed asset (Khan Academy blog, Google.org partnership post).
2. Reviews of AI science diagrams repeat one warning: labels, arrows, proportions and sequence are the usual errors, so a draft is never final. This is why labels are code-drawn and every image passes a checklist review.
3. BYJU'S, Toppr and OpenStax: the search returned nothing specific about them, so what follows is from general knowledge, not a checked source.
4. OpenStax science books use one consistent flat house style, numbered or lettered call-outs with a legend, and a caption that names the idea; the picture carries no text of its own.
5. BYJU'S and Toppr lean on short animated and 3D clips plus labelled stills; labels are in English with the regional-language term beside them in many Indian-language editions.
6. Common thread: one visual language across a whole course, labels as a separate layer, a caption. We copy all three: one style recipe, code-drawn pins and legend, an alt text.
7. Risk seen elsewhere: a plausible but wrong picture is worse than none. Rule here: no candidate fits means no picture, and a library id the server did not offer is dropped.
8. Cost: image generation is a one-off cost per concept (about 0.04 USD per image), review calls are cents; run-time cost is zero (a static file).
9. Indian-language labels: terms need a teacher review once; the glossary is one file, so a correction fixes every picture.
10. Trust: the "AI-made illustration" tag and a one-tap "Is this picture wrong?" button; three different families reporting hides the image automatically.

## A. Library (offline, `scripts/imglib/`)
- `library/manifest.json`: per image `id`, `aliases {en,te,hi,ta}`, `subject`, `classMin/classMax`, `description`, `alt`, `file`, `anchors [{key,x,y}]` (x, y from 0 to 1), `provenance {source: ai-generated|licensed, model, prompt, date, license}`, `review {...}`, `status approved|hidden`.
- `library/glossary.json`: label key to names in en, te, hi, ta; a missing language falls back to English.
- `library/style.json` (shared style rules: flat vector, white background, blue/teal palette plus one orange accent, no text, no gradients) and `library/recipes/<id>.json` (prompt, label keys, checklist). Recipes exist for the 3 seeds and the 12 starter concepts.
- `pipeline.mjs`: `import <folder>` (inbox mode: PNGs named `<id>.png`), `generate` (Gemini image API when the secret `gemini-api-key` exists), `regen <id>`, `review <id>`. Generate, review, refine (at most 3 rounds), store. Review is Claude vision against the checklist (structure, no text, palette, identical repeated elements) plus a second independent Gemini pass when a key exists; approved only when both pass. Hard cap 3 USD per run, cost per image logged to `library/cost-log.jsonl`. Secrets are never printed; a missing Gemini key prints the one command to store it.
- Anchors: Claude proposes (x, y) per label key, the script renders the pins on the image and Claude checks the render, one correction round; an image with unverified anchors is not approved.
- Stored form: the original PNG in `library/originals/` (kept out of the Cloud Run image by `.dockerignore`) and a 900 px wide WebP in `public/imglib/` that the page loads.
- `audit-sample.mjs` writes `docs/image-audit.html` with 20 random approved images (monthly glance, no per-image approval).
- `hide-reported.mjs` lists images with 3 or more reporting families in 30 days and regenerates them through the pipeline.

## B. App
1. `server/image-library.js`: loads the manifest, `candidatesFor({text, classNum, limit 15})` (aliases in any language matched against the lesson text; class range must fit; with no typed text, the class-fitting images). The prompt gets only `id: description` lines. `validateStory(raw, ctx)` accepts `visual {type:"library", id}` only when the id is one of the offered candidates, approved and not hidden; otherwise the picture is dropped (never a wrong one). The server adds `src`, `alt`, and `labels [{n, x, y, term, source}]` in the story language (term in the story language, English source term in brackets, English alone when no translation).
2. `story-modal.js/css`: image with numbered pins, legend, alt text, "AI-made illustration" tag, "Is this picture wrong?" button; pins and legend print, the button does not. 360 px: image scales, legend is a single column.
3. Reports: `POST /api/story-image/report {studentId, imageId}` logs a `image.reported` row in `usage_events` (no migration). When 3 or more distinct families reported one image in 30 days it is hidden (lookup cached 5 minutes, refreshed after a report). A script regenerates it.

## C. Visuals v3 (code only)
- `venn` visual: `{left {label, items}, right {label, items}, both [items]}`, validated (no element in two regions, at most 24 elements, at least half of them named in the story), drawn as two circles with the intersection highlighted, elements as icons (item map) or small text chips.
- `icon`/`itemNoun` accepted on `numberLine`, `barModel`, `factFamily` (hopper icon on the number line, icons in the bar segments, icon inside the triangle circles).
- Pictures for chain equations and blanks: `2 + 3 + 4 = 9` gives a bar model; `2 × 3 × 4 = 24` gives groups; `4 × ___ = 24` gives a fact family; `6 × 9 = 6 × 3 × ___` is solved (blank 3) and drawn as groups (3 groups of 18). Only whole numbers, exact results; anything else gives no picture.

## D. Prompt
Scene 3 ("the big idea") is explained in simple ${lang}; only technical terms, names and numbers stay in the lesson's language; never a pasted textbook paragraph. The story has a conflict (problem scene) and a resolution (wrap-up). The prompt change makes the e2e runner do its live smoke set.

## E. Release
Unit tests, e2e on a no-traffic preview (replay, plus the live smoke set), final image without `E2E_REPLAY` with `CHIP_HASH_SALT:2`, tag `ilrel`, 0 percent traffic. `scripts/release-il.ps1` modelled on `release-sq.ps1`; its git step uses `$LASTEXITCODE` and `git rev-parse`, and git stderr is never treated as an error under Windows PowerShell 5.1. Not run here; traffic and main are not moved.

## Files
New: `server/image-library.js`, `scripts/imglib/*`, `public/imglib/*`, `scripts/release-il.ps1`, unit tests. Edited: `server/story-schema.js`, `server/prompts/homework-prompts.js`, `server.js` (candidates, ctx, report route), `tracking/*`, `public/app/shared/story-modal.js`, `public/css/story-modal.css`, `.dockerignore`, e2e story spec and recordings, docs.

## Edge cases
No candidates: no picture. Photo-only lesson (no typed text): class-fitting images are offered, the model must still judge the fit. Library id from the model that is not offered, hidden, or unknown: dropped. Language with no glossary entry: English. Glossary key missing: the pin is left out. Images with no approved status are never served by lookup. Gemini key missing: inbox mode only.

## Tests
Unit: manifest/candidate lookup, hiding rule (3 families, 30 days), library visual validation, glossary fallback, venn validation, icons on the three types, chain/blank pictures, pipeline helpers (spend cap, review verdict combination). E2E: a library story renders image, pins, legend, tag and report button (replay), the report posts, the old types still render, 360 px no overflow.
