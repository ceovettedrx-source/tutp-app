// Test families (round 2): family_registrations rows with data.is_test = true
// (family 16 for the e2e suite, and any family registered on Firebase test
// numbers). They are left out of every founder metric, and only they can get
// e2e replay and the X-Model-Usd header. Cached for 5 minutes; on a lookup
// error the last known set is kept (empty at start), so a real family is
// never treated as a test one by mistake.
let supabase = null;
let cache = { ids: new Set(), at: 0 };
const TTL_MS = 5 * 60 * 1000;

export function initTestFamilies(client) { supabase = client; }

export async function testFamilyIds() {
  if (!supabase || Date.now() - cache.at < TTL_MS) return cache.ids;
  const { data, error } = await supabase.from('family_registrations').select('id').eq('data->>is_test', 'true');
  if (error) { console.error('test families lookup failed:', error.message); return cache.ids; }
  cache = { ids: new Set((data || []).map((r) => r.id)), at: Date.now() };
  return cache.ids;
}

export async function isTestFamily(familyId) {
  if (familyId == null) return false;
  return (await testFamilyIds()).has(Number(familyId));
}

// Rows minus those of test families: rows is an array, key the family id
// field ('family_id' by default, 'id' for family_registrations).
export function withoutTestFamilies(rows, ids, key = 'family_id') {
  return (rows || []).filter((r) => !ids.has(Number(r[key])));
}
