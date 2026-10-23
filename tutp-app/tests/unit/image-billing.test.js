// TUT-73: loud picture billing failures. A mocked 402, no live Gemini call.
//   node --test tests/unit/image-billing.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiProvider } from '../../server/services/image-provider.js';
import { createIllustrationService } from '../../server/services/illustration-service.js';
import { createImageBillingMonitor } from '../../server/services/image-billing-alert.js';

const KEY = 'AIza-SECRET-KEY-123';
const tick = () => new Promise((r) => setTimeout(r, 25));

// illustrations rows + a storage stand-in (same shape the service uses).
function fakeIllustrations(initial = []) {
  const rows = [...initial];
  return {
    rows,
    from(table) {
      assert.equal(table, 'illustrations');
      return {
        select() {
          const f = [];
          const b = {
            eq(c, v) { f.push((r) => r[c] === v); return b; },
            gte(c, v) { f.push((r) => r[c] >= v); return b; },
            maybeSingle: async () => ({ data: rows.find((r) => f.every((x) => x(r))) || null, error: null }),
            then: (res) => res({ count: rows.filter((r) => f.every((x) => x(r))).length, error: null }),
          };
          return b;
        },
        insert: async (row) => { rows.push({ created_at: new Date().toISOString(), ...row }); return { error: null }; },
        update(patch) {
          const f = [];
          const b = {
            eq(c, v) { f.push((r) => r[c] === v); return b; },
            then: (res) => { rows.filter((r) => f.every((x) => x(r))).forEach((r) => Object.assign(r, patch)); return res({ error: null }); },
          };
          return b;
        },
      };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  };
}

// usage_events stand-in for the monitor.
function fakeEvents(initial = [], clock = () => Date.now()) {
  const rows = [...initial];
  return {
    rows,
    from(table) {
      assert.equal(table, 'usage_events');
      return {
        select() {
          const f = [];
          const b = {
            eq(c, v) { f.push((r) => r[c] === v); return b; },
            gte(c, v) { f.push((r) => r[c] >= v); return b; },
            order() { return b; },
            limit: async () => ({ data: rows.filter((r) => f.every((x) => x(r))), error: null }),
          };
          return b;
        },
        insert: async (row) => { rows.push({ id: String(rows.length + 1), created_at: new Date(clock()).toISOString(), ...row }); return { error: null }; },
      };
    },
  };
}

const failRow = (status, feature, at) => ({ event_name: 'image_billing_fail', created_at: at || new Date().toISOString(), properties: { status, feature, concept_key: 'k' } });

function capture() {
  const lines = [];
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => lines.push(a.join(' ')); console.warn = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  return { lines, restore() { Object.assign(console, o); } };
}

const env402 = { GEMINI_IMAGE_API_KEY: KEY, IMAGE_GEN_ENABLED: '1' };
const fetch402 = async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'x' } }) });

test('a 402 from Gemini gives one WARNING line, one event, one alert check, and no secret', async () => {
  const sb = fakeIllustrations(); const events = []; let alerts = 0;
  const svc = createIllustrationService({
    supabase: sb, env: env402, getProviderFn: (e) => geminiProvider(e, fetch402),
    logEvent: (n, p) => events.push([n, p]), onBillingFail: () => { alerts++; },
  });
  const cap = capture();
  try { await svc.request('c9-test-concept', 'scene', { feature: 'story' }); await tick(); } finally { cap.restore(); }
  const warn = cap.lines.filter((l) => l.includes('image_billing_fail'));
  assert.equal(warn.length, 1);
  const j = JSON.parse(warn[0]);
  assert.deepEqual([j.severity, j.event, j.status, j.concept_key, j.feature], ['WARNING', 'image_billing_fail', 402, 'c9-test-concept', 'story']);
  assert.equal(events.filter(([n]) => n === 'image_billing_fail').length, 1);
  assert.equal(alerts, 1);
  assert.ok(!cap.lines.join('\n').includes(KEY) && !cap.lines.join('\n').includes('x-goog-api-key'));
  assert.ok(!JSON.stringify(events).includes(KEY));
});

test('429 and a 500 also count; a missing key, flag off or the mock provider do not', async () => {
  for (const status of [429, 500]) {
    const events = [];
    const svc = createIllustrationService({
      supabase: fakeIllustrations(), env: env402, getProviderFn: (e) => geminiProvider(e, async () => ({ ok: false, status })),
      logEvent: (n, p) => events.push([n, p]),
    });
    const cap = capture();
    try { await svc.request('k-' + status, 's'); await tick(); } finally { cap.restore(); }
    assert.equal(events.filter(([n]) => n === 'image_billing_fail')[0][1].status, status);
  }
  for (const e of [{ IMAGE_GEN_ENABLED: '1' }, { GEMINI_IMAGE_API_KEY: KEY }, { IMAGE_GEN_ENABLED: '1', IMAGE_PROVIDER: 'mock' }]) {
    const events = []; let alerts = 0;
    const svc = createIllustrationService({
      supabase: fakeIllustrations(), env: e, logEvent: (n, p) => events.push([n, p]), onBillingFail: () => { alerts++; },
    });
    const cap = capture();
    try { await svc.request('k-cfg', 's'); await tick(); } finally { cap.restore(); }
    assert.equal(events.filter(([n]) => n === 'image_billing_fail').length, 0);
    assert.equal(alerts, 0);
  }
});

test('a cached picture writes no failure and no image_generated line', async () => {
  const sb = fakeIllustrations([{ concept_key: 'cached', status: 'ready', created_at: new Date().toISOString() }, { concept_key: 'failed', status: 'fallback', reason: 'error', created_at: new Date().toISOString() }]);
  const events = []; let calls = 0;
  const svc = createIllustrationService({
    supabase: sb, env: env402, getProviderFn: (e) => geminiProvider(e, async () => { calls++; return fetch402(); }),
    logEvent: (n, p) => events.push([n, p]), onBillingFail: () => { calls += 100; },
  });
  const cap = capture();
  try { await svc.request('cached', 's'); await svc.request('failed', 's'); await tick(); } finally { cap.restore(); }
  assert.equal(calls, 0);
  assert.ok(!cap.lines.some((l) => l.includes('image_generated') || l.includes('image_billing_fail')));
  assert.equal(events.filter(([n]) => n === 'image_billing_fail').length, 0);
});

test('a success logs one image_generated line with the model, and no failure', async () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('png').toString('base64'), mimeType: 'image/png' } }] } }] }) });
  const events = []; let alerts = 0;
  const svc = createIllustrationService({
    supabase: fakeIllustrations(), env: { ...env402, GEMINI_IMAGE_MODEL: 'gemini-test-model' }, getProviderFn: (e) => geminiProvider(e, okFetch),
    logEvent: (n, p) => events.push([n, p]), onBillingFail: () => { alerts++; }, checkFn: async () => null,
  });
  const cap = capture();
  try { await svc.request('good-concept', 's', { feature: 'notes' }); await tick(); } finally { cap.restore(); }
  const ok = cap.lines.filter((l) => l.includes('image_generated'));
  assert.equal(ok.length, 1);
  const j = JSON.parse(ok[0]);
  assert.deepEqual([j.severity, j.event, j.model, j.concept_key, j.feature], ['INFO', 'image_generated', 'gemini-test-model', 'good-concept', 'notes']);
  assert.equal(events.filter(([n]) => n === 'image_billing_fail').length, 0);
  assert.equal(alerts, 0);
});

test('two requests for one concept at once make one generation and one line', async () => {
  let calls = 0;
  const slow = async () => { calls++; return { ok: false, status: 402 }; };
  const sb = fakeIllustrations();
  const svc = createIllustrationService({ supabase: sb, env: env402, getProviderFn: (e) => geminiProvider(e, slow), checkFn: async () => null });
  const cap = capture();
  try { await Promise.all([svc.request('same', 's'), svc.request('same', 's')]); await tick(); } finally { cap.restore(); }
  assert.ok(calls <= 2);
  assert.ok(cap.lines.filter((l) => l.includes('image_billing_fail')).length === calls);
});

test('50 failures send one email; the next day sends a new one', async () => {
  let t = Date.parse('2026-10-22T06:00:00Z');
  const ev = fakeEvents(Array.from({ length: 50 }, () => failRow(402, 'story', new Date(t - 1000).toISOString())), () => t);
  const mails = [];
  const mon = createImageBillingMonitor({ supabase: ev, sendEmail: async (to, s, b) => { mails.push({ to, s, b }); }, to: 'f@example.com', now: () => t });
  for (let i = 0; i < 50; i++) { await mon.checkAndAlert(); t += 11 * 60 * 1000; if (t > Date.parse('2026-10-22T12:00:00Z')) t = Date.parse('2026-10-22T12:00:00Z'); }
  assert.equal(mails.length, 1);
  assert.match(mails[0].s, /^Tut-P: picture generation failing \(HTTP 402\) since 2026-10-22 11:\d\d IST$/);
  assert.match(mails[0].b, /story: 50/);
  assert.match(mails[0].b, /top up Prepay - AI Studio/i);
  // 25 h later, a fresh failure: a new email.
  t += 25 * 60 * 60 * 1000;
  ev.rows.push(failRow(429, 'notes', new Date(t - 1000).toISOString()));
  await mon.checkAndAlert();
  assert.equal(mails.length, 2);
  assert.match(mails[1].s, /HTTP 429/);
});

test('no failures means no email and an empty summary; a broken mailer or database never throws', async () => {
  const ev = fakeEvents();
  const mails = [];
  const mon = createImageBillingMonitor({ supabase: ev, sendEmail: async (...a) => { mails.push(a); }, to: 'f@example.com' });
  assert.equal(await mon.checkAndAlert(), false);
  assert.deepEqual(await mon.summary(), { count: 0, first_seen: null, last_status: null });
  assert.equal(mails.length, 0);
  const ev2 = fakeEvents([failRow(402, 'story')]);
  const cap = capture();
  try {
    const bad = createImageBillingMonitor({ supabase: ev2, sendEmail: async () => { throw new Error('smtp down'); }, to: 'f@example.com' });
    assert.equal(await bad.checkAndAlert(), false);
    const broken = createImageBillingMonitor({ supabase: { from: () => { throw new Error('db down'); } }, sendEmail: async () => {}, to: 'f@example.com' });
    assert.equal(await broken.checkAndAlert(), false);
  } finally { cap.restore(); }
});

test('an empty ADMIN_NOTIFY_EMAIL logs a WARNING, sends nothing and writes no marker', async () => {
  const ev = fakeEvents([failRow(402, 'story')]);
  const mails = [];
  const mon = createImageBillingMonitor({ supabase: ev, sendEmail: async (...a) => { mails.push(a); }, to: '' });
  const cap = capture();
  try { assert.equal(await mon.checkAndAlert(), false); } finally { cap.restore(); }
  assert.equal(mails.length, 0);
  assert.equal(ev.rows.filter((r) => r.event_name === 'image_billing_alert_sent').length, 0);
  const w = JSON.parse(cap.lines.find((l) => l.includes('image_billing_alert_no_recipient')));
  assert.equal(w.severity, 'WARNING');
});

test('the summary counts the last 24 h, ignores older rows, and the email holds no secret', async () => {
  const t = Date.parse('2026-10-22T06:00:00Z');
  const ev = fakeEvents([failRow(402, 'story', new Date(t - 30 * 3600 * 1000).toISOString()), failRow(402, 'story', new Date(t - 3600 * 1000).toISOString()), failRow(429, 'notes', new Date(t - 60 * 1000).toISOString())]);
  const mails = [];
  const mon = createImageBillingMonitor({ supabase: ev, sendEmail: async (to, s, b) => { mails.push(s + b); }, to: 'f@example.com', now: () => t });
  const s = await mon.summary();
  assert.equal(s.count, 2);
  assert.equal(s.last_status, 429);
  assert.equal(s.first_seen, new Date(t - 3600 * 1000).toISOString());
  await mon.checkAndAlert();
  assert.ok(!mails.join('').includes(KEY));
});
