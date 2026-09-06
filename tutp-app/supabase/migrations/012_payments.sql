-- Run in the Supabase SQL editor, same as 001-011.
--
-- Phase: one-time Razorpay payments (Orders API) for the paid tiers. This is
-- additive to, not a replacement for, 010_subscriptions.sql's
-- family_subscriptions table — that recurring-billing schema stays in place
-- for future use, it's just not wired up yet. A family currently pays once
-- per checkout (no auto-renewal); family_subscriptions.status for a paid
-- tier is still whatever /api/register set it to ('pending_payment') until
-- a later pass wires payment capture through to it.
--
-- razorpay_order_id is created up front (one row per checkout attempt,
-- status='created'); razorpay_payment_id and status get filled in by the
-- webhook once Razorpay reports payment.captured or payment.failed.
-- razorpay_payment_id is nullable (a 'created' row has no payment yet) but
-- unique once set — Razorpay's webhook delivery is at-least-once, so the
-- same payment.captured event can arrive more than once; re-running the
-- same UPDATE is naturally idempotent.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  tier text not null check (tier in ('pro', 'ultrapro', 'max')),
  amount integer not null, -- paise
  currency text not null default 'INR',
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  status text not null default 'created' check (status in ('created', 'captured', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_family_id on payments(family_id);
create index if not exists idx_payments_razorpay_order_id on payments(razorpay_order_id);
