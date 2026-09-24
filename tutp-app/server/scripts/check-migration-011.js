// Read-only check: has supabase/migrations/011_teacher_materials.sql been run?
// Uses the same client setup as server.js (SUPABASE_URL + service role key,
// retry-once fetch). Only ever issues a GET (select ... limit 1) — never
// creates, alters, or writes anything. Prints no credentials.
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

const { data, error } = await supabase.from('teacher_materials').select('id').limit(1);

if (!error) {
  console.log(`EXISTS — teacher_materials table is present (${data.length} row(s) returned by limit 1). Migration 011 has been run.`);
  process.exit(0);
}

// PostgREST: PGRST205 = table not found in schema cache; Postgres 42P01 = undefined_table.
const missing = error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message || '');
if (missing) {
  console.log(`MISSING — teacher_materials table not found (${error.code}: ${error.message}). Migration 011 is still pending.`);
  process.exit(1);
}

console.log(`INCONCLUSIVE — unexpected error (${error.code || 'no code'}: ${error.message}).`);
process.exit(3);
