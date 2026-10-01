-- Search box mode chips: impressions, taps and submitted instructions
-- (search-box-v2). One row per event. The adaptive-chips engine (deferred)
-- reads this to compute tap-through = taps / impressions per chip.
--
-- Privacy: no images, no full text, no raw family id (family_hash is an HMAC),
-- no child name. `phrase` is a scrubbed phrase of at most 6 words and is only
-- set when intent = 'other'; the server clears it after 30 days (it runs the
-- clearing statement below at most once an hour on insert). Optional extra,
-- if pg_cron is enabled in Supabase:
--   select cron.schedule('clear-chip-phrases', '17 3 * * *',
--     $$update search_chip_events set phrase = null
--       where phrase is not null and created_at < now() - interval '30 days'$$);
--
-- Run in Supabase Dashboard -> SQL Editor. The app tolerates this table being
-- absent (chip logging pauses, nothing else changes). Numbered 030: 027 is the
-- last on main, 028 is round 4, 029 is reserved for the adaptive-chips engine.

create table if not exists search_chip_events (
  id bigserial primary key,
  kind text not null check (kind in ('impression', 'tap', 'submit')),
  chip_id text check (chip_id in ('answer', 'explain', 'notes', 'exam_prep')),
  intent text check (intent in ('answer', 'explain', 'notes', 'exam_prep', 'quiz', 'other', 'none')),
  language text not null,
  class_band text not null,
  board text not null,
  event_date date not null,
  family_hash text not null,
  phrase text check (phrase is null or intent = 'other'),
  created_at timestamptz not null default now()
);
create index if not exists idx_search_chip_events_date on search_chip_events(event_date, kind, chip_id);
create index if not exists idx_search_chip_events_family on search_chip_events(family_hash, event_date);
create index if not exists idx_search_chip_events_phrase on search_chip_events(created_at) where phrase is not null;

-- Server-only table: the service-role key bypasses RLS; no policy means the
-- browser (anon key) can read and write nothing.
alter table search_chip_events enable row level security;
