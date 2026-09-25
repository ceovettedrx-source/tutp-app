-- Run in the Supabase SQL editor, same as 001-022.
-- (023 is reserved for emotional_checkins — PES V1.5, TUTP-4 §3 — not yet
-- written; this baseline survey is separate from that per-session check-in.)
--
-- One-time onboarding "Bonding baseline" survey — the 5-page storybook popup
-- (public/js/baseline-survey.js): homework days per week, how the parent
-- helps, which activities the family already does together, how often they
-- eat together, and days on a trip with the child in the last year. One row
-- per viewer per family; viewer_key follows bonding_scores' convention
-- ('mother', 'father', or a family_members.id stored as text). A viewer can
-- revise their answer later, so the API upserts on (family_id, viewer_key)
-- and bumps updated_at.
--
-- Collect-only for now (TUTP-4 §3.1 option 1): nothing reads this into the
-- bonding_scores cron. It's the data foundation for when the PIS weighting
-- (option 2 or 3) is decided. The allowed values below must match the
-- BASELINE_* lists in server.js.
create table if not exists parent_involvement_baseline (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  viewer_key text not null,
  homework_days smallint not null check (homework_days between 0 and 7),
  support_style text not null check (support_style in
    ('explains_until_understood', 'guides_questions', 'checks_only', 'sits_through')),
  -- Empty array = "none of these yet", a valid answer.
  activities text[] not null default '{}' check (activities <@ array
    ['meals', 'game_night', 'story_time', 'outdoor', 'chores', 'celebrations']::text[]),
  meal_frequency text not null check (meal_frequency in
    ('every_day', 'most_days', 'occasionally', 'rarely')),
  trip_days_bucket text not null check (trip_days_bucket in
    ('none', '1_5', '6_15', '16_30', '30_plus')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, viewer_key)
);
