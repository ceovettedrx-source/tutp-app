// TUT-66 Watch & Learn: the YouTube lookup behind the "Watch & Learn" card.
// At most 2 search.list + 1 videos.list per lesson, then cached by (board, class, subject, lesson, language).
// A cache hit makes no API call. Any API error or quota stop hides the card; it never throws.
import { parseDuration, cacheKey, pickVideos, watchable } from './pick.js';

const API = 'https://www.googleapis.com/youtube/v3';
const COOLDOWN_MS = 10 * 60 * 1000;   // after a quota/API stop, no more calls for a while
const MAX_CANDIDATES = 30;
const LANG_CODE = { English: 'en', Hindi: 'hi', Telugu: 'te', Tamil: 'ta', Marathi: 'mr', Spanish: 'es', French: 'fr', German: 'de', Arabic: 'ar' };

// "Telugu", "telugu", "te" and "te-IN" are one language; anything unknown is English.
export function canonLang(lang) {
  const s = String(lang || '').trim();
  const byName = Object.keys(LANG_CODE).find((n) => n.toLowerCase() === s.toLowerCase());
  if (byName) return byName;
  const code = s.toLowerCase().split(/[-_]/)[0];
  return Object.keys(LANG_CODE).find((n) => LANG_CODE[n] === code) || 'English';
}
export const langCode = (lang) => LANG_CODE[canonLang(lang)];

export function createWatchLearn({ supabase, fetchFn = fetch, env = process.env, now = Date.now, log = console, cooldownMs = COOLDOWN_MS } = {}) {
  let coolUntil = 0;

  const stop = (why) => {
    coolUntil = now() + cooldownMs;
    log.warn(JSON.stringify({ severity: 'WARNING', event: 'watch_learn_api_stop', reason: why }));
  };

  async function call(path, params, ctx) {
    ctx.n += 1;
    const url = `${API}/${path}?${new URLSearchParams({ ...params, key: env.WATCH_LEARN_YOUTUBE_KEY })}`;
    const res = await fetchFn(url);
    if (!res.ok) { const e = new Error('youtube http'); e.status = res.status; throw e; }
    return res.json();
  }

  const search = (q, code, ctx) => call('search', {
    part: 'snippet', q, type: 'video', safeSearch: 'strict', videoEmbeddable: 'true',
    regionCode: 'IN', relevanceLanguage: code, maxResults: '15',
  }, ctx).then((j) => (j.items || []).map((it) => ({
    id: it.id && it.id.videoId, title: (it.snippet && it.snippet.title) || '',
    channel: (it.snippet && it.snippet.channelTitle) || '',
    thumb: (it.snippet && it.snippet.thumbnails && ((it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url) || '',
  })).filter((c) => c.id));

  async function fetchCandidates({ lessonTitle, subject, cls, lang }, ctx) {
    const q = [lessonTitle, subject, cls ? `class ${cls}` : ''].filter(Boolean).join(' ');
    const code = langCode(lang);
    const user = (await search(q, code, ctx)).map((c) => ({ ...c, lang: 'user' }));
    const en = code === 'en' ? [] : (await search(q, 'en', ctx)).map((c) => ({ ...c, lang: 'en' }));
    const all = [...user, ...en];
    const ids = [...new Set(all.map((c) => c.id))].slice(0, 50);
    if (!ids.length) return [];
    const det = await call('videos', { part: 'contentDetails,statistics', id: ids.join(','), maxResults: '50' }, ctx);
    const by = new Map((det.items || []).map((v) => [v.id, v]));
    return all.map((c) => {
      const v = by.get(c.id);
      return { ...c, seconds: v ? parseDuration(v.contentDetails && v.contentDetails.duration) : 0, views: v ? Number(v.statistics && v.statistics.viewCount) || 0 : 0 };
    }).filter(watchable).slice(0, MAX_CANDIDATES);
  }

  async function readCache(key) {
    const { data, error } = await supabase.from('watch_learn_cache').select('videos').eq('cache_key', key).maybeSingle();
    if (error) throw error;
    return data && Array.isArray(data.videos) ? data.videos : null;
  }

  async function readReported(key) {
    const { data, error } = await supabase.from('watch_learn_reports').select('video_id').eq('cache_key', key);
    if (error) throw error;
    return new Set((data || []).map((r) => r.video_id));
  }

  // -> { videos: [{id,title,channel,thumb}], locked: n, api_calls: n } or null (hide the card).
  async function get({ board, cls, subject, lessonTitle, lang: rawLang, tier }) {
    const ctx = { n: 0 };
    const lang = canonLang(rawLang);
    try {
      const key = cacheKey({ board, cls, subject, lessonTitle, lang });
      if (!key) return null;
      let cands = await readCache(key);
      if (!cands) {
        if (!env.WATCH_LEARN_YOUTUBE_KEY || now() < coolUntil) return null;
        try { cands = await fetchCandidates({ lessonTitle, subject, cls, lang }, ctx); }
        catch (err) { stop(err && err.status ? `http_${err.status}` : 'network'); return null; }
        if (!cands.length) return null;                   // never cache an empty answer
        const { error } = await supabase.from('watch_learn_cache').upsert({
          cache_key: key, board: board || null, cls: cls == null ? null : String(cls), subject: subject || null,
          lesson_norm: key.split('|')[3], lang: lang || 'English', videos: cands,
        }, { onConflict: 'cache_key' });
        if (error) log.error('watch_learn cache write failed:', error.message);
      }
      const picked = pickVideos(cands, { reported: await readReported(key) });
      if (!picked.length) return null;
      const show = tier && tier !== 'free' ? picked : picked.slice(0, 1);
      // A Free family never gets the other ids: only how many are locked.
      return { videos: show.map(({ id, title, channel, thumb }) => ({ id, title, channel, thumb })), locked: picked.length - show.length, api_calls: ctx.n };
    } catch (err) {
      log.error('watch_learn failed:', err && err.message);
      return null;
    }
  }

  // A parent says a video is not right for this lesson: hidden for everyone, once per family.
  async function report({ board, cls, subject, lessonTitle, lang: rawLang, videoId, studentId, familyId }) {
    const lang = canonLang(rawLang);
    const key = cacheKey({ board, cls, subject, lessonTitle, lang });
    if (!key || !/^[\w-]{6,20}$/.test(String(videoId || ''))) return { ok: false };
    const { error } = await supabase.from('watch_learn_reports').upsert(
      { cache_key: key, video_id: videoId, student_id: studentId || null, family_id: familyId || null },
      { onConflict: 'cache_key,video_id', ignoreDuplicates: true });
    if (error) { log.error('watch_learn report failed:', error.message); return { ok: false }; }
    return { ok: true, cache_key: key };
  }

  return { get, report };
}
