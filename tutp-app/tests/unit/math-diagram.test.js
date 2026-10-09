// Code-drawn maths diagrams (TUT-23, server/services/diagrams.js buildMathDiagram).
//   node --test tests/unit/math-diagram.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMathDiagram } from '../../server/services/diagrams.js';
import { parseQuestion } from '../../server/math-engine.js';

const draw = (q) => buildMathDiagram(parseQuestion(q));
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const circles = (svg) => (svg.match(/<circle /g) || []).length;

test('the 8 live questions: a diagram only where the shape is supported, and every number in it is the question\'s own', () => {
  const live = ['9 = 3 × __', '100 × 5 = 25 × __', '25 × 0 + 75 =', '6 × 9 = 6 × 3 × __', '9 + 3 = __', '31 × 0 =', '45 − 18 =', '8 ÷ 2 = ?'];
  for (const q of live) {
    const p = parseQuestion(q);
    const d = buildMathDiagram(p);
    if (p.kind === 'compound') { assert.equal(d, null, 'compound sums get no diagram: ' + q); continue; }
    if (!d) continue;                       // an unsupported shape (31 × 0) gives none, never a wrong one
    const allowed = new Set([...p.numbers, p.answerText, '0', '?']);
    const shown = texts(d.svg).join(' ').match(/\d+/g) || [];
    // number-line ticks are a scale (multiples of the step); every labelled jump or bar value is checked below
    assert.ok(d.svg.startsWith('<svg'), q);
    assert.ok(shown.length > 0, q);
    if (d.template !== 'number_line') for (const n of shown) assert.ok(allowed.has(n), `${q}: "${n}" is not in the question`);
  }
});

test('addition: a number line whose jumps are the two addends', () => {
  const d = draw('9 + 3 = __');
  assert.equal(d.template, 'number_line');
  assert.deepEqual(d.params.jumps.map((j) => j.label), ['+9', '+3']);
  assert.equal(d.params.jumps[1].to, 12);
});

test('subtraction: one jump back by the subtrahend', () => {
  const d = draw('45 − 18 =');
  assert.deepEqual(d.params.jumps.map((j) => [j.from, j.to, j.label]), [[45, 27, '-18']]);
});

test('multiplication: a grid with exactly rows x columns dots; the same concept with other numbers draws another grid', () => {
  const a = draw('6 × 9 = ?'), b = draw('7 × 8 = ?');
  assert.equal(a.template, 'dot_grid');
  assert.equal(circles(a.svg), 54);
  assert.equal(circles(b.svg), 56);
  assert.notEqual(a.svg, b.svg);
});

test('a big product falls back to a labelled bar; 12 x 12 is the grid cap', () => {
  assert.equal(draw('12 × 12 = ?').template, 'dot_grid');
  const big = draw('25 × 13 = ?');
  assert.equal(big.template, 'bar_model');
  assert.ok(texts(big.svg).includes('25 × 13'));
});

test('division: equal groups, groups x size dots', () => {
  const d = draw('8 ÷ 2 = ?');
  assert.equal(d.template, 'dot_groups');
  assert.equal(circles(d.svg), 8);
  assert.equal(draw('7 ÷ 2 = ?'), null, 'not a whole answer: no diagram');
});

test('a missing number is drawn as "?" next to the total', () => {
  const d = draw('25 × __ = 100');
  assert.equal(d.template, 'bar_model');
  assert.ok(texts(d.svg).includes('25 × ?'));
  const left = draw('__ + 5 = 12');
  assert.ok(texts(left.svg).includes('? + 5'));
});

test('unsupported shapes give null, never a wrong diagram', () => {
  for (const q of ['0.5 + 0.25 =', '3/4 + 1/4 =', '25 × 0 + 75 =', '6 × 9 = 6 × 3 × __', '9 = 3 × __', '9 - 12 =']) assert.equal(draw(q), null, q);
  assert.equal(buildMathDiagram(null), null);
  assert.equal(buildMathDiagram({ kind: 'binary', op: '+', a: '<script>', b: '1', answer: { n: 1, d: 1 } }), null);
});

test('labels are escaped: markup in a number string never becomes markup', () => {
  const evil = { kind: 'blank', op: '+', blank: 'right', a: '1', b: null, c: '5', answer: { n: 4, d: 1 } };
  const d = buildMathDiagram(evil);
  assert.ok(d);
  assert.ok(!/<script|onload|onerror/i.test(d.svg));
  const svg = buildMathDiagram({ ...evil, op: '"><script>alert(1)</script>' });
  assert.ok(!svg || (!/<script/i.test(svg.svg) && !svg.svg.includes('alert(1)</script>')));
});

test('the font stack is cleaned before it reaches the svg', () => {
  const d = buildMathDiagram(parseQuestion('9 + 3 = __'), { font: "'Noto Sans Telugu'; background:url(x)" });
  assert.ok(!d.svg.includes('url('));
});
