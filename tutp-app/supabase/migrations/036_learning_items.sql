-- 036: learning_items — per-child server-side library of generated content (TUT-69).
-- family_id is bigint (family_registrations.id), student_id is uuid (students.id).
-- Additive only. RLS on with no policies: service role only.
-- Deliberately no column for who generated the item.

create table if not exists learning_items (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  mode text not null check (mode in ('answer','explain','notes','story','quiz','experiential')),
  subject text,
  topic text,
  lesson_label text,
  title text not null,
  language text,
  payload jsonb not null,
  source_text text,
  content_hash text not null,
  imported boolean default false,
  created_at timestamptz default now(),
  unique (student_id, mode, content_hash)
);

create index if not exists idx_learning_items_student_created on learning_items(student_id, created_at desc);
create index if not exists idx_learning_items_student_subject on learning_items(student_id, subject);

alter table learning_items enable row level security;
