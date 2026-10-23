// Client-side tests for public/app/shared/library.js (TUT-69). Run: npm run test:unit
// library.js runs on a small fake DOM. The dashboards pick the child after the page loads (tutpChildReady),
// so the Library mounts with no child first and again once the child is known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../../public/app/shared/library.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

// Just enough DOM for the list: elements with children, text, classes and click listeners.
function fakeDom() {
  const docListeners = {};
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.attrs = {}; this.listeners = {}; this.parent = null; this._text = ''; this.type = ''; this.style = {}; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    click() {
      (docListeners.click || []).forEach(f => f({ target: this }));
      (this.listeners.click || []).forEach(f => f({ target: this }));
    }
    all(pred, out = []) { this.children.forEach(c => { if (pred(c)) out.push(c); c.all(pred, out); }); return out; }
  }
  const root = new El('div');
  const byClass = (n) => root.all(c => c.className.split(' ').includes(n));
  const document = {
    readyState: 'complete', head: new El('head'), body: new El('body'),
    createElement: (t) => new El(t),
    getElementById: (id) => (id === 'tutpLibrary' ? root : null),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
  };
  return { document, root, cards: () => byClass('tl-card').length, cardEls: () => byClass('tl-card'), more: () => byClass('tl-more')[0] };
}

const pageOf = (items, next) => ({ items, next, subjects: [{ subject: 'Maths', count: 60 }], upsell: null });
const rowsFor = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: tag + i, mode: 'explain', subject: 'Maths', title: tag + ' item ' + i, created_at: '2026-10-23T10:00:00+00:00' }));

// onFetch(url, calls) returns the response body, or a promise of it, so a test can hold a reply back.
async function boot(onFetch, extra) {
  const dom = fakeDom();
  const store = {};
  const calls = [];
  let ready;
  const childReady = new Promise(r => { ready = r; });
  const fetchFake = async (url) => {
    const kind = /cursor=/.test(url) ? 'cursor' : 'first';
    calls.push(kind);
    const body = await onFetch(url, kind);
    return { ok: true, status: 200, json: async () => body };
  };
  const sandbox = {
    document: dom.document, location: { pathname: '/app/mother/' }, fetch: fetchFake, setTimeout, console,
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    localStorage: { getItem: () => null, removeItem() {} },
    tutpChildReady: childReady,
    ...(extra || {}),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { dom, calls, store, ready };
}

const sidOf = (url) => (/studentId=([^&]+)/.exec(url) || [])[1];

test('Show more after a late tutpChildReady adds a page; it never shrinks the list or refetches page 1', async () => {
  const { dom, calls, store, ready } = await boot((url, kind) => pageOf(rowsFor(kind === 'cursor' ? 'b' : 'a', 30), kind === 'cursor' ? null : 'c1'));
  await wait(20);
  assert.deepEqual(calls, [], 'no child yet, so nothing to fetch');
  store.tutp_student_id = A;
  ready();
  await wait(50);
  assert.equal(dom.cards(), 30);
  assert.deepEqual(calls, ['first']);
  dom.more().click();
  await wait(50);
  assert.equal(dom.cards(), 60, 'Show more should add the second page');
  await wait(400); // past the 250 ms child-change check that every click schedules
  assert.equal(dom.cards(), 60, 'the list shrank after the click');
  assert.deepEqual(calls, ['first', 'cursor'], 'page 1 was fetched again');
});

test('a real child switch still reloads the list from page 1', async () => {
  const { dom, calls, store, ready } = await boot((url) => pageOf(rowsFor(sidOf(url) === A ? 'A' : 'B', 3), null));
  store.tutp_student_id = A;
  ready();
  await wait(50);
  store.tutp_student_id = B;
  dom.root.click();
  await wait(400);
  assert.deepEqual(calls, ['first', 'first']);
  assert.ok(/B item 0/.test(dom.root.textContent) && !/A item/.test(dom.root.textContent));
});

test('a child switch during an in-flight load: the old reply arrives last and is dropped', async () => {
  const held = {};
  const { dom, store, ready } = await boot((url) => {
    const who = sidOf(url) === A ? 'A' : 'B';
    if (who === 'A') return new Promise(r => { held.releaseA = () => r(pageOf(rowsFor('A', 3), null)); });
    return pageOf(rowsFor('B', 3), null);
  });
  store.tutp_student_id = A;
  ready();
  await wait(30); // A's first page is now in flight
  store.tutp_student_id = B;
  dom.root.click();
  await wait(400); // B mounts and loads
  assert.ok(/B item 0/.test(dom.root.textContent), 'B should be showing');
  held.releaseA(); // the slow reply for A lands after B's
  await wait(50);
  assert.ok(!/A item/.test(dom.root.textContent), 'the old child’s items overwrote the new child’s list');
  assert.equal(dom.cards(), 3);
});

test('a Show more reply for the old child is not appended to the new child’s list', async () => {
  const held = {};
  const { dom, store, ready } = await boot((url, kind) => {
    const who = sidOf(url) === A ? 'A' : 'B';
    if (who === 'A' && kind === 'cursor') return new Promise(r => { held.releaseA = () => r(pageOf(rowsFor('A2', 3), null)); });
    return pageOf(rowsFor(who, 3), who === 'A' ? 'c1' : null);
  });
  store.tutp_student_id = A;
  ready();
  await wait(50);
  dom.more().click(); // A's second page in flight
  store.tutp_student_id = B;
  await wait(400); // the click's own child check mounts B
  assert.ok(/B item 0/.test(dom.root.textContent));
  held.releaseA();
  await wait(50);
  assert.ok(!/A2 item/.test(dom.root.textContent), 'A’s second page was appended to B’s list');
  assert.equal(dom.cards(), 3);
});

async function openExplain(payload) {
  const seen = [];
  const extra = { TutpAnswer: {}, TutpExplain: { view(panel, p) { seen.push(p); panel.textContent = 'PANEL'; } } };
  const { dom, store, ready } = await boot((url) => {
    if (/\/api\/library\/[^?]/.test(url)) return { id: 'a0', mode: 'explain', title: 'a item 0', language: 'English', payload };
    return pageOf(rowsFor('a', 1), null);
  }, extra);
  store.tutp_student_id = A;
  ready();
  await wait(50);
  dom.cardEls()[0].click();
  await wait(50);
  return { seen, shown: dom.document.body.textContent };
}

test('an explanation saved with only title, quick, full and traps (imported or old, traps null) opens as plain text', async () => {
  const { seen, shown } = await openExplain({ concept_key: 'k', title: 'a item 0', quick: 'Quick A 0', full: 'Full A 0', traps: null });
  assert.equal(seen.length, 0, 'the explain panel cannot render a partial payload');
  assert.ok(/Quick A 0/.test(shown) && /Full A 0/.test(shown), 'text not shown: ' + shown);
  assert.ok(!/could not be opened/.test(shown));
});

test('a complete explanation still opens in the explain panel', async () => {
  const full = { title: 'a item 0', quick: 'Q', full: 'F', traps: ['t'], parent_questions: [{ q: 'q' }], check_question: { q: 'c', options: ['x', 'y'], correct_index: 0 } };
  const { seen, shown } = await openExplain(full);
  assert.equal(seen.length, 1);
  assert.ok(/PANEL/.test(shown));
});
