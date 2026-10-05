# Changes explained

## 2026-10-05 - homework help v2: Answer Please + Explain Please (built, tested, not live)

**What changed**
- Answer Please now returns a marks-aware answer card per question (steps, final answer, a check of the numbers by code); Explain Please adds a concept explanation with a picture (code-drawn SVG now, Gemini image when the key is bound). Free families see the card, Pro (any child with an active paid_until) sees the full explanation. Pictures and explanations are cached per concept and language; pictures are served by short-lived signed URLs (`server/lib/signed-url.js`, shared; `/api/upload` untouched). "Tut-P Knowledge Graph" shows only when the answer came from the graph, never for a model answer.
- Golden set (10 cases, live, effort low): g1 345+278=623 and 600-257=343 pass; g2 Telugu 24x6=144 pass; g3 3/8+2/8=5/8 pass; g4 Hindi civics, g5 Telugu biology, g6 grammar pass; g7 physics 120 km/2 h=60 km/h and distance-vs-displacement pass; g8 Hindi 150/3=50 km/h pass; g9 Telugu 0+2x10=20 m/s pass; g10 aerobic vs anaerobic pass. 10/10, all 6 numerical cases right, so Answer stays at Sonnet 5 low; medium was not needed. Explain is Sonnet 5 low.
- 8-question Telugu photo: one call took 26 s (about 2,900 tokens, nothing cut off), too slow, so photos are split into two parallel batches of 4 and merged in order: 16-17 s locally, 19-20 s end to end on the preview (old path about 18 s; no time budget was set, so that was the yardstick). Cost about 0.045 vs 0.036 USD per photo. `ANSWER_V2_BATCH=0` turns batching off.

**What is live**
- Live now: experiential learning v2 (00393-huf, commit c3d9863); nothing of this round is live. Earlier note that live was 00376-muj was wrong, and the first release revision 00391-yig was built before experiential learning was on main, so it must not get traffic. Main (51706e0) is now merged into this branch (16ccee6): conflicts in server.js, knowledgeGraph.js, e2e-mode.js and run.js were resolved keeping both features, and the recordings and LAST_LIVE took main's version.
- Release revision: tutp-demo-00398-vim (tag aev2, 0 percent traffic, label git-sha=16ccee6, `ANSWER_V2_ENABLED=1`, no `E2E_REPLAY`, no YOUTUBE_API_KEY like live; every other env var, secret and the service account equal to live 00393-huf). Same image digest as the tested 00397-ver. The live commit c3d9863 is an ancestor of 16ccee6. Built behind `ANSWER_V2_ENABLED` (new path on) with the old `/api/homework` untouched when it is 0. Rollback: `gcloud run services update tutp-demo --region=us-central1 --update-env-vars ANSWER_V2_ENABLED=0`.
- Tests: migration 031 (explain_cache, illustrations, private bucket) applied. After the merge: full e2e suite, all 11 specs including el, passed twice in a row (runs 3 and 4) in replay on the no-traffic preview 00397-ver (tag aev2); run 1 also passed and run 2 died on a Playwright "guid not bound" crash after login checks a-f passed (not an app failure, not counted). Model spend: $0.0000 per spec in replay; the 4-test live smoke set ran once in run 1 (models.js changed vs LAST_LIVE) for $0.0265. Recording the 15 answer-explain specs earlier cost $0.1846 (26 calls). Unit 305/305 (the el test "a lesson file that fails the gate loses its experiment at load" fails in a checkout path with a space, because it uses an undecoded URL pathname; it passes in a path without spaces). The preview runs with the flag unset (specs switch v2 on by header); the revision that gets traffic has `ANSWER_V2_ENABLED=1` and no `E2E_REPLAY`.
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

## 2026-10-05 - experiential learning v2 started, answer-explain-v2 parked

- answer-explain-v2 is parked as WIP (commit 80b6b78 on branch answer-explain-v2, pushed). It is not merged into main, not deployed, and untouched by this work.
- Left out of that commit: four log files, docs/.last-summary and a stray pasted-command file in the parent folder. The pre-commit secret scan passed, nothing was flagged.

## 2026-10-05 - experiential learning v2 (Guided Discovery + shared video service)

**What changed**
- Parents can pick one of 12 Science lessons (Class 6-10) in the Experiential Learning window, or type a topic that matches one: the child guesses first (the guess locks), does a kitchen experiment or plays a PhET simulation, says what they noticed, gets up to 3 hints, learns the science word, watches videos and explains it back. One follow-up question comes from the cheapest model (max 300 tokens). Revisit questions show on the parent dashboard on day 3, 10 and 30. Any other topic or photo runs the old notes flow, unchanged.
- One shared video service (2 in the user's language, 2 English, 1 best in the world; key-part segments from description chapters or Gemini; Key part / Watch full video; nocookie embeds, no autoplay, YouTube title link; tutp_hosted sorts before youtube).

**Video root cause (recorded before the fix)**
- "Video matching for this lesson isn't available yet" was a hardcoded `<p>` in `public/app/{mother,father,family-member,child}/index.html` (the results block of `#experientialModalResults`, lines about 590 / 724 / 738). No video search existed anywhere in the code; it was not an empty list, a swallowed key or a wrong query. It is replaced by `#experientialModalVideos`, filled by the service; an empty list shows nothing.

**What is live**
- Nothing is live yet. The release candidate is revision `tutp-demo-00393-huf` (tag `elrel`, https://elrel---tutp-demo-vs4743puka-uc.a.run.app), the image that passed e2e twice on the preview `elprev` (00390-zug). It has no E2E_REPLAY and an env identical to the live revision (checked by hash of names and secret references; values never read). Production is still 100% on `tutp-demo-00376-muj`.
- Why: auto mode refused `gcloud run services update-traffic` (as CLAUDE.md says it does). Nothing else was tried. main is NOT fast-forwarded; the branch is `experiential-learning-v2` at 1e5c6a1, pushed.
- Founder: run `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-el-v2\tutp-app\scripts\release-el.ps1"` (checks, YES prompt, auto-rollback, fast-forwards main). Then tell Claude Code to verify `status.traffic`.

**Tests**
- Unit: 243 of 243 pass. E2E (`tests/e2e/el.spec.js`, e0-e16) passed in record mode, then the full suite passed twice in a row on the preview (run 1 with the live smoke set, $0.027; run 2 replay only, $0). The el spec itself spent $0.0004 recording; one-time lesson generation about $0.21 (23 calls plus one earlier magnets test, sonnet-5).
- Not tested: real YouTube. The project has no YouTube key, so video tests run on hand-written fixtures (`tests/e2e/recordings/yt-fixture.json`, test families only). The Gemini segment path is covered by unit tests with a stubbed API; no Gemini call was made against a real video.

**Founder to-dos**
1. YouTube: enable `youtube.googleapis.com`, create a key limited to the YouTube Data API, store it as secret `youtube-api-key`, attach with `gcloud run services update tutp-demo --region=us-central1 --update-secrets=YOUTUBE_API_KEY=youtube-api-key:latest`. Until then, the video section is hidden everywhere and the log says `video.no_key`. I did not create a credential or enable an API tonight (outside the overnight guardrails).
2. Gemini segments need the Cloud Run service account to read secret `gemini-api-key` (it is not granted today; the code then quietly skips Gemini).
3. Telangana SCERT chapters: scert.telangana.gov.in was unreachable (connection and certificate errors), so all 12 Telangana mappings are placeholders with no chapter. Fill from the official textbook list.
4. Review the 12 lessons' wording once; the "steel spoon" in the magnets lesson depends on the spoon (many stainless spoons are not magnetic).

**Placeholder mappings**: all 12 Telangana (above). NCERT mappings are sourced: chapter number and title read from the official ncert.nic.in contents pages, topic found inside the chapter PDF (Class 6 Ch 4 and 9; Class 7 Ch 2, 3, 7, 11; Class 8 Ch 5 (friction, floating) and 6; Class 9 Ch 6 and 10; Class 10 Ch 9). NCF competency codes are null, not guessed. Misconceptions are marked placeholder (no citation attached).
**Excluded concepts**: none (12 of 12 served; target was 10).
**Safety-gate drops** (docs/specs/el-v2-safety-report.md): home experiments dropped for force-pressure (sharp pencil point), friction (the word "sharp" in a safety sentence, a deliberate false positive) and density-floating (a fact error: a potato sinks); those three are sim-only. Circuit has no home experiment (batteries are not on the whitelist) and is sim-only. 8 experiments passed.
**Guardrails kept**: no migration, no schema change, no data deleted, no secret touched or printed, no force-push, no change to auth, payments or Razorpay code (the free-limit check is only called). One note: the free limit counts a guided lesson once, when the teach-back is done.
**Other facts**: no CSP exists in the app, so no frame-src change was needed. All 9 PhET html5 URLs return 200. Specs: docs/specs/experiential-learning-v2.md, docs/specs/ad-free-video-library.md (spec only).

**Where I stopped / next**
- Stopped at the traffic move (blocked). Next: founder runs release-el.ps1; Claude verifies and checks main = branch tip.
- Part 3 (phone-sensor experiments) is NOT started: it starts only after Parts 1 and 2 are live.
