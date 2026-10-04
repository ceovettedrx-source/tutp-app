// Image provider, illustration cache and signed URLs (docs/specs/answer-explain-v2.md section D).
//   node --test tests/unit/illustration-service.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, mockProvider, geminiProvider, imageGenEnabled, dailyCap, withSuffix, DEFAULT_DAILY_CAP } from '../../server/services/image-provider.js';
import { createIllustrationService, startOfIstDayUtc, BUCKET } from '../../server/services/illustration-service.js';
import { signedUrl, uploadPrivate, safeObjectPath, clampTtl } from '../../server/lib/signed-url.js';
import { IMAGE_SUFFIX } from '../../server/explain-schema.js';

// A tiny in-memory stand-in for the parts of supabase-js the service uses.
function fakeSupabase() {
  const rows = [];
  const files = new Map();
  let signCalls = [];
  const q = (filter = []) => ({
    _f: filter, _head: false,
    eq(c, v) { return { ...q([...this._f, (r) => r[c] === v]), _head: this._head, _sel: this._sel, _upd: this._upd }; },
    gte(c, v) { return { ...q([...this._f, (r) => r[c] >= v]), _head: this._head, _sel: this._sel }; },
  });
  const supabase = {
    rows, files, get signCalls() { return signCalls; },
    from(table) {
      assert.equal(table, 'illustrations');
      return {
        select(cols, opts) {
          const filters = [];
          const b = {
            eq(c, v) { filters.push((r) => r[c] === v); return b; },
            gte(c, v) { filters.push((r) => r[c] >= v); return b; },
            maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) || null, error: null }),
            then: (res) => res({ count: rows.filter((r) => filters.every((f) => f(r))).length, error: null }),
          };
          void cols; void opts;
          return b;
        },
        insert: async (row) => {
          if (rows.some((r) => r.concept_key === row.concept_key)) return { error: { code: '23505', message: 'dup' } };
          rows.push({ id: String(rows.length + 1), created_at: new Date().toISOString(), storage_path: null, reason: null, ...row });
          return { error: null };
        },
        update(patch) {
          const filters = [];
          const b = {
            eq(c, v) { filters.push((r) => r[c] === v); return b; },
            select: async () => { const hit = rows.filter((r) => filters.every((f) => f(r))); hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ id: r.id })), error: null }; },
            then: (res) => { rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch)); return res({ error: null }); },
          };
          return b;
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, BUCKET);
        return {
          upload: async (p, buf) => { files.set(p, buf); return { error: null }; },
          createSignedUrl: async (p, ttl) => { signCalls.push({ p, ttl }); return { data: { signedUrl: `https://signed.example/${p}?ttl=${ttl}` }, error: null }; },
        };
      },
    },
  };
  void q;
  return supabase;
}

const tick = () => new Promise((r) => setTimeout(r, 20));
const env = (o = {}) => ({ IMAGE_GEN_ENABLED: '1', IMAGE_PROVIDER: 'mock', ...o });

test('provider choice follows the environment, so a key added later needs no code change', () => {
  assert.equal(getProvider({}), null);
  assert.equal(getProvider({ IMAGE_GEN_ENABLED: '1' }), null);
  assert.equal(getProvider({ IMAGE_PROVIDER: 'mock' }).name, 'mock');
  const g = getProvider({ GEMINI_IMAGE_API_KEY: 'k', GEMINI_IMAGE_MODEL: 'm1' });
  assert.equal(g.name, 'gemini');
  assert.equal(g.model, 'm1');
  assert.equal(imageGenEnabled({ IMAGE_GEN_ENABLED: '1' }), true);
  assert.equal(imageGenEnabled({}), false);
  assert.equal(dailyCap({}), DEFAULT_DAILY_CAP);
  assert.equal(dailyCap({ IMAGE_GEN_DAILY_CAP: '3' }), 3);
  assert.equal(dailyCap({ IMAGE_GEN_DAILY_CAP: '0' }), 0);
});

test('the gemini provider sends the no-text suffix and reads the inline image', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('PNGDATA').toString('base64') } }] } }] }) };
  };
  const p = geminiProvider({ GEMINI_IMAGE_API_KEY: 'secret', GEMINI_IMAGE_MODEL: 'gem-img' }, fetchImpl);
  const out = await p.generate('A boy on a lane.');
  assert.equal(out.buffer.toString(), 'PNGDATA');
  assert.match(sent.url, /models\/gem-img:generateContent/);
  assert.equal(sent.init.headers['x-goog-api-key'], 'secret');
  assert.ok(sent.body.contents[0].parts[0].text.endsWith(IMAGE_SUFFIX));
  assert.equal(withSuffix('x ' + IMAGE_SUFFIX).split(IMAGE_SUFFIX).length, 2);   // never doubled
  await assert.rejects(geminiProvider({ GEMINI_IMAGE_API_KEY: 'k' }, async () => ({ ok: false, status: 429 })).generate('x'), /gemini http 429/);
  await assert.rejects(geminiProvider({ GEMINI_IMAGE_API_KEY: 'k' }, async () => ({ ok: true, json: async () => ({ candidates: [] }) })).generate('x'), /no image/);
});

test('the mock provider gives a real PNG', async () => {
  const { buffer, contentType } = await mockProvider({}).generate('x');
  assert.equal(contentType, 'image/png');
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('flag off, no key and cap hit give a silent fallback, write no row, and log the reason', async () => {
  const logs = [];
  for (const [e, reason] of [[{}, 'flag_off'], [{ IMAGE_GEN_ENABLED: '1' }, 'no_key'], [env({ IMAGE_GEN_DAILY_CAP: '0' }), 'cap_hit']]) {
    const sb = fakeSupabase();
    const svc = createIllustrationService({ supabase: sb, env: e, logEvent: (n, p) => logs.push([n, p.reason]) });
    const r = await svc.request('c9-physics-speed', 'scene');
    assert.deepEqual(r, { status: 'fallback', reason });
    assert.equal(sb.rows.length, 0);                       // a key added later works at once
    assert.equal((await svc.status('c9-physics-speed')).status, 'fallback');
  }
  assert.deepEqual(logs.map((l) => l[1]), ['flag_off', 'no_key', 'cap_hit']);
  assert.ok(logs.every((l) => l[0] === 'illustration.fallback'));
});

test('with a provider: pending at once, ready after, stored privately, signed URL, cache hit on the 2nd call', async () => {
  const sb = fakeSupabase();
  let generated = 0;
  const provider = { name: 'mock', model: 'mock-1', generate: async (p) => { generated++; assert.ok(p.endsWith(IMAGE_SUFFIX)); return { buffer: Buffer.from('img'), contentType: 'image/png' }; } };
  const svc = createIllustrationService({ supabase: sb, env: env(), getProviderFn: () => provider });
  const first = await svc.request('c9-physics-speed', 'A lane.');
  assert.equal(first.status, 'pending');                    // the answer never waits on the image
  assert.equal((await svc.status('c9-physics-speed')).status, 'pending');
  await tick();
  const ready = await svc.status('c9-physics-speed');
  assert.equal(ready.status, 'ready');
  assert.match(ready.url, /^https:\/\/signed\.example\/c9-physics-speed\.png\?ttl=300$/);
  assert.equal(sb.files.has('c9-physics-speed.png'), true);
  const second = await svc.request('c9-physics-speed', 'A lane.');
  assert.equal(second.status, 'ready');
  assert.equal(generated, 1);
  assert.equal(sb.rows.length, 1);
  assert.equal(sb.rows[0].provider, 'mock');
});

test('two requests at once for one concept make one picture', async () => {
  const sb = fakeSupabase();
  let generated = 0;
  const provider = { name: 'mock', model: 'm', generate: async () => { generated++; await tick(); return { buffer: Buffer.from('i'), contentType: 'image/png' }; } };
  const svc = createIllustrationService({ supabase: sb, env: env(), getProviderFn: () => provider });
  const rs = await Promise.all([svc.request('c5-maths-fractions', 's'), svc.request('c5-maths-fractions', 's'), svc.request('c5-maths-fractions', 's')]);
  assert.ok(rs.every((r) => r.status === 'pending'));
  await tick(); await tick();
  assert.equal(generated, 1);
});

test('a failing provider: the row becomes fallback (silent), it is logged, and it is retried only after an hour', async () => {
  const sb = fakeSupabase();
  const logs = [];
  let now = Date.now();
  const provider = { name: 'gemini', model: 'm', generate: async () => { throw new Error('boom'); } };
  const svc = createIllustrationService({ supabase: sb, env: env(), getProviderFn: () => provider, now: () => now, logEvent: (n, p) => logs.push(p.reason) });
  await svc.request('c9-bio-cell', 's');
  await tick();
  assert.equal((await svc.status('c9-bio-cell')).status, 'fallback');
  assert.deepEqual(logs, ['error']);
  assert.equal((await svc.request('c9-bio-cell', 's')).status, 'fallback');     // not retried at once
  now += 61 * 60 * 1000;
  provider.generate = async () => ({ buffer: Buffer.from('ok'), contentType: 'image/png' });
  assert.equal((await svc.request('c9-bio-cell', 's')).status, 'pending');
  await tick();
  assert.equal((await svc.status('c9-bio-cell')).status, 'ready');
});

test('the daily cap counts today\'s pictures of the provider', async () => {
  const sb = fakeSupabase();
  const provider = { name: 'mock', model: 'm', generate: async () => ({ buffer: Buffer.from('i'), contentType: 'image/png' }) };
  const svc = createIllustrationService({ supabase: sb, env: env({ IMAGE_GEN_DAILY_CAP: '2' }), getProviderFn: () => provider });
  assert.equal((await svc.request('k-one-aa', 's')).status, 'pending');
  assert.equal((await svc.request('k-two-aa', 's')).status, 'pending');
  assert.equal((await svc.request('k-three-a', 's')).reason, 'cap_hit');
  assert.equal(startOfIstDayUtc(Date.parse('2026-10-04T20:00:00Z')), '2026-10-04T18:30:00.000Z');
  assert.equal(startOfIstDayUtc(Date.parse('2026-10-04T10:00:00Z')), '2026-10-03T18:30:00.000Z');
});

test('signed URLs: only server-made safe paths, a clamped lifetime, never public', async () => {
  assert.equal(safeObjectPath('c9-physics-speed.png'), true);
  for (const bad of ['../x', 'a/../b', '/abs', 'a b', '', 'a'.repeat(400), null]) assert.equal(safeObjectPath(bad), false);
  assert.equal(clampTtl(undefined), 300);
  assert.equal(clampTtl(99999), 3600);
  assert.equal(clampTtl(-1), 300);
  const sb = fakeSupabase();
  assert.equal(await signedUrl(sb, BUCKET, '../etc'), null);
  assert.match(await signedUrl(sb, BUCKET, 'a.png', 60), /ttl=60$/);
  assert.equal(await uploadPrivate(sb, BUCKET, 'a.png', Buffer.from('x'), 'image/png'), true);
  assert.equal(await uploadPrivate(sb, BUCKET, '../a.png', Buffer.from('x'), 'image/png'), false);
  assert.equal(await signedUrl(null, BUCKET, 'a.png'), null);
});
