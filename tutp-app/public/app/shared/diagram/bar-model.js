// Bar model (Singapore Maths Method, TUT-43; first module of the shared TUT-23
// diagram engine). Plain ES module with no DOM access, so the server
// (server/services/diagrams.js, server/sgmath/) and the browser
// (public/app/singapore-maths/) run the same code.
//
// A model spec is numbers only (labels are added at render time):
//   {
//     kind: 'parts' | 'lengths' | 'fraction' | 'units',
//     unit: 5,                       // value of one grid unit
//     bars: [{ name: 'Ravi', segments: [{ units: 3, shaded?: true }] }],
//     unknown: { bar: 0, segment: 1 } | { bar: 0, total: true } | { difference: [0, 1] } | { shaded: true } | { unshaded: true }
//   }
// A segment's value is units * unit. Kinds:
//   parts     one bar split into parts of any size (part-whole, before/after)
//   lengths   2 bars, one segment each (comparison)
//   fraction  one bar of N equal parts, some shaded
//   units     2 bars of equal units (ratio)
//
//   layoutBarModel(spec, opts) -> { width, height, bars, brackets }
//   renderSvg(layout, opts)    -> '<svg ...>' (labels escaped)
//   validateModel(spec)        -> { ok, errors }
//   compareBuilt(built, spec)  -> { correct, bars: [{ ok, reason }] }
// Unit tests: tests/unit/bar-model.test.js.

export const KINDS = ['parts', 'lengths', 'fraction', 'units'];
export const LIMITS = { maxBars: 4, maxSegments: 12, maxUnitsPerBar: 20, maxValue: 100000 };

const INK = '#0F1B2D';
const BLUE = '#005bbf';
const GREEN = '#1E7B4A';
const LIGHT = '#EAF2FC';
const SHADE = '#9CC3EE';

const isInt = (n) => Number.isInteger(n);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const cut = (s, max) => {
  const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const fmt = (n) => String(Math.round(n * 100) / 100);

export const segmentValue = (spec, seg) => seg.units * spec.unit;
export const barUnits = (bar) => bar.segments.reduce((s, g) => s + g.units, 0);
export const barValue = (spec, bar) => barUnits(bar) * spec.unit;

// ---- validation ---------------------------------------------------------

export function validateModel(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['not_an_object'] };
  if (!KINDS.includes(spec.kind)) errors.push('kind');
  if (!finite(spec.unit) || spec.unit <= 0 || spec.unit > LIMITS.maxValue) errors.push('unit');
  const bars = Array.isArray(spec.bars) ? spec.bars : null;
  if (!bars || bars.length < 1 || bars.length > LIMITS.maxBars) errors.push('bar_count');
  if (errors.length) return { ok: false, errors };
  let segCount = 0;
  bars.forEach((b, i) => {
    if (!b || !Array.isArray(b.segments) || !b.segments.length) { errors.push(`bar_${i}_segments`); return; }
    segCount += b.segments.length;
    for (const g of b.segments) {
      if (!g || !isInt(g.units) || g.units < 1) errors.push(`bar_${i}_units`);
    }
    if (barUnits(b) > LIMITS.maxUnitsPerBar) errors.push(`bar_${i}_too_long`);
    if (barValue(spec, b) > LIMITS.maxValue) errors.push(`bar_${i}_value`);
  });
  if (segCount > LIMITS.maxSegments) errors.push('segment_count');
  if (spec.kind === 'lengths' && (bars.length !== 2 || bars.some((b) => b.segments.length !== 1))) errors.push('lengths_shape');
  if (spec.kind === 'fraction' && (bars.length !== 1 || bars[0].segments.some((g) => g.units !== 1) || bars[0].segments.length < 2)) errors.push('fraction_shape');
  if (spec.kind === 'fraction' && !bars[0].segments.some((g) => g.shaded)) errors.push('fraction_none_shaded');
  if (spec.kind === 'units' && (bars.length !== 2 || bars.some((b) => b.segments.some((g) => g.units !== 1)))) errors.push('units_shape');
  if (spec.kind === 'parts' && (bars.length !== 1 || bars[0].segments.length < 2)) errors.push('parts_shape');
  const u = spec.unknown;
  if (!u || typeof u !== 'object') errors.push('unknown');
  else if (u.difference) {
    if (!Array.isArray(u.difference) || u.difference.length !== 2 || !u.difference.every((k) => isInt(k) && bars[k])) errors.push('unknown_ref');
  } else if (u.shaded || u.unshaded) {
    if (spec.kind !== 'fraction') errors.push('unknown_ref');
  } else if (!isInt(u.bar) || !bars[u.bar] || (!u.total && !(isInt(u.segment) && bars[u.bar].segments[u.segment]))) {
    errors.push('unknown_ref');
  }
  if (!errors.length) {
    // Proportionality, checked on the real layout: a segment's width must be
    // value / maxTotal * trackWidth within 0.5 percent of the track.
    const layout = layoutBarModel(spec);
    const maxV = Math.max(...bars.map((b) => barValue(spec, b)));
    for (const lb of layout.bars) {
      for (const s of lb.segments) {
        const want = (s.value / maxV) * layout.trackWidth;
        if (Math.abs(s.w - want) > 0.005 * layout.trackWidth) errors.push('not_proportional');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// The value the question asks for, computed from the spec alone.
export function unknownValue(spec) {
  const u = spec.unknown;
  if (u.difference) {
    const [a, b] = u.difference;
    return Math.abs(barValue(spec, spec.bars[a]) - barValue(spec, spec.bars[b]));
  }
  if (u.shaded || u.unshaded) {
    const segs = spec.bars[0].segments;
    return segs.filter((g) => (u.shaded ? g.shaded : !g.shaded)).length * spec.unit;
  }
  if (u.total) return barValue(spec, spec.bars[u.bar]);
  return segmentValue(spec, spec.bars[u.bar].segments[u.segment]);
}

// ---- layout ---------------------------------------------------------------

export function layoutBarModel(spec, { trackWidth = 260, labelWidth = 76, barHeight = 36, gap = 34, pad = 14 } = {}) {
  const maxV = Math.max(...spec.bars.map((b) => barValue(spec, b)));
  const x0 = pad + labelWidth;
  const bars = spec.bars.map((b, i) => {
    const y = pad + 18 + i * (barHeight + gap);
    let x = x0;
    const segments = b.segments.map((g, j) => {
      const value = segmentValue(spec, g);
      const w = (value / maxV) * trackWidth;
      const seg = { index: j, x, w, value, shaded: !!g.shaded };
      x += w;
      return seg;
    });
    return { index: i, name: b.name || '', x: x0, y, h: barHeight, w: x - x0, value: barValue(spec, b), segments };
  });
  const brackets = [];
  const u = spec.unknown || {};
  if (u.difference) {
    const [a, b] = u.difference;
    const long = bars[a].w >= bars[b].w ? bars[a] : bars[b];
    const short = long === bars[a] ? bars[b] : bars[a];
    brackets.push({ kind: 'difference', x1: short.x + short.w, x2: long.x + long.w, y: short.y + short.h / 2, unknown: true });
  }
  bars.forEach((b, i) => {
    if (spec.kind === 'parts' || spec.kind === 'fraction' || (u.total && u.bar === i) || spec.kind === 'units') {
      brackets.push({ kind: 'total', bar: i, x1: b.x, x2: b.x + b.w, y: b.y + b.h + 6, unknown: !!(u.total && u.bar === i) });
    }
  });
  const height = pad + 18 + spec.bars.length * (barHeight + gap) + 6;
  return { width: x0 + trackWidth + pad + 40, height, trackWidth, bars, brackets, kind: spec.kind };
}

// ---- render ---------------------------------------------------------------
// opts.labels: { 'b0s1': '7', 'b0': 'Ravi', 'total0': '?', 'diff': '?' } overrides; by default
// every segment shows its value, the unknown shows '?', and opts.hideValues shows only '?'.
export function renderSvg(layout, { title = 'Bar model', font = "'Plus Jakarta Sans', 'Noto Sans', sans-serif", spec = null, showValues = true, labels = {} } = {}) {
  const f = String(font).replace(/[^A-Za-z0-9 ,'_-]/g, '');
  const u = (spec && spec.unknown) || {};
  const t = (x, y, s, { size = 13, fill = INK, anchor = 'middle', weight = 600 } = {}) =>
    `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(cut(String(s), 24))}</text>`;
  let inner = '';
  for (const b of layout.bars) {
    inner += t(b.x - 8, b.y + b.h / 2 + 5, labels['b' + b.index] ?? b.name, { anchor: 'end', size: 12 });
    for (const s of b.segments) {
      const isUnknown = (!u.difference && !u.total && !u.shaded && !u.unshaded && u.bar === b.index && u.segment === s.index)
        || (layout.kind === 'lengths' && u.total && u.bar === b.index);
      const fill = s.shaded ? SHADE : (isUnknown ? '#FFF6DD' : LIGHT);
      inner += `<rect x="${fmt(s.x)}" y="${fmt(b.y)}" width="${fmt(s.w)}" height="${b.h}" fill="${fill}" stroke="${BLUE}" stroke-width="2"/>`;
      const key = `b${b.index}s${s.index}`;
      let lab = labels[key];
      if (lab === undefined && layout.kind !== 'fraction' && layout.kind !== 'units') lab = isUnknown ? '?' : (showValues ? fmt(s.value) : '');
      if (lab) inner += t(s.x + s.w / 2, b.y + b.h / 2 + 5, lab);
    }
  }
  for (const br of layout.brackets) {
    const key = br.kind === 'difference' ? 'diff' : 'total' + br.bar;
    const value = br.kind === 'difference' ? null : layout.bars[br.bar].value;
    let lab = labels[key];
    if (lab === undefined) lab = br.unknown ? '?' : (showValues && value != null ? fmt(value) : '');
    if (br.kind === 'difference') {
      inner += `<path d="M${fmt(br.x1)},${fmt(br.y)} H${fmt(br.x2)}" stroke="${GREEN}" stroke-width="2" stroke-dasharray="4 3" fill="none"/>`;
      if (lab) inner += t((br.x1 + br.x2) / 2, br.y - 8, lab, { fill: GREEN });
    } else {
      const y = br.y;
      inner += `<path d="M${fmt(br.x1)},${y} v6 H${fmt(br.x2)} v-6" stroke="${INK}" stroke-width="1.5" fill="none"/>`;
      if (lab) inner += t((br.x1 + br.x2) / 2, y + 22, lab, { size: 12 });
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(layout.width)} ${fmt(layout.height + 18)}" role="img" aria-label="${escapeXml(cut(title, 120))}" style="font-family:${f}">${inner}</svg>`;
}

// ---- judging a child's build --------------------------------------------
// built: { bars: [{ segments: [{ units, shaded?, label? }] }] }   (the child's bars, same count and order)
// Result per bar: ok and a reason key the page turns into words:
//   count (wrong number of parts), size (a part has the wrong size), length (bar too long/short
//   against the other), shade (wrong shaded amount), label (a label does not match), shape (unusable build).
// Sizes are compared as ratios of the longest bar (so a build at twice the scale is still right),
// within half a unit step. A fraction is right when shaded/parts equals the spec's (6 of 12 = 1 of 2).

function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }

export function compareBuilt(built, spec, { checkLabels = true } = {}) {
  const fail = (reason) => ({ correct: false, bars: spec.bars.map(() => ({ ok: false, reason })) });
  if (!built || !Array.isArray(built.bars) || built.bars.length !== spec.bars.length) return fail('shape');
  for (const b of built.bars) {
    if (!b || !Array.isArray(b.segments) || !b.segments.length || b.segments.length > LIMITS.maxSegments) return fail('shape');
    if (b.segments.some((g) => !g || !isInt(g.units) || g.units < 1 || g.units > LIMITS.maxUnitsPerBar)) return fail('shape');
  }
  const res = spec.bars.map(() => ({ ok: true, reason: null }));

  if (spec.kind === 'fraction') {
    const want = spec.bars[0].segments;
    const got = built.bars[0].segments;
    const wk = want.filter((g) => g.shaded).length, wn = want.length;
    const gk = got.filter((g) => g.shaded).length, gn = got.length;
    if (got.some((g) => g.units !== got[0].units)) res[0] = { ok: false, reason: 'size' };
    else if (gk * wn !== wk * gn) res[0] = { ok: false, reason: 'shade' };
    return { correct: res.every((r) => r.ok), bars: res };
  }

  const wantMax = Math.max(...spec.bars.map(barUnits));
  const gotMax = Math.max(...built.bars.map(barUnits));
  const tol = 0.5 / wantMax;

  if (spec.kind === 'units') {
    // ratio: unit counts must be in the same proportion (4:6 equals 2:3)
    const w = spec.bars.map(barUnits), g = built.bars.map(barUnits);
    const gw = gcd(w[0], w[1]), gg = gcd(g[0], g[1]);
    spec.bars.forEach((_, i) => {
      if (built.bars[i].segments.some((s) => s.units !== built.bars[i].segments[0].units)) res[i] = { ok: false, reason: 'size' };
      else if (g[i] / gg !== w[i] / gw) res[i] = { ok: false, reason: g[i] / gg > w[i] / gw ? 'too_many' : 'too_few' };
    });
    return { correct: res.every((r) => r.ok), bars: res };
  }

  spec.bars.forEach((wb, i) => {
    const gb = built.bars[i];
    if (spec.kind === 'lengths') {
      const wr = barUnits(wb) / wantMax, gr = barUnits(gb) / gotMax;
      if (gb.segments.length !== 1) res[i] = { ok: false, reason: 'count' };
      else if (Math.abs(wr - gr) > tol) res[i] = { ok: false, reason: gr > wr ? 'too_long' : 'too_short' };
      return;
    }
    // parts: same number of parts, and the same sizes in any order
    if (gb.segments.length !== wb.segments.length) { res[i] = { ok: false, reason: 'count' }; return; }
    const w = wb.segments.map((s) => s.units / wantMax).sort((a, b) => a - b);
    const g = gb.segments.map((s) => s.units / gotMax).sort((a, b) => a - b);
    if (w.some((x, k) => Math.abs(x - g[k]) > tol)) res[i] = { ok: false, reason: 'size' };
  });

  if (checkLabels && res.every((r) => r.ok)) {
    const labelErr = checkLabelsOf(built, spec, gotMax, wantMax);
    if (labelErr) res[labelErr.bar] = { ok: false, reason: 'label' };
  }
  return { correct: res.every((r) => r.ok), bars: res };
}

// Labels: every part of a parts bar, and every lengths bar, carries a label:
// its number, or '?' on the unknown. Matched by size, so order does not matter.
function checkLabelsOf(built, spec, gotMax, wantMax) {
  const u = spec.unknown || {};
  const scale = gotMax / wantMax;
  for (let i = 0; i < spec.bars.length; i++) {
    const wb = spec.bars[i], gb = built.bars[i];
    if (spec.kind === 'lengths') {
      const unknownHere = u.total && u.bar === i;
      const want = unknownHere ? '?' : String(barValue(spec, wb));
      if (u.difference) { if (String(gb.label ?? gb.segments[0].label ?? '') !== String(barValue(spec, wb))) return { bar: i }; continue; }
      if (String(gb.label ?? gb.segments[0].label ?? '') !== want) return { bar: i };
      continue;
    }
    const pool = wb.segments.map((s, j) => ({ units: s.units * scale, label: (!u.total && u.bar === i && u.segment === j) ? '?' : String(segmentValue(spec, s)) }));
    for (const g of gb.segments) {
      const k = pool.findIndex((p) => Math.abs(p.units - g.units) < 0.5 && p.label === String(g.label ?? ''));
      if (k < 0) return { bar: i };
      pool.splice(k, 1);
    }
  }
  return null;
}
