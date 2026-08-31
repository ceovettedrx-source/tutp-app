-- Run in the Supabase SQL editor, same as 001-009.
--
-- Phase: subscription tiers (Free/Pro/UltraPro/Max) + Razorpay recurring
-- billing. Subscription state gets its own table rather than columns on
-- family_registrations (which has no CREATE TABLE anywhere in this repo's
-- migration history — it predates it) or JSONB fields on that blob: this
-- state is written repeatedly by webhooks for the life of the family's
-- subscription, a completely different write pattern than the write-once
-- registration blob, and webhook handlers need to look families up
-- reliably by razorpay_subscription_id — exactly the kind of field that
-- needs to be a real, indexed column, not buried in JSON.
create table if not exists family_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null unique references family_registrations(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'pro', 'ultrapro', 'max')),
  status text not null default 'active' check (status in ('active', 'pending_payment', 'past_due', 'cancelled')),
  razorpay_customer_id text,
  razorpay_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_family_subscriptions_razorpay_subscription_id on family_subscriptions(razorpay_subscription_id);

-- referral_conversions previously had unique(family_id) — one row per
-- family, ever, made sense when a "conversion" was just "registered via my
-- link" (Phase 3.5, no payments yet). Under recurring billing, a referred
-- family now generates one 'paid' row per monthly charge for as long as
-- they stay subscribed (25% teacher share on the first charge, 10% on
-- every renewal after — see server.js's handleSubscriptionCharged), so
-- that constraint has to go. The original registration-time 'signup' row
-- (amount=0) is untouched and still what establishes "this family was
-- referred by this teacher" — handleSubscriptionCharged looks it up to
-- find who to credit.
alter table referral_conversions drop constraint if exists referral_conversions_family_id_key;

-- razorpay_payment_id is the real idempotency guard: Razorpay's webhook
-- delivery is at-least-once, so the same subscription.charged event can
-- arrive more than once. It's unique and nullable — the 'signup' row (no
-- real payment) and any pre-existing rows stay NULL here, which Postgres
-- allows any number of under a unique constraint; only real charges, which
-- always have a real payment id, are protected against double-processing.
alter table referral_conversions add column if not exists razorpay_subscription_id text;
alter table referral_conversions add column if not exists razorpay_payment_id text;
alter table referral_conversions add constraint referral_conversions_razorpay_payment_id_key unique (razorpay_payment_id);
