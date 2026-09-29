# Round 2 — cost reduction (2026-09-29)

Approved in advance by the founder's master plan (2026-09-28): typed
features off sonnet-4-6 to haiku-4-5, anything that isn't a fit for haiku to
sonnet-5; cost logging and a daily cost card; test families out of every
founder metric.

Prices per 1M tokens (input / output): sonnet-4-6 $3 / $15, sonnet-5 $2 /
$10, haiku-4-5 $1 / $5. Every model call below gets cheaper; none gets dearer.

## 0. Cheaper tests first (founder, 2026-09-29, before the model changes)

### Record and replay (`server/model-replay.js`)
- `E2E_REPLAY=1` on a preview turns it on; the test browser picks the mode
  per request with `X-E2E-Mode` (sent only to the two model routes, not to
  Firebase), so one preview serves replay, record and live runs without a
  redeploy:
  - replay (default): `/api/homework` and `/api/visual-tutor` answer from
    `tests/e2e/recordings/<key>.json`, no model call. A missing recording
    is `503 no_recording`, never a live call.
  - record: live calls, and the response carries `_recordings` (the raw
    model replies); `tests/e2e/e2e-mode.js` saves them.
  - live: live calls, nothing saved.
- Key: sha256 of feature + language + the request's messages (parent's
  text, photos). The system prompt, model and settings are left out on
  purpose: prompt/model changes are the live smoke set's job, and the replay
  suite keeps testing server and page logic without re-recording. A change
  of the reply's JSON shape needs a full re-record (`--record-all`).
- Production never reads recordings, two guards: (1) replay/record only for
  test families (`is_test`), real families are always live whatever the
  env; (2) the tested image is redeployed for release without the env var
  (same image digest, `--remove-env-vars`), and that revision gets traffic.
  `tests/e2e/recordings` goes into the image (`.dockerignore` exception) so
  the preview can read it.

### Which runs are live (`tests/e2e/run.js`)
- Default: replay for everything.
- Live only when a file under `server/prompts/`, `server/pointing-model.js`
  or `server/models.js` differs from the last passing live run.
  `tests/e2e/recordings/LAST_LIVE` holds each file's `git hash-object`, so
  uncommitted edits count and a commit made after the tests doesn't. Then
  only the live smoke set (`homework.spec.js --smoke`), recording as it
  goes: one typed question, one photo (new 4-question fixture
  `worksheet-4.jpg`, rows 2 and 3 wrong), one explain on a wrong row, one
  check mistakes. `--live-smoke` forces it, `--replay-only` skips it,
  `--record-all` runs everything live and saves every reply.

### Spend per run
- For test-family sessions each model-calling response carries
  `X-Model-Usd` (sum over its model calls, 0 when replayed). The runner
  totals it per spec and prints "model spend: $x.xxx"; the release summary
  lists every run's figure.

## 1. Models (one table in `server/models.js`)

| Call site | Today | New |
|---|---|---|
| `/api/homework` typed (no photo) | sonnet-4-6 | haiku-4-5 |
| `/api/homework` photo, visual tutor | sonnet-5 | unchanged |
| `/api/homework-explain` | sonnet-4-6 | haiku-4-5 |
| `/api/homework-demo` | sonnet-4-6 | haiku-4-5 |
| `/api/homework/illustrate` (problem parse) | sonnet-4-6 | haiku-4-5 |
| game questions (play-based quiz) | sonnet-4-6 | haiku-4-5 |
| feedback classifier (`tracking/feedback-pipeline.js`) | sonnet-4-6 | haiku-4-5 |
| teacher question paper (16k-token JSON) | sonnet-4-6 | sonnet-5 |
| teacher lesson material + verifier | sonnet-4-6 | sonnet-5 |

- Teacher calls go to sonnet-5 rather than haiku: long structured output,
  and the verifier's job is to catch mistakes.
- sonnet-5 calls run at effort low (`output_config.effort`), the photo
  calls too (`POINTING_SETTINGS`): the recording run on 00310 (thinking
  off) had "Check mistakes" mark 56 + 27 = 73 as correct, and the founder's
  rule (2026-09-29) was to go to effort low if a live run showed a wrong
  answer. Default effort is not used: it used up max_tokens before the JSON
  in round 1 (the 98 s run).
- None of these calls sends `thinking`, `temperature` or tools today, so
  haiku-4-5 takes the same request body.
- Quality gate: homework e2e (typed, en/te/hi) must pass on haiku. A feature
  that fails on haiku for quality (not a flaky run) goes to sonnet-5
  instead, and the spec is updated with the reason.

## 2. Cost logging

- `server/model-cost.js`: price table, `costUsd(model, usage)` (input,
  output, cache write 1.25x, cache read 0.1x) and `logModelCall(...)`, which
  writes a `model.call` row to `usage_events` (no migration): properties
  `{ feature, model, input_tokens, output_tokens, cache_read, cache_write,
  usd, ms }`, `family_id` when the call has one.
- Every Anthropic call site logs through it, retries included (each attempt
  costs money). Logging never blocks or fails the request.

## 3. Daily cost card

- `GET /api/admin/costs` (admin only): today and 14 days, total USD, split
  by feature and by model, call count, cost per active family today.
- A "Model cost" card on the Founder Dashboard next to Engagement.

## 4. Test families out of founder metrics

- Mark: `family_registrations.data.is_test = true` (inside the existing
  jsonb, no migration) for family 16 (e2e) and any other family whose
  mother/father phone is a Firebase test number (`99999000xx`). The list is
  printed as ids only before writing; no rows are deleted.
- `testFamilyIds()` (cached 5 min) and every `/api/admin/*` metric (kpis,
  signups, activation, engagement, revenue, failed payments, feedback,
  costs) leaves those families out. The payments `note = 'TEST'` rule
  stays.

## Files

`server/models.js` (new), `server/model-cost.js` (new), `server.js` (call
sites, admin routes, dashboard card), `server/services/lessonMaterialGenerator.js`,
`server/services/lessonVerifier.js`, `tracking/feedback-pipeline.js`,
`server/routes/visual-tutor.js` (logging only).

## Tests

- unit: `costUsd` for each model and the cache fields; unknown model logs
  cost null, never throws; `isTestFamily` filter.
- e2e: homework typed (en/te/hi) on haiku, once (a model setting changed:
  twice); a new admin check that `/api/admin/costs` answers with numbers
  and that family 16 does not appear in engagement/DAU; login and cache
  twice.
- Model spend for this round's tests stays under 3 USD (checked from the
  `model.call` rows of the preview runs).

## Edge cases

- Haiku 4.5 context is 200K: the largest typed request (homework with 8
  questions) is far below it.
- A photo in `/api/homework` still goes to sonnet-5; only the no-photo path
  changes.
- Old `usage_events` rows have no `model.call`: the card shows cost from
  the deploy day on.
