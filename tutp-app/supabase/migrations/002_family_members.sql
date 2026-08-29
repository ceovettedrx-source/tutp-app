-- Run in the Supabase SQL editor, same as 001_student_progress.sql.
-- family_id is bigint, matching family_registrations.id (confirmed there).

create table if not exists family_members (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  name text not null,
  relationship text,
  phone text,
  created_at timestamptz not null default now()
);

create index if not exists idx_family_members_family_id on family_members(family_id);
