// "Key part" of a video: where the concept starts and ends.
//
// 1. From the description's chapter timestamps (parseChapters): the chapter
//    whose title shares a word with the concept, ending where the next
//    chapter starts (or at the video's end).
// 2. Else, when a Gemini key can be read at run time, Gemini watches the
//    public URL and answers { start, end, moments }.
// 3. Else no segment, and the page plays the full video.
// Every segment is validated: 0 <= start < end <= duration, and 1 to 8
// minutes long. Up to 3 "key moment" chips (seek only, never stitched).

import { parseChapters } from './youtube.js';

export const SEGMENT_MIN_S = 60;
export const SEGMENT_MAX_S = 8 * 60;

export function validateSegment(seg, duration) {
  if (!seg || !Number.isFinite(seg.start) || !Number.isFinite(seg.end) || !Number.isFinite(duration)) return null;
  const start = Math.floor(seg.start), end = Math.floor(seg.end);
  if (start < 0 || start >= end || end > duration) return null;
  const len = end - start;
  if (len < SEGMENT_MIN_S || len > SEGMENT_MAX_S) return null;
  return { start, end };
}

const STOP = new Set(['the', 'and', 'of', 'in', 'a', 'an', 'to', 'for', 'is', 'how', 'what', 'with', 'class', 'light', 'on']);
function words(s) { return String(s).toLowerCase().split(/[^a-z0-9ऀ-෿]+/).filter((w) => w.length > 2 && !STOP.has(w)); }

// terms: the concept's title and aliases. -> { segment|null, moments[] }
export function segmentFromChapters(video, terms) {
  const chapters = parseChapters(video.description);
  if (!chapters.length || !video.duration) return null;
  const want = new Set(terms.flatMap(words));
  const scored = chapters.map((c, i) => ({ i, c, score: words(c.title).filter((w) => want.has(w)).length }));
  const best = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i)[0];
  if (!best) return null;
  const next = chapters[best.i + 1];
  const segment = validateSegment({ start: best.c.start, end: next ? next.start : video.duration }, video.duration);
  const moments = scored.filter((s) => s.score > 0).slice(0, 3).map((s) => ({ t: s.c.start, label: s.c.title.slice(0, 60) }));
  return segment ? { segment, moments, via: 'chapters' } : null;
}

// Gemini video analysis of a public YouTube URL. fetchImpl and key are
// injected; any failure gives null (logged), never an error to the page.
export async function segmentFromGemini(video, concept, { key, fetchImpl = fetch, log = console, model = 'gemini-2.5-flash' }) {
  if (!key || !video.duration) return null;
  try {
    const prompt = `Watch this video. Find the part that explains "${concept}". Reply ONLY with JSON: {"start":seconds,"end":seconds,"moments":[{"t":seconds,"label":"3 to 6 words"}]} with at most 3 moments. The part must be between 1 and 8 minutes. If the video does not explain it, reply {"start":null,"end":null,"moments":[]}.`;
    const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ fileData: { fileUri: `https://www.youtube.com/watch?v=${video.id}` } }, { text: prompt }] }] }),
    });
    if (!r.ok) { log.error('video.gemini_error', JSON.stringify({ status: r.status, video: video.id })); return null; }
    const j = await r.json();
    const text = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const m = /\{[\s\S]*\}/.exec(text.map((p) => p.text || '').join(''));
    if (!m) return null;
    const out = JSON.parse(m[0]);
    const segment = validateSegment({ start: Number(out.start), end: Number(out.end) }, video.duration);
    if (!segment) return null;
    const moments = (Array.isArray(out.moments) ? out.moments : [])
      .filter((x) => x && Number.isFinite(Number(x.t)) && Number(x.t) >= 0 && Number(x.t) < video.duration && typeof x.label === 'string')
      .slice(0, 3).map((x) => ({ t: Math.floor(Number(x.t)), label: x.label.slice(0, 60) }));
    return { segment, moments, via: 'gemini' };
  } catch (err) {
    log.error('video.gemini_error', JSON.stringify({ message: String(err && err.message).slice(0, 120), video: video.id }));
    return null;
  }
}

// The Gemini key from Secret Manager, read at run time with the Cloud Run
// service account's own token (no redeploy when the key appears or changes).
// Cached for 5 minutes, absent or denied -> null. Never logged.
let keyCache = { at: 0, value: null };
export async function geminiKeyFromSecretManager({ fetchImpl = fetch, now = Date.now, ttlMs = 5 * 60 * 1000, log = console } = {}) {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (now() - keyCache.at < ttlMs) return keyCache.value;
  keyCache = { at: now(), value: null };
  try {
    const tr = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    if (!tr.ok) return null;
    const { access_token } = await tr.json();
    const pr = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/project/project-id', { headers: { 'Metadata-Flavor': 'Google' } });
    const project = (await pr.text()).trim();
    const sr = await fetchImpl(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/gemini-api-key/versions/latest:access`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!sr.ok) { log.warn('video.gemini_key_unavailable', sr.status); return null; }
    const j = await sr.json();
    keyCache.value = Buffer.from(j.payload.data, 'base64').toString('utf8').trim() || null;
    return keyCache.value;
  } catch { return null; }
}
