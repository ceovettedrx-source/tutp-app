// Answer Please diagrams (docs/specs/answer-explain-v2.md section C): the
// model names a template and gives numbers/labels as JSON; the SVG is drawn
// here, in code. A model-drawn SVG is never used. An unknown template, or
// params that fail the checks, give null (the answer shows no diagram).
//
//   buildDiagram(template, params, { font }) -> { template, params, svg } | null
//
// Templates (v1): vector_right_triangle, path_vs_straight, number_line,
// bar_model, flow_steps. Every number is finite and bounded, every label is
// text escaped into the SVG and cut to a length, so nothing the model writes
// can become markup. `font` is the CSS font-family stack of the answer's
// script (Noto Sans Telugu etc.); the page loads only that script's font.
// Unit tests: tests/unit/diagrams.test.js.
import { generateBarModelSvg } from './barModelSvgGenerator.js';

export const DIAGRAM_TEMPLATES = ['vector_right_triangle', 'path_vs_straight', 'number_line', 'bar_model', 'flow_steps'];

const INK = '#0F1B2D';
const BLUE = '#005bbf';
const GREEN = '#1E7B4A';
const MUTED = '#5B6678';
const MAX_LABEL = 28;

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const label = (s, max = MAX_LABEL) => {
  const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const num = (n, lo = -1e6, hi = 1e6) => (typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi ? n : null);
const fmt = (n) => String(Math.round(n * 100) / 100);

function frame(w, h, title, font, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(label(title, 80))}" style="font-family:${font}">${inner}</svg>`;
}
const text = (x, y, s, { size = 13, fill = INK, anchor = 'middle', weight = 600 } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(s)}</text>`;

// ---- vector_right_triangle: legs a (across) and b (up); c = the resultant.
function triangle(p, font) {
  const a = num(p.a, 0.01, 100000), b = num(p.b, 0.01, 100000);
  if (a == null || b == null) return null;
  const unit = label(p.unit, 8);
  const c = Math.hypot(a, b);
  const L = p.labels && typeof p.labels === 'object' ? p.labels : {};
  const la = label(L.a) || `${fmt(a)} ${unit}`.trim();
  const lb = label(L.b) || `${fmt(b)} ${unit}`.trim();
  const lc = label(L.c) || `${fmt(c)} ${unit}`.trim();
  const W = 300, H = 220, pad = 40, maxW = W - 2 * pad - 20, maxH = H - 2 * pad;
  const k = Math.min(maxW / a, maxH / b);
  const aw = a * k, bh = b * k;
  const x0 = pad + 10, y0 = H - pad, x1 = x0 + aw, y1 = y0 - bh;
  const m = 10;
  const inner = `<polygon points="${x0},${y0} ${x1},${y0} ${x1},${y1}" fill="#EAF2FC" stroke="${BLUE}" stroke-width="2"/>`
    + `<path d="M${x1 - m},${y0} V${y0 - m} H${x1}" fill="none" stroke="${INK}" stroke-width="1.5"/>`
    + text((x0 + x1) / 2, y0 + 20, la) + text(x1 + 8, (y0 + y1) / 2, lb, { anchor: 'start' })
    + text((x0 + x1) / 2 - 22, (y0 + y1) / 2 - 8, lc, { fill: GREEN });
  return { svg: frame(W, H, `Right triangle with sides ${la}, ${lb} and ${lc}`, font, inner), params: { a, b, unit, labels: { a: la, b: lb, c: lc } } };
}

// ---- path_vs_straight: the winding path (distance) against the straight line (displacement).
function pathVsStraight(p, font) {
  const path = num(p.path_length, 0.01, 1e6), straight = num(p.straight_length, 0.01, 1e6);
  if (path == null || straight == null || straight > path) return null;
  const unit = label(p.unit, 8);
  const L = p.labels && typeof p.labels === 'object' ? p.labels : {};
  const lp = label(L.path) || `${fmt(path)} ${unit}`.trim();
  const ls = label(L.straight) || `${fmt(straight)} ${unit}`.trim();
  const start = label(L.start, 14) || 'A', end = label(L.end, 14) || 'B';
  const inner = `<path d="M40,150 C80,40 130,200 180,100 S250,30 270,110" fill="none" stroke="${BLUE}" stroke-width="3"/>`
    + `<line x1="40" y1="150" x2="270" y2="110" stroke="${GREEN}" stroke-width="3" stroke-dasharray="7 5"/>`
    + `<circle cx="40" cy="150" r="5" fill="${INK}"/><circle cx="270" cy="110" r="5" fill="${INK}"/>`
    + text(40, 172, start) + text(270, 132, end)
    + text(150, 30, lp, { fill: BLUE }) + text(150, 195, ls, { fill: GREEN });
  return { svg: frame(300, 210, `Path ${lp} against straight line ${ls}`, font, inner), params: { path_length: path, straight_length: straight, unit, labels: { path: lp, straight: ls, start, end } } };
}

// ---- number_line: min..max with ticks, optional marked values and jumps.
function numberLine(p, font) {
  const min = num(p.min), max = num(p.max), step = num(p.step, 1e-6, 1e6);
  if (min == null || max == null || step == null || max <= min) return null;
  const ticks = Math.floor((max - min) / step + 1e-9) + 1;
  if (ticks < 2 || ticks > 25) return null;
  const x = (v) => 30 + ((v - min) / (max - min)) * 240;
  let inner = `<line x1="30" y1="100" x2="270" y2="100" stroke="${INK}" stroke-width="2"/>`;
  for (let i = 0; i < ticks; i++) {
    const v = min + i * step;
    inner += `<line x1="${x(v)}" y1="94" x2="${x(v)}" y2="106" stroke="${INK}" stroke-width="1.5"/>` + text(x(v), 124, fmt(v), { size: 11, fill: MUTED, weight: 500 });
  }
  const marks = [], jumps = [];
  for (const m of (Array.isArray(p.marks) ? p.marks.slice(0, 6) : [])) {
    const v = m && num(m.value, min, max);
    if (v == null) continue;
    marks.push({ value: v, label: label(m.label, 14) });
    inner += `<circle cx="${x(v)}" cy="100" r="6" fill="${BLUE}"/>` + (label(m.label, 14) ? text(x(v), 84, label(m.label, 14), { fill: BLUE }) : '');
  }
  for (const j of (Array.isArray(p.jumps) ? p.jumps.slice(0, 6) : [])) {
    const f = j && num(j.from, min, max), t = j && num(j.to, min, max);
    if (f == null || t == null || f === t) continue;
    jumps.push({ from: f, to: t, label: label(j.label, 14) });
    const mid = (x(f) + x(t)) / 2, h = 40;
    inner += `<path d="M${x(f)},96 Q${mid},${96 - h} ${x(t)},96" fill="none" stroke="${GREEN}" stroke-width="2"/>`
      + (label(j.label, 14) ? text(mid, 96 - h / 2 - 6, label(j.label, 14), { fill: GREEN, size: 12 }) : '');
  }
  return { svg: frame(300, 150, `Number line from ${fmt(min)} to ${fmt(max)}`, font, inner), params: { min, max, step, marks, jumps } };
}

// ---- bar_model: { parts, shaded, label } (fractions) or { bars: [{label, value}] } (comparison).
function barModel(p, font) {
  if (Array.isArray(p.bars)) {
    const bars = p.bars.slice(0, 5).map((b) => ({ label: label(b && b.label, 16), value: b && num(b.value, 0, 1e6) })).filter((b) => b.value != null);
    if (bars.length < 1 || !bars.some((b) => b.value > 0)) return null;
    const maxV = Math.max(...bars.map((b) => b.value));
    const rowH = 38, H = 20 + bars.length * rowH;
    let inner = '';
    bars.forEach((b, i) => {
      const y = 14 + i * rowH, w = (b.value / maxV) * 170;
      inner += text(10, y + 20, b.label, { anchor: 'start', size: 12 })
        + `<rect x="100" y="${y + 4}" width="${w}" height="22" rx="3" fill="${i % 2 ? GREEN : BLUE}"/>`
        + text(100 + w + 6, y + 20, fmt(b.value), { anchor: 'start', size: 12, fill: INK });
    });
    return { svg: frame(300, H, 'Bar comparison', font, inner), params: { bars } };
  }
  const parts = num(p.parts, 1, 12), shaded = num(p.shaded, 0, 12);
  if (!Number.isInteger(parts) || !Number.isInteger(shaded) || shaded > parts) return null;
  try {
    const svg = generateBarModelSvg({ parts, shaded, label: label(p.label, 24) || undefined });
    return { svg: svg.replace('<svg ', `<svg role="img" aria-label="${escapeXml(`${shaded} of ${parts} parts shaded`)}" style="font-family:${font}" `), params: { parts, shaded, label: label(p.label, 24) } };
  } catch { return null; }
}

// ---- flow_steps: 2 to 6 boxes joined by arrows.
function flowSteps(p, font) {
  const steps = (Array.isArray(p.steps) ? p.steps : []).map((s) => label(s, 34)).filter(Boolean);
  if (steps.length < 2 || steps.length > 6) return null;
  const boxH = 34, gap = 22, H = steps.length * (boxH + gap) - gap + 20;
  let inner = `<defs><marker id="fa" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${BLUE}"/></marker></defs>`;
  steps.forEach((s, i) => {
    const y = 10 + i * (boxH + gap);
    inner += `<rect x="30" y="${y}" width="240" height="${boxH}" rx="6" fill="#EAF2FC" stroke="${BLUE}" stroke-width="1.5"/>` + text(150, y + 22, s, { size: 13 });
    if (i < steps.length - 1) inner += `<line x1="150" y1="${y + boxH}" x2="150" y2="${y + boxH + gap - 2}" stroke="${BLUE}" stroke-width="2" marker-end="url(#fa)"/>`;
  });
  return { svg: frame(300, H, 'Steps: ' + steps.join(', '), font, inner), params: { steps } };
}

const BUILDERS = { vector_right_triangle: triangle, path_vs_straight: pathVsStraight, number_line: numberLine, bar_model: barModel, flow_steps: flowSteps };

export function buildDiagram(template, params, { font = "'Plus Jakarta Sans', 'Noto Sans', sans-serif" } = {}) {
  if (typeof template !== 'string' || !Object.prototype.hasOwnProperty.call(BUILDERS, template)) return null;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  try {
    const r = BUILDERS[template](params, font.replace(/[^A-Za-z0-9 ,'_-]/g, ''));
    return r ? { template, params: r.params, svg: r.svg } : null;
  } catch { return null; }
}
