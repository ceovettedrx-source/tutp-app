// Client-side race test for public/app/shared/library.js (TUT-69). Run: npm run test:unit
// The dashboards pick the child after the page loads (tutpChildReady). The Library mounts first with no
// child, then again once the child is known. A click landing after that used to be taken for "the child
// changed" and reloaded page 1, so the first tap on "Show more" shrank the list back to one page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../../public/app/shared/library.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Just enough DOM for the list: elements with children, text, classes and click listeners.
function fakeDom() {
  const docListeners = {};
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.attrs = {}; this.listeners = {}; this.parent = null; this._text = ''; this.type = ''; }
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
  return { document, root, cards: () => byClass('tl-card').length, more: () => byClass('tl-more')[0] };
}

function page(items, next) { return { items, next, subjects: [{ subject: 'Maths', count: 60 }], upsell: null }; }

async function boot() {
  const dom = fakeDom();
  const store = {};
  const calls = [];
  let ready;
  const childReady = new Promise(r => { ready = r; });
  const fetchFake = async (url) => {
    calls.push(/cursor=/.test(url) ? 'cursor' : 'first');
    const cursor = /cursor=/.test(url);
    const items = Array.from({ length: 30 }, (_, i) => ({ id: (cursor ? 'b' : 'a') + i, mode: 'explain', subject: 'Maths', title: 'T' + i, created_at: '2026-10-23T10:00:00+00:00' }));
    return { ok: true, json: async () => page(items, cursor ? null : 'c1') };
  };
  const sandbox = {
    document: dom.document, location: { pathname: '/app/mother/' }, fetch: fetchFake, setTimeout, console,
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    localStorage: { getItem: () => null, removeItem() {} },
    tutpChildReady: childReady,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { dom, calls, store, ready };
}

test('Show more after a late tutpChildReady adds a page; it never shrinks the list or refetches page 1', async () => {
  const { dom, calls, store, ready } = await boot();
  await wait(20);
  assert.deepEqual(calls, [], 'no child yet, so nothing to fetch');
  store.tutp_student_id = '11111111-1111-4111-8111-111111111111';
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
  const { dom, calls, store, ready } = await boot();
  store.tutp_student_id = '11111111-1111-4111-8111-111111111111';
  ready();
  await wait(50);
  store.tutp_student_id = '22222222-2222-4222-8222-222222222222';
  dom.root.click ? dom.root.click() : dom.more().click();
  await wait(400);
  assert.ok(calls.filter(c => c === 'first').length >= 2, 'the new child was not loaded: ' + calls.join(','));
});
