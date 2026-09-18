create table if not exists tutors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  photo_url text,
  category text not null check (category in ('online', 'area_wise', 'home_tuition')),
  subjects text[] not null default '{}',
  experience_years int,
  fee_display text,
  area text,
  bio text,
  phone text not null,  -- real number, NEVER exposed to client directly, only via masked-call layer (Phase 2) or founder-manual-connect (Phase 1)
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  verified_by text,  -- founder's note on how verification was done (manual check for Phase 1)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_tutors_category_active on tutors(category, is_active);

create table if not exists tutor_contact_requests (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  tutor_id uuid not null references tutors(id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  status text not null default 'created' check (status in ('created', 'paid', 'connected', 'refunded', 'failed')),
  -- 'connected': founder manually confirmed parent+tutor were put in touch (Phase 1's
  -- substitute for real-time masked calling). 'refunded': auto-refund fired because
  -- connection didn't happen within the SLA window.
  connected_at timestamptz,
  refund_deadline timestamptz,  -- set to created_at + 24h on payment capture; a cron job checks this
  created_at timestamptz not null default now()
);
create index if not exists idx_tutor_contact_family on tutor_contact_requests(family_id);
create index if not exists idx_tutor_contact_refund_check on tutor_contact_requests(status, refund_deadline);
