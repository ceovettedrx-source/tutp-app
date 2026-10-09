# cost-health-v1: TUT-11 model-health alert + TUT-10 prompt caching

Founder-agreed 2026-10-09. Branch `cost-health-v1`.

## Part 0 findings (usage_events, last 7 days to 2026-10-09, read-only)
Live (non-replay) model calls, USD from `model.call` rows: test families $6.77 (880 calls,
78%), real families $1.91 (137 calls, 22%), no family $0.01. Replay rows (6,202) cost $0.
The paid test calls cluster on release days (10-03 $1.16, 10-04 $1.81, 10-07 $1.21, 10-09 $1.25).
Anthropic console shows 3.8M tokens; usage_events holds 2.9M live (2.4M in, 0.55M out). The
rest is most likely calls that are not logged (local golden/latency runs call `callClaude`
without a database), not proven.

## Part 1: model-health
- `server/model-alert.js`: billing ("credit balance") or auth (401/403) failure in `callClaude`
  emails the founder once per reason per hour (memory claim first, `usage_events`
  `alert.model` row across instances). Body: reason, HTTP status, feature, time. No key, prompt
  or upstream body.
- `server/model-health.js` + `POST /api/cron/model-health` (401 without `X-Cron-Token`): one
  Anthropic call (haiku-4-5, max_tokens 5), one Gemini text call (`gemini-2.5-flash-lite`, key
  `GEMINI_IMAGE_API_KEY`, 5 output tokens, TEXT only; override with `GEMINI_HEALTH_MODEL`), and
  the 24h error rate (`properties.ok === false`, at least 5 calls). Email only on a failure or a
  rate above 10%. 200 when healthy, 503 when not (Cloud Scheduler shows the job as failed).
- `model.call` rows now carry `ok` and `status` in `properties`.

Scheduler job (daily 08:00 IST), not run by Claude:

    gcloud.cmd scheduler jobs create http tutp-model-health --location=us-central1 --schedule="0 8 * * *" --time-zone="Asia/Kolkata" --uri="https://tutp.online/api/cron/model-health" --http-method=POST --headers="X-Cron-Token=<value of secret cron-token-v2>"

(put the token in with `$(gcloud.cmd secrets versions access latest --secret=cron-token-v2)`;
never paste it into a chat.)

## Part 2: prompt caching
Every Anthropic call goes through `callClaude`. A cacheable prompt is two system blocks
(`server/prompt-cache.js`): STATIC (rules + schema, same bytes every call) and DYNAMIC (language,
child, board, range, photo sizes, glossary, the parent's words). `cache_control` goes on the
static block only, and only when the static prefix clears the model's floor (Sonnet 5 1,024
tokens, Haiku 4.5 4,096); otherwise the two blocks are joined into one plain string.

| call | model | static ~tokens | result |
|---|---|---|---|
| answer_v2, answer_v2_photo | sonnet-5 | 2,090 | cached |
| explain_v2 | sonnet-5 | 1,396 | cached |
| notes, other than English | sonnet-5 | 1,060 | cached (close to the floor; the API skips it silently if the real count is under) |
| storytelling, other than English | sonnet-5 | 2,045 | cached |
| notes / storytelling in English | haiku-4-5 | same | skipped: below the 4,096 floor |
| homework_help (typed haiku, photo sonnet-5), quiz, experiential_learning | | ~1,200 | not changed: language, child and photo list are woven through the rules; haiku is below the floor anyway. Candidate for a later round |
| visual_tutor (4 prompts) | sonnet-5 | 120-540 | skipped: below 1,024 |
| el_translate | sonnet-5 | ~100 | skipped: below 1,024 |
| lesson_verify | sonnet-5 | ~750 | skipped: below 1,024 |
| lesson_material, question_paper | sonnet-5 | n/a | not changed: per-request content sits between the static parts; teacher module, no traffic in 7 days |
| el_teachback, el_video_review, illustrate, homework_demo, game_questions, feedback_classify, model_health | haiku-4-5 | small | skipped: below 4,096 |

The reply rules and JSON shapes are word for word the old ones. Only "in Telugu" became "in
the parent language", defined in the first line of the dynamic block, and the per-request
sentences moved after the cached block. `EXPLAIN_PROMPT_VERSION` stays `explain-v2.4` so saved
explanations stay valid.

### Migration (not run on production)
`supabase/migrations/032_usage_events_cache_tokens.sql`:

    alter table usage_events add column if not exists cache_creation_input_tokens integer;
    alter table usage_events add column if not exists cache_read_input_tokens integer;

The code writes the columns only when `USAGE_CACHE_COLUMNS=1` is set on the service. Until
then the same counts are in `properties.cache_write` and `properties.cache_read`.

## Tests
`tests/unit/cost-health.test.js` (risks 1 to 6 of the brief), `tests/e2e/cron.spec.js` 4-6.
Replay e2e cannot see a prompt change (recordings are keyed on the messages, not the system
prompt); the live smoke set (`homework.spec.js --smoke`, a few cents) is what checks the model
still answers in the same shape, and waits for the founder's go.
