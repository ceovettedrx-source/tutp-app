// The Answer Please call runner: one retry per call, batches of 4 in parallel merged in order,
// and the design-token contrast pairs (docs/specs/answer-explain-v2.md sections A, F; founder decision 7).
//   node --test tests/unit/answer-run.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnswer } from '../../server/answer-run.js';

const q = (n) => ({ q_text: `Question ${n}: name the capital of state ${n}.`, q_type: 'short', marks: 1, blocks: [{ type: 'text', text: `Capital ${n}` }], keywords: [], diagram: null, unit_direction_note: '' });
const reply = (obj) => ({ ok: true, data: { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], usage: {} } });
const ok = (from, to) => reply({ status: 'ok', subject: 'Social', questions: Array.from({ length: to - from + 1 }, (_, i) => q(from + i)) });

test('one call: a good reply passes with one model call', async () => {
  let calls = 0;
  const r = await runAnswer({ callModel: async () => { calls++; return ok(1, 3); } });
  assert.equal(r.kind, 'ok');
  assert.equal(r.answer.questions.length, 3);
  assert.equal(calls, 1);
});

test('invalid JSON then a good reply: the second call carries a correction hint', async () => {
  const seen = [];
  const r = await runAnswer({ callModel: async (a) => { seen.push(a); return a.attempt === 1 ? reply('not json at all') : ok(1, 2); } });
  assert.equal(r.kind, 'ok');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].hint, null);
  assert.match(seen[1].hint, /failed these checks/);
});

test('a reply that fails the checks twice is reported invalid, with the issues', async () => {
  let calls = 0;
  const r = await runAnswer({ callModel: async () => { calls++; return reply({ status: 'ok', questions: [{ q_text: 'x', blocks: [] }] }); } });
  assert.equal(r.kind, 'invalid');
  assert.ok(r.issues.length);
  assert.equal(calls, 2);
});

test('an upstream error is passed straight back, no retry', async () => {
  let calls = 0;
  const r = await runAnswer({ callModel: async () => { calls++; return { ok: false, status: 529, errText: 'overloaded' }; } });
  assert.equal(r.kind, 'upstream');
  assert.equal(r.status, 529);
  assert.equal(calls, 1);
});

test('unreadable passes through as a status, not an error', async () => {
  const r = await runAnswer({ callModel: async () => reply({ status: 'unreadable', subject: '', questions: [] }) });
  assert.equal(r.kind, 'ok');
  assert.equal(r.answer.status, 'unreadable');
});

test('batch: questions 1-4 and 5-8 run in parallel and merge in page order', async () => {
  const order = [];
  const r = await runAnswer({
    batch: true,
    callModel: async ({ range }) => {
      order.push('start' + range.from);
      await new Promise((res) => setTimeout(res, range.from === 1 ? 30 : 5));   // batch 2 finishes first
      order.push('end' + range.from);
      return range.from === 1 ? ok(1, 4) : ok(5, 8);
    },
  });
  assert.deepEqual(order.slice(0, 2), ['start1', 'start5']);                    // both started before either ended
  assert.equal(r.kind, 'ok');
  assert.deepEqual(r.answer.questions.map((x) => x.q_text.slice(0, 10)), Array.from({ length: 8 }, (_, i) => `Question ${i + 1}`));
  assert.equal(r.answer.extracted_questions.length, 8);
  assert.equal(r.calls, 2);
});

test('batch: a page with fewer than 5 questions leaves batch 2 empty, which is fine', async () => {
  const r = await runAnswer({ batch: true, callModel: async ({ range }) => (range.from === 1 ? ok(1, 3) : reply({ status: 'ok', subject: '', questions: [] })) });
  assert.equal(r.kind, 'ok');
  assert.equal(r.answer.questions.length, 3);
});

test('batch: one batch failing fails the whole answer (never a half answer)', async () => {
  const r = await runAnswer({ batch: true, callModel: async ({ range }) => (range.from === 1 ? ok(1, 4) : { ok: false, status: 500, errText: 'x' }) });
  assert.equal(r.kind, 'upstream');
});

// ---- contrast of the founder's design tokens (WCAG 2 relative luminance)
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('every text/background pair of the Answer/Explain styles is at least 4.5:1', () => {
  const pairs = [
    ['ink on white card', '#0F1B2D', '#FFFFFF'], ['ink on ground', '#0F1B2D', '#F4F6FA'],
    ['white on brand blue (marks chip, primary button, selected tab)', '#FFFFFF', '#005bbf'],
    ['brand blue on white (hover, upsell label)', '#005bbf', '#FFFFFF'], ['brand blue on light blue pressed state', '#005bbf', '#EAF2FC'],
    ['keyword chip text on chip bg', '#9A3F07', '#FFF1E6'], ['misconception heading on its box', '#9A3F07', '#FFF4EC'],
    ['ink on misconception box', '#0F1B2D', '#FFF4EC'], ['success on white', '#1E7B4A', '#FFFFFF'], ['success on its tint', '#1E7B4A', '#E8F5EE'],
    ['ink on success tint', '#0F1B2D', '#E8F5EE'], ['wrong answer on white', '#A12B1B', '#FFFFFF'], ['wrong answer on its tint', '#A12B1B', '#FDECEA'],
    ['muted on white', '#4A5568', '#FFFFFF'], ['muted on ground', '#4A5568', '#F4F6FA'],
    ['white on dark tonight card', '#FFFFFF', '#0F1B2D'], ['hint on dark tonight card', '#C9D3E3', '#0F1B2D'], ['ink on white button in the dark card', '#0F1B2D', '#FFFFFF'],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
});
