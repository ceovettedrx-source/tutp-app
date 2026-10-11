# TUT-49 Partner Programme (spec, treated as approved)

Founder decisions of 2026-10-10/11 are final and override any older Linear line.
Status: this file is written before the build; the build follows it.

## 0. Repo facts this rests on

- Money in: `payments` (migration 012/025/027): `family_id`, `student_id`, `tier`, `amount` (paise), `status` created|captured|failed|refunded, `captured_at`, `refunded_at`, `period_days` 30|365, `note` ('TEST' rows are left out of founder metrics). Razorpay webhook marks rows captured/refunded (`handlePaymentCaptured`, `handlePaymentRefunded`). Nothing in that path is changed.
- Sessions: JWT cookie `tutp_session` carries `{ phone, familyId, teacherId, mids }`; `/api/session` accepts any OTP-verified phone, also one with no family and no teacher. A partner is identified by that verified phone.
- Existing `teachers` + `referral_codes` (migration 007) and `family_referral_codes` (021) stay as they are; the partner programme is separate and uses only new tables.
- Registration is `POST /api/register` (one family row, `family_registrations`). It is the only place an attribution is locked, through one try/catch call that can never fail a registration.
- Admin: `requireAdmin` (cookie or `?token=`). Test families: `family_registrations.data.is_test` (families 16 and 18), left out of admin metrics.
- Migrations are run by hand in the Supabase SQL editor (no database connection from this repo or the build machine). Migration **035** (033/034 are reserved by the TUT-43/TUT-45 specs) only CREATEs new tables and indexes, nothing existing is altered. Attribution lives in the new table `partner_attributions` keyed by `family_id` (founder addendum), never as a column on `family_registrations`.

## 1. Framing and market check (unverified, from general knowledge)

Indian tuition and EdTech companies grow through teacher and tutor referrals and school tie-ups (BYJU'S and Vedantu run affiliate/teacher programmes; PhysicsWallah and Unacademy have creator/partner referral payouts; many schools get a per-student share). Typical rates are 10-20% of a first payment. 10% for six months with a seven-day refund hold is at the cautious end. Not verified online in this run; the founder should treat the figures as a sanity check, not a citation.

Risks that make this a legal and trust topic, not only a feature: paying teachers/schools for enrolling children (school staff pressure on parents), income tax (TDS, PAN), GST on the base, and children's data. The rules below are designed around those.

## 2. Partner types (final)

| Type | Pays | Link |
|---|---|---|
| Independent tutor / tuition centre (`tutor`) | 10% of each actual Pro payment (excl. GST), first 6 paid months per family | own `/t/<CODE>` + QR |
| Private-school teacher (`school_teacher`) | 10% to the teacher **and** 10% to that school's management, both paid directly by Tut-P | own `/t/<CODE>` + QR |
| Private school (`school`, the management) | 10% on families that come through any of its teachers, and on families from the school's own QR (no teacher link) | school QR `/s/<SCHOOLCODE>` |
| Government teacher | nothing: content and tools access only | none |

Government teacher: choosing this type shows exactly one popup (te/en/hi): "Referral income is only for private-school teachers and private tutors. Government teachers can use Tut-P content and tools free." Nothing else: no mention of family members or any workaround, no school name/address collected, no partner row created, no code. The server refuses the type with the same text (`govt_not_eligible`).

Private schools only: the school declares it is private (unaided) when it signs the terms.

## 3. Flows

1. **Public page `/partners`** (footer link + a landing-page section): explains the programme, type picker, phone OTP signup (the existing Firebase phone flow, then `POST /api/session`), then `POST /api/partner/signup`. The partner tab appears in the Teacher Dashboard (`/app/teacher/`, a "Partner programme" tab) and the same panel is at `/app/partner/` for partners who are not teachers.
2. **School flow**: school admin signs up as type `school`, accepts the partner terms (digital accept stored with version and time, private-school declaration, no-compulsion clause: no teacher or school may pressure, require or reward-by-marks any family to buy), adds teachers (name, WhatsApp number), gets one invite link per teacher (`/p/join/<token>`), shares it through their own WhatsApp (`wa.me` link, Tut-P never messages those numbers), the teacher opens it, installs the PWA, consents, registers with OTP and becomes `school_teacher` of that school with their own link and QR. The school admin sees teacher names, status and counts and amounts only.
3. **Partner tools**: link `/t/<CODE>`, printable A4 QR poster (`/api/partner/poster?lang=te|en|hi`), WhatsApp share button with a prewritten message in the chosen language, and a code box at family signup.

## 4. Attribution rules

- `/t/<CODE>` and `/s/<SCHOOLCODE>` set a first-touch marker cookie (`tutp_ref`, 30 days). A later link does not replace an unexpired marker.
- Locked to the family at registration, from the marker (or a code typed in the registration form) into `partner_attributions` (unique per family).
- Manual code after signup: `POST /api/partner/claim-code` from the family session, only within 7 days of the family's registration and only if the family has no attribution yet.
- One family = one attributing partner for 12 months (`expires_at`). Commissions need an unexpired attribution and stop after 6 paid months anyway.
- Partner phone must differ from every parent/member phone of the family (compared by hash); such a claim is refused and stored as nothing.
- A school teacher's family also pays the school (10%); a school-QR family pays the school only.

## 5. Money

- Base per payment = amount excl. GST: `amount / (1 + gst_percent/100)`. Rate comes from env `PARTNER_GST_RATE` (default 18; a `gst_percent` settings row still overrides). Prices are GST-inclusive and read "incl. GST". Rate 18 because the merchant entity holds GSTIN 36ACAFM2312H1ZO (founder decision 2026-10-11).
- Eligible months: a payment buys 1 month (30 days) or 12 months (365 days). Per (partner, family) at most 6 months earn commission; a payment that crosses the cap earns commission on the months left only (annual payment: 6/12 of it).
- Commission rows are created by a **reconcile** step (cron endpoint and on admin/partner views), not by the payment webhook: it reads captured/refunded `payments` of attributed families and writes `partner_commissions`, idempotent on (payment, beneficiary).
- Lifecycle: Pending when the payment is captured; Approved 7 days after capture if the payment is still captured; refunded before approval (or before payout) = Cancelled; refunded after payout = a negative clawback row that is deducted from the next payout.
- Payout on the 1st (IST) of the month for everything Approved, minimum Rs 200 per partner (below: carried forward, shown as such). Phase 1 only: `/admin/partners` payout sheet (name, UPI, amount, TDS line), the founder pays by hand and marks Paid (`payout_marked`). No Razorpay Route/Payouts.
- Payout always to the PAN holder's own UPI: the partner confirms "this UPI belongs to the PAN holder"; the sheet shows the PAN holder name next to the UPI.
- TDS: yearly (1 April-31 March, IST) total per partner kept from paid and due payouts; **PAN required before the cumulative total reaches Rs 20,000** (a payout that would pass it is `blocked_pan` until PAN is on file); the sheet shows a 2% TDS line (**CA to confirm** rate, section and threshold). The amount to transfer shown is amount minus the TDS line.
- Milestone bonus (schema + config only): 10 / 25 / 50 paid joinings (families with at least one Approved commission), amounts in `partner_settings` = 0 until the founder sets them, each awarded once per partner (`partner_milestone_awards`, unique). With amount 0 nothing is awarded or paid.

## 6. Privacy and security

- Partners and schools see counts and amounts only, never parent or child names or phones (the API has no field for them).
- Name, phone, PAN and UPI are encrypted at rest (AES-256-GCM, key in the Secret Manager secret `partner-data-key`, env `PARTNER_DATA_KEY`); phone lookups use a keyed hash (HMAC) so the phone is not stored readable. Only the admin payout/partner views decrypt, and the sheet needs the admin token.
- Invite tokens are random and stored hashed, expire in 14 days, single use.
- Admin-only routes use `requireAdmin`; partner routes require a session whose phone belongs to the partner; school routes require the school's admin partner.
- Rate limits on signup, claim-code and invite open.
- Tracking events (new table `partner_events`, shown in the admin panel): `partner_signup`, `school_signup`, `referral_signup`, `referral_paid`, `payout_marked`.

## 7. Tables (migration 035, create-only)

`partner_settings`, `schools`, `partners`, `school_invites`, `partner_attributions`, `partner_commissions`, `partner_payouts`, `partner_milestone_awards`, `partner_events`. Row-level security stays off like the other tables (server-only access with the service key).

## 8. What can go wrong -> test

| # | What can go wrong | Test |
|---|---|---|
| 1 | A government teacher gets a link or a row, or sees an extra hint | e2e: type `govt_teacher` returns `govt_not_eligible` with the exact popup text, no partner row; page shows only that popup; unit: no school fields stored |
| 2 | Government-teacher text mentions family members or a workaround | e2e: popup text equals the approved string (te/en/hi) exactly |
| 3 | A school that is not private joins | e2e: school signup without the private declaration is 400; terms record version and time |
| 4 | School terms skipped before adding teachers | e2e: add-teacher before accepting terms is 403 |
| 5 | Invite link reused, expired or guessed | e2e: second open after registration is 410; expired token is 410; random token 404; token stored hashed (unit) |
| 6 | Teacher joins a different school than the invite | e2e: registered teacher's school equals the invite's school |
| 7 | Tut-P messages teacher numbers itself | code review + e2e: invite API returns a `wa.me` URL only; no outbound message code exists (grep test in unit) |
| 8 | Link click lost or overwritten | unit: first-touch kept, expired marker replaced, 30 days |
| 9 | Attribution is not locked at registration or breaks registration | e2e: lock via the same function; unit: a throwing store never rejects the registration promise |
| 10 | Code typed late or twice | unit/e2e: claim at day 7 ok, day 8 refused, second claim refused |
| 11 | Partner uses own family (same phone) | unit/e2e: refused (`own_family`), nothing stored |
| 12 | One family counted for two partners | unit: unique per family, second lock returns the first |
| 13 | Commission on GST, wrong rate, wrong cap | unit: Rs 500 payment -> base 42373, 10% = 4237; month cap 6 (monthly) and 6/12 (annual); 7th month = 0 |
| 14 | Commission paid twice for one payment (webhook retry, reconcile twice) | e2e: run reconcile twice, one row per (payment, beneficiary) |
| 15 | School teacher family pays school and teacher correctly | e2e: two rows, partner + school, 10% each; school-QR family pays school only |
| 16 | Paid out before the 7-day hold | e2e: payment now = Pending and not on the sheet; aged 8 days = Approved |
| 17 | Refund before payout still pays | e2e: refund -> Cancelled, not on the sheet |
| 18 | Refund after payout not recovered | e2e: refund after Paid -> negative clawback deducted in the next payout |
| 19 | Payout under Rs 200 lost or paid | e2e: Rs 150 approved carries forward, shows under the threshold, not on the sheet; next month adds up |
| 20 | PAN not collected at Rs 20,000 | unit/e2e: cumulative >= 20000 without PAN -> `blocked_pan`; with PAN -> TDS line 2% |
| 21 | Payout to someone else's UPI | e2e: UPI save requires the holder confirmation and the PAN holder name; sheet shows both |
| 22 | Partner sees parent/child data | e2e: partner and school API bodies contain no name/phone fields (deep key scan) and no phone digits of the test family |
| 23 | PAN/UPI/phone readable in the database or logs | unit: encrypt/decrypt round trip, ciphertext differs per call, tampering fails; no console.log of those fields (grep test) |
| 24 | A partner reads another partner's or school's data | e2e: other partner's id returns 403; school routes with a teacher session 403 |
| 25 | Admin payout sheet open to anyone | e2e: no token 403 |
| 26 | Marking Paid twice or for a wrong amount | e2e: second mark is a no-op (409), amounts come from the stored payout |
| 27 | Milestone bonus pays by accident | unit/e2e: amounts 0 -> no award; set 100 -> awarded once at the 10th joining, not again |
| 28 | Test partners distort real totals | e2e: test partners (99999000xx) excluded from admin totals unless `includeTest=1` |
| 29 | Registration or payments break | the whole existing suite stays green (twice) and the registration hook is wrapped in try/catch |
| 30 | Tracking events missing | e2e: the five event names appear in `partner_events` counts on the admin panel |
| 31 | A missing `PARTNER_DATA_KEY` leaks plaintext | unit: no key -> encryption refuses (no plaintext fallback), routes answer 503 `partners_not_configured` |
| 32 | Migration 035 not applied yet | routes answer 503 `partners_not_ready` instead of 500; e2e partners.spec.js reports it as MISSING MIGRATION and fails |

## 9. Test plan notes

- Pure rules (math, caps, hold, TDS, attribution windows, first-touch, crypto) are unit tests: `tests/unit/partners-core.test.js`, no database.
- `tests/e2e/partners.spec.js` runs against a preview with migration 035 applied and `E2E_REPLAY=1`. Real Firebase test numbers exist only for families 16 and 18, so partner sign-in uses 9999900005 and 9999900002; new families cannot be registered in tests, so attributions and TEST payment rows are seeded by a preview-only route (admin token **and** `E2E_REPLAY=1`, test families and test partners only). The seed route calls the same functions as the real hook.
- No real money moves anywhere; payments seeded for tests carry `note` = 'TEST'.

## 10. Files

New: `supabase/migrations/035_partner_programme.sql`, `server/partners/{config,crypto,core,qr,poster,service,routes}.js`, `server/admin/partners.html`, `public/partners/index.html`, `public/partners/join/index.html`, `public/app/partner/index.html`, `public/app/shared/partner-panel.js`, `tests/unit/partners-core.test.js`, `tests/e2e/partners.spec.js`.
Touched: `server.js` (mount, `/t/`, `/s/`, one registration hook), `public/app/teacher/index.html` (tab), `public/index.html` (footer + section), `package.json` (qrcode-generator), `tracking` docs, `docs/CHANGES-EXPLAINED.md`.

## 11. Needs the founder (cannot be done unattended)

- Run `035_partner_programme.sql` in the Supabase SQL editor (create-only).
- Secret `partner-data-key` is created and mounted by the release; confirm it is OK to keep it.
- CA confirmations: GST on the base, TDS section/rate/threshold, whether partner income needs an invoice.
- A cron job for the daily reconcile (`POST /api/cron/partners` with `X-Cron-Token`), same way as the other schedulers.
- Milestone amounts (all 0 now) and the real WhatsApp/poster wording review in Telugu/Hindi.
