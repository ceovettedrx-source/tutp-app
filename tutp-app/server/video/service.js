// The one video service for every mode (Experiential Learning first).
//
//   const svc = createVideoService({ search, review, segmenter, localVideos });
//   const { videos } = await svc.find({ conceptId, concept, grade, subject, lang });
//
// Up to 5 videos: 2 in the user's language, 2 in English, 1 best-in-world in
// any language; Tut-P hosted videos (none yet) always come first. The query is
// concept + class + subject, never the notes text. Fallback: the exact
// concept, then the broader topic (subject alone with the class), then an
// empty list: the page hides the section, it never shows a "not available"
// line. A search error is logged by the client and cached only briefly, so
// a quota blip does not hide videos for a day.

const LANG_CODES = { English: 'en', Hindi: 'hi', Telugu: 'te', Tamil: 'ta', Marathi: 'mr', Spanish: 'es', French: 'fr', German: 'de', Arabic: 'ar' };
export const langCode = (label) => LANG_CODES[label] || null;

// Tut-P hosted (ad-free library, phase 2) before YouTube. Field and order only.
export const SOURCE_PRIORITY = { tutp_hosted: 0, youtube: 1 };

export const CACHE_TTL_OK_MS = 24 * 60 * 60 * 1000;
export const CACHE_TTL_ERROR_MS = 5 * 60 * 1000;
export const MIN_VIDEOS = 3;

export function createVideoService({ search, review, segmenter, localVideos = async () => [], now = Date.now, log = console }) {
  const cache = new Map();   // key -> { at, ttl, value }

  async function gather(query, lang, errors) {
    const r = await search(query, lang);
    if (r.error) errors.push(r.error);
    return r.videos || [];
  }

  async function find({ conceptId, concept, grade, subject = 'science', lang = 'English', terms = [] }) {
    const key = `${conceptId}|${lang}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < hit.ttl) return hit.value;

    const errors = [];
    const code = langCode(lang);
    const tryTopic = async (topic) => {
      const base = `${topic} class ${grade} ${subject}`;
      const userSearch = code && code !== 'en' ? gather(`${base} ${lang}`, code, errors) : Promise.resolve([]);
      const [mine, english, best] = await Promise.all([userSearch, gather(base, 'en', errors), gather(topic + ' ' + subject, null, errors)]);
      const seen = new Set();
      const uniq = (list) => list.filter((v) => (seen.has(v.id) ? false : seen.add(v.id)));
      const pool = { mine: uniq(mine), english: uniq(english), best: uniq(best) };
      const all = [...pool.mine, ...pool.english, ...pool.best];
      if (!all.length) return [];
      const ok = await review(all, topic);          // Set of approved ids
      const keep = (l) => l.filter((v) => ok.has(v.id));
      const pick = [
        ...keep(pool.mine).slice(0, 2).map((v) => ({ ...v, slot: 'user' })),
        ...keep(pool.english).slice(0, code && code !== 'en' ? 2 : 4).map((v) => ({ ...v, slot: 'english' })),
        ...keep(pool.best).slice(0, 1).map((v) => ({ ...v, slot: 'best' })),
      ];
      return pick;
    };

    let picked = await tryTopic(concept);
    if (picked.length < MIN_VIDEOS) {
      const broader = await tryTopic(subject);          // broader topic
      const have = new Set(picked.map((v) => v.id));
      picked = [...picked, ...broader.filter((v) => !have.has(v.id))].slice(0, 5);
    }

    const out = [];
    for (const v of await localVideos(conceptId)) out.push({ ...v, source: v.source || 'tutp_hosted' });
    for (const v of picked) {
      const seg = (await segmenter(v, concept, terms)) || { segment: null, moments: [] };
      out.push({
        id: v.id, title: v.title, channel: v.channel, duration: v.duration, slot: v.slot,
        source: 'youtube', segment: seg.segment, segmentVia: seg.via || null, moments: seg.moments || [],
      });
    }
    out.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);   // stable: keeps relevance order within a source
    const value = { videos: out };
    cache.set(key, { at: now(), ttl: errors.length ? CACHE_TTL_ERROR_MS : CACHE_TTL_OK_MS, value });
    if (!out.length) log.warn('video.none', JSON.stringify({ conceptId, lang, errors: errors.map((e) => e.reason) }));
    return value;
  }

  return { find, cacheSize: () => cache.size, clear: () => cache.clear() };
}

// The second pass: a cheap model call drops off-topic or not child-appropriate
// videos. callModel(system, user) -> parsed JSON { ok: [id] }. A failure of the
// pass keeps nothing (fail closed): the section is hidden rather than showing
// unreviewed videos to a child.
export function makeReviewer(callModel, log = console) {
  return async function review(videos, topic) {
    const system = 'You review YouTube videos for a children\'s school-science app (Class 6 to 10, India). Reply ONLY with JSON {"ok":["videoId",...]} listing the videos that are clearly about the topic AND suitable for children (no violence, adult themes, scams, clickbait, misinformation, or ads for products). If unsure, leave it out.';
    const user = JSON.stringify({ topic, videos: videos.map((v) => ({ id: v.id, title: v.title, channel: v.channel, description: (v.description || '').slice(0, 300) })) });
    try {
      const out = await callModel(system, user);
      return new Set(Array.isArray(out && out.ok) ? out.ok.filter((x) => typeof x === 'string') : []);
    } catch (err) {
      log.error('video.review_error', String(err && err.message).slice(0, 160));
      return new Set();
    }
  };
}
