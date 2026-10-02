-- 028: exam prep notes on a reviewed answer cache (round 4,
-- docs/specs/round-4-exam-prep-pilot.md). Run once in the Supabase SQL
-- editor, same as 001-027. Safe to run twice.
--
-- answer_cache: one row per version of a note. A note = one mode of one
-- chapter in one language for one board, named by `key` (sha-256 of mode,
-- board, class, chapter, language, prompt_version, kg_version, plus 'test'
-- for e2e test notes). Parents are served only the one `approved` version
-- of a key; the partial unique index below keeps it to one.
--   status: generating -> needs_review (always, pilot) -> approved by the
--   founder; needs_fix (hidden while a fix is written), rejected,
--   superseded (an older version), failed (the model gave no usable reply).
-- answer_cache_decisions: every Approve / Needs fix / Reject, with the
-- statuses before and after, so the admin page can undo the latest one.
-- Nothing in either table is ever deleted.
create table if not exists answer_cache (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  mode text not null,
  board text not null,
  class integer not null,
  chapter text not null,
  language text not null,
  prompt_version text not null,
  kg_version text not null,
  version integer not null,
  content jsonb,
  status text not null check (status in ('generating', 'needs_review', 'approved', 'needs_fix', 'rejected', 'superseded', 'failed')),
  model text,
  usd numeric(10, 6) not null default 0,
  checks jsonb,
  fix_of uuid references answer_cache(id),
  fix_reason text,
  -- Who approved it: 'ai' (every gate passed, Haiku wrote it) or 'founder'.
  -- Never sent to parents. Null until approved.
  reviewed_by text check (reviewed_by in ('ai', 'founder')),
  -- A teacher's review of an AI-approved note (round 6 screen; the queue is
  -- every ai-approved row where this is null).
  teacher_reviewed_at timestamptz,
  teacher_reviewed_by uuid references teachers(id),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);
create unique index if not exists answer_cache_one_approved on answer_cache(key) where status = 'approved';
create index if not exists idx_answer_cache_status on answer_cache(status);

create table if not exists answer_cache_decisions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version_id uuid not null references answer_cache(id),
  action text not null check (action in ('approve', 'needs_fix', 'reject', 'keep')),
  -- 'ai' for an automatic approval, otherwise 'founder'.
  decided_by text not null default 'founder' check (decided_by in ('ai', 'founder')),
  -- keep: the version's reviewed_by before, so undo can put it back.
  reviewed_by_before text,
  reason text,
  hide boolean not null default false,
  status_before text not null,
  status_after text not null,
  -- approve: the version it replaced; needs_fix: the new version written.
  other_version_id uuid references answer_cache(id),
  other_status_before text,
  other_status_after text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists idx_answer_cache_decisions_key on answer_cache_decisions(key, created_at desc);

-- "Report a mistake" from a parent: one open report per child per version.
-- The note keeps being served; the founder's list shows the version until
-- the reports are closed (a Keep decision, or the version is replaced).
create table if not exists answer_cache_reports (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references answer_cache(id),
  key text not null,
  family_id integer,
  student_id uuid,
  message text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- the Keep decision that closed it (undo re-opens what it closed)
  resolved_by_decision uuid references answer_cache_decisions(id)
);
create unique index if not exists answer_cache_one_open_report on answer_cache_reports(version_id, student_id) where resolved_at is null;
create index if not exists idx_answer_cache_reports_key on answer_cache_reports(key);

-- Server-only tables: RLS on with no policies, so only the service role
-- (the Cloud Run server) can read or write them.
alter table answer_cache enable row level security;
alter table answer_cache_decisions enable row level security;
alter table answer_cache_reports enable row level security;

-- The e2e test family's Class 5 / Telangana change is test data, not
-- schema: supabase/test-data/028_family16_class5.sql.
