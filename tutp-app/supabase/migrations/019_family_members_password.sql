-- Run in the Supabase SQL editor, same as prior migrations in this
-- directory (no CLI/migration runner set up in this project).

alter table family_members add column if not exists password_hash text;
