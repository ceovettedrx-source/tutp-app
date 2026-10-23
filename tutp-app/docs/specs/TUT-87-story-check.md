# TUT-87 (Story only): fact re-check of a generated Story (spec, 2026-10-23)

Branch `tut-87-story-check` from origin/main 5ff173e, worktree `wt-tut87`. Triggered by TUT-86 (rain-shadow side reversed in a Telugu Class 9 Story) and TUT-78 (Moon "almost no gravity"). Scope is Story only; Notes, Explain, Answer and EL stay in TUT-87 for later. No code until you approve this page.

## What exists today (checked in the repo)

- Story path: `/api/homework` with `feature=storytelling` (`server.js` ~6810): model reply -> `validateStory` (`server/story-schema.js`, shape, language, picture, length) -> one retry with the list of issues -> else `salvageStory` fallback.
- Fact checks that exist: `server/fact-guard.js` (one regex rule, cold air at the subtropical high), `answer-arithmetic.js` / `arith-check.js` (maths only), `lessonVerifier.js` (Teacher Module, sonnet-5). Nothing checks facts in a Story. TUT-86 and TUT-78 are not caught by any of these.
- Models in `server/models.js`: haiku-4-5 ($1 in / $5 out per 1M tokens) is the cheapest. Story generation uses haiku for English and sonnet-5 ($2 / $10, effort low) for every other language, because haiku's Telugu was weak.
- There is no separate `subject` field in the request. The Story prompt gets the parent's topic text (`text`) and the child's class (`students.class`). The verifier gets both: class, and the topic text as "subject".

## Founder decisions (2026-10-23), spec approved, build paused for TUT-69

1. Verifier failure (API error, timeout, bad JSON): the Story is shown unchecked, logged `ok: null`. Approved.
2. Salvaged (fallback) Stories are not verified in this round. Approved.
3. The two extra RIGHT cases are added to the golden set (5 cases x 5 runs). Approved.
4. When the second check still fails: 502 `story_unverified` with the wording below. Approved.

## Design

1. After a Story passes `validateStory`, one verifier call (`callClaude`, feature `story_check`, new `MODELS.story_check`). Input: story text (title, steps, any quiz/tip text in the story JSON), class, subject/topic, language. Output JSON only: `{"ok": bool, "wrong": [{"quote": "...", "why": "...", "fix": "..."}]}`. It checks facts against that class level, written in the story's language, and flags only statements that are false, reversed or misleading at that level, not omissions or fair simplifications.
2. `ok` -> show the Story as now.
3. Not ok -> regenerate the Story ONCE with the verifier's `fix` notes added to `storyHint` (the existing retry channel), run `validateStory` on it, verify again.
4. Still not ok (or the regenerated story fails `validateStory`) -> **never show it**. Proposal below.
5. One log line, JSON, severity INFO: `story_fact_check {ok, attempts, wrong_count, ms, usd}`. Counts only: no story text, quote or topic in the log. `usd` comes from `costUsd`; the verifier call also gets its normal `model.call` row.
6. `E2E_REPLAY=1` -> verifier skipped (no call, no log line), so recordings stay valid. Unit tests mock `callClaude`.

### Verifier model

Start with `MODELS.story_check = 'claude-haiku-4-5'` (cheapest in the repo). Risk: the same Telugu weakness that moved Story generation to sonnet-5 could make a haiku verifier miss TUT-86. So the **golden set decides**: if haiku misses either WRONG case (or flags the RIGHT case) in Telugu, the verifier for non-English uses sonnet-5 at low effort, same split as `storyModel`. I will report both numbers rather than pick silently.

### What the parent sees when the second check still fails (proposal; your preference noted)

Never a Story we know is wrong. The route answers 502 with `error: story_unverified` and the page shows (all languages, translated like the other errors): "We could not make a Story for this topic that we are fully sure is correct. Please try again, or pick a more specific topic." The session is not counted (the free-limit count and `session.completed` happen only on a shown Story; I confirm that in code before building). Alternatives I do not recommend: show with the wrong sentence cut (breaks the story's flow), or show with a warning (the child still reads the wrong fact).

### Decisions I made (shout if you disagree)

- Verifier fails (API error, timeout, unparseable, `ok:false` with no usable `wrong`, or every `quote` is not in the story text) -> the Story is shown unchecked and the log line has `ok: null`. We cannot say it is wrong; blocking every Story whenever the verifier is down is worse. A `story_check_unavailable` WARNING makes it visible.
- A fallback (salvaged) Story, which failed `validateStory`, is not verified in this round; today's behaviour stays.
- Each `quote` must be an exact substring of the story; the `fix` note is cut to 300 characters and only the first 3 items go into the retry prompt, so a long or hostile verifier reply cannot flood the prompt.

## Cost and time per Story (estimates; the golden run replaces them with measured numbers)

| Case | Extra calls | Cost | Added time |
|---|---|---|---|
| Story is ok (the normal case) | 1 verifier | about $0.003 haiku (about 2,000 in / 200 out tokens, Telugu costs more tokens), about $0.006 if sonnet-5 | about 2-4 s haiku, about 4-8 s sonnet-5 |
| Wrong once, fixed | verifier + new Story + verifier | about 2 verifier calls + one more Story generation (today's Story call cost) | about 2 verifier calls + one Story call, roughly double a Story |
| Wrong twice, blocked | same as above | same, no Story shown | same |

If the measured added time for the normal case is over 5 s I stop and ask before building further.

## Golden set (real model, read-only, before release)

Calls the verifier directly (no database, no family, no Story generation), through a script that prints per case: verdict, caught quote, tokens, usd, ms. Class 9 Social Studies for the first two, Class 9 Science for the third.

| # | Text | Must |
|---|---|---|
| W1 | TUT-86 Telugu step 3: "గాలి పైకి లేచినప్పుడు చల్లబడి ... కొండకు ఎదురుగా ఉన్న వైపు వర్షం పడుతుంది. దీన్నే వర్షచ్ఛాయ ప్రాంతం ... అంటారు" | `ok:false`, quote contains "వర్షచ్ఛాయ" sentence |
| W2 | TUT-78 "The Moon has almost no gravity to hold gases" (English, wrapped in a short story) | `ok:false`, quote contains "almost no gravity" |
| R1 | "కొండలు దాటాక గాలిలో తేమ అయిపోతుంది ... వెనుక వైపు (leeward) దక్కన్ పీఠభూమిలో వర్షం తక్కువగా పడుతుంది - దీన్ని వర్షచ్ఛాయ ప్రాంతం (rain-shadow region) అంటారు." | `ok:true`, `wrong: []` |

Each case runs 5 times (the model is not deterministic): a WRONG case must be caught 5/5, a RIGHT case passed 5/5. I propose adding two more RIGHT cases to measure false alarms (a correct Moon sentence: "The Moon's gravity is about one sixth of Earth's, too weak to hold gases", and the correct windward sentence in Telugu); say no and I keep three.

**Golden-set spend:** 5 cases x 5 runs = 25 calls, estimated $0.10-$0.20 on either model, **well under your $3 limit**. I stop and ask before spending if the estimate or the running total passes $3 (for example a larger set, or a sonnet-5 comparison on top of a haiku run, would still be under $1). The live Story smoke set (`--live`) is not run; adding a key to `server/models.js` makes the e2e runner print its usual warning only (TUT-47).

## Files touched

`server/models.js` (+`story_check`), new `server/story-fact-check.js` (prompt, call, parse, quote and length guards, pure functions), `server.js` (Story block: one call after `validateStory`, one regeneration with notes, the 502 path, log line), `public/app/*` Story error message only if the page needs a new text for `story_unverified` (templates/dashboard.html + `node scripts/build-dashboards.mjs`, never the generated files), `tests/unit/story-fact-check.test.js`, `tests/golden/story-fact-check.mjs` (golden script), `docs/specs/TUT-87-story-check.md`.

## What can go wrong

| # | Risk | Test that catches it |
|---|---|---|
| 1 | False alarm: a correct Story (or a fair simplification for the class) is flagged, so parents get "try again" for good stories | golden R1 (+ the two extra RIGHT cases) 5/5 pass; prompt says flag only false or reversed statements; unit: `ok:true` shows the Story untouched |
| 2 | Miss: the verifier passes a wrong Story (haiku weak in Telugu, or "almost no" style magnitude wording) | golden W1 and W2 caught 5/5; if haiku fails W1 the non-English verifier moves to sonnet-5 (decision recorded in the release summary) |
| 3 | Verifier replies `ok:true` but lists `wrong` items, or `ok:false` with an empty list | unit: `ok` is true only when the flag is true AND `wrong` is empty; `ok:false` with no usable item = invalid reply = shown unchecked, `ok:null` |
| 4 | Verifier hallucinates a quote that is not in the story | unit: items whose `quote` is not an exact substring are dropped; none left = invalid reply |
| 5 | The `fix` note carries an instruction, or is very long, into the next prompt (prompt injection through the topic text or the verifier) | unit: notes cut to 300 characters, max 3, wrapped as "facts to correct:"; a note saying "ignore the rules" stays inside that wrapper |
| 6 | Regeneration repeats the same error, loops, or doubles cost without limit | unit: exactly 1 regeneration and 2 verifier calls maximum (call counter asserted); then `story_unverified`, no third call |
| 7 | The regenerated Story fails `validateStory` (shape, language, picture) | unit: treated as still-not-ok, `story_unverified`; the first (known wrong) Story is never sent |
| 8 | Same topic, different class or language: a cached verdict or a regenerated Story from another class/language is reused | no cache is added; unit: the verifier input contains this request's class, topic and language; two requests (Class 5 English, Class 9 Telugu) make independent calls |
| 9 | Telugu: the quote is cut or normalised so the substring check fails on a correct catch (Unicode normalisation, ZWJ/ZWNJ, spaces) | unit: a Telugu quote with the real TUT-86 sentence matches after the same normalisation used for the story text; golden W1 shows the catch end to end |
| 10 | Verifier down or slow, so every Story fails or hangs | unit: API error, timeout (verifier call has its own 15 s limit) and bad JSON all show the Story unchecked with `ok:null` and a WARNING; the Story is not delayed beyond the limit |
| 11 | E2E recordings break or paid calls start in CI | unit: with `E2E_REPLAY=1` the verifier is not called and no log line is written; the e2e suite is run twice on a no-traffic preview as usual; no `--live`, no `--record-all` |
| 12 | A blocked Story still counts against the free limit, or charges a paid family | unit/e2e: `story_unverified` returns before `trackSessionCompleted`; verified in code before build that the free-limit count only reads completed sessions; a free and a paid test family both get the 502 and an unchanged count |
| 13 | The log leaks story text, a child's name or the topic | unit: the log line is exactly the 5 keys plus severity and event, values numbers or booleans only |
| 14 | Cost creep: a verifier call on every Story and on every retry unnoticed | `usd` in the log line and the `model.call` rows per call; release summary reports the measured cost per Story and the share of Stories that needed a regeneration |
| 15 | No claim of "always correct" before it is measured | Linear and any copy say "checked", not "always correct", until the golden set and a week of `story_fact_check` logs are reported |

## Order of work

You approve this spec (or change the open choices: what the parent sees, the unchecked-on-verifier-failure rule, the two extra RIGHT cases) -> unit tests first (mocked) -> build -> golden run, report verdicts, cost and time -> e2e twice in a row on a no-traffic tag -> commit with `TUTP_AGENT_COMMIT=1` -> PR. No deploy and no traffic command from me.
