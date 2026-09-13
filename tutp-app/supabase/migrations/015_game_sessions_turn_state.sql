-- Run in the Supabase SQL editor, same as 001-014.
-- Makes turn order server-authoritative, required for remote multi-device
-- Play-Based Learning. Previously "whose turn is it" existed only as local
-- JS variables (playTurnIdx/playLap) in whichever single browser was
-- running the game — fine for pass-and-play on one device, but a second
-- device polling GET /api/game-sessions/:id/state has nothing to read
-- otherwise. POST /api/game-sessions/:id/answer now advances these columns
-- itself, right after grading, instead of the client computing the next
-- turn locally.

alter table game_sessions
  add column if not exists current_turn_order smallint not null default 1,
  add column if not exists current_lap smallint not null default 0;
