-- Run in the Supabase SQL editor, same as 001-035.
-- TUT-66 Watch & Learn (docs/specs/tut-66-watch-learn.md).
-- CREATE-only: two new tables, nothing existing is altered. Row-level security is ON for both and
-- there are NO policies, so the anon and authenticated roles can read and write nothing; only the
-- server's service-role key (which bypasses RLS) can reach them.

-- The picked and ordered YouTube candidates of one lesson (board, class, subject, lesson, language).
-- A hit means zero YouTube API calls.
create table if not exists watch_learn_cache (
  cache_key text primary key,
  board text,
  cls text,
  subject text,
  lesson_norm text not null,
  lang text not null,
  videos jsonb not null,
  created_at timestamptz not null default now()
);

-- "Not right for this lesson": hides that video for that lesson for everyone.
-- Delete the row to bring a video back.
create table if not exists watch_learn_reports (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  video_id text not null,
  student_id uuid,
  family_id uuid,
  created_at timestamptz not null default now(),
  unique (cache_key, video_id)
);
create index if not exists watch_learn_reports_key_idx on watch_learn_reports (cache_key);

-- Service-role access only: RLS on, no policies.
alter table watch_learn_cache enable row level security;
alter table watch_learn_reports enable row level security;
