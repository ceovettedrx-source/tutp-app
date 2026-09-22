-- Run in the Supabase SQL editor, same as 001-020.
-- Parent-to-parent referral links — the analog to 007_referrals.sql's
-- teacher referral_codes/referral_conversions, kept in their own tables
-- rather than reusing those: referral_codes.teacher_id is NOT NULL + UNIQUE
-- (one code per teacher) and referral_conversions carries teacher-payout-
-- only columns (share_percentage, teacher_share, payout_status) that don't
-- apply to a family referrer. No payout/amount columns here — Phase 1 is
-- tracking + the "Immediate Gratitude Loop" referral count only.

create table if not exists family_referral_codes (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null unique references family_registrations(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists family_referral_conversions (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references family_referral_codes(id) on delete cascade,
  referring_family_id bigint not null references family_registrations(id) on delete cascade,
  new_family_id bigint not null references family_registrations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (new_family_id)
);

create index if not exists idx_family_referral_conversions_referring on family_referral_conversions(referring_family_id);
