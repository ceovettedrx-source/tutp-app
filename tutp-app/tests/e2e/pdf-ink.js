// A small PDF reader for the print check (tests/e2e/print-a4.spec.js): for a
// PDF made by Chromium (page.pdf) it returns, per page, the page height and
// how far down the page anything is drawn (text, filled shapes, images). No
// dependency: the streams are inflated with zlib and the drawing operators
// are walked with a matrix stack. Good to about a line of text, which is all
// the "no page is more than 40% empty" check needs.
import zlib from 'zlib';

function objects(buf) {
  const text = buf.toString('latin1');
  const out = new Map();
  const re = /(\d+) 0 obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const sIdx = body.indexOf('stream');
    let dict = body, stream = null;
    if (sIdx >= 0) {
      dict = body.slice(0, sIdx);
      let from = start + sIdx + 'stream'.length;
      if (text[from] === '\r') from++;
      if (text[from] === '\n') from++;
      const to = text.lastIndexOf('endstream', end);
      stream = buf.subarray(from, to);
      if (/\/FlateDecode/.test(dict)) { try { stream = zlib.inflateSync(stream); } catch { stream = null; } }
    }
    out.set(Number(m[1]), { dict, stream });
    re.lastIndex = end;
  }
  return out;
}

const mul = (a, b) => [ // a then b, as PDF [a b c d e f] matrices (row vectors)
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// The lowest and highest y (PDF space, origin bottom left) touched by a content stream.
function inkExtent(content) {
  const src = content.toString('latin1');
  const tokens = src.match(/\[(?:[^\]\\]|\\.)*\]|\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F\s]*>|\/[^\s/<>\[\]()]*|[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[A-Za-z'"*]+/g) || [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0];
  const nums = [];
  let minY = Infinity, maxY = -Infinity;
  let pathPts = [];
  let whiteFill = false;
  const touch = (x, y) => { const p = apply(ctm, x, y); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); };
  const flushPath = () => { for (const [x, y] of pathPts) touch(x, y); pathPts = []; };
  for (const t of tokens) {
    if (/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/.test(t)) { nums.push(Number(t)); if (nums.length > 8) nums.shift(); continue; }
    switch (t) {
      case 'q': stack.push({ ctm, whiteFill }); break;
      case 'Q': { const s = stack.pop(); if (s) { ctm = s.ctm; whiteFill = s.whiteFill; } break; }
      case 'cm': if (nums.length >= 6) ctm = mul(nums.slice(-6), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tm': if (nums.length >= 6) tm = nums.slice(-6); break;
      case 'Td': case 'TD': if (nums.length >= 2) tm = mul([1, 0, 0, 1, nums[nums.length - 2], nums[nums.length - 1]], tm); break;
      case 'Tj': case 'TJ': case "'": case '"': { const p = apply(ctm, tm[4], tm[5]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); break; }
      case 're': if (nums.length >= 4) { const [x, y, w, h] = nums.slice(-4); pathPts.push([x, y], [x + w, y + h]); } break;
      case 'm': case 'l': if (nums.length >= 2) pathPts.push([nums[nums.length - 2], nums[nums.length - 1]]); break;
      case 'c': if (nums.length >= 6) pathPts.push([nums[nums.length - 2], nums[nums.length - 1]]); break;
      case 'rg': whiteFill = nums.length >= 3 && nums.slice(-3).every((n) => n >= 0.999); break;
      case 'g': whiteFill = nums.length >= 1 && nums[nums.length - 1] >= 0.999; break;
      // a white fill is the page's own background, not ink
      case 'f': case 'F': case 'f*': case 'B': case 'B*': if (whiteFill) pathPts = []; else flushPath(); break;
      case 'S': case 's': flushPath(); break;
      case 'n': pathPts = []; break; // a clip path, no ink
      case 'Do': touch(0, 0); touch(1, 1); break; // an image or form: the unit square
      default: break;
    }
    nums.length = 0;
  }
  return { minY, maxY };
}

// -> [{ width, height, minY, maxY }] in points: the lowest and highest drawn
// y of each page (null on a blank page); white fills (the page background) do
// not count.
export function pdfPages(buf) {
  const objs = objects(buf);
  const pages = [];
  const order = [];
  for (const [, o] of objs) {
    const kids = /\/Type\s*\/Pages\b[\s\S]*?\/Kids\s*\[([^\]]*)\]/.exec(o.dict) || /\/Kids\s*\[([^\]]*)\][\s\S]*?\/Type\s*\/Pages\b/.exec(o.dict);
    if (kids) for (const k of kids[1].matchAll(/(\d+) 0 R/g)) order.push(Number(k[1]));
  }
  const ids = order.filter((id) => objs.has(id) && /\/Type\s*\/Page\b(?!s)/.test(objs.get(id).dict));
  const pageIds = ids.length ? ids : [...objs].filter(([, o]) => /\/Type\s*\/Page\b(?!s)/.test(o.dict)).map(([id]) => id);
  for (const id of pageIds) {
    const d = objs.get(id).dict;
    const box = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(d) || [0, 0, 0, 595.28, 841.89];
    const width = Number(box[3]) - Number(box[1]), height = Number(box[4]) - Number(box[2]);
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/.exec(d);
    let minY = Infinity, maxY = -Infinity;
    for (const c of contents ? [...contents[1].matchAll(/(\d+) 0 R/g)] : []) {
      const o = objs.get(Number(c[1]));
      if (!o || !o.stream) continue;
      const e = inkExtent(o.stream);
      minY = Math.min(minY, e.minY); maxY = Math.max(maxY, e.maxY);
    }
    const hasInk = Number.isFinite(minY) && Number.isFinite(maxY);
    // PDF space: y grows upwards, so minY is the lowest drawn thing on the page
    pages.push({ width, height, minY: hasInk ? minY : null, maxY: hasInk ? maxY : null });
  }
  return pages;
}
