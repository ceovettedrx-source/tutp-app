// Pictures by class (TUT-19, server/picture-rule.js + server/explain-schema.js mathsScenePrompt).
//   node --test tests/unit/picture-rule.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureRule, contextPictureKey } from '../../server/picture-rule.js';
import { mathsScenePrompt, MATHS_IMAGE_SUFFIX } from '../../server/explain-schema.js';
import { classBand } from '../../server/question-key.js';

test('maths: Class 1-5 gets one context picture on the page slot and none on the other cards', () => {
  assert.equal(pictureRule({ maths: true, band: '1-5', slot: 'page' }), 'context');
  assert.equal(pictureRule({ maths: true, band: '1-5', slot: 'none' }), 'none');
});

test('maths: Class 6+ and an unknown class get no AI picture (the diagram only)', () => {
  for (const cls of ['Class 6', 'Class 8', 'Class 9', 'Class 12', '', null, 'KG', 'Class ten']) {
    assert.equal(pictureRule({ maths: true, band: classBand(cls), slot: 'page' }), 'none', String(cls));
  }
});

test('anything that is not maths keeps today\'s concept picture, whatever the class', () => {
  for (const cls of ['Class 3', 'Class 7', 'Class 10', '']) {
    assert.equal(pictureRule({ maths: false, band: classBand(cls), slot: 'none' }), 'normal');
  }
});

test('a context picture has its own key, so an old concept picture is never reused', () => {
  const k = contextPictureKey('c4-multiplication-facts');
  assert.equal(k, 'c4-multiplication-facts-ctx');
  assert.notEqual(k, 'c4-multiplication-facts');
  const long = contextPictureKey('c4-' + 'x'.repeat(80));
  assert.ok(long.length <= 60 && long.endsWith('-ctx'), long);
});

test('the context prompt keeps the setting and drops countable objects, numbers and text', () => {
  const live = [
    'A kirana shop with 5 apples and 3 mangoes on the counter. A mother and a child stand near the shop.',
    'Rice, dal and oil packets on a shelf. A market lane in the morning.',
    'Four children share eight laddus. A classroom in an Indian school.',
  ];
  for (const scene of live) {
    const p = mathsScenePrompt(scene, 'c4-multiplication');
    assert.ok(p.endsWith(MATHS_IMAGE_SUFFIX), p);
    assert.ok(!/\d/.test(p.replace(MATHS_IMAGE_SUFFIX, '')), p);
    assert.ok(!/apple|mango|laddu|packet|rice|dal|oil|four|eight|five|three/i.test(p.replace(MATHS_IMAGE_SUFFIX, '')), p);
  }
  assert.match(mathsScenePrompt(live[0], 'c4-x'), /mother and a child/);
});

test('the suffix carries the no-countable, no-number, no-text rule; an empty scene falls back to a plain setting', () => {
  assert.match(MATHS_IMAGE_SUFFIX, /no countable objects/);
  assert.match(MATHS_IMAGE_SUFFIX, /no numbers/);
  assert.match(MATHS_IMAGE_SUFFIX, /no text/);
  const p = mathsScenePrompt('Five apples. Ten coins. Write the number 5.', 'c4-x');
  assert.match(p, /everyday place in India/);
});

test('no digit of the 8 live questions can reach the prompt', () => {
  const live = ['9 = 3 × __', '100 × 5 = 25 × __', '25 × 0 + 75 =', '6 × 9 = 6 × 3 × __', '9 + 3 = __', '31 × 0 =', '45 − 18 =', '8 ÷ 2 = ?'];
  for (const q of live) {
    const p = mathsScenePrompt(`A market lane. ${q} is written on a board. ${q.replace(/\D+/g, ' ')} stones.`, 'c4-x').replace(MATHS_IMAGE_SUFFIX, '');
    assert.ok(!/\d/.test(p), q + ' -> ' + p);
  }
});
