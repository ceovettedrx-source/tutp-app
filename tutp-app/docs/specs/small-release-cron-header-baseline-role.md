# Small release: cron token in a header, baseline role check (2026-09-29)

Two backlog items, shipped together before round 2.

## 1. CRON_TOKEN rotated and moved out of the URL

- `server/cron-auth.js`: `cronAuthorized(headers, expected)` accepts the
  token only from the `X-Cron-Token` header, compared in constant time.
  All four `/api/cron/*` routes use it; `?token=` is ignored.
- New secret `cron-token-v2` (random 64 hex). A new secret name rather than a
  new version of `cron-token`, because the serving revision reads
  `cron-token:latest` and would pick up a new version on its next cold start
  while Cloud Scheduler still sent the old value in the URL.
- Order: (a) secret created, runtime SA granted accessor; (b) the 4 Scheduler
  jobs got the `X-Cron-Token` header, URIs unchanged, so both the old revision
  (query) and the new one (header) authenticate; (c) preview deployed with
  `CRON_TOKEN=cron-token-v2:latest`; (d) after traffic moves, `?token=` is
  removed from the 4 job URIs and the next run is checked for 200.
- The old `cron-token` secret stays enabled so a rollback to an older revision
  still starts; the old value no longer works on any revision from this one on.

## 2. /api/parent-involvement-baseline restricted by role

- GET `?viewer=` and POST `{viewer}` naming a viewer the session doesn't hold
  now get 403, like bonding-score (`sessionMayNameViewer`). A blank viewer
  keeps the old behaviour (resolved from the session, `available: false` when
  unclear), so multi-role parents are not locked out.

## 3. Correct answers on photo homework (found by e2e p3, 2026-09-29)

- Bug: with the worksheet photo, card 2 said "Answer: 33" for 45 − 18 (the
  child's wrong answer, copied), and "Explain on photo", told the card's
  answer was the correct one, said "33 matches the correct answer. Great
  job!". Round 1 on preview only; not live.
- Prompts: Homework Help works out every answer and never copies the
  child's; Explain on photo gets "Card answer" (may be wrong) and works the
  answer out itself.
- `server/arith-check.js` (founder, 2026-09-29): plain integer arithmetic
  (+ − × ÷, brackets, one blank as in "6 × 9 = 6 × 3 × __") is recomputed in
  code; a differing model answer is replaced. Counts only in the log and in
  `X-Arith-Checked` / `X-Arith-Fixed`, never text.
- If a live run still shows the model's own answer wrong (X-Arith-Fixed > 0
  on the worksheets), the photo call goes from thinking off to effort low.

## Tests

- unit: `tests/unit/cron-auth.test.js` (match, mismatch, missing, empty, no
  configured token); `tests/unit/arith-check.test.js` (every row of both
  worksheet fixtures, plain, numbered, with the child's answer, "= ?";
  missing-number forms; words/decimals/non-whole results left alone; the
  copied-answer reply fixed and counted).
- e2e homework k2: each wrong row's card shows the correct answer; k2 and
  p6 report the X-Arith-Fixed count.
- e2e: `tests/e2e/cron.spec.js` (no token, query token, wrong header -> 403
  on all four routes; never runs a job). Login f/g: other roles' baseline
  GET/POST 403, own baseline GET 200 / POST with bad answers 400.
- after traffic: the next Scheduler run of each job returns 200.
