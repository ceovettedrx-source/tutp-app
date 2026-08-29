-- No Supabase CLI / migration runner is set up in this project (the
-- existing waitlist / demo_usage / family_registrations tables were all
-- created by hand in the Supabase SQL editor). Run this file there too:
-- Supabase Dashboard -> SQL Editor -> paste -> Run.
--
-- Confirmed in the Supabase dashboard: family_registrations.id is `bigint`
-- (int8), not uuid — so students.family_id (the FK to it) is bigint below.
-- students.id and student_progress.id/student_id stay uuid.

-- Students: one row per child, decoupled from the family_registrations
-- onboarding-form blob so it can be safely referenced by other tables.
-- school_name/class/section/roll_number exist mainly so /api/resolve-student
-- can disambiguate two children with similar names within the same family.
-- No uniqueness constraint on name — same/similar names within one family
-- is exactly the case that disambiguation exists to handle.
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  name text not null,
  school_name text,
  class text,
  section text,
  roll_number text,
  created_at timestamptz not null default now()
);

create index if not exists idx_students_family_id on students(family_id);

-- Student progress: one record per student-subject combination.
create table if not exists student_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  subject text not null,
  level text not null default 'learner' check (level in ('beginner','learner','master')),
  logical_understanding int not null default 50 check (logical_understanding between 0 and 100),
  subject_understanding int not null default 50 check (subject_understanding between 0 and 100),
  memory_capacity int not null default 50 check (memory_capacity between 0 and 100),
  learning_skill int not null default 50 check (learning_skill between 0 and 100),
  consistency_engagement int not null default 50 check (consistency_engagement between 0 and 100),
  response_time_pattern int not null default 50 check (response_time_pattern between 0 and 100),
  error_pattern_type int not null default 50 check (error_pattern_type between 0 and 100),
  retention_rate int not null default 50 check (retention_rate between 0 and 100),
  help_seeking_frequency int not null default 50 check (help_seeking_frequency between 0 and 100),
  cognitive_load_signal int not null default 50 check (cognitive_load_signal between 0 and 100),
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (student_id, subject)
);

create index if not exists idx_student_progress_student_id on student_progress(student_id);
