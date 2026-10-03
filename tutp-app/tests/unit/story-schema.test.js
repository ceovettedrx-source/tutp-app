// Storytelling Method reply checks (storytelling redesign).
//   node --test tests/unit/story-schema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, salvageStory, fixEquation, extractStoryJson } from '../../server/story-schema.js';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';

const good = () => ({
  title: 'Meena shares the Diwali laddus',
  gradeSubjectTag: 'Class 3 · Maths · Multiplication',
  readMinutes: 2,
  scenes: [
    { label: 'hook', text: 'Meena was helping amma pack laddus for Diwali.' },
    { label: 'problem', text: 'There were 4 plates and every plate needed 6 laddus.' },
    { label: 'mathMoment', text: 'Meena counted 6 + 6 + 6 + 6 and found it is 4 groups of 6.' },
    { label: 'wrapUp', text: 'Amma smiled: 4 times 6 is 24 laddus.' },
  ],
  visual: { type: 'groups', itemNoun: 'laddus', total: 24, groups: [6, 6, 6, 6] },
  equations: ['4 × 6 = 24', '6 + 6 + 6 + 6 = 24'],
  tryTogether: { question: 'If you put 5 laddus on each of 3 plates, how many laddus is that? 5 × 3 = ?', answer: '15' },
  parentPrompt: 'Ask your child to show 3 groups of 5 with spoons.',
});

test('a complete reply passes and keeps its numbers', () => {
  const r = validateStory(good());
  assert.equal(r.ok, true);
  assert.equal(r.fixed, 0);
  assert.equal(r.story.scenes.length, 4);
  assert.deepEqual(r.story.visual.groups, [6, 6, 6, 6]);
  assert.equal(r.story.readMinutes, 2);
});

test('groups that do not add up to the total drop the visual, nothing else', () => {
  const s = good();
  s.visual.total = 25;
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.equal(r.story.visual, null);
  assert.equal(r.fixed, 1);
  assert.equal(r.story.equations.length, 2);
});

test('a total over 60 is kept (the page draws 60 and counts the rest)', () => {
  const s = good();
  s.visual = { type: 'groups', itemNoun: 'laddus', total: 100, groups: [50, 50] };
  assert.equal(validateStory(s).story.visual.total, 100);
});

test('a wrong plain-arithmetic equation result is corrected', () => {
  assert.deepEqual(fixEquation('4 × 6 = 25'), { text: '4 × 6 = 24', fixed: true });
  assert.deepEqual(fixEquation('4 × 6 = 24'), { text: '4 × 6 = 24', fixed: false });
  assert.deepEqual(fixEquation('half of 8 = 4'), { text: 'half of 8 = 4', fixed: false });
  const s = good();
  s.equations = ['4 × 6 = 26'];
  const r = validateStory(s);
  assert.equal(r.story.equations[0], '4 × 6 = 24');
  assert.equal(r.fixed, 1);
});

test('the try-together answer is recomputed from its question', () => {
  const s = good();
  s.tryTogether.answer = '16';
  const r = validateStory(s);
  assert.equal(r.story.tryTogether.answer, '15');
  assert.equal(r.fixed, 1);
});

test('a sentence answer that does not contain the computed value asks for a retry', () => {
  const s = good();
  s.tryTogether.answer = 'It makes sixteen laddus: 16';
  assert.equal(validateStory(s).ok, false);
  s.tryTogether.answer = '5 groups of 3 make 15 laddus';
  assert.equal(validateStory(s).ok, true);
});

test('missing pieces are reported', () => {
  const s = good();
  delete s.title; delete s.parentPrompt; s.scenes = s.scenes.slice(0, 2);
  const r = validateStory(s);
  assert.equal(r.ok, false);
  assert.ok(r.issues.length >= 3);
  assert.equal(validateStory(null).ok, false);
  assert.equal(validateStory([]).ok, false);
});

test('an unknown scene label or an empty text is a problem; extra scenes are cut at 6', () => {
  const s = good();
  s.scenes[1].label = 'twist';
  assert.equal(validateStory(s).ok, true); // 3 usable scenes are enough
  s.scenes[2].text = '';
  assert.equal(validateStory(s).ok, false);
  const t = good();
  t.visual = null;
  t.scenes = Array.from({ length: 9 }, () => ({ label: 'hook', text: 'x y z' }));
  assert.equal(validateStory(t).story.scenes.length, 6);
});

test('read time is worked out when the model leaves it out or sends nonsense', () => {
  const s = good();
  s.readMinutes = 99;
  assert.ok(validateStory(s).story.readMinutes >= 1 && validateStory(s).story.readMinutes <= 10);
});

test('salvage: the old story shape becomes scenes; nothing readable is null', () => {
  const f = salvageStory({ subject: 'Maths', story: 'Meena had 4 plates. She put 6 laddus on each. How many laddus? There were 24. Amma smiled.', abhyasaPrompt: 'Count spoons together.' });
  assert.equal(f.fallback, true);
  assert.ok(f.scenes.length >= 2 && f.scenes.length <= 4);
  assert.equal(f.tryTogether, null);
  assert.equal(f.parentPrompt, 'Count spoons together.');
  assert.equal(salvageStory({ title: 'x' }), null);
  assert.equal(salvageStory(null), null);
});

test('extractStoryJson reads the first text block', () => {
  const data = { content: [{ type: 'text', text: 'ok ' + JSON.stringify(good()) }] };
  assert.equal(extractStoryJson(data).title, good().title);
  assert.equal(extractStoryJson({ content: [] }), null);
  assert.equal(extractStoryJson({ content: [{ type: 'text', text: '{bad' }] }), null);
});

test('the prompt asks for the new shape, talks to the child, keeps Panchpadi and the source wording', () => {
  const { system } = buildHomeworkRequest({ feature: 'storytelling', lang: 'Telugu', childContext: 'Asha · Class 3', text: 'Multiplication', attachments: [] });
  for (const k of ['scenes', 'tryTogether', 'parentPrompt', 'readMinutes', 'gradeSubjectTag', 'mathMoment', 'wrapUp']) assert.ok(system.includes(k), k);
  assert.match(system, /Panchpadi/);
  assert.match(system, /Telugu/);
  assert.match(system, /exactly as (written|they appear)/i);
  assert.match(system, /you/i);
});
