-- Run in the Supabase SQL editor, same as 001-012.
-- Play-Based Learning multiplayer game engine. Replaces the old client-only
-- implementation (single AI call, no persistence, no timer, correct answers
-- sent to the browser before the question was answered).
--
-- Players are heterogeneous: mother/father have no row anywhere (same
-- problem bonding_scores.viewer_key already solved), extended family have a
-- family_members row, children have a students row. game_players stores a
-- snapshot (player_type/player_ref_id/player_name) rather than a live join,
-- same reasoning homework_status snapshots status instead of joining live.

create table if not exists game_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  subject text,
  language text not null,
  player_count smallint not null check (player_count between 2 and 4),
  time_limit_seconds smallint not null check (time_limit_seconds in (30, 45, 60)),
  questions_per_player smallint check (questions_per_player between 3 and 15),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  winning_game_player_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_duration_seconds int
);

create index if not exists idx_game_sessions_family_id on game_sessions(family_id);
create index if not exists idx_game_sessions_status_completed on game_sessions(status, completed_at);

create table if not exists game_players (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references game_sessions(id) on delete cascade,
  turn_order smallint not null check (turn_order between 1 and 4),
  player_type text not null check (player_type in ('mother', 'father', 'family_member', 'student')),
  player_ref_id uuid,
  player_name text not null,
  total_score int not null default 0,
  correct_count smallint not null default 0,
  unique (game_session_id, turn_order)
);

create index if not exists idx_game_players_session_id on game_players(game_session_id);

alter table game_sessions
  add constraint fk_game_sessions_winner foreign key (winning_game_player_id)
  references game_players(id) on delete set null;

-- cognitive_category mirrors Quiz's existing vocabulary exactly
-- (HW_QUIZ_CATEGORY_LABELS in the parent pages) for a consistent Panchpadi
-- mapping across features. Populated at generation time but never sent to
-- the client until the post-game recap — never during timed play, per the
-- founder's explicit call not to slow down turn-based pacing with labels.
create table if not exists game_questions (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references game_sessions(id) on delete cascade,
  game_player_id uuid not null references game_players(id) on delete cascade,
  question_index smallint not null,
  question_text text not null,
  options jsonb not null,
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text not null,
  cognitive_category text check (cognitive_category in ('logical_reasoning', 'understanding', 'application', 'skill_based')),
  points_possible smallint not null default 10,
  selected_index smallint,
  is_correct boolean,
  answer_time_seconds smallint,
  answered_at timestamptz,
  unique (game_player_id, question_index)
);

create index if not exists idx_game_questions_session_id on game_questions(game_session_id);

-- One row per calendar day: the fastest-completing game app-wide that day.
-- Upserted on every game completion (replaced only if the new game is
-- faster) rather than computed by a cron, so it's always correct in real
-- time with no CRON_TOKEN job needed. Admin-only for now — see
-- GET /api/game-changer-of-the-day in server.js; no public banner yet,
-- per the founder's 2026-09-09 call (cross-family child-name exposure needs
-- its own opt-in/privacy discussion post-launch).
create table if not exists daily_game_badges (
  id uuid primary key default gen_random_uuid(),
  badge_date date not null,
  badge_type text not null default 'game_changer_of_the_day',
  game_session_id uuid not null references game_sessions(id) on delete cascade,
  winning_game_player_id uuid not null references game_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (badge_date, badge_type)
);
