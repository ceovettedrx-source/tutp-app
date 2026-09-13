-- Run in the Supabase SQL editor, same as 001-016.
--
-- Phase: link a payments row to the specific child the paid tier applies
-- to. Today (012_payments.sql) payments only carries family_id — a family
-- with 2+ children in `students` and a captured payment has no way to say
-- which child's plan that payment was for, since /api/register's checkout
-- is one order per family submission regardless of how many children are
-- on it. This column is additive scaffolding for fixing that; nothing
-- populates it yet.
--
-- Nullable: every existing payments row (and any new one until the
-- checkout/registration flow is updated to collect a per-child selection)
-- has no student to attach to. on delete cascade matches family_id's FK
-- above and students.family_id's FK in 001_student_progress.sql — if the
-- child row is removed, the payment record shouldn't be left dangling.
alter table payments add column if not exists student_id uuid references students(id) on delete cascade;

create index if not exists idx_payments_student_id on payments(student_id);
