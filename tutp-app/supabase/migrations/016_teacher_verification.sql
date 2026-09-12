-- Run in the Supabase SQL editor, same as 001-015. Not auto-applied.
--
-- Phase 1 of the Teacher Dashboard feature: schema only. This is a
-- separate, parallel system from the existing teachers/teacher_class_sections
-- tables (migration 004) — those are private tutors matched to homework by
-- geography; this is government/school class-teacher verification, matched
-- to a family's own students via explicit parent consent
-- (students.share_homework_status_with_teacher below).
--
-- govt_teacher_reference is the future matching source for govt_data_match_status
-- on teacher_registrations. It stays EMPTY here — no seed/import data, since
-- none is verified official yet. Verification-signal logic (how a
-- registration actually gets scored/approved) is explicitly out of scope for
-- this phase.

create table if not exists govt_teacher_reference (
  reference_id text primary key,
  school_type text not null,          -- 'government' | 'private'
  employment_type text,               -- 'permanent' | 'aided' | 'contract' | 'outsourcing' | 'daily_basis' | null
  teacher_name text not null,
  school_name text not null,
  school_udise_code text,
  mandal_name text,
  designation_raw text,
  employee_id text,
  cell_number_hash text,
  source_document text,
  source_dataset_type text,
  source_district text,
  imported_at bigint,
  raw_row_reference integer
);

create index if not exists idx_govt_ref_lookup on govt_teacher_reference(school_type, teacher_name, school_name);

create table if not exists teacher_registrations (
  registration_id text primary key,
  full_name text not null,
  phone text not null,
  school_type text not null,          -- 'government' | 'private'
  employment_type text,               -- required only if school_type='government'
  school_name text not null,
  school_udise_code text,
  school_address text,
  principal_name text,
  class_grade text not null,
  section text not null,
  subject text not null,
  employee_id_optional text,
  id_card_photo_url text,
  govt_data_match_status text default 'pending',      -- matched|partial|no_match|cold_start
  peer_vouch_teacher_id text references teacher_registrations(registration_id),
  peer_vouch_status text default 'not_applicable',    -- pending|approved|rejected|not_applicable
  parent_name_match_status text default 'no_data_yet',-- matched|mismatch|no_data_yet
  overall_status text default 'submitted',            -- submitted|under_manual_review|approved|rejected
  rejected_reason text,
  reviewed_by text,
  reviewed_at bigint,
  created_at bigint default extract(epoch from now()),
  updated_at bigint
);

create table if not exists verification_events (
  event_id text primary key,
  registration_id text not null references teacher_registrations(registration_id),
  signal_type text not null,   -- govt_data|id_card|peer_vouch|parent_name_match|manual_review
  result text not null,
  notes text,
  created_at bigint default extract(epoch from now())
);

create table if not exists teacher_student_links (
  link_id text primary key,
  registration_id text not null references teacher_registrations(registration_id),
  student_id text not null,
  linked_at bigint default extract(epoch from now()),
  unique(registration_id, student_id)
);

alter table students add column if not exists class_teacher_name text;
alter table students add column if not exists share_homework_status_with_teacher boolean default false;
