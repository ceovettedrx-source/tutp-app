// Unit tests for server/model-replay.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { replayMode, recordingKey, readRecording, modelFetch } from '../../server/model-replay.js';

function withEnv(env, fn) {
  const old = { E2E_REPLAY: process.env.E2E_REPLAY, E2E_RECORD: process.env.E2E_RECORD };
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('real families are always live', () => {
  withEnv({ E2E_REPLAY: '1' }, () => {
    for (const h of [undefined, 'replay', 'record', 'live']) assert.equal(replayMode(false, h), 'live');
  });
});

test('without E2E_REPLAY (production) everyone is live, whatever the header', () => {
  withEnv({ E2E_REPLAY: '' }, () => {
    for (const h of [undefined, 'replay', 'record']) assert.equal(replayMode(true, h), 'live');
  });
});

test('test family on a replay preview: header picks, replay by default', () => {
  withEnv({ E2E_REPLAY: '1' }, () => {
    assert.equal(replayMode(true), 'replay');
    assert.equal(replayMode(true, 'replay'), 'replay');
    assert.equal(replayMode(true, 'record'), 'record');
    assert.equal(replayMode(true, 'live'), 'live');
    assert.equal(replayMode(true, 'nonsense'), 'replay');
  });
});

test('key: same content same key; system prompt and model ignored; language and feature count', () => {
  const a = { model: 'm1', system: 's1', messages: [{ role: 'user', content: 'x' }] };
  const b = { model: 'm2', system: 's2', messages: [{ role: 'user', content: 'x' }] };
  assert.equal(recordingKey('homework', a, 'English'), recordingKey('homework', b, 'English'));
  assert.notEqual(recordingKey('homework', a, 'English'), recordingKey('homework', a, 'Telugu'));
  assert.notEqual(recordingKey('homework', a), recordingKey('explain_line', a));
  assert.match(recordingKey('homework', a), /^[0-9a-f]{32}$/);
});

test('readRecording: attempt files, missing file, bad key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const key = 'a'.repeat(32);
  fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify({ status: 200, data: { n: 1 } }));
  fs.writeFileSync(path.join(dir, key + '.2.json'), JSON.stringify({ status: 200, data: { n: 2 } }));
  assert.equal(readRecording(key, 1, dir).data.n, 1);
  assert.equal(readRecording(key, 2, dir).data.n, 2);
  assert.equal(readRecording('b'.repeat(32), 1, dir), null);
  assert.equal(readRecording('../etc/passwd', 1, dir), null);
});

test('replay with no recording is a 503, never a live call', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('live call in replay mode'); };
  try {
    const r = await modelFetch({ mode: 'replay', feature: 'homework', body: { messages: [{ role: 'user', content: 'never recorded ' + Date.now() }] } });
    assert.equal(r.status, 503);
    assert.equal(r.data.error, 'no_recording');
  } finally { globalThis.fetch = realFetch; }
});

test('record mode keeps the raw reply', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{}' }] }) });
  try {
    const recordings = [];
    const r = await modelFetch({ mode: 'record', feature: 'homework', body: { messages: [] }, recordings });
    assert.equal(r.status, 200);
    assert.equal(recordings.length, 1);
    assert.equal(recordings[0].data.content[0].text, '{}');
  } finally { globalThis.fetch = realFetch; }
});
