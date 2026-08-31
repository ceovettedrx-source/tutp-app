-- Run in the Supabase SQL editor, same as 001-006.
-- Phase 3.5: teacher referral links — tracking only, no automated payout yet.
-- family_id is bigint, matching family_registrations.id (confirmed in 001/002/003).

create table if not exists referral_codes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null unique references teachers(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

-- One row per successful referral conversion. amount/share_percentage/
-- teacher_share exist now even though there's no paid tier yet (every row
-- is conversion_type='signup' with amount=0) so the payout math is ready
-- to go the day a real fee model exists, with no migration needed then.
-- share_percentage/teacher_share are snapshotted at conversion time so a
-- later change to payout percentages never retroactively rewrites past rows.
create table if not exists referral_conversions (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references referral_codes(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  family_id bigint references family_registrations(id) on delete set null,
  conversion_type text not null default 'signup' check (conversion_type in ('signup', 'paid')),
  amount numeric not null default 0,
  share_percentage numeric,
  teacher_share numeric not null default 0,
  payout_status text not null default 'pending' check (payout_status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  unique (family_id)
);

create index if not exists idx_referral_conversions_teacher_id on referral_conversions(teacher_id);
