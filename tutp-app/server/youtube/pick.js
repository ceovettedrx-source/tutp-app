// TUT-66 Watch & Learn: choosing which videos to show. Pure functions, no network.
//   candidate = { id, title, channel, thumb, lang: 'user' | 'en', seconds, views }
export const MIN_SECONDS = 60;          // under this: a Short
export const MAX_SECONDS = 30 * 60;     // over this: a lecture

// "PT1H2M3S" -> 3723. Live and unknown ("P0D", "", junk) -> 0, so they are dropped.
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || ''));
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

export const watchable = (c) => c && c.id && c.seconds >= MIN_SECONDS && c.seconds <= MAX_SECONDS;

// Lesson title -> a stable cache key part: lower case, letters and digits of any script, single spaces.
export function normalizeLesson(title) {
  return String(title || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function cacheKey({ board, cls, subject, lessonTitle, lang }) {
  const lesson = normalizeLesson(lessonTitle);
  if (!lesson) return '';
  const part = (v) => String(v == null ? '' : v).toLowerCase().trim().replace(/\s+/g, '-');
  return [part(board) || 'any', part(cls) || 'any', part(subject) || 'any', lesson, part(lang) || 'en'].join('|');
}

// 2 in the user's language, 2 in English, then the most viewed of the rest. Each video once.
// `reported` is a Set of video ids hidden for this lesson. Fewer candidates -> fewer videos.
export function pickVideos(candidates, { reported = new Set(), max = 5 } = {}) {
  const seen = new Set();
  const ok = [];
  for (const c of candidates || []) {
    if (!watchable(c) || reported.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    ok.push(c);
  }
  const top = (lang, n) => ok.filter((c) => c.lang === lang).slice(0, n);
  // An English family has one search only (user's language is English): its top 4 fill both slots.
  const chosen = ok.some((c) => c.lang === 'en') ? [...top('user', 2), ...top('en', 2)] : top('user', 4);
  const used = new Set(chosen.map((c) => c.id));
  const rest = ok.filter((c) => !used.has(c.id)).sort((a, b) => (b.views || 0) - (a.views || 0));
  if (rest[0]) chosen.push(rest[0]);
  return chosen.slice(0, max);
}
