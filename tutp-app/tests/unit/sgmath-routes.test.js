// Singapore Maths routes against an in-memory Supabase (TUT-43 spec section 10, risks 5, 6,
// 9, 10, 13, 14): node --test tests/unit/sgmath-routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSingaporeMathsRoutes, cleanBuilt } from '../../server/routes/singapore-maths.js';
import { LANGUAGES, STRINGS } from '../../server/sgmath/strings-seed.js';
import { problemById, weekStartIst } from '../../server/sgmath/core.js';
import { randomUUID } from 'crypto';

// ---- a small Supabase query-builder fake (only what the routes use) --------------
function fakeSupabase(tables, { failTables = [] } = {}) {
  const uniqueFreeWeek = (rows, row) => row.gate === 'free_weekly' && row.week_start && rows.some((r) => r !== row && r.student_id === row.student_id && r.gate === 'free_weekly' && r.week_start === row.week_start);
  return {
    from(name) {
      const rows = (tables[name] ||= []);
      const st = { filters: [], op: 'select', order: null, limit: null, head: false, count: false, single: false, maybe: false, payload: null, returning: false };
      const match = (r) => st.filters.every((f) => f(r));
      async function run() {
        if (failTables.includes(name)) return { data: null, error: { message: 'relation does not exist', code: '42P01' } };
        if (st.op === 'insert') {
          const list = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => ({ id: randomUUID(), started_at: new Date().toISOString(), status: 'open', concrete: null, pictorial_started_at: null, week_start: null, created_at: new Date().toISOString(), ...p }));
          rows.push(...list);
          return { data: st.single ? list[0] : list, error: null };
        }
        if (st.op === 'update') {
          const hit = rows.filter(match);
          for (const r of hit) {
            const before = { ...r };
            Object.assign(r, st.payload);
            if (name === 'sgmath_sessions' && uniqueFreeWeek(rows, r)) { Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, before); return { data: null, error: { code: '23505', message: 'duplicate key' } }; }
          }
          return { data: st.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
        }
        if (st.op === 'upsert') {
          const keys = st.conflict.split(',');
          const ex = rows.find((r) => keys.every((k) => r[k] === st.payload[k]));
          if (ex) Object.assign(ex, st.payload); else rows.push({ id: randomUUID(), created_at: new Date().toISOString(), ...st.payload });
          return { data: null, error: null };
        }
        if (st.op === 'delete') {
          const keep = rows.filter((r) => !match(r));
          const gone = rows.filter(match);
          rows.splice(0, rows.length, ...keep);
          if (name === 'sgmath_sessions') { const ids = new Set(gone.map((r) => r.id)); const a = tables.sgmath_attempts || []; tables.sgmath_attempts = a.filter((x) => !ids.has(x.session_id)); }
          return { data: null, error: null };
        }
        let out = rows.filter(match);
        if (st.order) out = out.slice().sort((a, b) => (a[st.order.col] > b[st.order.col] ? 1 : -1) * (st.order.asc ? 1 : -1));
        if (st.limit != null) out = out.slice(0, st.limit);
        if (st.head) return { data: null, count: out.length, error: null };
        if (st.single || st.maybe) return { data: out[0] || null, error: null };
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      const b = {
        select(_c, opts = {}) { if (st.op === 'select') { st.head = !!opts.head; st.count = !!opts.count; } else st.returning = true; return b; },
        insert(p) { st.op = 'insert'; st.payload = p; return b; },
        update(p) { st.op = 'update'; st.payload = p; return b; },
        upsert(p, o) { st.op = 'upsert'; st.payload = p; st.conflict = o.onConflict; return b; },
        delete() { st.op = 'delete'; return b; },
        eq(c, v) { st.filters.push((r) => String(r[c]) === String(v)); return b; },
        in(c, v) { st.filters.push((r) => v.map(String).includes(String(r[c]))); return b; },
        gte(c, v) { st.filters.push((r) => String(r[c]) >= String(v)); return b; },
        is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return b; },
        order(col, o = {}) { st.order = { col, asc: o.ascending !== false }; return b; },
        limit(n) { st.limit = n; return b; },
        single() { st.single = true; return b; },
        maybeSingle() { st.maybe = true; return b; },
        then(res, rej) { return run().then(res, rej); },
      };
      return b;
    },
  };
}

function seedTables() {
  const strings = [];
  for (const l of LANGUAGES) for (const [key, text] of Object.entries(STRINGS[l.code])) strings.push({ lang: l.code, key, text });
  return {
    sgmath_languages: LANGUAGES.map((l) => ({ ...l })),
    sgmath_strings: strings,
    sgmath_sessions: [], sgmath_attempts: [], usage_events: [], payments: [], member_visibility_rules: [],
    students: [
      { id: 'kid-free', family_id: 1, class: 'Class 3' },
      { id: 'kid-pro', family_id: 1, class: 'Class 4' },
      { id: 'kid-max', family_id: 1, class: 'Class 6' },
      { id: 'kid-big', family_id: 1, class: 'Class 8' },
      { id: 'other-kid', family_id: 2, class: 'Class 4' },
    ],
  };
}

function harness({ tiers = { 'kid-free': 'free', 'kid-pro': 'pro', 'kid-max': 'max', 'kid-big': 'max', 'other-kid': 'pro' }, session = { familyId: 1, viewerKey: 'mother:1' }, failTables, clock } = {}) {
  const tables = seedTables();
  const supabase = fakeSupabase(tables, { failTables });
  const routes = {};
  const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post: (p, ...h) => { routes['POST ' + p] = h[h.length - 1]; } };
  const events = [];
  const state = { session };
  registerSingaporeMathsRoutes(app, {
    rateLimit: () => (req, res, next) => next(),
    supabase,
    getSession: () => state.session,
    requireOwnStudent: async (req, res, id) => {
      if (!state.session) { res.status(401).json({ error: 'session_expired' }); return null; }
      const s = tables.students.find((x) => x.id === id);
      if (!s || s.family_id !== state.session.familyId) { res.status(403).json({ error: 'Forbidden' }); return null; }
      return state.session;
    },
    sendSessionExpired: (res) => res.status(401).json({ error: 'session_expired' }),
    sendForbidden: (res) => res.status(403).json({ error: 'Forbidden' }),
    requireAdmin: (req, res, next) => next(),
    tierForStudent: async (id) => tiers[id] || 'free',
    trackSessionStarted: (...a) => events.push(['started', ...a]),
    trackSessionCompleted: (...a) => events.push(['completed', ...a]),
    trackSgmathEvent: (...a) => events.push(a),
    now: clock || (() => Date.now()),
  });
  async function call(method, path, { body, query, params, headers = {} } = {}) {
    const key = method + ' ' + path;
    const handler = routes[key];
    assert.ok(handler, 'no route ' + key);
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; }, set() { return res; } };
    const req = { body: body || {}, query: query || {}, params: params || {}, get: (h) => headers[h.toLowerCase()] };
    await handler(req, res);
    return out;
  }
  return { call, tables, events, state };
}

const startFor = (h, kid, extra = {}) => h.call('POST', '/api/sgmath/session/start', { body: { studentId: kid, language: 'en', ...extra } });
const buildCorrect = (p) => {
  const u = p.spec.unknown;
  return {
    bars: p.spec.bars.map((b, i) => ({
      segments: b.segments.map((g, j) => {
        const seg = { units: g.units, ...(g.shaded ? { shaded: true } : {}) };
        if (p.spec.kind === 'parts') seg.label = (!u.total && u.bar === i && u.segment === j) ? '?' : String(g.units * p.spec.unit);
        if (p.spec.kind === 'lengths') seg.label = (u.total && u.bar === i) ? '?' : String(g.units * p.spec.unit);
        return seg;
      }),
    })),
  };
};

test('Free child: start is 402 locked, the preview has a picture and a question but no answer or spec', async () => {
  const h = harness();
  const r = await startFor(h, 'kid-free');
  assert.equal(r.status, 402);
  assert.equal(r.body.error, 'locked');
  const pv = await h.call('GET', '/api/sgmath/preview', { query: { studentId: 'kid-free' } });
  assert.equal(pv.status, 200);
  assert.match(pv.body.svg, /^<svg /);
  assert.ok(pv.body.question.length > 20);
  for (const k of ['answer', 'spec', 'equation', 'equationOptions']) assert.equal(pv.body[k], undefined);
  assert.equal((await h.call('GET', '/api/sgmath/card', { query: { studentId: 'kid-free' } })).body.state, 'locked');
});

test('Pro child: one free session a week, used when the Pictorial starts; the second is 409 free_used', async () => {
  const h = harness();
  const a = await startFor(h, 'kid-pro', { gate: 'max', tier: 'max', week: '1999-01-01' });   // forged fields are ignored
  assert.equal(a.status, 200);
  assert.equal(a.body.session.gate, 'free_weekly');
  assert.equal((await h.call('GET', '/api/sgmath/card', { query: { studentId: 'kid-pro' } })).body.state, 'free_left');
  const id = a.body.session.id;
  assert.equal((await h.call('POST', '/api/sgmath/session/:id/pictorial', { params: { id } })).status, 200);
  assert.equal(h.tables.sgmath_sessions[0].week_start, weekStartIst(Date.now()));
  await h.call('POST', '/api/sgmath/session/:id/finish', { params: { id } });
  const b = await startFor(h, 'kid-pro');
  assert.equal(b.status, 409);
  assert.equal(b.body.error, 'free_used');
  assert.equal(b.body.maxBuyable, false);
  assert.equal((await h.call('GET', '/api/sgmath/card', { query: { studentId: 'kid-pro' } })).body.state, 'free_used');
});

test('two parallel Pictorial starts in the same week leave exactly one free session used', async () => {
  const h = harness();
  const s1 = (await startFor(h, 'kid-pro')).body.session.id;
  h.tables.sgmath_sessions.push({ ...h.tables.sgmath_sessions[0], id: randomUUID(), pictorial_started_at: null, week_start: null });
  const s2 = h.tables.sgmath_sessions[1].id;
  const [r1, r2] = await Promise.all([s1, s2].map((id) => h.call('POST', '/api/sgmath/session/:id/pictorial', { params: { id } })));
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(h.tables.sgmath_sessions.filter((s) => s.week_start).length, 1);
});

test('next IST week (Monday 00:00 IST) the Pro child gets a new free session', async () => {
  let t = Date.parse('2026-10-18T23:00:00+05:30');
  const h = harness({ clock: () => t });
  const id = (await startFor(h, 'kid-pro')).body.session.id;
  await h.call('POST', '/api/sgmath/session/:id/pictorial', { params: { id } });
  await h.call('POST', '/api/sgmath/session/:id/finish', { params: { id } });
  t = Date.parse('2026-10-18T23:59:00+05:30');
  assert.equal((await startFor(h, 'kid-pro')).status, 409);
  t = Date.parse('2026-10-19T00:00:00+05:30');
  assert.equal((await startFor(h, 'kid-pro')).status, 200);
});

test('Max child (TEST tier): unlimited sessions, no 409', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    const r = await startFor(h, 'kid-max');
    assert.equal(r.status, 200);
    assert.equal(r.body.session.gate, 'max');
    await h.call('POST', '/api/sgmath/session/:id/pictorial', { params: { id: r.body.session.id } });
    await h.call('POST', '/api/sgmath/session/:id/finish', { params: { id: r.body.session.id } });
  }
});

test('grade 8 gets a clear "not yet" (422), never an empty session', async () => {
  const h = harness();
  const r = await startFor(h, 'kid-big');
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'grade_not_supported');
});

test('judging: hint after a wrong build, reveal and answer only when done, abstract only after the picture', async () => {
  const h = harness();
  h.tables.sgmath_attempts.push({ session_id: 'x', student_id: 'kid-max', problem_id: 'part_whole-g6-d1-0', problem_index: 0, model_type: 'part_whole', difficulty: 1, step: 'pictorial', correct: true, done: true, tries: 1, created_at: '2026-10-01T00:00:00Z' });
  const start = await startFor(h, 'kid-max');
  const s = start.body.session;
  assert.equal(s.diagnostic, false);
  const json = JSON.stringify(s);
  const p = problemById(h.tables.sgmath_sessions.at(-1).problems[0]);
  assert.ok(!json.includes('"answer"') && !json.includes('"spec"'), 'no answer or spec reaches the page');
  const id = s.id;
  const early = await h.call('POST', '/api/sgmath/session/:id/attempt', { params: { id }, body: { index: 0, step: 'pictorial', built: buildCorrect(p) } });
  assert.equal(early.status, 409);
  await h.call('POST', '/api/sgmath/session/:id/pictorial', { params: { id } });
  assert.equal((await h.call('POST', '/api/sgmath/session/:id/attempt', { params: { id }, body: { index: 0, step: 'abstract', equation: p.equation, answer: p.answer } })).status, 409);
  const wrong = await h.call('POST', '/api/sgmath/session/:id/attempt', { params: { id }, body: { index: 0, step: 'pictorial', built: { bars: p.spec.bars.map(() => ({ segments: [{ units: 1 }] })) } } });
  assert.equal(wrong.body.correct, false);
  assert.equal(wrong.body.done, false);
  assert.ok(wrong.body.hint);
  assert.equal(wrong.body.reveal, undefined);
  const right = await h.call('POST', '/api/sgmath/session/:id/attempt', { params: { id }, body: { index: 0, step: 'pictorial', built: buildCorrect(p) } });
  assert.equal(right.body.correct, true, JSON.stringify(right.body));
  assert.match(right.body.reveal, /^<svg /);
  const badEq = await h.call('POST', '/api/sgmath/session/:id/attempt', { params: { id }, body: { index: 0, step: 'abstract', equation: p.equationOptions.find((e) => e !== p.equation), answer: p.answer } });
  assert.equal(badEq.body.reason, 'equation');
  assert.equal(badEq.body.answer, undefined);
  const ok = await h.call('POST', '/api/sgmath/session/:id/attempt', { params: { id }, body: { index: 0, step: 'abstract', equation: p.equation, answer: String(p.answer) } });
  assert.equal(ok.body.correct, true);
  assert.equal(ok.body.answer, p.answer);
  const fin = await h.call('POST', '/api/sgmath/session/:id/finish', { params: { id } });
  assert.ok(fin.body.minutes >= 1);
  assert.match(fin.body.replay, /^<svg /);
});

test('three wrong tries end the step with the model shown; no model call is ever made', async () => {
  const h = harness();
  const s = (await startFor(h, 'kid-max')).body.session;
  await h.call('POST', '/api/sgmath/session/:id/pictorial', { params: { id: s.id } });
  let r;
  for (let i = 0; i < 3; i++) r = await h.call('POST', '/api/sgmath/session/:id/attempt', { params: { id: s.id }, body: { index: 0, step: 'pictorial', built: null } });
  assert.equal(r.body.done, true);
  assert.equal(r.body.correct, false);
  assert.match(r.body.reveal, /^<svg /);
  assert.equal(h.tables.sgmath_sessions[0].ai_hints_used ?? 0, 0);
});

test('"We did it" without a signed-in viewer key is not counted as parent participation', async () => {
  const h = harness({ session: { familyId: 1, viewerKey: null } });
  h.tables.sgmath_attempts.push({ session_id: 'x', student_id: 'kid-max', problem_id: 'part_whole-g6-d1-0', problem_index: 0, model_type: 'part_whole', difficulty: 1, step: 'pictorial', correct: true, done: true, tries: 1, created_at: '2026-10-01T00:00:00Z' });
  const s = (await startFor(h, 'kid-max')).body.session;
  await h.call('POST', '/api/sgmath/session/:id/concrete', { params: { id: s.id }, body: { action: 'done' } });
  const ev = h.events.find((e) => e[0] === 'sgmath.concrete_done');
  assert.equal(ev[3].participation, false);
});

test('privacy: another family\'s child is 403; a member whose activities are hidden is 403', async () => {
  const h = harness();
  assert.equal((await h.call('GET', '/api/sgmath/progress', { query: { studentId: 'other-kid' } })).status, 403);
  assert.equal((await startFor(h, 'other-kid')).status, 403);
  const own = (await startFor(h, 'kid-max')).body.session.id;
  h.state.session = { familyId: 2, viewerKey: 'mother:2' };
  assert.equal((await h.call('GET', '/api/sgmath/session/:id', { params: { id: own } })).status, 403);
  h.state.session = { familyId: 1, viewerKey: 'member:9', mids: ['m9'] };
  h.tables.member_visibility_rules.push({ family_id: 1, family_member_id: 'm9', feature_name: 'activities', is_visible: false });
  assert.equal((await h.call('GET', '/api/sgmath/progress', { query: { studentId: 'kid-max' } })).status, 403);
  h.state.session = null;
  assert.equal((await startFor(h, 'kid-max')).status, 401);
});

test('before migration 033 runs, every route answers 503 not_ready', async () => {
  const h = harness({ failTables: ['sgmath_strings'] });
  assert.equal((await startFor(h, 'kid-max')).status, 503);
  assert.equal((await h.call('GET', '/api/sgmath/strings', { query: { lang: 'te' } })).status, 503);
});

test('strings: Telugu rows, English per missing key, templates and hints are not sent to the page', async () => {
  const h = harness();
  h.tables.sgmath_strings = h.tables.sgmath_strings.filter((r) => !(r.lang === 'te' && r.key === 'page.start'));
  const r = await h.call('GET', '/api/sgmath/strings', { query: { lang: 'te' } });
  assert.equal(r.body.lang, 'te');
  assert.equal(r.body.strings['page.title'], STRINGS.te['page.title']);
  assert.equal(r.body.strings['page.start'], STRINGS.en['page.start']);
  assert.ok(!Object.keys(r.body.strings).some((k) => k.startsWith('tpl.') || k.startsWith('hint.')));
  assert.equal((await h.call('GET', '/api/sgmath/strings', { query: { lang: 'xx' } })).body.lang, 'en');
});

test('cleanBuilt drops anything that is not units, shading or a short label', () => {
  const spec = { bars: [{ segments: [{ units: 1 }] }] };
  const c = cleanBuilt({ bars: [{ segments: [{ units: '3', shaded: 1, label: 'x'.repeat(50), evil: '<script>' }] }] }, spec);
  assert.deepEqual(c, { bars: [{ segments: [{ units: 3, shaded: true, label: 'x'.repeat(12) }] }] });
  assert.equal(cleanBuilt({ bars: [] }, spec), null);
});
