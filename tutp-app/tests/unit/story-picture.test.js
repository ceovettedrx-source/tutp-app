// TUT-73 add-on: a Story always gets a picture ticket unless a library picture covers it.
//   node --test tests/unit/story-picture.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { storyPicture, fallbackScene, fallbackKey } from '../../server/story-picture.js';
import { cleanScenePrompt, normalizeConceptKey } from '../../server/explain-schema.js';

const KEY = 'c9-physics-distance-vs-displacement';
const GOOD = 'A boy walks along a winding village road to the market at sunrise.';
const ctx = { classNum: 5, seed: 'lesson text' };

test('good key and scene: used as they are, no warning reason', () => {
  const r = storyPicture(KEY, GOOD, ctx);
  assert.equal(r.reason, null);
  assert.equal(r.usedFallback, false);
  assert.equal(r.pic.concept_key, KEY);
});

test('scene with a digit only: key kept, scene built in code, ticket returned', () => {
  const r = storyPicture(KEY, 'A girl walks 5 metres to the shop.', ctx);
  assert.equal(r.reason, 'scene');
  assert.equal(r.usedFallback, true);
  assert.equal(r.pic.concept_key, KEY);
  assert.ok(r.pic.scene_prompt && r.pic.sig);
});

test('scene with a text word only ("label"): ticket still returned', () => {
  const r = storyPicture(KEY, 'A boy puts a label on the jar.', ctx);
  assert.equal(r.reason, 'scene');
  assert.ok(r.pic && r.pic.scene_prompt);
});

test('empty key: key built from the class, scene kept', () => {
  const r = storyPicture('', GOOD, ctx);
  assert.equal(r.reason, 'key');
  assert.equal(r.usedFallback, true);
  assert.match(r.pic.concept_key, /^c5-story-[0-9a-f]{8}$/);
  assert.equal(r.pic.scene_prompt, GOOD);
});

test('Telugu-only scene and no key: both fall back', () => {
  const r = storyPicture(null, 'ఒక అబ్బాయి మార్కెట్‌కు నడుచుకుంటూ వెళ్తున్నాడు.', ctx);
  assert.equal(r.reason, 'both');
  assert.equal(r.usedFallback, true);
  assert.ok(r.pic.concept_key && r.pic.scene_prompt && r.pic.sig);
});

test('library visual: no picture, no fallback', () => {
  const r = storyPicture('', '', { ...ctx, visual: { type: 'library', id: 'chromosome' } });
  assert.equal(r.pic, null);
  assert.equal(r.reason, null);
  assert.equal(r.usedFallback, false);
});

test('a non-library visual does not block the picture', () => {
  const r = storyPicture(KEY, '', { ...ctx, visual: { type: 'groups' } });
  assert.ok(r.pic);
});

test('fallback scene survives cleanScenePrompt unchanged, with no digit or text word', () => {
  for (const k of [KEY, 'c5-science-number-line', 'c7-maths-q362552f3', 'c9-x', '', 'c3-general-label-writing']) {
    const s = fallbackScene(k);
    assert.ok(s.length > 20, k);
    assert.equal(cleanScenePrompt(s), s, k);
    assert.doesNotMatch(s, /\d/);
  }
});

test('fallback key is a valid concept key, stable per lesson, and class-clamped', () => {
  const a = fallbackKey(5, 'same lesson');
  assert.equal(a, fallbackKey(5, 'same lesson'));
  assert.notEqual(a, fallbackKey(5, 'other lesson'));
  assert.equal(normalizeConceptKey(a), a);
  assert.match(fallbackKey(99, 'x'), /^c5-story-/);
  assert.match(fallbackKey(undefined, undefined), /^c5-story-/);
});
