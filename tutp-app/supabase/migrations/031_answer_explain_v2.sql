-- 031: Answer Please / Explain Please v2 (docs/specs/answer-explain-v2.md).
-- Run once in the Supabase SQL editor. Self-contained: needs no other
-- migration from 029 on, only the tables that exist since 001-018
-- (usage_events is not touched), so it can be run in any order. Safe to run
-- twice.
--
-- explain_cache: one row per concept and explain-in language. The full
-- Explain payload (what a paid family gets) is kept here; the server strips
-- the paid-only fields before a free family is answered.
-- illustrations: one row per concept_key (shared across questions and
-- families). status: pending (being made) -> ready | fallback (the SVG
-- template is used). The picture itself is a file in the private storage
-- bucket "illustrations", served only through short-lived signed URLs.
-- Both tables are only ever read and written with the service-role key.
create table if not exists explain_cache (
  id uuid primary key default gen_random_uuid(),
  concept_key text not null,
  language text not null,
  payload jsonb not null,
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (concept_key, language)
);

create table if not exists illustrations (
  id uuid primary key default gen_random_uuid(),
  concept_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready', 'fallback')),
  storage_path text,
  provider text,
  model text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_illustrations_created on illustrations(created_at);

alter table explain_cache enable row level security;
alter table illustrations enable row level security;

-- Private bucket for the pictures (no public access; signed URLs only).
insert into storage.buckets (id, name, public)
values ('illustrations', 'illustrations', false)
on conflict (id) do update set public = false;

-- Make the API see the new tables at once (PostgREST schema cache).
notify pgrst, 'reload schema';
