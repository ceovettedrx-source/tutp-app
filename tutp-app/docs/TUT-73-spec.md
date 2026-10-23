# TUT-73 step 2: make Gemini picture billing failures loud

Branch `tut-73-image-billing` (from main). Founder rule 2026-10-12: no approval gate; hard stops only for spend over $3 or auth, payments, student data. This touches none. Cause: `docs/TUT-73-diagnosis.md` (Gemini `http 402`, found only by hand).

## What changes
- `server/services/image-provider.js`: the thrown error carries `.status` (the HTTP code) and never the key or URL.
- `server/services/illustration-service.js` (`generate()`): on any provider failure with a status, ONE JSON log line `{severity:'WARNING', event:'image_billing_fail', status, concept_key, feature}` and a `usage_events` row `image_billing_fail` (reuses the table, no migration). On success ONE line `{severity:'INFO', event:'image_generated', model, concept_key, feature}`. `feature` comes from the caller (`surface` in the request body, else `unknown`). Only a real generation logs: a cache hit never reaches `generate()`.
- New `server/services/image-billing-alert.js`: `checkAndAlert()` reads `image_billing_fail` rows of the last 24h. If there are any and no `image_billing_alert_sent` row in the last 24h: write the marker first, then email the founder (existing `sendEmail`: Resend, Gmail fallback, `ADMIN_NOTIFY_EMAIL`). Subject `Tut-P: picture generation failing (HTTP <status>) since <first time IST>`; body = count per feature + "top up Prepay - AI Studio". In-process throttle 10 min.
- `server.js`: `GET /api/admin/image-billing` (`requireAdmin`) returns `{count, first_seen, last_status}` for the last 24h; the admin dashboard gets a red tile "Pictures failing", hidden when count is 0.
- User side unchanged: the SVG fallback stays, no fake picture.

## What can go wrong (each has a test)
| Risk | How it breaks | Test |
|---|---|---|
| Alert spam | 50 failures send 50 emails | unit: 50 failures through `checkAndAlert` = 1 `sendEmail`; second call after the marker = 0; a failure 25h later = new email |
| Alert on a cached picture | a ready/cache hit counted as failure | unit: `request()` on a `ready` row and on a recent `fallback` row writes no `image_billing_fail` and no `image_generated` |
| Config fallbacks counted as billing | `no_key`, `flag_off`, `cap_hit` alert the founder | unit: those reasons write no `image_billing_fail` |
| Secret in log or email | the key sits in the request URL or header | unit: the error message, the log line, the usage_events row and the email contain neither the key nor `x-goog-api-key`; the provider error text is only `gemini http <status>` |
| Admin tile on empty data | shows `0` or "NaN", or breaks the page | unit: empty rows give `{count:0,first_seen:null}`; e2e: the tile is hidden on a clean preview |
| Test family noise | replay and e2e failures alert the founder | `checkAndAlert` is skipped when the provider is the e2e mock; test-family rows are not counted |
| Alert itself fails | a mail error breaks a picture | unit: a throwing `sendEmail` or supabase is swallowed; the picture path still returns `fallback` |
| Duplicate across instances | two instances both see no marker | marker written before sending; worst case 2 emails on a tie, noted not fixed |
| Cost per image uncountable | no success line | unit: success logs one `image_generated` with `model`; failure logs none |
| Same key, two surfaces at once | one generation, one log line | existing claim logic unchanged; unit: two requests = one `generate()` = one line |

## Tests
`tests/unit/image-billing.test.js` with a mocked 402 fetch and a fake supabase (no live Gemini, no spend). e2e: the existing suite twice on a no-traffic preview (replay) plus one admin-tile check. Release per CLAUDE.md: preview, e2e twice, redeploy without `E2E_REPLAY`, founder runs the traffic command, verify `status.traffic`, fast-forward main.
