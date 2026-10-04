// Shared video service: YouTube client, chapters, segments, 2+2+1, fallback, error handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseChapters, searchVideos } from '../../server/video/youtube.js';
import { validateSegment, segmentFromChapters, segmentFromGemini } from '../../server/video/segments.js';
import { createVideoService, makeReviewer, SOURCE_PRIORITY, CACHE_TTL_ERROR_MS } from '../../server/video/service.js';

const quiet = { error() {}, warn() {}, log() {} };

test('parseDuration', () => {
  assert.equal(parseDuration('PT10M'), 600);
  assert.equal(parseDuration('PT1H2M10S'), 3730);
  assert.equal(parseDuration('PT45S'), 45);
  assert.equal(parseDuration('junk'), null);
});

test('parseChapters: needs 0:00 first, 3+ chapters, ascending; ignores stray times', () => {
  const d = 'Intro text\n0:00 Introduction\n1:30 - Why magnets attract\n4:05 Summary\n';
  assert.deepEqual(parseChapters(d), [{ start: 0, title: 'Introduction' }, { start: 90, title: 'Why magnets attract' }, { start: 245, title: 'Summary' }]);
  assert.deepEqual(parseChapters('Meet at 2:30 pm\n0:00 Start\n1:00 Next'), [], 'only two chapters');
  assert.deepEqual(parseChapters('1:00 A\n2:00 B\n3:00 C'), [], 'no 0:00');
  assert.equal(parseChapters('0:00 Start\n1:10:00 Long\n1:20:00 Longer').length, 3, 'hours');
  assert.deepEqual(parseChapters('0:00 A\n2:00 B\n1:00 C'), [], 'out of order');
});

test('validateSegment: start < end <= duration, 1 to 8 minutes', () => {
  assert.deepEqual(validateSegment({ start: 60, end: 270 }, 600), { start: 60, end: 270 });
  assert.equal(validateSegment({ start: 60, end: 100 }, 600), null, 'under a minute');
  assert.equal(validateSegment({ start: 0, end: 600 }, 600), null, 'over 8 minutes');
  assert.equal(validateSegment({ start: 100, end: 90 }, 600), null);
  assert.equal(validateSegment({ start: 400, end: 700 }, 600), null, 'past the end');
  assert.equal(validateSegment({ start: -5, end: 100 }, 600), null);
  assert.equal(validateSegment({ start: NaN, end: 100 }, 600), null);
});

test('segmentFromChapters picks the chapter that names the concept and ends at the next chapter', () => {
  const v = { id: 'x', duration: 900, description: '0:00 Intro\n1:00 How sound travels and vibration\n4:30 Quiz\n' };
  const r = segmentFromChapters(v, ['Sound and vibration', 'sound']);
  assert.deepEqual(r.segment, { start: 60, end: 270 });
  assert.equal(r.via, 'chapters');
  assert.equal(segmentFromChapters(v, ['magnets']), null);
  assert.equal(segmentFromChapters({ ...v, description: 'none' }, ['sound']), null);
});

test('Gemini segment: a valid answer is used, a bad one or a failure gives null', async () => {
  const mk = (text, ok = true) => async () => ({ ok, status: ok ? 200 : 403, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
  const v = { id: 'abc', duration: 600 };
  const good = await segmentFromGemini(v, 'friction', { key: 'k', fetchImpl: mk('{"start":30,"end":200,"moments":[{"t":40,"label":"Rough surface"},{"t":9999,"label":"bad"}]}'), log: quiet });
  assert.deepEqual(good.segment, { start: 30, end: 200 });
  assert.equal(good.moments.length, 1, 'a moment past the end is dropped');
  assert.equal(await segmentFromGemini(v, 'friction', { key: 'k', fetchImpl: mk('{"start":30,"end":40}'), log: quiet }), null);
  assert.equal(await segmentFromGemini(v, 'friction', { key: 'k', fetchImpl: mk('{}', false), log: quiet }), null);
  assert.equal(await segmentFromGemini(v, 'friction', { key: null, fetchImpl: mk('{}'), log: quiet }), null, 'no key, no call');
});

test('searchVideos: no key and a quota error are reported and logged, never thrown', async () => {
  const logged = [];
  const log = { error: (...a) => logged.push(a.join(' ')) };
  const none = await searchVideos({ q: 'x', key: '', log });
  assert.equal(none.error.reason, 'no_key');
  const quota = await searchVideos({ q: 'x', key: 'k', log, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }) }) });
  assert.deepEqual(quota.error, { status: 403, reason: 'quotaExceeded' });
  assert.ok(logged.some((l) => l.includes('quotaExceeded')));
  const net = await searchVideos({ q: 'x', key: 'k', log, fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(net.error.reason, 'network');
});

test('searchVideos sends safeSearch=strict, videoEmbeddable=true, type=video and keeps only embeddable videos', async () => {
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(u);
    if (u.includes('/search?')) return { ok: true, status: 200, json: async () => ({ items: [{ id: { videoId: 'a' } }, { id: { videoId: 'b' } }] }) };
    return { ok: true, status: 200, json: async () => ({ items: [
      { id: 'b', snippet: { title: 'B', channelTitle: 'c', description: '' }, contentDetails: { duration: 'PT5M' }, status: { embeddable: false } },
      { id: 'a', snippet: { title: 'A', channelTitle: 'c', description: '0:00 x' }, contentDetails: { duration: 'PT5M' }, status: { embeddable: true } },
    ] }) };
  };
  const r = await searchVideos({ q: 'magnets class 6 science', lang: 'te', key: 'k', fetchImpl });
  assert.deepEqual(r.videos.map((v) => v.id), ['a']);
  assert.match(urls[0], /safeSearch=strict/);
  assert.match(urls[0], /videoEmbeddable=true/);
  assert.match(urls[0], /type=video/);
  assert.match(urls[0], /relevanceLanguage=te/);
});

const vid = (id, title = id) => ({ id, title, channel: 'c', duration: 600, description: '' });
const approveAll = async (v) => new Set(v.map((x) => x.id));

test('2 + 2 + 1: two in the user language, two English, one best-in-world, no repeats', async () => {
  const svc = createVideoService({
    search: async (q, lang) => ({ error: null, videos: lang === 'te' ? [vid('t1'), vid('t2'), vid('t3')] : lang === 'en' ? [vid('e1'), vid('e2'), vid('e3')] : [vid('e1'), vid('b1')] }),
    review: approveAll, segmenter: async () => null, log: quiet,
  });
  const r = await svc.find({ conceptId: 'c1', concept: 'Magnets', grade: 6, lang: 'Telugu' });
  assert.deepEqual(r.videos.map((v) => [v.slot, v.id]), [['user', 't1'], ['user', 't2'], ['english', 'e1'], ['english', 'e2'], ['best', 'b1']]);
  assert.ok(r.videos.every((v) => v.source === 'youtube' && v.segment === null));
});

test('the review pass drops videos; a failed review hides everything (fail closed)', async () => {
  const search = async () => ({ error: null, videos: [vid('a'), vid('b'), vid('c'), vid('d')] });
  const some = createVideoService({ search, review: async () => new Set(['a', 'c', 'd']), segmenter: async () => null, log: quiet });
  assert.ok(!(await some.find({ conceptId: 'k', concept: 'K', grade: 7 })).videos.some((v) => v.id === 'b'));
  const review = makeReviewer(async () => { throw new Error('model down'); }, quiet);
  const dead = createVideoService({ search, review, segmenter: async () => null, log: quiet });
  assert.deepEqual((await dead.find({ conceptId: 'k2', concept: 'K', grade: 7 })).videos, []);
});

test('fallback: exact concept, then the broader topic, then an empty list (never a notice)', async () => {
  const queries = [];
  const search = async (q) => { queries.push(q); return { error: null, videos: q.startsWith('science') ? [vid('s1'), vid('s2'), vid('s3')] : [] }; };
  const svc = createVideoService({ search, review: approveAll, segmenter: async () => null, log: quiet });
  const r = await svc.find({ conceptId: 'f1', concept: 'Obscure idea', grade: 8, lang: 'English' });
  assert.equal(r.videos.length >= 3, true);
  assert.ok(queries.some((q) => q.startsWith('Obscure idea class 8 science')), 'query = concept + class + subject');
  const none = createVideoService({ search: async () => ({ error: null, videos: [] }), review: approveAll, segmenter: async () => null, log: quiet });
  assert.deepEqual(await none.find({ conceptId: 'f2', concept: 'X', grade: 8 }), { videos: [] });
});

test('a quota error is cached only briefly; a good answer for a day', async () => {
  let t = 1000, calls = 0, fail = true;
  const search = async () => { calls++; return fail ? { error: { status: 403, reason: 'quotaExceeded' }, videos: [] } : { error: null, videos: [vid('a'), vid('b'), vid('c')] }; };
  const svc = createVideoService({ search, review: approveAll, segmenter: async () => null, now: () => t, log: quiet });
  const a = await svc.find({ conceptId: 'q', concept: 'Q', grade: 6 });
  assert.deepEqual(a.videos, []);
  const first = calls;
  await svc.find({ conceptId: 'q', concept: 'Q', grade: 6 });
  assert.equal(calls, first, 'cached inside the short window');
  t += CACHE_TTL_ERROR_MS + 1; fail = false;
  assert.ok((await svc.find({ conceptId: 'q', concept: 'Q', grade: 6 })).videos.length >= 3, 'recovers after the short window');
});

test('source priority: tutp_hosted is ordered before youtube', async () => {
  assert.ok(SOURCE_PRIORITY.tutp_hosted < SOURCE_PRIORITY.youtube);
  const svc = createVideoService({
    search: async () => ({ error: null, videos: [vid('y1'), vid('y2'), vid('y3')] }), review: approveAll, segmenter: async () => null,
    localVideos: async () => [{ id: 'local1', title: 'Teacher video', source: 'tutp_hosted' }], log: quiet,
  });
  const r = await svc.find({ conceptId: 'p', concept: 'P', grade: 6 });
  assert.equal(r.videos[0].id, 'local1');
  assert.equal(r.videos[0].source, 'tutp_hosted');
});
