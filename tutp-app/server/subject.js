// One canonical subject per family of spellings, so the Library files "Math", "Maths" and "Mathematics"
// in one folder (TUT-69). A subject outside every family is kept as written; an empty one stays empty.
const FAMILIES = [
  ['Maths', /^(maths?|mathematics)\.?$/],
  ['Science', /^(general )?sciences?$/],
  ['English', /^english( language)?$/],
  ['Telugu', /^telugu$/],
  ['Hindi', /^hindi$/],
  ['Social', /^(social|sst|social (studies|sciences?))$/],
  ['EVS', /^(evs|environmental (studies|science))$/],
];

export function canonicalSubject(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const key = s.toLowerCase();
  const hit = FAMILIES.find(([, re]) => re.test(key));
  return hit ? hit[0] : s;
}

// The folders of a list of stored subjects (null = none): canonical subject and count, biggest first.
export function groupSubjects(rawSubjects) {
  const counts = new Map();
  for (const r of rawSubjects) { const s = canonicalSubject(r) || ''; counts.set(s, (counts.get(s) || 0) + 1); }
  return [...counts.entries()].map(([subject, count]) => ({ subject: subject || null, count })).sort((a, b) => b.count - a.count);
}

// Every stored spelling that belongs in the folder named by `wanted` (the folder itself if none is stored).
export function subjectVariants(rawSubjects, wanted) {
  const want = canonicalSubject(wanted);
  const found = [...new Set(rawSubjects.filter(r => typeof r === 'string' && r && canonicalSubject(r) === want))];
  return found.length ? found : [want];
}
