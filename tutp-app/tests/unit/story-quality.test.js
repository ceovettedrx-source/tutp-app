// Storytelling quality round: the model per language, and one word for the
// counted things.
//   node --test tests/unit/story-quality.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, nounStem } from '../../server/story-schema.js';
import { storyModel, MODELS, modelSettings } from '../../server/models.js';
import { costUsd, PRICES } from '../../server/model-cost.js';
import { HOMEWORK_LANGUAGES } from '../../server/prompts/homework-prompts.js';

const good = () => ({
  title: 'Meena shares the Diwali laddus',
  gradeSubjectTag: 'Class 3 · Maths · Multiplication',
  readMinutes: 2,
  scenes: [
    { label: 'hook', text: 'Meena was helping amma pack laddus for Diwali.' },
    { label: 'problem', text: 'There were 4 plates and every plate needed 6 laddus.' },
    { label: 'mathMoment', text: 'Meena counted 6 + 6 + 6 + 6 and found 4 groups of 6.' },
    { label: 'wrapUp', text: 'Amma smiled: 4 times 6 is 24 laddus.' },
  ],
  visual: { type: 'groups', itemNoun: 'laddus', total: 24, groups: [6, 6, 6, 6] },
  equations: ['4 × 6 = 24'],
  tryTogether: { question: 'You put 5 laddus on each of 3 plates. How many laddus is that? 5 × 3 = ?', answer: '15' },
  parentPrompt: 'Ask your child to show 3 groups of 5 with spoons.',
});

test('English goes to haiku, every other language to sonnet-5', () => {
  assert.equal(storyModel('English'), 'claude-haiku-4-5');
  for (const l of HOMEWORK_LANGUAGES.filter((x) => x !== 'English')) assert.equal(storyModel(l), 'claude-sonnet-5', l);
  assert.equal(MODELS.story_english, 'claude-haiku-4-5');
  assert.deepEqual(modelSettings(storyModel('Telugu')), { output_config: { effort: 'low' } }); // sonnet-5 thinks by default
  assert.deepEqual(modelSettings(storyModel('English')), {});
});

test('the price table has both story models; sonnet-5 costs twice haiku', () => {
  assert.ok(PRICES[MODELS.story_english] && PRICES[MODELS.story_other]);
  const u = { input_tokens: 1500, output_tokens: 1200 };
  assert.equal(costUsd('claude-sonnet-5', u) / costUsd('claude-haiku-4-5', u), 2);
});

test('a story that uses its itemNoun passes', () => {
  assert.equal(validateStory(good()).ok, true);
});

test('another word for the counted things in the scenes asks for a retry', () => {
  const s = good();
  s.scenes = s.scenes.map((x) => ({ ...x, text: x.text.replace(/laddus/g, 'sweets') }));
  const r = validateStory(s);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /laddus/);
});

test('the try-together question must use the itemNoun too', () => {
  const s = good();
  s.tryTogether = { question: 'You put 5 messages in each of 3 boxes. How many messages? 5 × 3 = ?', answer: '15' };
  const r = validateStory(s);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /try-together/);
});

test('a dangling "= ?" after a sentence is cut off; a real expression keeps its "= ?"', () => {
  const s = good();
  s.tryTogether = { question: 'You put 3 laddus in each of 5 baskets. How many laddus in all? = ?', answer: '15' };
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.equal(r.story.tryTogether.question, 'You put 3 laddus in each of 5 baskets. How many laddus in all?');
  assert.equal(r.fixed, 1);
  const t = validateStory(good());
  assert.match(t.story.tryTogether.question, /5 × 3 = \?$/);
  assert.equal(t.fixed, 0);
});

test('a long open-ended try-together answer (science) is kept, not treated as missing', () => {
  const s = good();
  s.visual = null;
  s.tryTogether = { question: 'Which leaves of a plant look greener, and why?', answer: 'The leaves in bright sunlight look greener because they catch more sunlight to make food for the plant, so they stay healthy and strong.' };
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.ok(r.story.tryTogether.answer.length > 100);
});

test('no picture, no vocabulary check', () => {
  const s = good();
  s.visual = null;
  s.scenes = s.scenes.map((x) => ({ ...x, text: x.text.replace(/laddus/g, 'sweets') }));
  s.tryTogether.question = 'You put 5 sweets on each of 3 plates. 5 × 3 = ?';
  assert.equal(validateStory(s).ok, true);
});

test('stems: endings of an inflected language still match', () => {
  assert.equal(nounStem('laddus'), 'ladd');
  assert.equal(nounStem('లడ్డులు'), nounStem('లడ్డూలు'));               // ు / ూ
  assert.ok('లడ్డులను'.includes(nounStem('లడ్డులు')));                   // object ending
  assert.ok(!'సందేశాలు'.includes(nounStem('లడ్డులు')));                 // the Telugu word for "messages"
  assert.equal(nounStem('ab'), 'ab');                                   // short words are kept whole
  assert.ok(nounStem('मिठाई').length >= 3);
});

test('a Telugu story with matching inflected nouns passes', () => {
  const s = good();
  s.visual.itemNoun = 'లడ్డులు';
  s.scenes = [
    { label: 'hook', text: 'ఇష్టిక దీపావళికి అమ్మకు లడ్డూలు సర్దడంలో సాయం చేసింది.' },
    { label: 'problem', text: '4 పళ్ళేలు ఉన్నాయి, ప్రతి పళ్ళెంలో 6 లడ్డులు వేయాలి.' },
    { label: 'mathMoment', text: '6 + 6 + 6 + 6 అంటే 4 సమూహాల్లో 6.' },
    { label: 'wrapUp', text: 'మొత్తం 24 లడ్డులను చూసి అమ్మ నవ్వింది.' },
  ];
  s.tryTogether = { question: 'నీవు 3 పళ్ళేల్లో ప్రతిదానిలో 5 లడ్డులు పెడితే మొత్తం ఎన్ని లడ్డులు? 5 × 3 = ?', answer: '15' };
  assert.equal(validateStory(s).ok, true);
});
