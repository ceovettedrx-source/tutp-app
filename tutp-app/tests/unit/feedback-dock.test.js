// Where the "How was this?" and share boxes go (public/app/shared/feedback-dock.js).
//   node --test tests/unit/feedback-dock.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../public/app/shared/feedback-dock.js';

const Dock = globalThis.TutpFeedbackDock;

// A tiny stand-in for the DOM: elements with children, classes and style text.
function el(id) {
  const e = {
    id, children: [], parent: null, style: { cssText: '' },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { if (c.parent) c.remove(); c.parent = e; e.children.push(c); return c; },
    remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); e.parent = null; },
  };
  return e;
}
function fakeDoc(ids) {
  const body = el('body');
  const byId = { body };
  const all = [];
  for (const id of ids) { byId[id] = el(id); body.appendChild(byId[id]); }
  return {
    body,
    getElementById: (id) => byId[id] || null,
    querySelectorAll: () => {
      const out = [];
      (function walk(n) { for (const c of n.children) { if (c.classList.contains(Dock.DOCK_CLASS)) out.push(c); walk(c); } })(body);
      return out;
    },
    byId,
  };
}

test('each feature maps to its own results block; unknown features to none', () => {
  assert.equal(Dock.hostIdFor('homework_help'), 'hwModalResults');
  assert.equal(Dock.hostIdFor('quiz'), 'hwModalResults');
  assert.equal(Dock.hostIdFor('experiential_learning'), 'experientialModalResults');
  assert.equal(Dock.hostIdFor('toString'), null);
  assert.equal(Dock.hostIdFor('storytelling'), null);
});

test('the box is a normal block, never fixed, at the end of the results', () => {
  assert.doesNotMatch(Dock.BOX_STYLE, /position:\s*(fixed|absolute|sticky)/);
  assert.doesNotMatch(Dock.BOX_STYLE, /\b(bottom|right|top|left)\s*:/);
  const doc = fakeDoc(['hwModalResults', 'experientialModalResults']);
  const first = el('x'); first.style.cssText = 'position:fixed;bottom:16px;right:16px;';
  doc.byId.hwModalResults.appendChild(el('answer text'));
  const host = Dock.place(first, 'homework_help', doc);
  assert.equal(host, doc.byId.hwModalResults);
  assert.equal(host.children[host.children.length - 1], first, 'last child = after the content');
  assert.doesNotMatch(first.style.cssText, /fixed/);
});

test('only one box at a time; the share box follows the feedback box', () => {
  const doc = fakeDoc(['hwModalResults', 'experientialModalResults']);
  const a = el('a');
  Dock.place(a, 'experiential_learning', doc);
  const b = el('b');
  Dock.place(b, 'quiz', doc);
  assert.equal(a.parent, null);
  assert.equal(b.parent, doc.byId.hwModalResults);
  const s = el('s');
  Dock.place(s, 'share', doc);
  assert.equal(b.parent, null);
  assert.equal(s.parent, doc.byId.hwModalResults);
});

test('with no results block on the page it goes to the end of the body, in the flow', () => {
  const doc = fakeDoc([]);
  const a = el('a');
  assert.equal(Dock.place(a, 'homework_help', doc), doc.body);
  assert.equal(a.parent, doc.body);
});

test('every parent page loads the file and no page puts a feedback box in the fixed corner', () => {
  for (const p of ['mother', 'father', 'family-member', 'child']) {
    const html = readFileSync(`public/app/${p}/index.html`, 'utf8');
    assert.match(html, /<script src="\/app\/shared\/feedback-dock\.js"><\/script>/, p);
    assert.match(html, /TutpFeedbackDock\.place\(box, feature\)/, p);
    if (p !== 'child') assert.match(html, /TutpFeedbackDock\.place\(box, 'share'\)/, p);
    // the old fixed-corner boxes are not appended to <body> any more
    assert.doesNotMatch(html, /document\.body\.appendChild\(box\);\s*(let chosenSentiment|box\.querySelector\('#fbShareLink'\))/, p);
    assert.ok(html.indexOf('feedback-dock.js') < html.indexOf('homework-modal.js'), p);
  }
});
