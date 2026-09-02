-- Run in the Supabase SQL editor, same as 001-010.
--
-- Phase: "Create Material" teacher feature (grade/subject/chapter/state ->
-- Claude-generated lesson_json -> rendered printable HTML). This table is
-- the record of each generated material: the structured JSON (so future
-- edits/regeneration/analytics can work off the shape rather than
-- re-parsing HTML), the path to the rendered HTML on disk/storage, and a
-- verification_status carried over from lesson_json.grounding so ungrounded
-- material can be filtered/flagged without re-opening the JSON blob.
create table if not exists teacher_materials (
  id uuid primary key default gen_random_uuid(),
  teacher_id bigint not null,
  grade text not null,
  subject text not null,
  state text not null,
  material_type text not null check (material_type in ('worksheet', 'question_paper', 'notes')),
  lesson_json jsonb not null,
  rendered_html_path text,
  verification_status text,
  created_at timestamptz not null default now()
);

create index if not exists idx_teacher_materials_teacher_id on teacher_materials(teacher_id);
