# Changes explained

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

## 2026-10-05 - experiential learning v2 started, answer-explain-v2 parked

- answer-explain-v2 is parked as WIP (commit 80b6b78 on branch answer-explain-v2, pushed). It is not merged into main, not deployed, and untouched by this work.
- Left out of that commit: four log files, docs/.last-summary and a stray pasted-command file in the parent folder. The pre-commit secret scan passed, nothing was flagged.
- The experiential learning v2 job text arrived cut off after "PART 1 ... 1. KG, concept-level", so no build has started. Next step: resend the full job text.
