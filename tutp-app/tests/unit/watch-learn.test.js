// TUT-66 Watch & Learn: picking, cache, quota guard, tiers, report. YouTube is mocked: no network, no spend.
//   node --test tests/unit/watch-learn.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, normalizeLesson, cacheKey, pickVideos } from '../../server/youtube/pick.js';
import { createWatchLearn, canonLang } from '../../server/youtube/watch-learn.js';
import { lessonFromConceptKey, lessonFromQuestions } from '../../server/youtube/lesson.js';
import { validateAnswer } from '../../server/answer-schema.js';

const SECRET = 'AIza-test-secret-value'; // secret-scan:allow (a made-up value the tests look for in output)
const quiet = { warn() {}, error() {} };

function fakeDb() {
  const t = { watch_learn_cache: [], watch_learn_reports: [] };
  const q = (name) => {
    const f = [];
    const b = {
      select: () => b, eq: (c, v) => { f.push([c, v]); return b; },
      maybeSingle: async () => ({ data: t[name].find((r) => f.every(([c, v]) => r[c] === v)) || null, error: null }),
      then: (res) => res({ data: t[name].filter((r) => f.every(([c, v]) => r[c] === v)), error: null }),
    };
    return b;
  };
  return {
    t,
    from: (name) => ({
      ...q(name),
      select: () => q(name),
      upsert: async (row, opts = {}) => {
        const keys = String(opts.onConflict || 'cache_key').split(',');
        const i = t[name].findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (i >= 0) { if (!opts.ignoreDuplicates) t[name][i] = row; } else t[name].push(row);
        return { error: null };
      },
    }),
  };
}

// A fake YouTube: search returns n items per call, videos returns the given durations.
function fakeYoutube({ status = 200, durations = {}, views = {} } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    const u = new URL(url);
    calls.push({ path: u.pathname.split('/').pop(), params: Object.fromEntries(u.searchParams) });
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    if (u.pathname.endsWith('/search')) {
      const code = u.searchParams.get('relevanceLanguage');
      return { ok: true, status: 200, json: async () => ({ items: Array.from({ length: 6 }, (_, i) => ({ id: { videoId: `${code}vid${i}xx` }, snippet: { title: `${code} ${i}`, channelTitle: 'Ch', thumbnails: { medium: { url: 'https://i.ytimg.com/x.jpg' } } } })) }) };
    }
    const ids = u.searchParams.get('id').split(',');
    return { ok: true, status: 200, json: async () => ({ items: ids.map((id) => ({ id, contentDetails: { duration: durations[id] || 'PT5M' }, statistics: { viewCount: String(views[id] || 100) } })) }) };
  };
  return { fetchFn, calls };
}

const lesson = { board: 'CBSE', cls: 5, subject: 'Maths', lessonTitle: 'Fractions', lang: 'Telugu' };
const make = (yt, db = fakeDb(), env = { WATCH_LEARN_YOUTUBE_KEY: SECRET }, now = () => 1000) =>
  ({ db, svc: createWatchLearn({ supabase: db, fetchFn: yt.fetchFn, env, now, log: quiet }) });

test('duration: hours, minutes, seconds; live and junk are 0', () => {
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT59S'), 59);
  assert.equal(parseDuration('PT30M'), 1800);
  for (const x of ['P0D', '', null, 'abc']) assert.equal(parseDuration(x), 0);
});

test('Shorts (under 60 s) and lectures (over 30 min) are dropped, 60 s and 30 min stay', () => {
  const c = (id, seconds) => ({ id, seconds, lang: 'user', views: 1 });
  const out = pickVideos([c('short59', 59), c('ok60', 60), c('ok1800', 1800), c('long1801', 1801), c('none', 0)], { max: 9 });
  assert.deepEqual(out.map((v) => v.id).sort(), ['ok1800', 'ok60']);
});

test('2 user language + 2 English + the most viewed of the rest, no video twice', () => {
  const c = (id, lang, views) => ({ id, lang, seconds: 300, views });
  const cands = [c('u1', 'user', 5), c('u2', 'user', 4), c('u3', 'user', 900), c('e1', 'en', 3), c('e2', 'en', 2), c('e3', 'en', 50), c('u1', 'en', 5)];
  assert.deepEqual(pickVideos(cands).map((v) => v.id), ['u1', 'u2', 'e1', 'e2', 'u3']);
});

test('an English family (one search) gets its top 4 and the most viewed', () => {
  const c = (id, views) => ({ id, lang: 'user', seconds: 300, views });
  assert.deepEqual(pickVideos([c('a', 1), c('b', 2), c('c', 3), c('d', 4), c('e', 5), c('f', 99)]).map((v) => v.id), ['a', 'b', 'c', 'd', 'f']);
});

test('fewer candidates give fewer videos, none gives none', () => {
  assert.deepEqual(pickVideos([]), []);
  assert.equal(pickVideos([{ id: 'a', lang: 'en', seconds: 300, views: 1 }]).length, 1);
});

test('cache key: same lesson spelt differently is one key; board, class, subject, language split it', () => {
  const k = (o) => cacheKey({ ...lesson, ...o });
  assert.equal(k({ lessonTitle: 'Fractions' }), k({ lessonTitle: '  fractions. ' }));
  assert.equal(normalizeLesson('Ch-3: Adding  Fractions!'), 'ch 3 adding fractions');
  for (const o of [{ board: 'ICSE' }, { cls: 6 }, { subject: 'Science' }, { lang: 'Hindi' }, { lessonTitle: 'Decimals' }]) assert.notEqual(k(o), k({}));
  assert.equal(k({ lessonTitle: '   ' }), '');
});

test('a fresh lesson: 2 searches (user language, English) and 1 videos call, with the safe parameters', async () => {
  const yt = fakeYoutube(); const { svc } = make(yt);
  const r = await svc.get({ ...lesson, tier: 'pro' });
  assert.deepEqual(yt.calls.map((c) => c.path), ['search', 'search', 'videos']);
  const s = yt.calls[0].params;
  assert.deepEqual([s.safeSearch, s.type, s.videoEmbeddable, s.regionCode, s.relevanceLanguage, s.maxResults], ['strict', 'video', 'true', 'IN', 'te', '15']);
  assert.equal(yt.calls[1].params.relevanceLanguage, 'en');
  assert.equal(r.videos.length, 5);
  assert.deepEqual(r.videos.map((v) => v.id.slice(0, 2)), ['te', 'te', 'en', 'en', 'te']);
});

test('an English family makes one search only', async () => {
  const yt = fakeYoutube(); const { svc } = make(yt);
  await svc.get({ ...lesson, lang: 'English', tier: 'pro' });
  assert.deepEqual(yt.calls.map((c) => c.path), ['search', 'videos']);
});

test('cache hit makes no API call at all', async () => {
  const yt = fakeYoutube(); const { svc } = make(yt);
  await svc.get({ ...lesson, tier: 'pro' });
  const before = yt.calls.length;
  const again = await svc.get({ ...lesson, lessonTitle: ' FRACTIONS ', tier: 'pro' });
  assert.equal(yt.calls.length, before);
  assert.equal(again.videos.length, 5);
});

test('Free sees 1 video and the number locked, never the other ids; Pro, Ultra Pro and Max see all 5', async () => {
  const yt = fakeYoutube(); const { svc } = make(yt);
  const free = await svc.get({ ...lesson, tier: 'free' });
  assert.equal(free.videos.length, 1);
  assert.equal(free.locked, 4);
  const text = JSON.stringify(free);
  const pro = await svc.get({ ...lesson, tier: 'pro' });
  for (const v of pro.videos.slice(1)) assert.ok(!text.includes(v.id));
  for (const tier of ['pro', 'ultrapro', 'max']) assert.equal((await svc.get({ ...lesson, tier })).videos.length, 5);
});

test('quota exceeded or any API error hides the card, writes nothing, and stops further calls for 10 minutes', async () => {
  const yt = fakeYoutube({ status: 403 }); let t = 1000;
  const { svc, db } = make(yt, fakeDb(), { WATCH_LEARN_YOUTUBE_KEY: SECRET }, () => t);
  assert.equal(await svc.get({ ...lesson, tier: 'pro' }), null);
  assert.equal(db.t.watch_learn_cache.length, 0);
  const n = yt.calls.length;
  assert.equal(await svc.get({ ...lesson, lessonTitle: 'Decimals', tier: 'pro' }), null);
  assert.equal(yt.calls.length, n);            // cooldown: no new call
  t += 11 * 60 * 1000;
  await svc.get({ ...lesson, lessonTitle: 'Decimals', tier: 'pro' });
  assert.ok(yt.calls.length > n);              // tries again after the cooldown
});

test('no key, no lesson title, a broken database or a network error never throws and hides the card', async () => {
  const yt = fakeYoutube();
  assert.equal(await make(yt, fakeDb(), {}).svc.get({ ...lesson, tier: 'pro' }), null);
  assert.equal(await make(yt).svc.get({ ...lesson, lessonTitle: '', tier: 'pro' }), null);
  const broken = { from: () => { throw new Error('db down'); } };
  assert.equal(await make(yt, broken).svc.get({ ...lesson, tier: 'pro' }), null);
  const net = { fetchFn: async () => { throw new Error('offline'); }, calls: [] };
  assert.equal(await make(net).svc.get({ ...lesson, tier: 'pro' }), null);
});

test('a lesson with no usable video is not cached (so it can be tried again later)', async () => {
  const yt = fakeYoutube({ durations: Object.fromEntries(['te', 'en'].flatMap((c) => Array.from({ length: 6 }, (_, i) => [`${c}vid${i}xx`, 'PT20S']))) });
  const { svc, db } = make(yt);
  assert.equal(await svc.get({ ...lesson, tier: 'pro' }), null);
  assert.equal(db.t.watch_learn_cache.length, 0);
});

test('report hides that video for that lesson only, the next candidate takes its place', async () => {
  const yt = fakeYoutube(); const { svc, db } = make(yt);
  const first = await svc.get({ ...lesson, tier: 'pro' });
  const bad = first.videos[0].id;
  assert.deepEqual((await svc.report({ ...lesson, videoId: bad, studentId: 's1', familyId: 'f1' })).ok, true);
  const after = await svc.get({ ...lesson, tier: 'pro' });
  assert.ok(!after.videos.some((v) => v.id === bad));
  assert.equal(after.videos.length, 5);
  // another lesson with the same video id is untouched
  db.t.watch_learn_cache.push({ cache_key: cacheKey({ ...lesson, lessonTitle: 'Decimals' }), videos: [{ id: bad, lang: 'user', seconds: 300, views: 1, title: 't', channel: 'c', thumb: '' }] });
  assert.equal((await svc.get({ ...lesson, lessonTitle: 'Decimals', tier: 'pro' })).videos[0].id, bad);
  // the same report twice is one row; a bad id is refused
  await svc.report({ ...lesson, videoId: bad });
  assert.equal(db.t.watch_learn_reports.length, 1);
  assert.equal((await svc.report({ ...lesson, videoId: '<script>' })).ok, false);
});

test('lesson name of an Answer comes from the questions\' concept keys; hash keys are skipped', () => {
  assert.equal(lessonFromConceptKey('c9-physics-distance-vs-displacement'), 'distance vs displacement');
  assert.equal(lessonFromConceptKey('c5-maths-fractions'), 'fractions');
  for (const k of ['c7-maths-q362552f3', 'c5-story-1a2b3c4d', 'c9-x', '', null, 'c5-maths-ab']) assert.equal(lessonFromConceptKey(k), '', String(k));
  const qs = [{ concept_key: 'c5-maths-fractions' }, { concept_key: 'c5-maths-q1abc' }, { concept_key: 'c5-maths-fractions' }, { concept_key: 'c5-maths-decimals' }];
  assert.equal(lessonFromQuestions(qs), 'fractions');
  assert.equal(lessonFromQuestions([]), '');
});

test('a validated Answer carries lesson_title, and none when no question has a usable key', () => {
  const q = (concept_key) => ({
    q_text: 'Differentiate between distance and displacement.', q_type: 'difference', marks: 4, concept_key,
    blocks: [{ type: 'compare_table', headers: ['Distance', 'Displacement'], rows: [['scalar', 'vector'], ['path length', 'shortest line']] }],
    keywords: ['scalar', 'vector'], diagram: null,
  });
  const a = validateAnswer({ status: 'ok', subject: 'Physics', questions: [q('c9-physics-motion')] });
  assert.equal(a.ok, true, JSON.stringify(a.issues));
  assert.equal(a.answer.lesson_title, 'motion');
  const b = validateAnswer({ status: 'ok', subject: 'Physics', questions: [q('c9-physics-q362552f3')] });
  assert.equal(b.answer.lesson_title, undefined);
});

test('language names, codes and case are one language; unknown is English', async () => {
  assert.deepEqual(['Telugu', 'telugu', 'te', 'te-IN', 'TE'].map(canonLang), Array(5).fill('Telugu'));
  assert.equal(canonLang('Klingon'), 'English');
  assert.equal(canonLang(undefined), 'English');
  const yt = fakeYoutube(); const { svc } = make(yt);
  await svc.get({ ...lesson, lang: 'te', tier: 'pro' });
  const before = yt.calls.length;
  await svc.get({ ...lesson, lang: 'Telugu', tier: 'pro' });
  assert.equal(yt.calls.length, before);   // "te" and "Telugu" share one cache row
});

test('the API key never appears in a result, in a cached row or in a log line', async () => {
  const lines = [];
  const logger = { warn: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };
  const ok = fakeYoutube(); const { db } = make(ok);
  const svc = createWatchLearn({ supabase: db, fetchFn: ok.fetchFn, env: { WATCH_LEARN_YOUTUBE_KEY: SECRET }, log: logger });
  const r = await svc.get({ ...lesson, tier: 'pro' });
  const bad = createWatchLearn({ supabase: fakeDb(), fetchFn: fakeYoutube({ status: 403 }).fetchFn, env: { WATCH_LEARN_YOUTUBE_KEY: SECRET }, log: logger });
  await bad.get({ ...lesson, tier: 'pro' });
  const all = JSON.stringify([r, db.t, lines]);
  assert.ok(!all.includes(SECRET));
});
