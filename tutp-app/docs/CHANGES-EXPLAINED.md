# Changes explained

## 2026-10-10 - TUT-43 Singapore Maths Method (spec only, no code)

**What was wrong**
- The dashboard card "10-minute Math Session" opens the Homework Help modal (`openHomeworkModal()` in the mother, father and family-member dashboards). Two entries, one product.

**What the spec proposes** (`docs/specs/TUT-43-singapore-maths.md`, awaiting approval)
- The card becomes "Singapore Maths Method": a daily 10-minute word-problem session in three steps. Concrete (parent and child with household items, parent taps "We did it", logged as a participation signal for TUT-20), Pictorial (the child builds the bar model by dragging or tapping), Abstract (equation and answer).
- Five model types (part-whole, comparison, before/after, fractions, ratio) for grades 1 to 6, a short diagnostic first, then the weakest type.
- The bar-model drawing is code, not AI, and is the first module of the shared diagram engine (`diagrams.js`); the old bar-model generator is not duplicated.
- Questions are written once (504 problems in English, Telugu, Hindi) and stored; the only live AI is one hint after two wrong tries, at most one per session. A code solver checks every answer key and every translated number before a problem can be used.
- Max: unlimited. Pro and UltraPro: one free session per child per IST week, counted on the server so it cannot be bypassed from the phone. Parents see a mastery map per model type and a weekly growth line.
- Cost: under ₹0.21 of model spend per session at worst; about $4 (₹350) once for the content with the Batch API.

**What is not claimed**
- No result claim anywhere: our searches found no measured effect of this method on marks, so the card describes the method only.
- The repo has no site-wide translation layer; the new page gets its own small English, Telugu and Hindi string table.

**Founder decisions, 2026-10-10 (added to the spec)**: Free-tier children get a locked card plus one static non-AI preview; Max gating is built and tested with a TEST payment row but TUT-43 takes traffic together with TUT-45 (Max on sale); pilot languages en/te/hi with new languages as data rows only (a dummy-language test); card replaced in place and recorded in the TUT-42 item map.

**TUT-45 (spec only, `docs/specs/TUT-45-max-on-sale.md`)**: Max at ₹2,500/month needs a tier-aware access timeline (today every paid child is treated alike), an upgrade credit for Pro to Max, and an on/off switch. Two business gaps are flagged for Vet: illustrated notes and the 2 free tutor contacts are not built, and the per-mode daily limits are not built, so Max would differ from Pro only by Singapore Maths.

**Status**: nothing built, nothing deployed, no migration run (specs name 033 and 034).

## 2026-10-06 - answer v2 accepts any school page (built, tested, not live)

**What was wrong**
- A phone check on tutp.online (live 00398-vim, v2 on) with a page that teaches but has no questions (textbook or notebook notes) said "does not look like homework" for Explain and "notes could not be made" for Notes. The photo reached the model; the v2 prompt only knew "questions" or "not homework". Notes failed only because that answer had no questions. It is not an upload-security problem: no request ever reached upsec2.
- A file labelled HEIC was refused with 400 before the server's HEIC conversion ran.

**What changed**
- Answer v2 now accepts any school content: question pages, worksheets, exam papers, textbook pages, notebook notes, small, forwarded (WhatsApp) and screenshot photos. `not_homework` is only for clearly non-school pictures (selfie, landscape, receipt).
- A page with no questions comes back as a content page: 1 to 4 idea cards (one per main idea, with an Explain button, no marks, no "check the answer" box) and the page text. Notes please builds from that page text with zero questions. Explain works on each idea.
- Unreadable photos now show a "take it again closer, flat, sharp, good light" request written by the model in the parent's language.
- HEIC labelled image/heic or image/heif is converted to JPEG first. A file labelled HEIC whose bytes are not HEIC gets a clear 415.
- Rollback without code: `ANSWER_V2_ENABLED=0` (the old Homework Help path). Revision `tutp-demo-00405-qoh`, tag `v2off`, is the 00398-vim image with the flag off, deployed with no traffic.

**Tests**
- Unit: 331 tests, 330 pass (the one failure is the known checkout-path-with-a-space test). New: content mode in the answer schema, merge, prompt and unreadable retake text. UI harness 33 checks (content card, retake text). Golden set 13 cases (3 new content pages: English textbook, English notebook, Telugu textbook), recorded live.
- Live smoke `tests/e2e/photo-live.spec.js` (real model, release revision, about $0.22): worksheet photo, notes, 500 px photo, HEIC, landscape, and four no-question pages: printed textbook page, handwritten notebook page, WhatsApp-size photo (50 KB), 500 x 566 screenshot. Each content page gives idea cards, notes from the page text and an explanation about the page.
- Full e2e twice on the no-traffic preview `upsec3p` (00406-ref, replay, model spend $0.0000). Run 1: every spec passed except `login`, which crashed after its checks with Playwright's "guid not bound" error; run alone it passed (24 checks). Run 2: `login` crashed the same way and `story` timed out once on its first page load while a deploy was running; both passed when run alone. Both runs count as grouped runs.
- The live photo smoke passed twice on the release revision `tutp-demo-00407-gev` (tag `upsec2`, tested image digest redeployed without `E2E_REPLAY`, `ANSWER_V2_ENABLED=1`, label git-sha afd2f2e): 9 of 9 both times, $0.22 and $0.19. The HEIC sample is converted and read by the model (it is not a school picture, so the answer is `not_homework`).

## 2026-10-06 - upload security v2 (built, tested, not live)

**What changed**
- Upload security (2026-10-04 entry below) is merged with homework help v2 and everything else on main. One helper, `server/lib/signed-url.js`, now signs every file link; `server/uploads.js` no longer has its own signing.
- A photo taken on an iPhone (HEIC) is turned into a JPEG on the server before it is stored or sent to the model. If it cannot be converted (too large or broken) the parent sees a clear message and no model call is made.
- The teacher homework list shows 15 minute signed links, also for old rows that still hold a public link. No read path returns a public family-uploads link any more.
- `scripts/storage/count-public-urls.sql` is one read-only query: per table and column, how many rows still hold a public family-uploads link, plus the number of objects in the bucket. Vet runs it in the Supabase SQL editor before and after making the bucket private.

**What is live**
- Live now: homework help v2 on `00398-vim` (commit 16ccee6, `ANSWER_V2_ENABLED=1`). Nothing of this round is live; traffic has not moved.
- Release revision: `tutp-demo-00404-xab`, tag `upsec2`, 0 percent, label git-sha 0b5ff7a, `ANSWER_V2_ENABLED=1`, no `E2E_REPLAY`, same image as the tested `00403-mok`; env names, secrets (CHIP_HASH_SALT:2) and service account equal to live. 16ccee6 is an ancestor of the branch and of the tested commit; main (fc8a10c) is an ancestor too, so main can fast-forward.
- Tests: unit 322/323 (the one failure is the known el test in a path with a space). Full e2e on the preview (00403-mok, flag unset, replay): run 1 in groups (nine specs, then login, family and uploads on their own after a Playwright crash and the uploads fix) passed, run 2 passed all 12 specs in one go. Model spend $0.0000 (replay only; no prompt or model file changed). The uploads spec now signs in without the captcha like the other specs, so a preview host not in Firebase's authorized domains works.
- A first preview (00402-rom) inherited `ANSWER_V2_ENABLED=1` from the service and failed homework, chips and answer-explain with `no_recording`; previews must run with the flag removed.

**What is next**
- Founder: run `scripts\release-us.ps1`, then the bucket steps (`count-public-urls.sql`, `make-private.ps1`).

## 2026-10-05 - homework help v2 is live on 00398-vim

- Live: Answer Please + Explain Please v2 on `tutp-demo-00398-vim` (100% traffic, `ANSWER_V2_ENABLED=1`, commit 16ccee6). Main is fast-forwarded to 16ccee6 and pushed.
- Stray revision: `tutp-demo-00292-v54` (`ANSWER_V2_ENABLED=0`, latestCreated) came from an env-change rollback run by mistake after the traffic move. It serves 0% and must NEVER get traffic. It is also the service template, so a deploy that inherits env would carry the flag at 0.
- Fix: `deploy.sh` and the release command in CLAUDE.md now set `ANSWER_V2_ENABLED` explicitly (`=1` for a release; e2e previews use `--remove-env-vars=ANSWER_V2_ENABLED`). The one-off `scripts/release-el.ps1` was left alone (pinned to 00393).
- Correct rollback: change the env var (`gcloud run services update tutp-demo --region=us-central1 --update-env-vars ANSWER_V2_ENABLED=0`), THEN `update-traffic` to the new revision it creates (the service is pinned to a named revision, so the env change alone moves nothing). Never send traffic to 00292-v54 as it stands.

## 2026-10-05 - homework help v2: Answer Please + Explain Please (built, tested, not live)

**What changed**
- Answer Please now returns a marks-aware answer card per question (steps, final answer, a check of the numbers by code); Explain Please adds a concept explanation with a picture (code-drawn SVG now, Gemini image when the key is bound). Free families see the card, Pro (any child with an active paid_until) sees the full explanation. Pictures and explanations are cached per concept and language; pictures are served by short-lived signed URLs (`server/lib/signed-url.js`, shared; `/api/upload` untouched). "Tut-P Knowledge Graph" shows only when the answer came from the graph, never for a model answer.
- Golden set (10 cases, live, effort low): g1 345+278=623 and 600-257=343 pass; g2 Telugu 24x6=144 pass; g3 3/8+2/8=5/8 pass; g4 Hindi civics, g5 Telugu biology, g6 grammar pass; g7 physics 120 km/2 h=60 km/h and distance-vs-displacement pass; g8 Hindi 150/3=50 km/h pass; g9 Telugu 0+2x10=20 m/s pass; g10 aerobic vs anaerobic pass. 10/10, all 6 numerical cases right, so Answer stays at Sonnet 5 low; medium was not needed. Explain is Sonnet 5 low.
- 8-question Telugu photo: one call took 26 s (about 2,900 tokens, nothing cut off), too slow, so photos are split into two parallel batches of 4 and merged in order: 16-17 s locally, 19-20 s end to end on the preview (old path about 18 s; no time budget was set, so that was the yardstick). Cost about 0.045 vs 0.036 USD per photo. `ANSWER_V2_BATCH=0` turns batching off.

**What is live**
- Live now: experiential learning v2 (00393-huf, commit c3d9863); nothing of this round is live. Earlier note that live was 00376-muj was wrong, and the first release revision 00391-yig was built before experiential learning was on main, so it must not get traffic. Main (51706e0) is now merged into this branch (16ccee6): conflicts in server.js, knowledgeGraph.js, e2e-mode.js and run.js were resolved keeping both features, and the recordings and LAST_LIVE took main's version.
- Release revision: tutp-demo-00398-vim (tag aev2, 0 percent traffic, label git-sha=16ccee6, `ANSWER_V2_ENABLED=1`, no `E2E_REPLAY`, no YOUTUBE_API_KEY like live; every other env var, secret and the service account equal to live 00393-huf). Same image digest as the tested 00397-ver. The live commit c3d9863 is an ancestor of 16ccee6. Built behind `ANSWER_V2_ENABLED` (new path on) with the old `/api/homework` untouched when it is 0. Rollback: env change THEN `update-traffic` to the new revision (see the entry above; the env change alone moves no traffic).
- Tests: migration 031 (explain_cache, illustrations, private bucket) applied. After the merge: full e2e suite, all 11 specs including el, passed twice in a row (runs 3 and 4) in replay on the no-traffic preview 00397-ver (tag aev2); run 1 also passed and run 2 died on a Playwright "guid not bound" crash after login checks a-f passed (not an app failure, not counted). Model spend: $0.0000 per spec in replay; the 4-test live smoke set ran once in run 1 (models.js changed vs LAST_LIVE) for $0.0265. Recording the 15 answer-explain specs earlier cost $0.1846 (26 calls). Unit 305/305 (the el test "a lesson file that fails the gate loses its experiment at load" fails in a checkout path with a space, because it uses an undecoded URL pathname; it passes in a path without spaces). The preview runs with the flag unset (specs switch v2 on by header); the revision that gets traffic has `ANSWER_V2_ENABLED=1` and no `E2E_REPLAY`.
- Upload security: signed picture URLs now come from one shared helper (`server/lib/signed-url.js`); `/api/upload` itself was not changed.

**What is next**
- Pictures use the SVG fallback until `GEMINI_IMAGE_API_KEY` is bound from secret `gemini-image-api-key` and `IMAGE_GEN_ENABLED=1` is set. "Save to notes" is device-only (this browser). Founder: phone check, traffic command.

## 2026-10-04 - upload security (built, tested, not live)

**What changed**
- A file can no longer be uploaded without signing in. `/api/upload` needs a signed-in family member (a child's id must belong to that family), or a teacher for assignment attachments, or, during registration, the verified phone (OTP). Anything else gets 401 or 403.
- The server reads the file type from the file itself (JPEG, PNG, WebP, HEIC, PDF only, 8 MB), and names it itself: `families/<family id>/<random>.ext`. A name or path sent by the browser is never used.
- Files are opened only through `/api/files/open`, which checks the family and then hands out a link that works for 15 minutes. The database now stores the file's path, not a public link. Old rows with public links still show: the teacher-homework list turns them into 15 minute links.
- Registration photos are uploaded under a folder of the verified phone and moved into the new family's folder when the family is saved; any other path in the form is dropped. The registration page shows the photo from the local file.
- The home page "attach homework" no longer uploads before login: the file waits in the browser tab and the dashboard opens it after sign-in (very large files: attach after sign-in).
- The storage bucket itself is NOT changed. `scripts/storage/make-private.ps1` (for Vet, after traffic moves) checks, counts, prints what it will change and asks y/n.

**What is live**
- Live now: story image library (revision 00376-muj). Nothing of this round is live.
- Built and tested: see the release report (tag usrel, 0 percent traffic, no E2E_REPLAY, CHIP_HASH_SALT:2). Goes live when the founder runs `scripts/release-us.ps1`; then `scripts/storage/make-private.ps1`.

**What is next**
- Until the bucket is made private, old public links still work for anyone who has them. Making it private is the founder step after the release.

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
