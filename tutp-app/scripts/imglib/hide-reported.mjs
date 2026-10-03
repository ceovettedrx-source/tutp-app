// Reported images: lists every library image that 3 or more distinct families
// reported in the last 30 days (the server already hides them) and, with
// --regen, regenerates each through the pipeline (generate, review, refine,
// store; needs the Gemini key, see pipeline.mjs). Run by the founder, who has
// the Supabase service key in his shell:
//   $env:SUPABASE_URL = "..."; $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/imglib/hide-reported.mjs [--regen]
// Nothing is printed or stored of the keys.
import { spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import { hiddenFromReports, REPORT_WINDOW_DAYS, IMAGE_REPORTED } from '../../server/image-library.js';
import { loadManifest } from './lib.mjs';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell first.'); process.exit(2); }

const supabase = createClient(url, key);
const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 86400000).toISOString();
const { data, error } = await supabase.from('usage_events').select('family_id, properties, created_at').eq('event_name', IMAGE_REPORTED).gte('created_at', since).limit(5000);
if (error) { console.error('Could not read the reports:', error.message); process.exit(1); }

const images = loadManifest().images;
const notBefore = Object.fromEntries(images.filter((i) => i.stored_at).map((i) => [i.id, Date.parse(i.stored_at)]));
const hidden = [...hiddenFromReports(data, { notBefore })];
console.log(hidden.length ? `Hidden by reports: ${hidden.join(', ')}` : 'No image has 3 or more reporting families.');

if (hidden.length && process.argv.includes('--regen')) {
  const pipeline = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pipeline.mjs');
  for (const id of hidden) {
    console.log(`regenerating ${id} ...`);
    spawnSync(process.execPath, [pipeline, 'regen', id], { stdio: 'inherit' });
  }
  console.log('Regenerated images take effect with the next deploy; their old reports no longer count.');
}
