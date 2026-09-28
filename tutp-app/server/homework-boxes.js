// "Show on photo" for Homework Help: where each extracted question sits on
// the parent's photo. The model returns, per question, "photo" (attachment
// index) and "box" [x1, y1, x2, y2] in pixels of that photo; this module
// decides which photos may get boxes and checks every box before it reaches
// the page. Unit tests: tests/unit/homework-boxes.test.js.

// Longest edge the page sends Homework Help photos at (founder decision
// 2026-09-28). A larger photo is resized by the model API before the model
// sees it, so its pixel boxes wouldn't match the size we state: no boxes.
export const BOX_MAX_EDGE = 1568;

// Pixel size from the image header: { width, height } or null. JPEG (the
// page re-encodes every photo to JPEG) and PNG; the size is read from the
// file itself, never taken from the request.
export function imageSize(mediaType, base64) {
  let buf;
  try { buf = Buffer.from(base64 || '', 'base64'); } catch { return null; }
  if (mediaType === 'image/png') {
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return positive(buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  if (mediaType === 'image/jpeg') {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }                      // fill byte
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
      // SOF0-SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return positive(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  return null;
}

function positive(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}

// Attachments that may get boxes: images whose size is known and whose
// longest edge is at most BOX_MAX_EDGE. [{ index, width, height }], index
// being the position in the request's attachments (PDFs count too).
export function boxablePhotos(attachments) {
  const out = [];
  (attachments || []).forEach((a, index) => {
    const size = imageSize(a && a.mediaType, a && a.base64);
    if (size && Math.max(size.width, size.height) <= BOX_MAX_EDGE) out.push({ index, ...size });
  });
  return out;
}

// One model box -> [x1, y1, x2, y2] in 0..1000 of that photo, or null.
// Same rules as the visual tutor (server/routes/visual-tutor.js fixTarget):
// numbers only, corners put in order, clamped to the image, at least 4 px.
export function checkBox(box, photo) {
  if (!photo || !Array.isArray(box) || box.length !== 4) return null;
  let [x1, y1, x2, y2] = box.map((v) => (typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN));
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  [x1, x2] = [clamp(Math.min(x1, x2), 0, photo.width), clamp(Math.max(x1, x2), 0, photo.width)];
  [y1, y2] = [clamp(Math.min(y1, y2), 0, photo.height), clamp(Math.max(y1, y2), 0, photo.height)];
  if (x2 - x1 < 4 || y2 - y1 < 4) return null;
  const n = (v, max) => Math.round((v / max) * 1000);
  return [n(x1, photo.width), n(y1, photo.height), n(x2, photo.width), n(y2, photo.height)];
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The homework JSON with every question's photo/box checked: a valid pair
// becomes { photo, box (0..1000) }, anything else is removed. Returns
// { json, boxed, boxes }: boxed = questions left with a box; boxes = per
// question, { photo, box } or null (for the server log).
export function checkQuestionBoxes(json, photos) {
  const byIndex = new Map((photos || []).map((p) => [p.index, p]));
  const boxes = [];
  const questions = Array.isArray(json && json.extracted_questions) ? json.extracted_questions : null;
  if (!questions) return { json, boxed: 0, boxes };
  const extracted = questions.map((q) => {
    if (!q || typeof q !== 'object') { boxes.push(null); return q; }
    const { photo, box, ...rest } = q;
    const target = Number.isInteger(photo) ? byIndex.get(photo) : null;
    const checked = checkBox(box, target);
    if (!checked) { boxes.push(null); return rest; }
    boxes.push({ photo, box: checked });
    return { ...rest, photo, box: checked };
  });
  return { json: { ...json, extracted_questions: extracted }, boxed: boxes.filter(Boolean).length, boxes };
}

// Anthropic reply -> the same reply with its first text block replaced by
// the checked homework JSON (compact). The page parses it exactly as before.
// Returns { data, boxed, boxes }; data is unchanged when there is nothing to
// check.
export function applyQuestionBoxes(data, photos) {
  const blocks = (data && data.content) || [];
  const i = blocks.findIndex((b) => b && b.type === 'text');
  if (i < 0) return { data, boxed: 0, boxes: [] };
  const text = blocks[i].text || '';
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  let json;
  try { json = JSON.parse(text.slice(a, b + 1)); } catch { return { data, boxed: 0, boxes: [] }; }
  const { json: checked, boxed, boxes } = checkQuestionBoxes(json, photos);
  const content = blocks.slice();
  content[i] = { ...blocks[i], text: JSON.stringify(checked) };
  return { data: { ...data, content }, boxed, boxes };
}
