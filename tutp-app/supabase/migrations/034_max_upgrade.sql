-- TUT-45: Pro -> Max upgrade with credit for the unused Pro days.
-- upgrade_of     the payment the upgrade replaces (set by /api/billing/checkout)
-- credit_paise   the credit taken off the Max price (server-computed, never from the client)
-- superseded_at  when this payment's access ended because an upgrade was captured;
--                computePaidUntil and tierForStudent stop counting it from then on.
-- All nullable, no data changed. Run in the Supabase SQL editor. Until it exists the
-- upgrade path answers 503 not_ready; a plain purchase still works.
alter table payments add column if not exists upgrade_of uuid references payments(id);
alter table payments add column if not exists credit_paise integer;
alter table payments add column if not exists superseded_at timestamptz;
create index if not exists idx_payments_upgrade_of on payments(upgrade_of) where upgrade_of is not null;
