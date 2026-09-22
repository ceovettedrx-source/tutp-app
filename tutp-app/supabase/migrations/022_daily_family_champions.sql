-- Run in the Supabase SQL editor, same as 001-021.
-- "Today's Champion" — family-scoped equivalent of daily_game_badges'
-- app-wide "Game Changer of the Day" (013_game_engine.sql). Built instead
-- of extending that table because it's a deliberately different exposure
-- shape: one row per (family, day), ranked by score strictly within that
-- family's own games, never compared against or naming any other family's
-- child. This sidesteps the cross-family child-name exposure question the
-- founder explicitly deferred on 2026-09-09 (see 013_game_engine.sql's
-- comment) rather than reopening it — nothing here is admin-only or
-- gated, it's shown directly to the family that earned it.
create table if not exists daily_family_champions (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  champion_date date not null,
  game_session_id uuid not null references game_sessions(id) on delete cascade,
  winning_game_player_id uuid not null references game_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (family_id, champion_date)
);

create index if not exists idx_daily_family_champions_family_date on daily_family_champions(family_id, champion_date);
