// A tiny preview of a generated picture, for the blurred "see every picture in
// Pro" card (docs/specs/img1.md). The page blurs it and scales it up, so the
// free family never receives the real picture, only 24 or so pixels of colour.
// No dependencies: PNG only (what the image model returns), 8 bits per channel,
// not interlaced. Anything else returns null and the page shows a plain
// coloured card instead (never the full picture).
//
//   pngThumb(buffer, maxSide = 24) -> Buffer (a small RGB PNG) | null
// Unit tests: tests/unit/png-thumb.test.js.
import zlib from 'zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };   // grey, rgb, grey+alpha, rgba
const MAX_PIXELS = 16 * 1024 * 1024;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// { width, height, channels, type, pixels: Buffer(width*height*channels) } | null
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) return null;
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.length < 13 || !idat.length) return null;
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4);
  const depth = ihdr[8], type = ihdr[9], interlace = ihdr[12];
  const channels = CHANNELS[type];
  if (!channels || depth !== 8 || interlace !== 0 || !width || !height || width * height > MAX_PIXELS) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x];
      const left = x >= channels ? pixels[dst + x - channels] : 0;
      const up = y > 0 ? pixels[dst - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[dst - stride + x - channels] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + left;
      else if (filter === 2) v = cur + up;
      else if (filter === 3) v = cur + ((left + up) >> 1);
      else if (filter === 4) v = cur + paeth(left, up, upLeft);
      else return null;
      pixels[dst + x] = v & 255;
    }
  }
  return { width, height, channels, type, pixels };
}

export function pngThumb(buf, maxSide = 24) {
  try {
    const img = decodePng(buf);
    if (!img) return null;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const rgb = Buffer.alloc(w * h * 3);
    for (let ty = 0; ty < h; ty++) {
      const y0 = Math.floor((ty * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * img.height) / h));
      for (let tx = 0; tx < w; tx++) {
        const x0 = Math.floor((tx * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * img.width) / w));
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * img.width + x) * img.channels;
            const a = img.channels === 4 ? img.pixels[i + 3] / 255 : img.channels === 2 ? img.pixels[i + 1] / 255 : 1;
            const red = img.channels >= 3 ? img.pixels[i] : img.pixels[i];
            const green = img.channels >= 3 ? img.pixels[i + 1] : img.pixels[i];
            const blue = img.channels >= 3 ? img.pixels[i + 2] : img.pixels[i];
            // transparent pixels count as white
            r += red * a + 255 * (1 - a); g += green * a + 255 * (1 - a); b += blue * a + 255 * (1 - a); n++;
          }
        }
        const o = (ty * w + tx) * 3;
        rgb[o] = Math.round(r / n); rgb[o + 1] = Math.round(g / n); rgb[o + 2] = Math.round(b / n);
      }
    }
    const rows = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  } catch {
    return null;
  }
}
