# Round 1 — B2 "explain on photo" release (2026-09-28)

Approved in advance by the founder's master plan (2026-09-28).

## Scope
- Ship branch `explain-on-photo` (dd820b1): card button zooms into that
  question's line; 2-5 steps with Next/Back, each highlighting its part;
  wrong answer in red; recovery via `locate_line` when the crop misses;
  "Check mistakes" above the cards; thinking off for pointing calls.
- Rebased onto `static-cache-safe` (1eb86da, the cache fix awaiting
  traffic) instead of main, so the release carries everything deployed.
  One conflict: two import lines in `server.js`.
- Per-step timing, and the cause of the 98 s dense-sheet run.

## The 98 s run
- No single request in the Cloud Run logs took 98 s (7 days, all
  revisions). The slow case in the logs: 00298-lor, 2026-09-28 03:10 UTC,
  a photo `/api/homework` call. Both model attempts stopped at
  `max_tokens` with 3000 output tokens and no JSON (about 35 s each), then
  a 502 after 70 s. The parent's retry took 32 s more.
- Cause (ours): sonnet-5 thinks by default; on a dense sheet the thinking
  used up the whole 3000-token budget before any JSON was written, and
  the JSON retry repeated the same request, so it failed the same way.
- Fix: B2's `thinking: disabled` for pointing calls
  (`server/pointing-model.js`). On the B2 preview (00300-men) photo calls
  used 630-780 output tokens, and no request took over 20 s.
- The retry itself stays: a typed reply that ends normally but without
  JSON (00301, 07:13 UTC) did recover on the second call.

## Timing (new)
- `server/step-timer.js`: `mark(step)`, a log summary and a
  `Server-Timing` header.
- `/api/homework`: steps auth, student, limit, model1 (model2 on a retry),
  boxes. One `homework: timing` log line per model-backed reply, 200 or 502.
- `/api/visual-tutor`: prepare, model, reply (next to the existing
  `X-Server-Time-Ms`), logged as `visual-tutor: timing`.

## Files
`server.js`, `server/step-timer.js` (new), `server/routes/visual-tutor.js`,
`tests/unit/step-timer.test.js` (new), `tests/e2e/homework.spec.js`, plus
the B2 commit's own files.

## Tests
- Unit: step-timer (steps, header, total); all existing unit tests.
- E2E on a no-traffic preview: cache and login twice. The model-calling
  specs (homework, visual-tutor) also run twice, because B2 changes
  prompts and model settings.
- Homework p6 (dense 12-question sheet) now also requires exactly one
  model call (no `model2` in Server-Timing), which catches the max_tokens
  failure. k2 and p6 report the server's step times.

## 8-question cap, enforced on the server (added during the build)
- With thinking off, the model returned all 12 questions of the dense
  sheet despite the prompt's "at most 8" (p6 failed on 00304-jup).
  `checkQuestionBoxes` now keeps the first 8, as the prompt asks, and
  puts the number it cut into `more_questions`. The page does not show it
  yet; the prompt's own "there are more" note is missing when the server
  does the cut.

## Results (preview 00305-zir)
- Run 3: all green except login g. That was a 13 s network stall on the
  test machine: no request reached the server, then every asset arrived
  in the same few ms. The guard failed closed.
- Run 2: k5 quiz came back in the Homework Help shape once (typed path,
  sonnet-4-6, code unchanged).
- Run 4: all 31 green. Run 5 (cache and login): green.
- Server time, dense sheet: about 8-10 s total, 7-9 s of it the single model call.

## Found, not fixed here
- `/api/parent-involvement-baseline?viewer=mother` answers 200 to a
  family_member session (seen in the logs of login test g). Belongs to the
  round 3 access work.
- The cron job passes its token in the URL query string, so Cloud Run
  request logs store it in plain text. Rotate it, and send it in a header.

## Edge cases
- Cloud Run's front end may add its own Server-Timing entry; the e2e
  reads only the entries it knows.
- 400/402/403 replies send no timing (no model call was made).
