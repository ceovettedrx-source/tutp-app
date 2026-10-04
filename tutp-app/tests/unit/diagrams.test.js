// Answer Please diagram templates and script fonts (docs/specs/answer-explain-v2.md section C).
//   node --test tests/unit/diagrams.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagram, DIAGRAM_TEMPLATES, escapeXml } from '../../server/services/diagrams.js';
import { scriptOf, fontFor, fontStack } from '../../server/lang-fonts.js';

const ok = {
  vector_right_triangle: { a: 3, b: 4, unit: 'm' },
  path_vs_straight: { path_length: 10, straight_length: 6, unit: 'm' },
  number_line: { min: 0, max: 10, step: 2, marks: [{ value: 4, label: 'A' }], jumps: [{ from: 0, to: 4, label: '+4' }] },
  bar_model: { bars: [{ label: 'Ravi', value: 12 }, { label: 'Sita', value: 8 }] },
  flow_steps: { steps: ['Read', 'Plan', 'Solve'] },
};

test('every v1 template draws an svg from its params', () => {
  assert.deepEqual(DIAGRAM_TEMPLATES.sort(), Object.keys(ok).sort());
  for (const [t, p] of Object.entries(ok)) {
    const d = buildDiagram(t, p);
    assert.ok(d, t);
    assert.match(d.svg, /^<svg /);
    assert.match(d.svg, /role="img"/);
    assert.equal(d.template, t);
  }
});

test('the fraction bar model reuses the existing generator', () => {
  assert.match(buildDiagram('bar_model', { parts: 4, shaded: 3, label: '3/4' }).svg, /<svg/);
  assert.equal(buildDiagram('bar_model', { parts: 4, shaded: 5 }), null);
});

test('the right triangle computes the hypotenuse itself', () => {
  assert.match(buildDiagram('vector_right_triangle', { a: 3, b: 4, unit: 'm' }).svg, /5 m/);
});

test('unknown template and bad params give no diagram', () => {
  assert.equal(buildDiagram('freehand', { svg: '<svg/>' }), null);
  assert.equal(buildDiagram('__proto__', {}), null);
  assert.equal(buildDiagram('vector_right_triangle', { a: -1, b: 4 }), null);
  assert.equal(buildDiagram('vector_right_triangle', { a: 'x', b: 4 }), null);
  assert.equal(buildDiagram('vector_right_triangle', null), null);
  assert.equal(buildDiagram('path_vs_straight', { path_length: 5, straight_length: 9 }), null);
  assert.equal(buildDiagram('number_line', { min: 0, max: 1000, step: 1 }), null);
  assert.equal(buildDiagram('number_line', { min: 5, max: 1, step: 1 }), null);
  assert.equal(buildDiagram('flow_steps', { steps: ['only one'] }), null);
  assert.equal(buildDiagram('flow_steps', { steps: Array(7).fill('x') }), null);
  assert.equal(buildDiagram('bar_model', { bars: [] }), null);
});

test('labels are escaped and cut: no markup can come out of the model text', () => {
  const d = buildDiagram('flow_steps', { steps: ['<script>alert(1)</script>', '"><img src=x onerror=1>'] });
  assert.doesNotMatch(d.svg, /<script|<img/);        // only escaped text, never a tag
  assert.match(d.svg, /&lt;script&gt;/);
  assert.equal(escapeXml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  const long = buildDiagram('vector_right_triangle', { a: 3, b: 4, unit: 'm', labels: { a: 'x'.repeat(200) } });
  assert.ok(long.svg.length < 3000);
});

test('labels use the Noto Sans font of the answer script', () => {
  const d = buildDiagram('flow_steps', { steps: ['చదవండి', 'ఆలోచించండి'] }, { font: fontStack('telugu') });
  assert.match(d.svg, /font-family:'Noto Sans Telugu'/);
  assert.equal(scriptOf('దూరం మరియు స్థానభ్రంశం'), 'telugu');
  assert.equal(scriptOf('दूरी और विस्थापन'), 'devanagari');
  assert.equal(scriptOf('distance'), 'latin');
  assert.equal(scriptOf(''), 'latin');
  assert.equal(fontFor('devanagari'), 'Noto Sans Devanagari');
  assert.equal(fontFor('latin'), null);
  assert.match(fontStack('latin'), /Plus Jakarta Sans/);
  // a hostile font string is stripped to safe characters
  assert.doesNotMatch(buildDiagram('flow_steps', ok.flow_steps, { font: 'x;}</svg><script>' }).svg, /<script/);
});
