// The times sign normalizer of the Storytelling Method reply check.
//   node --test tests/unit/story-times-sign.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixTimesSign, validateStory } from '../../server/story-schema.js';

test('x between digits becomes ×, with the spacing 4 × 6', () => {
  assert.equal(fixTimesSign('4 x 6 = 24'), '4 × 6 = 24');
  assert.equal(fixTimesSign('6x3'), '6 × 3');
  assert.equal(fixTimesSign('4 X 6'), '4 × 6');
});

test('x with a blank on either side becomes ×', () => {
  assert.equal(fixTimesSign('4 x __'), '4 × __');
  assert.equal(fixTimesSign('__ x 4 = 12'), '__ × 4 = 12');
  assert.equal(fixTimesSign('4 x □'), '4 × □');
});

test('* between digits becomes ×', () => {
  assert.equal(fixTimesSign('5 * 12 = 60'), '5 × 12 = 60');
  assert.equal(fixTimesSign('5*12'), '5 × 12');
});

test('x used as an unknown, and words, stay unchanged', () => {
  for (const s of ['x is the unknown number', 'Find x if x + 3 = 7', 'the box has 2x + 3 sweets', 'Maths exam on Max and Alex', 'a 5 star box', 'x = 4']) {
    assert.equal(fixTimesSign(s), s);
  }
});

test('Telugu and Hindi text around the sign', () => {
  assert.equal(fixTimesSign('4 ప్లేట్లు x 6 లడ్డూలు'), '4 ప్లేట్లు x 6 లడ్డూలు'); // a word between: untouched
  assert.equal(fixTimesSign('మొత్తం 4 x 6 = 24 లడ్డూలు'), 'మొత్తం 4 × 6 = 24 లడ్డూలు');
  assert.equal(fixTimesSign('कुल 5 x 12 = 60 आम'), 'कुल 5 × 12 = 60 आम');
});

test('an already correct × is unchanged and a second pass changes nothing', () => {
  assert.equal(fixTimesSign('4 × 6 = 24'), '4 × 6 = 24');
  const once = fixTimesSign('4 x 6 and 5*12 and 3 x __');
  assert.equal(once, '4 × 6 and 5 × 12 and 3 × __');
  assert.equal(fixTimesSign(once), once);
});

test('every visible story string is normalized, and the equation is still checked', () => {
  const r = validateStory({
    title: 'Meena shares laddus',
    gradeSubjectTag: 'Class 3 · Maths',
    scenes: [
      { label: 'hook', text: 'Meena packed laddus.' },
      { label: 'problem', text: 'There were 4 plates of 6 laddus.' },
      { label: 'mathMoment', text: 'She wrote 4 x 6 for the laddus.' },
      { label: 'wrapUp', text: 'It was 24 laddus.' },
    ],
    visual: null,
    equations: ['4 x 6 = 25'],
    tryTogether: { question: 'How many laddus on 3 plates of 5? 5 x 3 = ?', answer: '15' },
    parentPrompt: 'Ask: what is 3 x 5?',
  });
  assert.equal(r.ok, true);
  assert.equal(r.story.scenes[2].text, 'She wrote 4 × 6 for the laddus.');
  assert.deepEqual(r.story.equations, ['4 × 6 = 24']);
  assert.equal(r.story.tryTogether.question, 'How many laddus on 3 plates of 5? 5 × 3 = ?');
  assert.equal(r.story.tryTogether.answer, '15');
  assert.equal(r.story.parentPrompt, 'Ask: what is 3 × 5?');
});
