// Unit tests for "Explain on photo" (round B2): the crop geometry in
// public/js/tutp-pointer.js and the explain_line / locate_line reply checks
// in server/routes/visual-tutor.js.
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'vm';
import { sanitizeExplain, sanitizeLocate } from '../../server/routes/visual-tutor.js';

// tutp-pointer.js is a browser script: run it with a stub window.
const sandbox = { window: { matchMedia: () => ({ matches: false }) } };
vm.runInNewContext(fs.readFileSync(new URL('../../public/js/tutp-pointer.js', import.meta.url), 'utf8'), sandbox);
// Copied into a plain object: the sandbox's objects have its own prototype.
const cropRect = (...args) => ({ ...sandbox.window.TutPointer.cropRect(...args) });

test('cropRect: pads one line height above and below, 4% at the sides', () => {
  // Line 500..800 wide, 300..340 tall (0..1000) on a 1000 x 1000 photo.
  assert.deepEqual(cropRect([500, 300, 800, 340], 1000, 1000), { x: 460, y: 260, w: 380, h: 120 });
});

test('cropRect: a thin line still gets 2% of the height as padding', () => {
  const r = cropRect([100, 500, 900, 505], 1000, 2000);   // 10 px tall on a 2000 px photo
  assert.equal(r.y, 1000 - 40);
  assert.equal(r.h, 10 + 80);
});

test('cropRect: at least 30% of the photo wide, centred on the line', () => {
  assert.deepEqual(cropRect([480, 300, 520, 340], 1000, 1000), { x: 350, y: 260, w: 300, h: 120 });
});

test('cropRect: clamped to the photo at every edge', () => {
  const r = cropRect([0, 0, 1000, 30], 1200, 1600);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
  assert.equal(r.w, 1200);
  assert.ok(r.y + r.h <= 1600);
  const b = cropRect([0, 970, 1000, 1000], 1200, 1600);
  assert.equal(b.y + b.h, 1600);
});

const IMG = { width: 800, height: 200 };
const step = (box, extra = {}) => ({ type: 'box', target: { kind: 'image', box }, tone: 'info', label: 'x', say: 'y', ...extra });

test('sanitizeExplain: found, boxes to 0..1000 of the crop, at most 5 steps', () => {
  const out = sanitizeExplain({ found: true, steps: [step([80, 20, 400, 100]), ...Array(6).fill(step([0, 0, 800, 200]))] }, IMG);
  assert.equal(out.found, true);
  assert.equal(out.steps.length, 5);
  assert.deepEqual(out.steps[0].target.box, [100, 100, 500, 500]);
});

test('sanitizeExplain: found false, or no step left after the checks -> not found', () => {
  assert.deepEqual(sanitizeExplain({ found: false, steps: [step([0, 0, 800, 200])] }, IMG), { found: false, steps: [] });
  assert.deepEqual(sanitizeExplain({ found: true, steps: [step([0, 0, 2, 2]), { type: 'bogus' }] }, IMG), { found: false, steps: [] });
  assert.deepEqual(sanitizeExplain(null, IMG), { found: false, steps: [] });
});

test('sanitizeExplain: unknown tone becomes info; red stays red', () => {
  const out = sanitizeExplain({ found: true, steps: [step([0, 0, 400, 100], { tone: 'purple' }), step([400, 0, 800, 100], { tone: 'mistake' })] }, IMG);
  assert.deepEqual(out.steps.map((s) => s.tone), ['info', 'mistake']);
});

test('sanitizeLocate: box to 0..1000 of the photo; bad or missing box -> not found', () => {
  assert.deepEqual(sanitizeLocate({ found: true, box: [80, 20, 400, 100] }, IMG), { found: true, box: [100, 100, 500, 500] });
  assert.deepEqual(sanitizeLocate({ found: false, box: [80, 20, 400, 100] }, IMG), { found: false, box: null });
  assert.deepEqual(sanitizeLocate({ found: true, box: [80, 20, 81, 100] }, IMG), { found: false, box: null });
  assert.deepEqual(sanitizeLocate({ found: true }, IMG), { found: false, box: null });
});
