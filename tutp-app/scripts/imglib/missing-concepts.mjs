// Library coverage: the 30 concepts that stories (of lessons that are not
// maths) needed a library picture for and did not get, over the last 30 days.
// The server logs a story.image_missing row per such story with the lesson's
// normalized concept (lowercase words, no names, no numbers; see
// normalizeConcept in server/image-library.js), the number of library pictures
// offered (0 = none matched) and the language. Run by the founder, who has the
// Supabase service key in his shell:
//   $env:SUPABASE_URL = "..."; $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/imglib/missing-concepts.mjs
// Nothing is printed or stored of the keys; read only.
import { createClient } from '@supabase/supabase-js';
import { topMissingConcepts, STORY_IMAGE_MISSING, REPORT_WINDOW_DAYS } from '../../server/image-library.js';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell first.'); process.exit(2); }

const supabase = createClient(url, key);
const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 86400000).toISOString();
// Supabase returns at most 1000 rows per request, so read in pages.
const data = [];
for (let from = 0; ; from += 1000) {
  const { data: page, error } = await supabase.from('usage_events').select('family_id, properties, created_at')
    .eq('event_name', STORY_IMAGE_MISSING).gte('created_at', since).order('created_at', { ascending: false }).range(from, from + 999);
  if (error) { console.error('Could not read the events:', error.message); process.exit(1); }
  data.push(...page);
  if (page.length < 1000) break;
}

const top = topMissingConcepts(data, { limit: 30 });
if (!top.length) {
  console.log(`No story.image_missing rows in the last ${REPORT_WINDOW_DAYS} days.`);
} else {
  console.log(`Top ${top.length} concepts with no library picture, last ${REPORT_WINDOW_DAYS} days (${(data || []).length} stories):`);
  console.log('rank  stories  families  no-candidate  concept');
  top.forEach((t, i) => console.log(`${String(i + 1).padStart(4)}  ${String(t.count).padStart(7)}  ${String(t.families).padStart(8)}  ${String(t.noCandidate).padStart(12)}  ${t.concept}`));
}
