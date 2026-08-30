-- Run in the Supabase SQL editor, same as 001/002/003.
-- Teachers are a standalone entity (not linked to family_registrations),
-- so ids are uuid throughout — no bigint FK constraint needed here.

create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  subjects text[] not null default '{}',
  school_name text,
  is_approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_teachers_phone on teachers(phone);

-- One row per grade+section a teacher teaches. section is nullable since a
-- teacher may teach an entire grade without one specific section in mind.
create table if not exists teacher_class_sections (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  grade text not null,
  section text,
  created_at timestamptz not null default now()
);

create index if not exists idx_teacher_class_sections_teacher_id on teacher_class_sections(teacher_id);
