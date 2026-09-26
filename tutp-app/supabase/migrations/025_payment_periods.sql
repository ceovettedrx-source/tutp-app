-- Run in the Supabase SQL editor, same as 001-024.
-- (023 is still reserved for emotional_checkins.)
--
-- Billing stopgap: paid access is no longer "any captured payment, forever".
-- Each captured payment now buys a period (30 days for Pro monthly, 365 for
-- Annual Pro), and a child's paid_until is derived from their captured
-- payments in server.js (computePaidUntil), not stored. That keeps refunds
-- and early renewals from ever leaving a stale date behind.
--
-- captured_at: when Razorpay says the payment happened (its own timestamp,
--   not webhook arrival time), so a late webhook can't shift the period.
-- refunded_at + status 'refunded': a refunded payment drops out of the
--   paid_until calculation and grants no access.
-- period_days: how long this payment's access lasts. Existing rows are all
--   Pro monthly (and there are none captured as of 2026-09-26), so the
--   default of 30 is correct for them.
alter table payments add column if not exists captured_at timestamptz;
alter table payments add column if not exists refunded_at timestamptz;
alter table payments add column if not exists period_days integer not null default 30;

alter table payments drop constraint if exists payments_period_days_check;
alter table payments add constraint payments_period_days_check check (period_days in (30, 365));

-- No-op today (zero captured rows), kept so the migration is correct on any copy of the data.
update payments set captured_at = updated_at where status = 'captured' and captured_at is null;

alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('created', 'captured', 'failed', 'refunded'));

create index if not exists idx_payments_student_status on payments(student_id, status);
