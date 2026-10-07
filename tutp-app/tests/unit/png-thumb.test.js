// The blurred-picture preview (server/lib/png-thumb.js, docs/specs/img1.md).
//   node --test tests/unit/png-thumb.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import { pngThumb, decodePng } from '../../server/lib/png-thumb.js';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
}
// pixel(x, y) -> [r, g, b(, a)]; filterFor(y) -> 0 none, 1 sub, 2 up
function makePng(w, h, pixel, { channels = 3, filterFor = () => 0, interlace = 0, depth = 8 } = {}) {
  const stride = w * channels;
  const img = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixel(x, y).forEach((v, c) => { img[y * stride + x * channels + c] = v; });
  const rows = [];
  for (let y = 0; y < h; y++) {
    const f = filterFor(y);
    const row = Buffer.alloc(stride + 1); row[0] = f;
    for (let x = 0; x < stride; x++) {
      const cur = img[y * stride + x];
      const left = x >= channels ? img[y * stride + x - channels] : 0;
      const up = y > 0 ? img[(y - 1) * stride + x] : 0;
      row[x + 1] = (f === 0 ? cur : f === 1 ? cur - left : cur - up) & 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0; ihdr[12] = interlace;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('decodes none, sub and up filters', () => {
  const px = (x, y) => [x * 4 % 256, y * 4 % 256, (x + y) % 256];
  for (const filterFor of [() => 0, () => 1, () => 2, (y) => y % 3]) {
    const d = decodePng(makePng(32, 32, px, { filterFor }));
    assert.equal(d.width, 32);
    assert.deepEqual([...d.pixels.subarray((5 * 32 + 7) * 3, (5 * 32 + 7) * 3 + 3)], px(7, 5));
  }
});

test('the preview is small, a PNG, and has the average colour of its quarter', () => {
  const big = makePng(256, 256, (x, y) => (x < 128 ? [255, 0, 0] : [0, 0, 255]));
  const t = pngThumb(big, 24);
  assert.ok(t.length < 400, 'under 400 bytes, got ' + t.length);
  const d = decodePng(t);
  assert.equal(d.width, 24);
  assert.equal(d.height, 24);
  assert.deepEqual([...d.pixels.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual([...d.pixels.subarray(23 * 3, 23 * 3 + 3)], [0, 0, 255]);
});

test('a preview cannot carry the picture: 24 pixels is all there is', () => {
  const noisy = makePng(200, 200, (x, y) => [(x * 7) % 256, (y * 13) % 256, (x * y) % 256]);
  const d = decodePng(pngThumb(noisy, 24));
  assert.ok(d.width * d.height <= 24 * 24);
});

test('transparent pixels count as white; alpha images work', () => {
  const t = pngThumb(makePng(16, 16, () => [0, 0, 0, 0], { channels: 4 }), 8);
  assert.deepEqual([...decodePng(t).pixels.subarray(0, 3)], [255, 255, 255]);
});

test('anything that is not a plain 8-bit PNG gives null, never the original', () => {
  assert.equal(pngThumb(Buffer.from('not a png')), null);
  assert.equal(pngThumb(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(pngThumb(makePng(8, 8, () => [1, 2, 3], { interlace: 1 })), null);
  assert.equal(pngThumb(null), null);
  const truncated = makePng(64, 64, () => [9, 9, 9]).subarray(0, 60);
  assert.equal(pngThumb(truncated), null);
});
