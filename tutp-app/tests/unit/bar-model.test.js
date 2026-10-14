// Bar model (TUT-43 spec section 3 and section 10 risk 1):
//   node --test tests/unit/bar-model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutBarModel, renderSvg, validateModel, compareBuilt, unknownValue } from '../../public/app/shared/diagram/bar-model.js';
import { buildDiagram } from '../../server/services/diagrams.js';

function rand(seed) { let a = seed; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; }
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

function randomSpec(kind, r) {
  const unit = [1, 2, 5, 10, 25, 50, 100][int(r, 0, 6)];
  if (kind === 'parts') return { kind, unit, bars: [{ name: 'all', segments: Array.from({ length: int(r, 2, 3) }, () => ({ units: int(r, 1, 6) })) }], unknown: { bar: 0, total: true } };
  if (kind === 'lengths') return { kind, unit, bars: [{ name: 'A', segments: [{ units: int(r, 1, 20) }] }, { name: 'B', segments: [{ units: int(r, 1, 20) }] }], unknown: { difference: [0, 1] } };
  if (kind === 'fraction') { const n = int(r, 2, 10), k = int(r, 1, n - 1); return { kind, unit, bars: [{ name: 'all', segments: Array.from({ length: n }, (_, j) => ({ units: 1, ...(j < k ? { shaded: true } : {}) })) }], unknown: { shaded: true } }; }
  const p = int(r, 1, 5), q = int(r, 1, 7);
  return { kind: 'units', unit, bars: [{ name: 'A', segments: Array.from({ length: p }, () => ({ units: 1 })) }, { name: 'B', segments: Array.from({ length: q }, () => ({ units: 1 })) }], unknown: { bar: 0, total: true } };
}

test('every model kind lays out with exact ratios (200 random specs each)', () => {
  const r = rand(7);
  for (const kind of ['parts', 'lengths', 'fraction', 'units']) {
    for (let i = 0; i < 200; i++) {
      const spec = randomSpec(kind, r);
      assert.ok(validateModel(spec).ok, kind + ' ' + JSON.stringify(validateModel(spec).errors));
      const L = layoutBarModel(spec);
      const maxV = Math.max(...L.bars.map((b) => b.value));
      for (const b of L.bars) for (const s of b.segments) {
        assert.ok(Math.abs(s.w - (s.value / maxV) * L.trackWidth) < 1e-9, 'segment width is value / max * track');
      }
      // segments of a bar touch end to end
      for (const b of L.bars) b.segments.forEach((s, j) => { if (j) assert.ok(Math.abs(b.segments[j - 1].x + b.segments[j - 1].w - s.x) < 1e-9); });
    }
  }
});

test('validateModel rejects bad shapes, numbers and references', () => {
  const ok = { kind: 'parts', unit: 5, bars: [{ name: 'all', segments: [{ units: 3 }, { units: 2 }] }], unknown: { bar: 0, segment: 1 } };
  assert.ok(validateModel(ok).ok);
  const bad = (patch) => validateModel({ ...ok, ...patch }).ok;
  assert.equal(bad({ kind: 'blob' }), false);
  assert.equal(bad({ unit: -1 }), false);
  assert.equal(bad({ unit: Infinity }), false);
  assert.equal(bad({ bars: [] }), false);
  assert.equal(bad({ bars: [{ segments: [{ units: 1.5 }, { units: 2 }] }] }), false);
  assert.equal(bad({ bars: [{ segments: [{ units: 15 }, { units: 9 }] }] }), false);              // longer than 20 units
  assert.equal(bad({ unknown: { bar: 0, segment: 5 } }), false);
  assert.equal(bad({ unknown: { bar: 3, total: true } }), false);
  assert.equal(bad({ bars: Array.from({ length: 5 }, () => ({ segments: [{ units: 1 }, { units: 1 }] })) }), false);
  assert.equal(validateModel({ kind: 'lengths', unit: 1, bars: [{ segments: [{ units: 2 }, { units: 1 }] }, { segments: [{ units: 1 }] }], unknown: { difference: [0, 1] } }).ok, false);
  assert.equal(validateModel({ kind: 'fraction', unit: 1, bars: [{ segments: [{ units: 1 }, { units: 1 }] }], unknown: { shaded: true } }).ok, false); // nothing shaded
  assert.equal(validateModel(null).ok, false);
});

test('unknownValue reads the asked value from the spec', () => {
  assert.equal(unknownValue({ kind: 'parts', unit: 5, bars: [{ segments: [{ units: 3 }, { units: 2 }] }], unknown: { bar: 0, total: true } }), 25);
  assert.equal(unknownValue({ kind: 'lengths', unit: 2, bars: [{ segments: [{ units: 9 }] }, { segments: [{ units: 4 }] }], unknown: { difference: [0, 1] } }), 10);
  assert.equal(unknownValue({ kind: 'fraction', unit: 3, bars: [{ segments: [{ units: 1, shaded: true }, { units: 1 }, { units: 1 }, { units: 1 }] }], unknown: { unshaded: true } }), 9);
});

test('compareBuilt: parts in any order, at any scale, with the right labels', () => {
  const spec = { kind: 'parts', unit: 10, bars: [{ name: 'all', segments: [{ units: 7 }, { units: 5 }] }], unknown: { bar: 0, total: true } };
  const b = (a, x, la = '70', lb = '50') => ({ bars: [{ segments: [{ units: a, label: la }, { units: x, label: lb }] }] });
  assert.equal(compareBuilt(b(7, 5), spec).correct, true);
  assert.equal(compareBuilt(b(5, 7, '50', '70'), spec).correct, true);           // order does not matter
  assert.equal(compareBuilt(b(14, 10), spec).correct, true);                       // twice the scale
  assert.equal(compareBuilt(b(5, 5, '70', '50'), spec).bars[0].reason, 'size');   // "the 5 part is longer than the 7 part"
  assert.equal(compareBuilt(b(7, 5, '50', '70'), spec).bars[0].reason, 'label');   // numbers on the wrong parts
  assert.equal(compareBuilt({ bars: [{ segments: [{ units: 12, label: '120' }] }] }, spec).bars[0].reason, 'count');
  const unknownPart = { ...spec, unknown: { bar: 0, segment: 1 } };
  assert.equal(compareBuilt(b(7, 5, '70', '?'), unknownPart).correct, true);
  assert.equal(compareBuilt(b(7, 5, '70', '50'), unknownPart).correct, false);
});

test('compareBuilt: lengths, fractions (6 of 12 = 1 of 2) and ratio units (4:6 = 2:3)', () => {
  const len = { kind: 'lengths', unit: 1, bars: [{ name: 'A', segments: [{ units: 12 }] }, { name: 'B', segments: [{ units: 8 }] }], unknown: { difference: [0, 1] } };
  const L = (a, b, la = '12', lb = '8') => ({ bars: [{ segments: [{ units: a, label: la }] }, { segments: [{ units: b, label: lb }] }] });
  assert.equal(compareBuilt(L(12, 8), len).correct, true);
  assert.equal(compareBuilt(L(6, 4), len).correct, true);
  assert.equal(compareBuilt(L(12, 11), len).bars[1].reason, 'too_long');
  assert.equal(compareBuilt(L(12, 5), len).bars[1].reason, 'too_short');

  const frac = { kind: 'fraction', unit: 4, bars: [{ name: 'all', segments: [{ units: 1, shaded: true }, { units: 1 }] }], unknown: { shaded: true } };
  const F = (n, k) => ({ bars: [{ segments: Array.from({ length: n }, (_, j) => ({ units: 1, ...(j < k ? { shaded: true } : {}) })) }] });
  assert.equal(compareBuilt(F(12, 6), frac).correct, true);
  assert.equal(compareBuilt(F(2, 1), frac).correct, true);
  assert.equal(compareBuilt(F(4, 1), frac).bars[0].reason, 'shade');

  const ratio = { kind: 'units', unit: 5, bars: [{ name: 'A', segments: [{ units: 1 }, { units: 1 }] }, { name: 'B', segments: [{ units: 1 }, { units: 1 }, { units: 1 }] }], unknown: { bar: 0, total: true } };
  const U = (p, q) => ({ bars: [{ segments: Array.from({ length: p }, () => ({ units: 1 })) }, { segments: Array.from({ length: q }, () => ({ units: 1 })) }] });
  assert.equal(compareBuilt(U(2, 3), ratio).correct, true);
  assert.equal(compareBuilt(U(4, 6), ratio).correct, true);
  assert.equal(compareBuilt(U(3, 3), ratio).correct, false);
});

test('compareBuilt refuses junk builds without throwing', () => {
  const spec = { kind: 'parts', unit: 1, bars: [{ segments: [{ units: 2 }, { units: 3 }] }], unknown: { bar: 0, total: true } };
  for (const junk of [null, {}, { bars: 'x' }, { bars: [] }, { bars: [{ segments: [{ units: -1 }] }] }, { bars: [{ segments: [{ units: 99 }] }] }, { bars: [{ segments: Array(30).fill({ units: 1 }) }] }]) {
    assert.equal(compareBuilt(junk, spec).correct, false);
  }
});

test('renderSvg escapes names and shows "?" on the unknown', () => {
  const spec = { kind: 'parts', unit: 1, bars: [{ name: '<script>x</script>', segments: [{ units: 2 }, { units: 3 }] }], unknown: { bar: 0, segment: 1 } };
  const svg = renderSvg(layoutBarModel(spec), { spec });
  assert.match(svg, /^<svg /);
  assert.match(svg, /role="img"/);
  assert.doesNotMatch(svg, /<script/);
  assert.match(svg, />\?</);
  assert.doesNotMatch(svg, />3</);   // the unknown part's value is not shown
});

test('the diagrams bar_model template draws a bar-model spec, and refuses a bad one', () => {
  const model = { kind: 'parts', unit: 1, bars: [{ name: 'all', segments: [{ units: 2 }, { units: 3 }] }], unknown: { bar: 0, total: true } };
  assert.match(buildDiagram('bar_model', { model }).svg, /^<svg /);
  assert.equal(buildDiagram('bar_model', { model: { ...model, unit: -2 } }), null);
});
