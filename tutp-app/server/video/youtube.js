// YouTube Data API v3 client for the shared video service.
//
// searchVideos() never throws and never hides a failure: it returns
// { videos, error } with error = { status, reason } when the API refused
// (quota, bad key, network), and logs it. A missing key is an error too
// (reason "no_key"), logged once per call, so "the section is empty" can
// always be traced to a cause.
//
// Rules we keep (YouTube API Services terms): safeSearch=strict,
// videoEmbeddable=true, type=video; only videos whose status.embeddable is
// true are returned. Nothing here touches ads or the player.

const API = 'https://www.googleapis.com/youtube/v3';

// ISO 8601 duration ("PT1H2M10S") -> seconds, or null.
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return null;
  const [d, h, mi, s] = [1, 2, 3, 4].map((i) => Number(m[i] || 0));
  const total = d * 86400 + h * 3600 + mi * 60 + s;
  return total > 0 ? total : null;
}

// Chapter timestamps in a description: lines like "0:00 Intro", "1:23 - Why
// magnets", "01:02:03 Summary". YouTube itself needs the first at 0:00, and
// at least three chapters; we ask for the same, so a stray "2:30 pm" line is
// not read as a chapter list. -> [{ start (s), title }] ascending, or [].
export function parseChapters(description) {
  const out = [];
  for (const line of String(description || '').split(/\r?\n/)) {
    const m = /^\s*(?:[-•*]\s*)?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:.)]?\s+(.{2,120}?)\s*$/.exec(line);
    if (!m) continue;
    const start = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (Number(m[3]) > 59) continue;
    out.push({ start, title: m[4] });
  }
  if (out.length < 3 || out[0].start !== 0) return [];
  for (let i = 1; i < out.length; i++) if (out[i].start <= out[i - 1].start) return [];
  return out;
}

const SEARCH_PARAMS = { part: 'snippet', type: 'video', safeSearch: 'strict', videoEmbeddable: 'true', maxResults: '8' };

// { videos: [{ id, title, channel, duration, description, language }], error }
export async function searchVideos({ q, lang = null, key, fetchImpl = fetch, log = console }) {
  if (!key) {
    log.error('video.no_key', JSON.stringify({ q }));
    return { videos: [], error: { status: 0, reason: 'no_key' } };
  }
  try {
    const sp = new URLSearchParams({ ...SEARCH_PARAMS, q, key });
    if (lang) sp.set('relevanceLanguage', lang);
    const sr = await fetchImpl(`${API}/search?${sp}`);
    const sj = await sr.json().catch(() => ({}));
    if (!sr.ok) return fail(log, sr.status, sj, q);
    const ids = (sj.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) return { videos: [], error: null };
    const vr = await fetchImpl(`${API}/videos?${new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.join(','), key })}`);
    const vj = await vr.json().catch(() => ({}));
    if (!vr.ok) return fail(log, vr.status, vj, q);
    const videos = (vj.items || [])
      .filter((v) => v.status && v.status.embeddable === true && v.status.privacyStatus !== 'private')
      .map((v) => ({
        id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
        duration: parseDuration(v.contentDetails && v.contentDetails.duration),
        description: v.snippet.description || '',
        language: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || null,
      }));
    // Keep the API's relevance order.
    videos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return { videos, error: null };
  } catch (err) {
    log.error('video.api_error', JSON.stringify({ q, status: 0, reason: 'network', message: String(err && err.message).slice(0, 120) }));
    return { videos: [], error: { status: 0, reason: 'network' } };
  }
}

function fail(log, status, body, q) {
  const reason = (body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || (body && body.error && body.error.status) || 'unknown';
  log.error('video.api_error', JSON.stringify({ q, status, reason }));
  return { videos: [], error: { status, reason } };
}
