// Story visuals v2: the four picture types, the item icon, the picture built
// in code, and the check of sums written in the scenes.
//   node --test tests/unit/story-visuals.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, validateVisual, equationFact, sceneEquationIssues, asciiDigits, timesSign } from '../../server/story-schema.js';
import { isSingleEmoji, iconForNoun, pickIcon } from '../../server/story-icons.js';

const base = () => ({
  title: 'Meena and the plates',
  gradeSubjectTag: 'Class 3 · Maths',
  readMinutes: 2,
  scenes: [
    { label: 'hook', text: 'Meena was helping amma pack laddus for Diwali.' },
    { label: 'problem', text: 'There were 4 plates and every plate needed 6 laddus.' },
    { label: 'mathMoment', text: 'Meena counted 6 + 6 + 6 + 6 = 24 laddus.' },
    { label: 'wrapUp', text: 'Amma smiled: 4 × 6 = 24.' },
  ],
  visual: { type: 'groups', itemNoun: 'laddus', icon: '🟠', total: 24, groups: [6, 6, 6, 6] },
  equations: ['4 × 6 = 24'],
  tryTogether: { question: 'You put 5 laddus on each of 3 plates. How many laddus? 5 × 3 = ?', answer: '15' },
  parentPrompt: 'Ask your child to show 3 groups of 5 with spoons.',
});
// an inverse-operations story, no groups
const inverse = () => ({
  ...base(),
  scenes: [
    { label: 'hook', text: 'Ravi had 7 marbles in his pocket.' },
    { label: 'problem', text: 'His friend gave him 5 more and he wondered how many he had.' },
    { label: 'mathMoment', text: 'He found 7 + 5 = 12, and then 12 - 5 = 7 to check.' },
    { label: 'wrapUp', text: 'Ravi saw that adding and taking away undo each other.' },
  ],
  visual: { type: 'factFamily', a: 7, b: 5, total: 12, op: 'add' },
  equations: ['7 + 5 = 12', '12 − 5 = 7'],
  tryTogether: { question: 'You have 9 stickers and get 4 more. How many now? 9 + 4 = ?', answer: '13' },
});

test('isSingleEmoji: one emoji only', () => {
  for (const e of ['🥭', '🟠', '✏️', '🪔', '👨‍👩‍👧']) assert.equal(isSingleEmoji(e), true, e);
  for (const e of ['', 'a', 'mango', '🥭🥭', '🥭 mango', '12', null, undefined, 5]) assert.equal(isSingleEmoji(e), false, String(e));
});

test('icon: model emoji, else the curated map, else empty (a dot)', () => {
  assert.equal(pickIcon('🥭', 'anything'), '🥭');
  assert.equal(pickIcon('mango', 'mangoes'), '🥭');           // not an emoji -> map
  assert.equal(pickIcon('', 'laddus'), '🟠');
  assert.equal(iconForNoun('మామిడి పండ్లు'), '🥭');
  assert.equal(iconForNoun('दीये'.replace('दीये', 'दीया')), '🪔');
  assert.equal(pickIcon(undefined, 'zorbs'), '');
  assert.equal(pickIcon('🥭🥭', 'zorbs'), '');
});

test('groups keep a valid icon; an invalid one falls back', () => {
  const r = validateStory(base());
  assert.equal(r.ok, true);
  assert.equal(r.story.visual.icon, '🟠');
  const s = base(); s.visual.icon = 'orange fruit';
  assert.equal(validateStory(s).story.visual.icon, '🟠'); // by noun
});

test('numberLine: valid, and bad ranges or jumps are dropped', () => {
  assert.deepEqual(validateVisual({ type: 'numberLine', from: 0, to: 20, jumps: [{ from: 8, to: 13 }] }),
    { type: 'numberLine', from: 0, to: 20, step: 1, jumps: [{ from: 8, to: 13 }] });
  assert.ok(validateVisual({ type: 'numberLine', from: 0, to: 50, step: 5, jumps: [] }));
  assert.equal(validateVisual({ type: 'numberLine', from: 0, to: 50, jumps: [] }), null);              // 50 marks
  assert.equal(validateVisual({ type: 'numberLine', from: 5, to: 5, jumps: [] }), null);
  assert.equal(validateVisual({ type: 'numberLine', from: 0, to: 10, jumps: [{ from: 2, to: 12 }] }), null);
});

test('barModel: parts must add up to the total', () => {
  const v = { type: 'barModel', total: 12, parts: [{ label: 'red', value: 5 }, { label: 'blue', value: 7 }] };
  assert.equal(validateVisual(v).total, 12);
  assert.equal(validateVisual({ ...v, total: 13 }), null);
  assert.equal(validateVisual({ ...v, parts: [{ label: 'red', value: 12 }] }), null);
});

test('factFamily: the numbers must be consistent', () => {
  assert.ok(validateVisual({ type: 'factFamily', a: 3, b: 4, total: 7, op: 'add' }));
  assert.ok(validateVisual({ type: 'factFamily', a: 3, b: 4, total: 12, op: 'multiply' }));
  assert.equal(validateVisual({ type: 'factFamily', a: 3, b: 4, total: 8, op: 'add' }), null);
  assert.equal(validateVisual({ type: 'factFamily', a: 3, b: 4, total: 7, op: 'power' }), null);
  assert.equal(validateVisual({ type: 'pie' }), null);
});

test('equationFact: plain whole-number equations become a fact family', () => {
  assert.deepEqual(equationFact('7 + 5 = 12'), { type: 'factFamily', a: 7, b: 5, total: 12, op: 'add' });
  assert.deepEqual(equationFact('9 − 4 = 5'), { type: 'factFamily', a: 4, b: 5, total: 9, op: 'add' });
  assert.deepEqual(equationFact('4 x 6 = 24'), { type: 'factFamily', a: 4, b: 6, total: 24, op: 'multiply' });
  assert.deepEqual(equationFact('24 ÷ 6 = 4'), { type: 'factFamily', a: 6, b: 4, total: 24, op: 'multiply' });
  for (const e of ['7 + 5 = 13', '1/2 + 1/2 = 1', '3 + 4 + 5 = 12', '2.5 × 4 = 10', '7 ÷ 2 = 3', '0 + 5 = 5', 'x + 5 = 12']) assert.equal(equationFact(e), null, e);
  assert.deepEqual(equationFact('౭ + ౫ = ౧౨'), { type: 'factFamily', a: 7, b: 5, total: 12, op: 'add' }); // Telugu digits
});

test('no picture from the model: one is built from the equations list', () => {
  const s = inverse(); s.visual = null;
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.equal(r.visualSource, 'derived');
  assert.deepEqual(r.story.visual, { type: 'factFamily', a: 7, b: 5, total: 12, op: 'add' });
});

test('a visual the model got wrong is replaced by the listed equation', () => {
  const s = inverse(); s.visual = { type: 'factFamily', a: 2, b: 3, total: 5, op: 'add' };
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.equal(r.visualSource, 'derived');
  assert.equal(r.story.visual.total, 12);
  assert.ok(r.fixed >= 1);
});

test('a factFamily that matches the list is kept as the model wrote it', () => {
  const r = validateStory(inverse());
  assert.equal(r.ok, true);
  assert.equal(r.visualSource, 'model');
});

test('a lesson with no equation and no picture stays without one', () => {
  const s = base(); s.visual = null; s.equations = [];
  s.scenes = s.scenes.map((x) => ({ ...x, text: x.text.replace(/\d+ [+×] \d+( [+×] \d+)*( = \d+)?/g, 'some') }));
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.equal(r.story.visual, null);
  assert.equal(r.visualSource, 'none');
});

test('the try-together question must be a new problem (fact family)', () => {
  const s = inverse(); s.tryTogether = { question: 'You have 7 stickers and get 5 more. How many now? 7 + 5 = ?', answer: '12' };
  const r = validateStory(s);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /new problem/);
  s.tryTogether = { question: 'You have 7 stickers and get 4 more. How many now? 7 + 4 = ?', answer: '11' }; // one number shared is fine
  assert.equal(validateStory(s).ok, true);
});

test('a wrong sum written in a scene is an issue (retry path)', () => {
  const s = base(); s.scenes[2].text = 'Meena counted 6 + 6 + 6 + 6 = 25 laddus.';
  const r = validateStory(s);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /6 \+ 6 \+ 6 \+ 6 = 25.*24/);
});

test('a scene result that disagrees with the equations list is an issue', () => {
  assert.deepEqual(sceneEquationIssues(['She found 3 × 4 = 12.'], ['3 × 4 = 12']), []);
  assert.equal(sceneEquationIssues(['She found 3 × 4 = 14.'], ['3 × 4 = 12']).length, 1); // wrong anyway
});

test('scene sums: x × ÷ / − - and Telugu text and digits around them', () => {
  assert.deepEqual(sceneEquationIssues(['4 x 6 = 24', '4 × 6 = 24', '24 ÷ 6 = 4', '24 / 6 = 4', '10 − 3 = 7', '10 - 3 = 7'], []), []);
  assert.equal(sceneEquationIssues(['4 x 6 = 25'], []).length, 1);
  assert.equal(sceneEquationIssues(['24 ÷ 6 = 5'], []).length, 1);
  assert.equal(sceneEquationIssues(['10 − 3 = 8'], []).length, 1);
  assert.equal(sceneEquationIssues(['10 - 3 = 8'], []).length, 1);
  assert.deepEqual(sceneEquationIssues(['ఇషిక 4 x 6 = 24 అని లెక్కవేసింది.'], []), []);
  assert.equal(sceneEquationIssues(['ఇషిక 4 x 6 = 25 అని లెక్కవేసింది.'], []).length, 1);
  assert.equal(sceneEquationIssues(['ఇషిక ౪ × ౬ = ౨౫ అని లెక్కవేసింది.'], []).length, 1); // Telugu digits
  assert.deepEqual(sceneEquationIssues(['ఇషిక ౪ × ౬ = ౨౪ అని లెక్కవేసింది.'], []), []);
  assert.equal(asciiDigits('౦౧౨౩౪౫౬౭౮౯ ०१२ ௦௯'), '0123456789 012 09');
});

test('scene sums: fractions, decimals, negatives, remainders and algebra are skipped silently', () => {
  const skip = [
    '1/2 + 1/4 = 3/4', '1/2 + 1/2 = 3', '0.5 × 4 = 3', '4 × 0.5 = 3', '3 × 2.5 = 8', '2 + 2 = 4.5',
    '-3 + 5 = 5', '5 + -3 = 9', '17 ÷ 5 = 4', '17 ÷ 5 = 3 remainder 2', '17 ÷ 5 = 3 R 2', '7 ÷ 2 = 5',
    '500 + 500 = 1,000', '2x + 3 = 8', '3x + 4x = 9', '12 ÷ 5 = 2 r 2', '1 + 2 + 3 = 6 + 1 = 8',
  ];
  for (const t of skip) assert.deepEqual(sceneEquationIssues([`She wrote ${t} on the board.`], []), [], t);
});

test('old replies with a groups picture and no icon still validate', () => {
  const s = base(); delete s.visual.icon;
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.equal(r.story.visual.icon, '🟠'); // from the noun map
  const t = base(); delete t.visual.icon; t.visual.itemNoun = 'zorbs';
  t.scenes = t.scenes.map((x) => ({ ...x, text: x.text.replace(/laddus/g, 'zorbs') }));
  t.tryTogether.question = t.tryTogether.question.replace(/laddus/g, 'zorbs');
  assert.equal(validateStory(t).story.visual.icon, ''); // the page draws a dot
});

test('timesSign: x, X and * between numbers become ×; variables and words stay', () => {
  assert.equal(timesSign('4 x 6 = 24'), '4 × 6 = 24');
  assert.equal(timesSign('4x6 = 24'), '4×6 = 24');
  assert.equal(timesSign('4 X 6 and 4 * 6 and 3 x 4 x 5'), '4 × 6 and 4 × 6 and 3 × 4 × 5');
  for (const t of ['x + 5 = 12', '2x + 3 = 11', 'x = 7', 'Max has 5 boxes', 'a box of 6', '6 x', 'x 6', 'size 4x', 'the 5 xylophones', 'matrix2x3']) {
    assert.equal(timesSign(t), t, t);
  }
  assert.equal(timesSign('ఇషిక 4 x 6 = 24 అని లెక్కవేసింది.'), 'ఇషిక 4 × 6 = 24 అని లెక్కవేసింది.');
  assert.equal(timesSign('ఇషిక4x6=24 అని'), 'ఇషిక4×6=24 అని');          // Telugu letters touching the numbers
  assert.equal(timesSign('౪ x ౬ = ౨౪'), '౪ × ౬ = ౨౪');                   // Telugu digits
  assert.equal(timesSign('x + 5 = 12 అయితే x విలువ 7'), 'x + 5 = 12 అయితే x విలువ 7');
});

test('validateStory writes × in scenes, equations and the try-together question', () => {
  const s = base();
  s.scenes[3].text = 'Amma smiled: 4 x 6 = 24 laddus.';
  s.equations = ['4 x 6 = 24'];
  s.tryTogether = { question: 'You put 5 laddus on each of 3 plates. How many laddus? 5 x 3 = ?', answer: '15' };
  const r = validateStory(s);
  assert.equal(r.ok, true);
  assert.match(r.story.scenes[3].text, /4 × 6 = 24/);
  assert.deepEqual(r.story.equations, ['4 × 6 = 24']);
  assert.match(r.story.tryTogether.question, /5 × 3 = \?$/);
  const v = base(); v.scenes[3].text = 'Amma said: x + 5 = 12 means x is 7, so 4 laddus.';
  assert.match(validateStory(v).story.scenes[3].text, /x \+ 5 = 12/);
});
