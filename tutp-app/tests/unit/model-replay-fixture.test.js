// Recording keys that don't depend on the browser's re-encoded photo bytes (server/model-replay.js).
//   node --test tests/unit/model-replay-fixture.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureKey, imageSize, recordingKey, fixtureMiddleware, replayMode, returnsRecordings } from '../../server/model-replay.js';

const body = (data) => ({ messages: [{ role: 'user', content: [
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
  { type: 'text', text: 'check my answers' }] }] });

test('same fixture, different encoded bytes: same fixture key, different exact key', () => {
  assert.notEqual(recordingKey('hw', body('AAAA')), recordingKey('hw', body('BBBB')));
  assert.equal(fixtureKey('hw', body('AAAA'), '', 'w5.jpg'), fixtureKey('hw', body('BBBB'), '', 'w5.jpg'));
});

test('different fixture, text or feature: different fixture key', () => {
  const k = fixtureKey('hw', body('AAAA'), '', 'w5.jpg');
  assert.notEqual(k, fixtureKey('hw', body('AAAA'), '', 'blank.jpg'));
  assert.notEqual(k, fixtureKey('vt', body('AAAA'), '', 'w5.jpg'));
  const other = body('AAAA'); other.messages[0].content[1].text = 'other';
  assert.notEqual(k, fixtureKey('hw', other, '', 'w5.jpg'));
  assert.match(k, /^fx[0-9a-f]{30}$/);
});

const png = (w, h) => { const b = Buffer.alloc(33); b[0] = 0x89; b[1] = 0x50; b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b.toString('base64'); };
const jpeg = (w, h) => { const b = Buffer.alloc(40); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0; b.writeUInt16BE(17, 4); b[6] = 8; b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9); return b.toString('base64'); };

test('p8: the whole photo and a crop of it (same fixture, different pixel size) have different fixture keys', () => {
  assert.equal(imageSize(png(767, 297)), '767x297');
  assert.equal(imageSize(jpeg(1280, 960)), '1280x960');
  assert.equal(imageSize('AAAA'), '');
  assert.notEqual(fixtureKey('hw', body(jpeg(1280, 960)), '', 'w5.jpg'), fixtureKey('hw', body(jpeg(767, 297)), '', 'w5.jpg'));
  assert.equal(fixtureKey('hw', body(jpeg(767, 297)), '', 'w5.jpg'), fixtureKey('hw', body(jpeg(767, 297)), '', 'w5.jpg'));
});

test('no fixture header: no fixture key', () => {
  assert.equal(fixtureKey('hw', body('AAAA'), '', ''), null);
});

test('header is read only with E2E_REPLAY=1', () => {
  const req = { get: () => 'w5.jpg' };
  const prev = process.env.E2E_REPLAY;
  process.env.E2E_REPLAY = '';
  let ran = false;
  fixtureMiddleware(req, {}, () => { ran = true; });
  assert.ok(ran);
  process.env.E2E_REPLAY = prev;
});

test('reindex is a replay mode that hands pairs back', () => {
  const prev = process.env.E2E_REPLAY;
  process.env.E2E_REPLAY = '1';
  assert.equal(replayMode(true, 'reindex'), 'reindex');
  assert.equal(replayMode(false, 'reindex'), 'live');
  process.env.E2E_REPLAY = prev;
  assert.ok(returnsRecordings('reindex') && returnsRecordings('record') && !returnsRecordings('replay'));
});
