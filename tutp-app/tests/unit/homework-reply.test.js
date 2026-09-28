// Unit tests for server/homework-reply.js, with fake model replies:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReplyJson, callWithJsonRetry } from '../../server/homework-reply.js';

const reply = (text, extra = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { output_tokens: 42 }, ...extra });
const GOOD = reply('{"mode":"questions","questions":[{"q":"24 + 13","a":"37"}]}');
const EXTRA_TEXT = reply('Here is the answer:\n{"mode":"questions","questions":[]}\nHope this helps!');
const CUT_OFF = reply('{"mode":"questions","questions":[{"q":"24 + 13","a":"3', { stop_reason: 'max_tokens' });
const NO_JSON = reply('Sorry, I cannot read this photo.');
const BROKEN = reply('{"questions":[{"q":"a"} {"q":"b"}]}');

// A fake model that answers with the given replies in turn.
function fakeModel(...replies) {
  let calls = 0;
  const fn = async () => {
    const r = replies[Math.min(calls, replies.length - 1)];
    calls++;
    return r.ok === false ? r : { ok: true, data: r };
  };
  fn.calls = () => calls;
  return fn;
}

test('checkReplyJson: good JSON', () => {
  assert.deepEqual(checkReplyJson(GOOD), { ok: true });
});

test('checkReplyJson: extra text around the JSON is fine', () => {
  assert.deepEqual(checkReplyJson(EXTRA_TEXT), { ok: true });
});

test('checkReplyJson: cut-off, no JSON, broken, empty', () => {
  assert.equal(checkReplyJson(CUT_OFF).ok, false);
  assert.equal(checkReplyJson(NO_JSON).ok, false);
  assert.equal(checkReplyJson(BROKEN).ok, false);
  assert.equal(checkReplyJson({ content: [] }).ok, false);
  assert.equal(checkReplyJson(null).ok, false);
});

test('good first reply: one call, no log', async () => {
  const model = fakeModel(GOOD);
  const logs = [];
  const r = await callWithJsonRetry(model, i => logs.push(i));
  assert.equal(r.kind, 'ok');
  assert.equal(r.attempts, 1);
  assert.equal(r.data, GOOD);
  assert.equal(model.calls(), 1);
  assert.equal(logs.length, 0);
});

test('extra text: accepted without a retry', async () => {
  const model = fakeModel(EXTRA_TEXT);
  const r = await callWithJsonRetry(model);
  assert.equal(r.kind, 'ok');
  assert.equal(model.calls(), 1);
});

test('cut-off, then good: retried once, logged with stop_reason', async () => {
  const model = fakeModel(CUT_OFF, GOOD);
  const logs = [];
  const r = await callWithJsonRetry(model, i => logs.push(i));
  assert.equal(r.kind, 'ok');
  assert.equal(r.attempts, 2);
  assert.equal(r.data, GOOD);
  assert.equal(model.calls(), 2);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].attempt, 1);
  assert.equal(logs[0].stopReason, 'max_tokens');
  assert.equal(logs[0].outputTokens, 42);
});

test('no JSON, then good: retried once', async () => {
  const model = fakeModel(NO_JSON, GOOD);
  const r = await callWithJsonRetry(model);
  assert.equal(r.kind, 'ok');
  assert.equal(model.calls(), 2);
});

test('broken twice: gives up after two calls, both logged', async () => {
  const model = fakeModel(BROKEN, BROKEN, GOOD);
  const logs = [];
  const r = await callWithJsonRetry(model, i => logs.push(i));
  assert.equal(r.kind, 'unparseable');
  assert.equal(r.attempts, 2);
  assert.equal(model.calls(), 2);
  assert.deepEqual(logs.map(l => l.attempt), [1, 2]);
  assert.ok(r.error);
});

test('upstream HTTP error: passed back, no retry', async () => {
  const model = fakeModel({ ok: false, status: 529, errText: 'overloaded' }, GOOD);
  const r = await callWithJsonRetry(model);
  assert.deepEqual(r, { kind: 'upstream', status: 529, errText: 'overloaded' });
  assert.equal(model.calls(), 1);
});
