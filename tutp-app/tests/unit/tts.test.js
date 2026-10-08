// Server voice for Listen (server/tts, server/routes/tts.js, TUT-7).
//   node --test tests/unit/tts.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTts, cacheKey, MAX_TTS_CHARS } from '../../server/tts/index.js';
import { googleRequestBody } from '../../server/tts/google.js';
import { registerTtsRoutes } from '../../server/routes/tts.js';

const AUDIO = Buffer.from('fake-mp3');
function memCache() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) || null, put: async (k, v) => { m.set(k, v); } };
}
function fakeFetch(calls, { elevenOk = true } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('elevenlabs')) {
      return elevenOk ? { ok: true, arrayBuffer: async () => AUDIO } : { ok: false, status: 500 };
    }
    return { ok: true, json: async () => ({ audioContent: AUDIO.toString('base64') }) };
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test('cache key differs by provider, voice, language and text, and is stable', () => {
  const a = { provider: 'google', voice: 'default', lang: 'te-IN', text: 'hello' };
  assert.equal(cacheKey(a), cacheKey({ ...a }));
  for (const k of ['provider', 'voice', 'lang', 'text']) assert.notEqual(cacheKey(a), cacheKey({ ...a, [k]: a[k] + 'x' }), k);
  assert.match(cacheKey(a), /^tts\/google\/te-IN\/[0-9a-f]{64}\.mp3$/);
});

test('google is the default; a Telugu request names te-IN and picks a voice by gender, not by name', async () => {
  const calls = [];
  const tts = createTts({ env: {}, fetchImpl: fakeFetch(calls), getToken: async () => 't', cache: memCache() });
  const out = await tts.speak({ text: 'నమస్తే', lang: 'te-IN' });
  assert.equal(out.provider, 'google');
  assert.equal(out.cached, false);
  assert.deepEqual(out.audio, AUDIO);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.voice.languageCode, 'te-IN');
  assert.equal(calls[0].body.voice.name, undefined);
  assert.equal(googleRequestBody({ text: 'x', lang: 'hi-IN', voice: 'hi-IN-Neural2-A' }).voice.name, 'hi-IN-Neural2-A');
});

test('the second request for the same text comes from the cache with no provider call', async () => {
  const calls = [];
  const cache = memCache();
  const tts = createTts({ env: {}, fetchImpl: fakeFetch(calls), getToken: async () => 't', cache });
  await tts.speak({ text: 'water cycle', lang: 'en-IN' });
  await tick();
  assert.equal(cache.m.size, 1);
  const again = await tts.speak({ text: '  water   cycle ', lang: 'en-IN' });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
});

test('elevenlabs is used only when selected, keyed and given a voice for the language', async () => {
  const env = { TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_TE: 'voiceTE' };
  let calls = [];
  let tts = createTts({ env, fetchImpl: fakeFetch(calls), getToken: async () => 't', cache: memCache() });
  assert.equal((await tts.speak({ text: 'hi', lang: 'te-IN' })).provider, 'elevenlabs');
  assert.match(calls[0].url, /elevenlabs\.io\/v1\/text-to-speech\/voiceTE/);
  // no voice for Hindi: Google
  calls = [];
  tts = createTts({ env, fetchImpl: fakeFetch(calls), getToken: async () => 't', cache: memCache() });
  assert.equal((await tts.speak({ text: 'hi', lang: 'hi-IN' })).provider, 'google');
  // no key: Google
  tts = createTts({ env: { TTS_PROVIDER: 'elevenlabs' }, fetchImpl: fakeFetch([]), getToken: async () => 't', cache: memCache() });
  assert.equal(tts.plan({ lang: 'te-IN' }).provider, 'google');
});

test('an elevenlabs failure falls back to google and is cached under the google key', async () => {
  const env = { TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_EN: 'v' };
  const calls = [];
  const cache = memCache();
  const tts = createTts({ env, fetchImpl: fakeFetch(calls, { elevenOk: false }), getToken: async () => 't', cache });
  const out = await tts.speak({ text: 'hello', lang: 'en-IN' });
  assert.equal(out.provider, 'google');
  await tick();
  assert.deepEqual([...cache.m.keys()].map((k) => k.split('/')[1]), ['google']);
});

test('a family voice id (grandparent clone) overrides the language voice', () => {
  const tts = createTts({ env: { TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' }, fetchImpl: fakeFetch([]), getToken: async () => 't', cache: memCache() });
  assert.deepEqual(tts.plan({ lang: 'te-IN', familyVoice: 'granny' }), { provider: 'elevenlabs', voice: 'granny' });
});

test('empty, too long and unsupported-language requests are refused before any call', async () => {
  const calls = [];
  const tts = createTts({ env: {}, fetchImpl: fakeFetch(calls), getToken: async () => 't', cache: memCache() });
  await assert.rejects(tts.speak({ text: '   ', lang: 'en-IN' }), { code: 'bad_request' });
  await assert.rejects(tts.speak({ text: 'a'.repeat(MAX_TTS_CHARS + 1), lang: 'en-IN' }), { code: 'too_long' });
  await assert.rejects(tts.speak({ text: 'hi', lang: 'or-IN' }), { code: 'bad_lang' });
  assert.equal(calls.length, 0);
});

// ---- the route, with a fake app
function route(tts, session = { familyId: 'f1' }, env = {}) {
  let handler;
  const app = { post: (p, h) => { if (p === '/api/tts') handler = h; } };
  registerTtsRoutes(app, {
    rateLimit: () => (req, res, next) => next(), getSession: () => session,
    sendSessionExpired: (res) => res.status(401).json({ error: 'session_expired' }), tts, isTest: async () => !!env.test,
  });
  return async (body, headers = {}) => {
    const out = { code: 200, headers: {}, body: null };
    const res = {
      status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; },
      set(h) { Object.assign(out.headers, h); return this; }, send(b) { out.body = b; return this; },
    };
    await handler({ body, get: (h) => headers[h] }, res);
    return out;
  };
}

test('route: needs a session, validates, and returns audio/mpeg from the server voice', async () => {
  const tts = createTts({ env: {}, fetchImpl: fakeFetch([]), getToken: async () => 't', cache: memCache() });
  assert.equal((await route(tts, null)({ text: 'hi', lang: 'en-IN' })).code, 401);
  assert.equal((await route(tts)({ text: '', lang: 'en-IN' })).code, 400);
  assert.equal((await route(tts)({ text: 'hi', lang: 'xx' })).code, 400);
  const ok = await route(tts)({ text: 'hi', lang: 'te-IN' });
  assert.equal(ok.code, 200);
  assert.equal(ok.headers['Content-Type'], 'audio/mpeg');
  assert.deepEqual(ok.body, AUDIO);
});

test('route: a provider failure is 503 so the page falls back to the browser voice', async () => {
  const tts = createTts({ env: {}, fetchImpl: async () => ({ ok: false, status: 500 }), getToken: async () => 't', cache: memCache() });
  assert.equal((await route(tts)({ text: 'hi', lang: 'en-IN' })).code, 503);
});

test('route: a test family on a replay preview gets a silent clip with no provider call', async () => {
  const calls = [];
  const tts = createTts({ env: {}, fetchImpl: fakeFetch(calls), getToken: async () => 't', cache: memCache() });
  process.env.E2E_REPLAY = '1';
  try {
    const r = route(tts, { familyId: 'f1' }, { test: true });
    const out = await r({ text: 'hi', lang: 'te-IN' });
    assert.equal(out.headers['X-Tts-Provider'], 'replay');
    assert.equal(calls.length, 0);
    const live = await r({ text: 'hi', lang: 'te-IN' }, { 'X-E2E-Mode': 'live' });
    assert.equal(live.headers['X-Tts-Provider'], 'google');
  } finally { delete process.env.E2E_REPLAY; }
});

test('every parent page loads tts-listen.js before the scripts that use it', () => {
  for (const p of ['mother', 'father', 'family-member', 'child']) {
    const html = readFileSync(`public/app/${p}/index.html`, 'utf8');
    assert.ok(html.includes('<script src="/app/shared/tts-listen.js"></script>'), p);
    const at = (f) => html.indexOf(`<script src="/app/shared/${f}"></script>`);
    assert.ok(at('tts-listen.js') > -1 && at('tts-listen.js') < at('homework-modal.js'), p);
    assert.ok(at('tts-listen.js') < at('story-modal.js'), p);
  }
});

test('no surface hides Listen when the browser has no voice', () => {
  for (const f of ['answer-cards', 'story-modal', 'notes-card', 'explain-panel', 'el-guided']) {
    const js = readFileSync(`public/app/shared/${f}.js`, 'utf8');
    assert.match(js, /TutpListen/, f);
    assert.doesNotMatch(js, /listen\.hidden\s*=|play\.classList\.toggle\('sm-hidden', !has\)/, f);
  }
});
