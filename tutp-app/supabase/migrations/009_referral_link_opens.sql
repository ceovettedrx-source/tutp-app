-- Run in the Supabase SQL editor, same as 001-008.
--
-- Referrals so far only tracked conversions (referral_conversions) — there
-- was no way to distinguish "link opened but never registered" from "never
-- opened", so the dashboard's "Total referred" and "Converted" tiles showed
-- the same number. This adds lightweight link-open tracking: one row per
-- hit on /r/:code, no personal data (we don't know who they are until they
-- register — that's what referral_conversions.family_id is for).
create table if not exists referral_link_opens (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references referral_codes(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  opened_at timestamptz not null default now()
);

create index if not exists idx_referral_link_opens_teacher_id on referral_link_opens(teacher_id);
