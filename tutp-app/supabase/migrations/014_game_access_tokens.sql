-- Run in the Supabase SQL editor, same as 001-013.
-- Foundation for remote multi-device Play-Based Learning (adult magic-link
-- invite + class-3+ child QR/code join). One shared table backs both flows.
--
-- Tokens are opaque random values (crypto.randomBytes(32) in server.js) —
-- only their SHA-256 hash is ever stored here, never the raw value, so a
-- leaked database row can't be replayed as a working token. This also makes
-- revocation trivial (set revoked_at) without a separate JWT blocklist,
-- which a self-verifying signed token would have needed instead. See the
-- remote-multiplayer-design memory / server.js comments for the full
-- reasoning, including why this shape was chosen over a signed JWT.
--
-- holder_type distinguishes the two flows sharing this table:
--   'family_login'    — an adult's magic-link invite. Single-purpose: lets
--                        the login page resolve which phone number to send
--                        a real Firebase OTP to. Never accepted as API
--                        bearer auth on any /api/game-sessions/* route —
--                        real access after that point is the normal
--                        tutp_session cookie, same as any other login.
--   'game_participant' — a class-3+ child's QR/code join. Accepted as
--                        Authorization: Bearer auth on /api/game-sessions/*
--                        routes, scoped to exactly the one
--                        (game_session_id, game_player_id) seat it names —
--                        nothing broader.

create table if not exists game_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  game_session_id uuid not null references game_sessions(id) on delete cascade,
  game_player_id uuid not null references game_players(id) on delete cascade,
  holder_type text not null check (holder_type in ('family_login', 'game_participant')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_access_tokens_session_id on game_access_tokens(game_session_id);
create index if not exists idx_game_access_tokens_player_id on game_access_tokens(game_player_id);
