// Unit tests for the Library list paging in server/library.js (TUT-69). Run: npm run test:unit
// A small in-memory stand-in for the supabase query builder, covering only what GET /api/library calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLibraryRoutes, parseCursor, makeCursor, PAGE_SIZE } from '../../server/library.js';

const SID = '11111111-1111-4111-8111-111111111111';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SAME = '2026-10-23T11:42:07.0753+00:00';

function fakeSupabase(rows) {
  const from = () => {
    const f = { eq: [], in: [], order: [], lt: null, or: null, nulls: [], limit: 1e9, cols: '' };
    const q = {
      select(cols) { f.cols = cols; return q; },
      eq(k, v) { f.eq.push([k, v]); return q; },
      in(k, v) { f.in.push([k, v]); return q; },
      is(k, v) { f.nulls.push([k, v]); return q; },
      order(k, o) { f.order.push([k, o.ascending]); return q; },
      limit(n) { f.limit = n; return q; },
      lt(k, v) { f.lt = [k, v]; return q; },
      or(s) { f.or = s; return q; },
      then(resolve, reject) {
        try {
          let out = rows.filter(r => f.eq.every(([k, v]) => r[k] === v) && f.in.every(([k, v]) => v.includes(r[k])));
          if (f.lt) out = out.filter(r => r[f.lt[0]] < f.lt[1]);
          if (f.or) {
            // created_at.lt.A,and(created_at.eq.A,id.lt.B), the only shape the route sends
            const m = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)$/.exec(f.or);
            assert.ok(m && m[1] === m[2], 'unexpected or() filter: ' + f.or);
            out = out.filter(r => r.created_at < m[1] || (r.created_at === m[1] && r.id < m[3]));
          }
          out = out.map((r, i) => [r, i]).sort(([a, ai], [b, bi]) => {
            for (const [k, asc] of f.order) { if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1); }
            return ai - bi;
          }).map(([r]) => r).slice(0, f.limit);
          resolve({ data: out.map(r => ({ ...r })), error: null });
        } catch (e) { (reject || (() => { throw e; }))(e); }
      },
    };
    return q;
  };
  return { from };
}

function listRoute(rows) {
  let handler = null;
  const app = { get(p, ...h) { if (p === '/api/library') handler = h[h.length - 1]; }, post() {}, patch() {}, put() {}, delete() {} };
  registerLibraryRoutes(app, {
    supabase: fakeSupabase(rows),
    getSession: () => ({ familyId: 1 }),
    requireOwnStudent: async () => ({ familyId: 1 }),
    sendForbidden() {}, sendSessionExpired() {},
    getPaidStatusForStudents: async () => ({ [SID]: { active: true } }),
    rateLimit: () => (req, res, next) => next && next(),
  });
  return async (query) => {
    let status = 200, body = null;
    const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; }, headersSent: false };
    await handler({ query: { studentId: SID, ...query }, get: () => '' }, res);
    return { status, body };
  };
}

async function pageAll(call) {
  const pages = []; let cursor = '';
  for (let i = 0; i < 20; i++) {
    const r = await call(cursor ? { cursor } : {});
    assert.equal(r.status, 200);
    pages.push(r.body.items.map(x => x.id));
    if (!r.body.next) break;
    cursor = r.body.next;
  }
  return pages;
}

const mk = (n, at) => ({ id: uuid(n), student_id: SID, mode: 'explain', subject: 'Maths', topic: null, lesson_label: null, title: 'T' + n, language: 'English', imported: false, created_at: typeof at === 'function' ? at(n) : at });

test('75 items with one created_at page as 30 + 30 + 15, no overlap, no gaps', async () => {
  const rows = Array.from({ length: 75 }, (_, i) => mk(i + 1, SAME));
  const pages = await pageAll(listRoute(rows));
  assert.deepEqual(pages.map(p => p.length), [PAGE_SIZE, PAGE_SIZE, 15]);
  const all = pages.flat();
  assert.equal(new Set(all).size, 75, 'an item was repeated');
  assert.deepEqual(new Set(all), new Set(rows.map(r => r.id)), 'an item was skipped');
});

test('ties that straddle a page edge, mixed with distinct times, still page cleanly', async () => {
  // 20 newer items, then 25 sharing one time (the page edge falls inside them), then 10 older ones.
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => mk(i + 1, `2026-10-23T12:${String(i).padStart(2, '0')}:00+00:00`)),
    ...Array.from({ length: 25 }, (_, i) => mk(100 + i, SAME)),
    ...Array.from({ length: 10 }, (_, i) => mk(200 + i, `2026-01-01T00:0${i}:00+00:00`)),
  ];
  const pages = await pageAll(listRoute(rows));
  assert.deepEqual(pages.map(p => p.length), [30, 25]);
  assert.deepEqual(new Set(pages.flat()), new Set(rows.map(r => r.id)));
  assert.equal(pages.flat().length, 55);
});

test('a cursor is time and id together; a bare time (older page) still works; junk is a 400', async () => {
  const row = mk(7, SAME);
  assert.equal(makeCursor(row), `${SAME}|${uuid(7)}`);
  assert.deepEqual(parseCursor(makeCursor(row)), { at: SAME, id: uuid(7) });
  assert.deepEqual(parseCursor(SAME), { at: SAME, id: null });
  assert.equal(parseCursor('x'), null);
  assert.equal(parseCursor(`${SAME}|not-a-uuid`), null);
  assert.equal(parseCursor(`${SAME},id.gt.0`), null, 'a filter fragment must not pass');
  const call = listRoute(Array.from({ length: 5 }, (_, i) => mk(i + 1, SAME)));
  assert.equal((await call({ cursor: 'a,b)' })).status, 400);
  assert.equal((await call({ cursor: SAME })).status, 200);
});
