# Changes explained

## 2026-10-05 - homework help v2: Answer Please + Explain Please (built, tested, not live)

**What changed**
- Answer Please now returns a marks-aware answer card per question (steps, final answer, a check of the numbers by code); Explain Please adds a concept explanation with a picture (code-drawn SVG now, Gemini image when the key is bound). Free families see the card, Pro (any child with an active paid_until) sees the full explanation. Pictures and explanations are cached per concept and language; pictures are served by short-lived signed URLs (`server/lib/signed-url.js`, shared; `/api/upload` untouched). "Tut-P Knowledge Graph" shows only when the answer came from the graph, never for a model answer.
- Golden set (10 cases, live, effort low): g1 345+278=623 and 600-257=343 pass; g2 Telugu 24x6=144 pass; g3 3/8+2/8=5/8 pass; g4 Hindi civics, g5 Telugu biology, g6 grammar pass; g7 physics 120 km/2 h=60 km/h and distance-vs-displacement pass; g8 Hindi 150/3=50 km/h pass; g9 Telugu 0+2x10=20 m/s pass; g10 aerobic vs anaerobic pass. 10/10, all 6 numerical cases right, so Answer stays at Sonnet 5 low; medium was not needed. Explain is Sonnet 5 low.
- 8-question Telugu photo: one call took 26 s (about 2,900 tokens, nothing cut off), too slow, so photos are split into two parallel batches of 4 and merged in order: 16-17 s locally, 19-20 s end to end on the preview (old path about 18 s; no time budget was set, so that was the yardstick). Cost about 0.045 vs 0.036 USD per photo. `ANSWER_V2_BATCH=0` turns batching off.

**What is live**
- Live now: story image library (00376-muj); nothing of this round is live. Release revision: tutp-demo-00391-yig (tag preview, 0 percent traffic, `ANSWER_V2_ENABLED=1`, no `E2E_REPLAY`, same image digest as the tested 00385-deq). Built behind `ANSWER_V2_ENABLED` (new path on) with the old `/api/homework` untouched when it is 0. Rollback: `gcloud run services update tutp-demo --region=us-central1 --update-env-vars ANSWER_V2_ENABLED=0`.
- Tests: migration 031 (explain_cache, illustrations, private bucket) applied. Full e2e suite passed twice in a row in replay on the no-traffic preview 00385-deq (all 10 specs, answer-explain 15/15, no live smoke set needed, model spend $0.0000 per spec; the first full run had a one-off 30 s page-load timeout in chips that passed on rerun). Recording the 15 answer-explain specs cost $0.1846 (26 calls). Unit 284, UI harness 30/30. The preview runs with the flag unset (specs switch v2 on by header); the revision that gets traffic has `ANSWER_V2_ENABLED=1` and no `E2E_REPLAY`.
- Upload security: signed picture URLs now come from one shared helper (`server/lib/signed-url.js`); `/api/upload` itself was not changed.

**What is next**
- Pictures use the SVG fallback until `GEMINI_IMAGE_API_KEY` is bound from secret `gemini-image-api-key` and `IMAGE_GEN_ENABLED=1` is set. "Save to notes" is device-only (this browser). Founder: phone check, traffic command.

## 2026-10-04 - story image library (built, tested, not live)

**What changed**
- Stories can now show a ready, checked science picture (library `chromosome` so far) instead of a model-drawn one. The server offers the model at most 15 matching pictures; a picture it did not offer, or one that is hidden, is dropped, so a story never gets a wrong picture. Labels are drawn by the page on numbered pins, with a legend in the story language and the English term in brackets, an "AI-made illustration" tag and an "Is this picture wrong?" button. Three different families reporting an image in 30 days hides it.
- Offline pipeline in `scripts/imglib/` (recipes for 15 concepts, glossary in en/te/hi/ta, review by Claude vision plus a Gemini second pass when a key exists, anchors checked by rendering, 3 USD cap per run, monthly audit page).
- Code-drawn pictures: Venn diagram for sets, item icons on number line / bar model / fact family, pictures for chain equations and blanks (6 x 9 = 6 x 3 x ___ is 3 groups of 18).
- Prompt: the big idea (scene 3) is explained in simple story-language words, only terms, names and numbers keep the lesson's language, no pasted textbook paragraph; the story needs a conflict and a resolution.

**What is live**
- Live now: storytelling visuals v2 (revision 00373-buy, main b7dfb60). Nothing of this round is live.
- Built and tested: revision tutp-demo-00376-muj (tag ilrel, 0 percent traffic, no E2E_REPLAY, CHIP_HASH_SALT:2), full e2e suite passed in replay on the preview (live smoke 4 calls 0.0276 USD, live library story 0.0048 USD). Goes live when the founder runs `scripts/release-il.ps1`.

**What is next**
- Founder to-do list is in the release report: Gemini key, starter set of 12 images, re-review of the chromosome with the API keys, two failed seeds, glossary review.

## 2026-10-03 - storytelling visuals v2 release

**What changed**
- Every maths story now gets a picture drawn in code (groups with item icons, number line, bar model, fact family). The picture sits under scene 3 and prints with the story.
- Numbers written in the scenes are recomputed in code and a wrong one triggers the one retry; "try together" stays a new problem.
- x, X or * between two numbers is shown as the real times sign. Fixed today: a digit next to a blank ("4 x __", "6x_") is now left alone; the earlier version changed it too. Telugu and Devanagari digits count as numbers.

**What is live**
- Live now: storytelling quality and the first times-sign fix (revision 00368-zur, main be0cc4f).
- Built and tested, not live: this release (revision 00373-buy, tag sqrel, no E2E_REPLAY; env identical to live; story spec passes in replay). It goes live when the founder runs `scripts/release-sq.ps1`.

**What is next**
- After the switch: main is fast-forwarded by the script. Non-urgent ideas are in docs/BACKLOG.md.
