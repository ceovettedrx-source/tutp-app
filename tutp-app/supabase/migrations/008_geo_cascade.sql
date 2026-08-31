-- Run in the Supabase SQL editor, same as 001-007.
--
-- Replaces the fixed HYDERABAD_AREAS dropdown (teachers.area / students.area)
-- with a State -> District -> Mandal -> Village cascade, so registration
-- isn't hardcoded to ~20 Hyderabad localities. State/District are closed
-- dropdowns (india-geo.js); Mandal/Village are datalist "pick or add new"
-- inputs, same convergence pattern as school_directory/school_name.
--
-- Dual-mode transition, deliberately NOT a backfill: this is a live app with
-- real teacher/student rows already matched via the single `area` column.
-- `area` is left in place, untouched, on both tables — existing rows keep
-- matching each other via `area` exactly as before. Only new registrations
-- (after this ships) populate state/district/mandal/village, and match each
-- other via those columns instead. See server.js's geoMatches() for the
-- runtime logic. `village` is captured but deliberately NOT part of the
-- match key (see server.js comment) — it's the most typo-prone field of the
-- cascade and isn't needed to disambiguate same-named school branches;
-- state/district/mandal alone preserve the same disambiguation granularity
-- the old single `area` dropdown had.
alter table teachers add column if not exists state text;
alter table teachers add column if not exists district text;
alter table teachers add column if not exists mandal text;
alter table teachers add column if not exists village text;

alter table students add column if not exists state text;
alter table students add column if not exists district text;
alter table students add column if not exists mandal text;
alter table students add column if not exists village text;

-- Backs the Mandal <datalist> on both registration forms, scoped by
-- state+district, same "pick or add new" convergence purpose as
-- school_directory. mandal_key is app-computed (trim+lowercase).
create table if not exists mandal_directory (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  district text not null,
  mandal text not null,
  mandal_key text not null,
  created_at timestamptz not null default now(),
  unique (state, district, mandal_key)
);

create index if not exists idx_mandal_directory_state_district on mandal_directory(state, district);

-- Backs the Village <datalist>, scoped by state+district+mandal. Not used
-- for homework matching (see comment above) — informational / future use.
create table if not exists village_directory (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  district text not null,
  mandal text not null,
  village text not null,
  village_key text not null,
  created_at timestamptz not null default now(),
  unique (state, district, mandal, village_key)
);

create index if not exists idx_village_directory_scope on village_directory(state, district, mandal);

-- Additive scoping columns for future (name, state, district, mandal)
-- upserts from the new registration flow. The existing (name_key, area)
-- unique constraint and all existing rows are untouched; Postgres treats
-- NULL as distinct in unique constraints, so old rows (state/district/
-- mandal NULL) and new rows (area NULL) never collide with each other.
alter table school_directory add column if not exists state text;
alter table school_directory add column if not exists district text;
alter table school_directory add column if not exists mandal text;

alter table school_directory add constraint school_directory_name_geo_key
  unique (name_key, state, district, mandal);
