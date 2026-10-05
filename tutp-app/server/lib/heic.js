// HEIC (iPhone photo) -> JPEG on the server, so a stored file or a model call
// never sees HEIC bytes. Used by /api/upload and /api/homework.
//
//   isHeic(buf)            -> true when the bytes are a HEIC/HEIF file (the claimed type is never trusted)
//   heicToJpeg(buf)        -> { ok: true, buffer } | { ok: false, reason, message }
//
// The decoder (heic-convert, pure JS/WASM, no native library) is loaded on the
// first use and runs one file at a time: a 12 MP photo needs roughly 200 MB
// while it decodes and the Cloud Run instance has 512 MB. Pictures above
// MAX_HEIC_PIXELS (read from the file's own header before decoding) are
// refused instead. Every failure gives a message a parent can act on.

export const MAX_HEIC_PIXELS = 16_000_000;
const BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'];

export const HEIC_MESSAGES = {
  unavailable: "This photo is in HEIC format, which we can't open right now. Please take it again as a JPEG (iPhone: Settings > Camera > Formats > Most Compatible) or choose a different photo.",
  too_large: 'This photo is very large. Please take it again at the normal camera size, or choose a smaller photo.',
  failed: "We couldn't read this HEIC photo. Please take it again as a JPEG (iPhone: Settings > Camera > Formats > Most Compatible) or choose a different photo.",
};

export function isHeic(buf) {
  if (!buf || buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return BRANDS.includes(buf.toString('latin1', 8, 12));
}

// The largest picture size named in the file's "ispe" boxes (width and height
// as two big-endian 32-bit numbers after 4 bytes of version/flags), or null.
export function heicPixels(buf) {
  let best = null;
  let at = buf.indexOf('ispe', 0, 'latin1');
  while (at !== -1) {
    if (at + 16 <= buf.length) {
      const px = buf.readUInt32BE(at + 8) * buf.readUInt32BE(at + 12);
      if (best === null || px > best) best = px;
    }
    at = buf.indexOf('ispe', at + 4, 'latin1');
  }
  return best;
}

let converter; // undefined = not tried yet, null = not available
async function loadConverter() {
  if (converter !== undefined) return converter;
  try {
    converter = (await import('heic-convert')).default;
  } catch (err) {
    console.error('heic: converter not available', err && err.message);
    converter = null;
  }
  return converter;
}

let queue = Promise.resolve();

export function heicToJpeg(buf) {
  const run = queue.then(() => convertOne(buf));
  queue = run.catch(() => {});
  return run;
}

async function convertOne(buf) {
  const fail = (reason) => ({ ok: false, reason, message: HEIC_MESSAGES[reason] });
  const px = heicPixels(buf);
  if (px === null || px > MAX_HEIC_PIXELS) return fail(px === null ? 'failed' : 'too_large');
  const convert = await loadConverter();
  if (!convert) return fail('unavailable');
  try {
    const out = Buffer.from(await convert({ buffer: buf, format: 'JPEG', quality: 0.9 }));
    if (!(out[0] === 0xff && out[1] === 0xd8 && out[2] === 0xff)) return fail('failed');
    return { ok: true, buffer: out };
  } catch (err) {
    console.error('heic: conversion failed', err && err.message);
    return fail('failed');
  }
}
