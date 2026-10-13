# TUT-45: Max on sale (₹2,500/month per child)

Status: **spec only, nothing built.** Written 2026-10-10 from `server/tier-gate.js`, the billing code in
`server.js` (`PAID_PLANS`, `computePaidUntil`, `getPaidStatusForStudents`, `/api/billing/checkout`,
`/api/billing/status`, `checkFreeLimit`), `public/js/billing.js` and `docs/pricing-tiers-spec.md`.

## 0. What is true in the repo today

- Only Pro is sold: `PAID_PLANS` holds `pro_monthly` (₹500, 30 days) and `pro_annual` (₹5,000, 365 days).
  `payments.tier` already allows `pro | ultrapro | max`; `period_days` is checked to be 30 or 365.
- Access is **tier-blind**: `getPaidStatusForStudents` returns only active / not active, and
  `computePaidUntil` stacks every captured payment of a child into one timeline. A Max payment today
  would behave exactly like a Pro payment.
- `tier-gate.js` gates only the Explain card: free vs. "paid" (any paid child). `checkFreeLimit` is
  free vs. paid. **The per-mode daily limits in `docs/pricing-tiers-spec.md` (Pro 6/2/1 a day, Max
  15/8/5/5/3) are not built.** So a Max child gets the same limits as a Pro child (unlimited) except for
  features that ask for the tier explicitly (Singapore Maths in TUT-43).
- The pricing spec says Max stays "Coming soon · Notify me" until its extras ship: Singapore Math, illustrated
  notes, 2 free tutor contacts a month. Of these only Singapore Maths has a spec (TUT-43).
- Razorpay is used through the Orders API (one payment per period), not recurring plans; the
  `RAZORPAY_PLAN_ID_*` variables belong to an older, unused flow. No Razorpay dashboard change is needed
  for a new plan, only a new `PAID_PLANS` entry.

## 1. Idea framing and market check

Tiering a per-child subscription with a premium tier is standard in Indian EdTech (for example BYJU'S and
Vedantu sell a higher tier with live tutor access; Khan Academy and Duolingo keep one premium tier).
The risk in every such product is a premium tier that buys little. Tut-P's Max is ₹2,500 against Pro's ₹500,
five times the price, so what Max includes at the moment of sale must be real and visible. This spec
therefore makes the **readiness checklist** (section 4) part of the release, not an afterthought. I did
not run a fresh web search for this spec; the comparison above is from general knowledge and should be
treated as unverified until a market check is run at build time.

## 2. Proposed behaviour

1. **New plan:** `max_monthly: { tier: 'max', amountPaise: 250000, periodDays: 30, label: 'Max · ₹2,500/month' }`.
   No annual Max (not in the pricing spec).
2. **`tierForStudent(studentId, now)`** (also needed by TUT-43): walks the child's captured payments in
   capture order exactly like `computePaidUntil`, producing segments `{ tier, start, end }`, and returns
   the tier of the segment containing `now`, or `free`. Renewals extend a segment; a different tier
   bought while another is active starts after it (this is how a **downgrade** takes effect at the
   end of the current period with no refund, resolved question 5).
3. **Upgrade mid-period (resolved question 4):** Pro → Max starts immediately, with the unused value of
   the Pro period deducted. `POST /api/billing/checkout` with `plan: 'max_monthly'` for a child with an
   active lower tier computes `credit = floor(remaining_days x price_paid / period_days)` on the server
   (never from the client), charges `max price - credit` (minimum ₹1 in Razorpay terms; a credit that
   exceeds the price charges the minimum and the remainder is dropped), and inserts the payment with
   `upgrade_of` (the superseded payment id) and `credit_paise`. When the webhook captures it, the
   superseded payment's access ends at the capture time (`superseded_at`), and the Max segment starts
   at once. `tierForStudent` and `computePaidUntil` honour `superseded_at`.
4. **Entitlements are read on the server only.** One table in `server/tier-gate.js`
   (`TIER_FEATURES`) maps tier to features (`singapore_maths: 'unlimited'`, and so on); callers ask
   `tierAllows(tier, feature)`. Nothing is decided in the browser.
5. **Dashboards:** the plan block (`public/js/billing.js`, `/api/billing/status`) lists Max as a buyable
   plan with exactly what is live (section 4), "Upgrade to Max" on a Pro child with the credit shown
   before payment ("Pro days left: 12, credit ₹X, you pay ₹Y"), and the current tier name next to each
   child. `/api/billing/status` gains `tier` per child and `plans` gains `tier` and `buyable`.
6. **Switch:** env `MAX_ON_SALE=1` turns the Max plan on; without it `max_monthly` is refused with 400
   `not_for_sale` and the UI keeps "Coming soon · Notify me". This lets the code ship dark and go live
   with one environment change, in the same traffic move as TUT-43 (TUT-43 decision 2).
7. **Admin:** the existing revenue-by-tier report already groups by `payments.tier`; add Max to the
   label map where it is missing (`TIER_LABELS`, `server.js` ~2047 and the register page's map are
   already there), and exclude test families as today.
8. **Registration page:** unchanged. Max is bought from the dashboard, as an upgrade or a first
   purchase for an existing child; the register page keeps Pro only (less surface, no change to the
   first-purchase path).

## 3. Schema (migration 034, after TUT-43's 033; renumber at merge)

`payments`: `upgrade_of uuid references payments(id)`, `credit_paise integer`, `superseded_at timestamptz`.
All nullable, no data changed. Founder runs it in the Supabase SQL editor; before it exists, the upgrade
path answers 503 `not_ready` and a plain Max purchase (no upgrade) still works.

## 4. Release readiness (Max is not sold with an empty promise)

Max copy lists only what is live in the same release. The checklist the traffic command waits for:
- [ ] Singapore Maths (TUT-43) live and unlimited for a Max child (tested with a TEST payment row).
- [ ] Decision for Vet: **illustrated notes** and **2 free tutor contacts a month** are in the pricing
      spec but not built. Either they are built and tested first, or the Max card does not mention them
      and the price is reconsidered. Selling ₹2,500 for Singapore Maths alone is the largest business
      risk in this spec.
- [ ] Decision for Vet: the **per-mode daily limits** (pricing spec) are unbuilt, so Max and Pro have the same
      limits today. Either that task ships first, or Max copy claims no limit advantage.
- [ ] Refund policy page: pricing spec says it must exist before Annual Pro is sold; Max monthly has the
      same 7-day question, so it should state the Max rule too.

## 5. What can go wrong (risk -> the test that catches it)

| # | Risk | Test |
|---|---|---|
| 1 | A Max payment is treated as Pro (tier-blind timeline) | `tests/unit/tier-for-student.test.js`: Pro only, Max only, Pro then Max, Max then Pro (downgrade), lapse and re-buy, refunded row ignored, boundary at the last millisecond of the IST day |
| 2 | Upgrade credit wrong or exploitable (client sets the price, repeated upgrades) | unit tests of the credit maths with a fixed clock; integration: a forged `amount`, `credit` or `tier` in the body is ignored; two upgrade attempts in a row create one pending order or the second one is refused; credit never exceeds the unused value |
| 3 | Double access after an upgrade (old Pro and new Max both stacked) | unit: after capture, `computePaidUntil` for the child ends at Max's end, not Max's end plus the remaining Pro days |
| 4 | Webhook retried or arriving twice | integration: capturing the same `payment.captured` event twice leaves one captured row and one `superseded_at` |
| 5 | Max sold before it is ready | `MAX_ON_SALE` unset gives 400 `not_for_sale` on checkout and "Coming soon" in `/api/billing/status`; e2e asserts both; set, the plan appears |
| 6 | Downgrade loses days already paid for | unit: Max then Pro purchase gives Max until its end, then Pro; no refund row created |
| 7 | Another family's child upgraded or read | `requireOwnStudent` on checkout (existing) plus a 403 test for a student of a different family on checkout and on status |
| 8 | The UI shows a price different from what Razorpay charges | e2e: the displayed "you pay" equals the server order amount for a Pro child with days left; Razorpay is replaced by a stub at `/api/billing/checkout` (real live-key payments only work on `tutp.online`, see CLAUDE.md) |
| 9 | Max copy over-promises | the readiness checklist above; a test reads the plan text from the API and fails if it mentions a feature missing from `TIER_FEATURES` |
| 10 | Test families pollute revenue and conversion | admin revenue test with the TEST payment row excluded, as for the other tiers |
| 11 | Existing Pro children lose anything | e2e on the existing paid test family (family 16): still paid, same limits, same Explain output after the change |
| 12 | `period_days` check blocks a plan | Max is 30 days, inside the existing check; unit asserts every `PAID_PLANS` entry has 30 or 365 |
| 13 | Real money moves in tests | e2e uses the stub and the TEST payment row (`note = 'TEST'`); no live Razorpay call from a preview |

E2E runs twice in a row on a no-traffic preview (`E2E_REPLAY=1`). No model calls are added.

## 6. Cost

No model cost. Razorpay fee about 2 percent plus GST on the fee: on ₹2,500 about ₹59, against the Max
worst-case model cost in the pricing spec of ₹1,620 a month at ₹1.5 a session (a ceiling, not a forecast).

## Files (when built)
New: `supabase/migrations/034_max_plan.sql`, `tests/unit/tier-for-student.test.js`,
`tests/e2e/max-plan.spec.js`. Changed: `server.js` (`PAID_PLANS`, `tierForStudent`, checkout, status,
webhook capture, `MAX_ON_SALE`), `server/tier-gate.js` (`TIER_FEATURES`, `tierAllows`),
`public/js/billing.js`, `tests/e2e/run.js`, `docs/CHANGES-EXPLAINED.md`.
Depends on: TUT-43 (shares `tierForStudent`; both take traffic together).
