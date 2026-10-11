-- Run in the Supabase SQL editor, same as 001-032.
-- TUT-49 Partner Programme (docs/specs/TUT-49-partner-programme.md).
-- CREATE-only: new tables and indexes, nothing existing is altered. The
-- attribution of a family to a partner lives in partner_attributions, keyed
-- by family_id, not as a column on family_registrations. Row-level security
-- stays off like the other tables (server-only access with the service key).
-- Name, phone, PAN and UPI columns hold AES-256-GCM ciphertext (server/partners/crypto.js);
-- phone_hash is a keyed hash used only to find a partner by phone.

create table if not exists partner_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into partner_settings (key, value) values
  ('commission_pct', '10'),
  ('max_paid_months', '6'),
  ('hold_days', '7'),
  ('min_payout_paise', '20000'),
  ('gst_percent', '18'),
  ('attribution_months', '12'),
  ('claim_days', '7'),
  ('tds_pct', '2'),
  ('pan_required_paise', '2000000'),
  ('milestone_10_paise', '0'),
  ('milestone_25_paise', '0'),
  ('milestone_50_paise', '0'),
  ('terms_version', '"2026-10"')
on conflict (key) do nothing;

create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- /s/<code> school QR
  name_enc text not null,
  admin_partner_id uuid,                     -- the partners row of the school admin (set after signup)
  private_declared_at timestamptz,           -- "private (unaided) school" declaration
  terms_version text,
  terms_accepted_at timestamptz,
  no_compulsion_accepted_at timestamptz,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('tutor', 'school_teacher', 'school')),
  code text not null unique,                 -- /t/<code>
  phone_hash text not null unique,
  phone_enc text not null,
  name_enc text not null,
  school_id uuid references schools(id),
  lang text not null default 'en' check (lang in ('en', 'te', 'hi')),
  consent_at timestamptz,
  pan_enc text,
  upi_enc text,
  upi_holder_name_enc text,
  upi_holder_confirmed_at timestamptz,
  is_test boolean not null default false,    -- Firebase test numbers 99999000xx
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);
create index if not exists idx_partners_school on partners(school_id);

create table if not exists school_invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  teacher_name_enc text not null,
  teacher_whatsapp_enc text not null,
  token_hash text not null unique,
  status text not null default 'invited' check (status in ('invited', 'registered', 'revoked')),
  expires_at timestamptz not null,
  teacher_partner_id uuid references partners(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_school_invites_school on school_invites(school_id);

create table if not exists partner_attributions (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null unique references family_registrations(id) on delete cascade,
  partner_id uuid references partners(id),   -- null for a school-QR family (school only)
  school_id uuid references schools(id),
  source text not null check (source in ('link', 'school_qr', 'code')),
  first_touch_at timestamptz not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (partner_id is not null or school_id is not null)
);
create index if not exists idx_partner_attributions_partner on partner_attributions(partner_id);
create index if not exists idx_partner_attributions_school on partner_attributions(school_id);

create table if not exists partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  period text not null,                      -- 'YYYY-MM' of the payout date (1st of the month)
  amount_paise integer not null,             -- gross, after clawbacks
  tds_paise integer not null default 0,
  status text not null default 'due' check (status in ('due', 'paid', 'blocked_pan')),
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (partner_id, period)
);

create table if not exists partner_commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  beneficiary text not null check (beneficiary in ('partner', 'school')),
  partner_id uuid not null references partners(id),   -- who is paid (school: the school admin's partner row)
  family_id bigint not null references family_registrations(id),
  base_paise integer not null,               -- payment amount excl. GST
  eligible_months numeric not null,
  pct numeric not null,
  amount_paise integer not null,             -- negative on a clawback row
  kind text not null default 'commission' check (kind in ('commission', 'clawback')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'cancelled')),
  approve_after timestamptz not null,
  payout_id uuid references partner_payouts(id),
  created_at timestamptz not null default now(),
  unique (payment_id, beneficiary, kind)
);
create index if not exists idx_partner_commissions_partner_status on partner_commissions(partner_id, status);
create index if not exists idx_partner_commissions_family on partner_commissions(family_id);

create table if not exists partner_milestone_awards (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  threshold integer not null check (threshold in (10, 25, 50)),
  amount_paise integer not null,
  status text not null default 'approved' check (status in ('approved', 'paid')),
  payout_id uuid references partner_payouts(id),
  created_at timestamptz not null default now(),
  unique (partner_id, threshold)
);

create table if not exists partner_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in ('partner_signup', 'school_signup', 'referral_signup', 'referral_paid', 'payout_marked')),
  partner_id uuid references partners(id),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_partner_events_name on partner_events(event_name, created_at);
