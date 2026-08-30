-- Run in the Supabase SQL editor, same as 001-005.

create table if not exists homework (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  grade text not null,
  section text,
  subject text,
  title text not null,
  description text,
  attachment_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_homework_teacher_id on homework(teacher_id);
create index if not exists idx_homework_grade_section on homework(grade, section);

-- One row per student who has interacted with a homework item. A missing
-- row means "pending" — same convention as member_visibility_rules
-- (absence of a row means the default state).
create table if not exists homework_status (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references homework(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  is_done boolean not null default false,
  marked_done_at timestamptz,
  unique (homework_id, student_id)
);

create index if not exists idx_homework_status_homework_id on homework_status(homework_id);
create index if not exists idx_homework_status_student_id on homework_status(student_id);

-- Idempotency guard for the once-daily evening alert digest — a unique
-- violation here means "already sent today," not an error.
create table if not exists homework_alerts_sent (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  sent_date date not null,
  created_at timestamptz not null default now(),
  unique (family_id, sent_date)
);
