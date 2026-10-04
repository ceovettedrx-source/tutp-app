# Changes explained

## 2026-10-04 - android prep (built, tested, not live)

**What changed**
- The website is now installable and ready to be wrapped as an Android app: the manifest has an id and scope, and a small service worker (`/sw.js`) only shows an offline page when a page load fails. It never stores API answers, sign-in or child data.
- `/.well-known/assetlinks.json` is served (correct content type, no redirect) for the app `online.tutp.app`. It holds a zero placeholder until the Play signing fingerprint exists; `scripts/android/set-fingerprint.mjs` fills it in.
- Android project files: `android/twa-manifest.json` and `scripts/android/build.ps1` (for Vet; checks tools, creates the upload keystore outside the repo, asks for passwords itself, builds the `.aab`).
- Three DRAFT pages, marked for legal review and hidden from search engines: `/privacy/`, `/terms/`, `/delete-account/`. They follow what the code really does (`docs/play-store/code-audit.md`); the DPDP consent wording is a marked placeholder.
- `docs/play-store/`: listing text in English, Telugu and Hindi, Data safety answers, content rating answers, target-audience recommendation, screenshot list, feature graphic spec.
- No change to any existing feature or model prompt.

**What is live**
- Live now: story image library (revision 00376-muj). Nothing of this round is live.
- Built and tested: revision tutp-demo-00381-hit (tag anrel, 0 percent traffic, no E2E_REPLAY, CHIP_HASH_SALT:2). The full e2e suite passed twice in a row on the preview 00380-ban (same image); 22 new unit tests and 10 new e2e checks pass. Lighthouse 11.7.1 PWA category 100 on the preview (newer Lighthouse versions dropped that category: performance 79, accessibility 96, best practices 100, SEO 100 on the home page). Goes live when the founder runs `scripts/release-an.ps1`.

**What is next**
- The founder list is in the release report: Play account, fingerprint, package id decision, Play Billing decision, legal review, native-speaker review of the Telugu and Hindi text, screenshots.
- Found while auditing and not fixed: `/api/upload` has no sign-in check and writes to a public bucket; no in-app delete-account path. Both are in docs/BACKLOG.md.

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
