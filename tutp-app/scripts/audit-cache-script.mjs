// Cached explain cards whose visible text is in another script than their language
// (Hindi labels stored under "English"). Dry run by default: counts only, changes nothing.
//   node scripts/audit-cache-script.mjs            dry run: counts per table and per language
//   node scripts/audit-cache-script.mjs --apply    marks the rows stale (never deletes)
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never printed).
// "Stale" = prompt_version becomes 'stale-script:<old version>': the explain route only reads the
// current version, so the row is never served again and the next request regenerates it in place.
// The payload is kept for inspection. Run --apply only after the PR is merged.
import { createClient } from '@supabase/supabase-js';
import { cardMatchesLanguage, scriptMismatch, visibleText } from '../server/lang-check.js';

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;
const rows = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase.from('explain_cache').select('id,language,prompt_version,payload').order('id').range(from, from + PAGE - 1);
  if (error) { console.error('read failed:', error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < PAGE) break;
}

const perLanguage = {};
const bad = [];
for (const r of rows) {
  const l = (perLanguage[r.language] ||= { rows: 0, current: 0, mismatched: 0, foreign: {} });
  l.rows++;
  if (String(r.prompt_version || '').startsWith('stale-script:')) continue;
  l.current++;
  if (!cardMatchesLanguage(r.language, r.payload)) {
    l.mismatched++;
    const f = scriptMismatch(r.language, visibleText(r.payload));
    l.foreign[f] = (l.foreign[f] || 0) + 1;
    bad.push(r);
  }
}

console.log(`explain_cache: ${rows.length} rows (${apply ? 'APPLY' : 'dry run'})`);
console.table(Object.entries(perLanguage).map(([language, v]) => ({ language, rows: v.rows, 'current rows': v.current, 'would be marked stale': v.mismatched, 'script found': JSON.stringify(v.foreign) })));
console.log(`explain_cache total that ${apply ? 'are marked stale' : 'would be marked stale'}: ${bad.length}`);

// illustrations has no language and no text: its pictures are text-free (labels are an HTML overlay
// from explain_cache), so none is invalidated here. Pictures keyed by the bare concept are simply no
// longer asked for by Explain and Answer (the key now carries a question hash).
const { count: ill } = await supabase.from('illustrations').select('id', { count: 'exact', head: true });
console.log(`illustrations: ${ill} rows, 0 invalidated (no language, no text; Explain and Answer now use question-specific keys)`);

if (apply) {
  let done = 0;
  for (const r of bad) {
    const { error } = await supabase.from('explain_cache').update({ prompt_version: 'stale-script:' + (r.prompt_version || '') }).eq('id', r.id);
    if (error) console.error('mark failed', r.id, error.message); else done++;
  }
  console.log(`marked stale: ${done} of ${bad.length}`);
}
