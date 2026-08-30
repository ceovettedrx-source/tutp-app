-- Run in the Supabase SQL editor, same as 001-004.
--
-- Lightweight school lookup for autocomplete — NOT a relational schools
-- table (nothing references its id via a foreign key). teachers/students
-- keep plain-text school_name/area columns, and matching between them
-- stays text-based (ilike equality), same as before. This table exists
-- only so a school name + area converges to the same values instead of
-- fragmenting across independently free-typed entries, via a
-- <datalist>-backed "pick or add new" input on the registration forms.
--
-- (name, area) is the compound key, not name alone — school chains
-- (Sri Chaitanya, Narayana, etc.) commonly have multiple branches across
-- different Hyderabad localities, and area is what disambiguates them.
--
-- name_key is app-computed (trim+lowercase of name) rather than a
-- Postgres expression index, since upserting against a plain unique
-- constraint from supabase-js is simpler than an expression-based one.
create table if not exists school_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null,
  area text not null,
  created_at timestamptz not null default now(),
  unique (name_key, area)
);

create index if not exists idx_school_directory_name_key on school_directory(name_key);

-- Additive — existing teachers/students rows get NULL, unaffected.
alter table teachers add column if not exists area text;
alter table teachers add column if not exists address text;
alter table students add column if not exists area text;
alter table students add column if not exists address text;
