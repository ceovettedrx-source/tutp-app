// HEIC -> JPEG on the server (server/lib/heic.js). The fixture is libheif's
// own example photo (tests/fixtures/sample.heic, brand mif1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { isHeic, heicPixels, heicToJpeg, HEIC_MESSAGES, MAX_HEIC_PIXELS } from '../../server/lib/heic.js';
import * as uploads from '../../server/uploads.js';

const sample = fs.readFileSync(new URL('../fixtures/sample.heic', import.meta.url));

test('the claimed type is never used: HEIC is recognised by its bytes', () => {
  assert.equal(isHeic(sample), true);
  assert.equal(uploads.sniffType(sample).ext, 'heic');
  assert.equal(isHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  assert.equal(isHeic(Buffer.from('%PDF-1.7 and some more bytes')), false);
  assert.equal(isHeic(null), false);
});

test('the picture size is read from the header, largest entry wins', () => {
  const px = heicPixels(sample);
  assert.ok(px > 0 && px <= MAX_HEIC_PIXELS, 'sample is within the limit: ' + px);
  assert.equal(heicPixels(Buffer.from('no header here at all')), null);
});

test('a HEIC photo becomes a JPEG', async () => {
  const r = await heicToJpeg(sample);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.buffer.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal(uploads.sniffType(r.buffer).mime, 'image/jpeg');
  assert.ok(r.buffer.length > 1000);
});

test('two conversions at once both finish (one at a time)', async () => {
  const [a, b] = await Promise.all([heicToJpeg(sample), heicToJpeg(sample)]);
  assert.equal(a.ok && b.ok, true);
});

test('a photo above the pixel limit is refused with a parent message, before decoding', async () => {
  const big = Buffer.from(sample);
  const at = big.indexOf('ispe', 0, 'latin1');
  big.writeUInt32BE(20000, at + 8);
  big.writeUInt32BE(20000, at + 12);
  const r = await heicToJpeg(big);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_large');
  assert.equal(r.message, HEIC_MESSAGES.too_large);
});

test('a broken HEIC file is refused with a parent message, not a crash', async () => {
  const broken = Buffer.concat([sample.subarray(0, 4096), Buffer.alloc(2048, 7)]);
  const r = await heicToJpeg(broken);
  assert.equal(r.ok, false);
  assert.ok(['failed', 'too_large'].includes(r.reason));
  assert.match(r.message, /HEIC|photo/);
  const headerless = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(40)]);
  assert.equal((await heicToJpeg(headerless)).reason, 'failed');
});

test('every refusal has a message a parent can act on', () => {
  for (const k of ['unavailable', 'too_large', 'failed']) assert.ok(HEIC_MESSAGES[k].length > 40);
});
