// Read-only check: did a recent 2-player test game produce a
// daily_family_champions row, and would isTodaysChampion have been true?
// Only issues GET (select) queries — never writes anything.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createRetryFetch } from '../services/supabaseRetryFetch.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot check.');
  process.exit(2);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: createRetryFetch() }
});

const today = new Date().toISOString().slice(0, 10);

const { data: rows, error } = await supabase
  .from('daily_family_champions')
  .select('id, family_id, champion_date, game_session_id, winning_game_player_id, created_at')
  .eq('champion_date', today)
  .order('created_at', { ascending: false })
  .limit(5);

if (error) {
  console.log(`ERROR querying daily_family_champions (${error.code || 'no code'}: ${error.message})`);
  process.exit(3);
}

if (!rows.length) {
  console.log(`NO ROWS for champion_date=${today}. Either the table is empty for today, or the game did not trigger a champion upsert.`);
  process.exit(1);
}

console.log(`Found ${rows.length} row(s) for champion_date=${today}:`);
for (const r of rows) console.log(JSON.stringify(r));

const latest = rows[0];
const { data: session, error: sessErr } = await supabase
  .from('game_sessions')
  .select('id, family_id, status, completed_at, winning_game_player_id')
  .eq('id', latest.game_session_id)
  .maybeSingle();

if (sessErr) console.log(`ERROR querying game_sessions: ${sessErr.message}`);
else console.log('Linked session:', JSON.stringify(session));

const { data: player, error: playerErr } = await supabase
  .from('game_players')
  .select('id, player_name, total_score, game_session_id')
  .eq('id', latest.winning_game_player_id)
  .maybeSingle();

if (playerErr) console.log(`ERROR querying game_players: ${playerErr.message}`);
else console.log('Winning player:', JSON.stringify(player));
