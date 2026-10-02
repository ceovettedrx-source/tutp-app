# Adaptive chips for the homework search box — spec (APPROVED, build deferred)

Status: approved by founder 2026-10-01; build deferred (Task 2).

## Scope split (founder decision 2026-10-01)

- **Task 1 = search-box base** (chip config list, impression/tap logging, `chips.js` client). Founder pastes it separately; NOT part of this spec.
- **Task 2 = this adaptive engine**, built later once real chip data has accumulated. It builds on Task 1's config list and logging.
- Work in a separate worktree/branch from `main`. Do not touch round 4 files or the uncommitted migration 028; do not copy code from the dirty tree. A chip whose backend is not on `main` stays hidden behind its capability flag (`exam_prep` appears only after round 4 ships).

## Seed (`server/chips/chips-seed.json`, created in Task 2, exactly this content; no counts are invented)

```json
{
  "source": "Founder interviews, ~50 parents, 2026-10-01; qualitative convenience sample; no counts recorded",
  "pseudo_weight_per_intent": 1,
  "intents": {
    "answer": ["answer please", "answer the questions"],
    "explain": ["explain please"],
    "notes": ["short notes", "explain notes"],
    "exam_prep": ["exam preparation notes", "exam prep notes"]
  },
  "note": "Telugu/Hindi/transliterated label variants are unverified drafts; tap-through decides."
}
```

Equal small pseudo-weights, marked unverified; decay as real data arrives (section 3).

## Task 1 dependencies assumed by this spec

`server/chips/config.js` (capability registry, closed label vocabulary, core 4 flag) and chip impression/tap events. Where Task 1 differs, this spec adapts to it.

## 1. Signals

- Intent classifier `server/chips/intent.js`: normalize (lowercase, strip digits/punctuation, collapse space), rules for en/te/hi/transliterated -> `answer | explain | notes | exam_prep | quiz | other`. Unknown phrase -> cheapest model (haiku-4-5 via `server/anthropic.js`, effort low), cached by normalized phrase (table below). Unsupported -> `other`.
- Called fire-and-forget from the homework instruction submit path (after the reply is sent, no added latency).
- Events: `chip_impression` and `chip_tap` written to existing `usage_events` (no new table for these). Rate-limited and test-family (`is_test`) traffic ignored; bot UA/rate-limit hits skipped.
- One vote per family per intent per day enforced at aggregation (distinct family hash per day).

## 2. Privacy (nothing beyond your stated list is stored)

Stored: intent_id or scrubbed phrase <= 6 words, language, class band, board, date, family hash (HMAC of family id with a server secret, not the raw id). Scrub: names (via closed-list heuristic + capitalized tokens), digits, phones, emails, URLs. No images, no full text. Raw `other` phrases deleted after 30 days by the nightly job. A phrase is shown in any report only if >= K (default 20) distinct families used it. If I find more must be stored, I stop and ask.

## 3. Engine (nightly)

- Runs as `POST /api/cron/chips-nightly` with the existing `cronAuthorized` + `X-Cron-Token` pattern, triggered by one new Cloud Scheduler job (free tier covers 3 jobs/account; existing jobs counted before adding). No new paid service.
- Per segment (language x class band x board): tap-through = taps / impressions per chip; hierarchical backoff segment -> language -> global when < N (30) families. Seed prior = pseudo-observations, weight w0 / (1 + real_families / N), so it decays as real data arrives.
- Output: one `chip_publish` row per segment holding order, <= 2 extras, label variants. Published at most once per 7 days (job refuses otherwise); `/api/chips` serves the last published row; within a session the client freezes the layout.
- Label wording: variant chosen by tap-through with ~10% exploration; demotion when tap-through drops below a floor relative to the segment median for 2 consecutive evaluations. Every promotion/demotion logged to `chip_changes`.
- Core 4 never removed (only reordered / relabelled). Extras only for intents mapped in the registry.

## 4. Safety

- Kill switch: env `CHIPS_ADAPTIVE=0` (and admin toggle row) -> `/api/chips` returns the fixed 4 instantly.
- Candidate labels only from the closed vocabulary in config + a profanity check at config load (tests fail the build on a bad label).
- No changes to auth, payments, pricing, Bonding Report (nothing sent to it).

## 5. Demand report (admin only)

`GET /api/admin/chips-demand` behind the existing admin auth (note: the backlog already flags `?token=` in the URL; I reuse the same check and add no new auth, and will not make that worse — the view will accept the header as well if the existing check does). Top `other`/unsupported intents with the K rule. Backlog signal only; never feeds chips.

## 6. Optional external signal (no-op without credentials)

`server/chips/search-console.js`: Google Search Console API + Bing Webmaster API behind env flags (`GSC_SERVICE_ACCOUNT_JSON` secret ref, `GSC_SITE_URL`, `BING_WEBMASTER_API_KEY`); unset -> skipped silently. Top queries shown in the same admin view as an SEO signal, never chips. Manual step for you: add the service account email as a user on the tutp.online Search Console property.

## New tables (migration `029_adaptive_chips.sql`, you run it in the Supabase SQL Editor; code tolerates absence)

`chip_intent_events` (day, family_hash, intent_id, phrase nullable, language, class_band, board), `chip_phrase_cache` (normalized phrase -> intent_id), `chip_publish` (segment, published_at, payload jsonb), `chip_changes` (log). Code falls back to the fixed 4 chips if any is missing.

## Files touched

New: `server/chips/{config.js,chips-seed.json,intent.js,engine.js,search-console.js}`, `server/routes/chips.js`, `public/app/shared/chips.js`, `public/css/chips.css`, `supabase/migrations/029_adaptive_chips.sql`, `tests/e2e/chips.spec.js`, `tests/unit/chips-*.test.js` (pure aggregation logic, no browser, no model).
Edited: `server.js` (mount routes + cron), chooser markup in the 4 `index.html` pages (render via `chips.js`), `homework-modal.js` (fire intent log), `tests/e2e/run.js` (register spec), `.dockerignore` check.

## Test list

Unit (pure, synthetic fixtures): classifier en/te/hi/transliterated; K-anonymity (K-1 families hidden, K shown); backoff at N-1 families; tap-through vs raw count (high-count low-rate chip loses); weekly cadence (second publish within 7 days refused); seed prior decays; scrub removes names/digits/phones/emails; no raw text in logs/reports (grep of captured output); unsupported intent never becomes a chip.
E2E (preview, replay mode): in-session position stability (data changes mid-session, layout unchanged); kill switch returns fixed 4; core 4 always present; a11y unchanged (chips keep role/label, tab order, axe check on the chooser); Lighthouse mobile before/after on the parent page (budget: no regression in performance/a11y score; `chips.js` < 4 KB gz, single fetch).
Done = e2e twice in a row on the no-traffic preview.

## Cost

Aggregation: zero model calls. Classifier: rules first; model only for unknown phrases, cached, haiku-4-5 at effort low (~$0.0002 per unknown phrase, rough estimate, to be measured via `model.call` rows). Nightly job: one Cloud Run request/day. Estimated well under $1/month at current traffic.

## Decisions I need

1. Where is the search-box task (or approve step 0 as part of this)?
2. OK to branch from `main` in a separate worktree, leaving round 4 untouched?
3. Seed file: send the interview findings, or ship a placeholder seed now and update later?
