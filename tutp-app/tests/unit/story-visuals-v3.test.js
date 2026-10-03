// Story visuals v3 (code-drawn): the Venn diagram, item icons on numberLine,
// barModel and factFamily, and pictures for chain equations and blanks.
//   node --test tests/unit/story-visuals-v3.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVisual, validateVenn, equationVisual, validateStory } from '../../server/story-schema.js';

const venn = () => ({
  type: 'venn',
  left: { label: 'likes tea', items: ['Asha', 'Ravi'] },
  right: { label: 'likes milk', items: ['Meena'] },
  both: ['Kiran'],
});

test('venn: valid sets keep their regions, items become {text, icon}', () => {
  const v = validateVisual(venn());
  assert.equal(v.type, 'venn');
  assert.deepEqual(v.left.items.map((i) => i.text), ['Asha', 'Ravi']);
  assert.deepEqual(v.both, [{ text: 'Kiran', icon: '' }]);
  assert.equal(v.left.label, 'likes tea');
});

test('venn: an element with an icon in the item map gets it, numbers are items too', () => {
  const v = validateVisual({ type: 'venn', left: { label: 'fruit', items: ['mango', 2] }, right: { label: 'sweets', items: ['laddu'] }, both: [] });
  assert.equal(v.left.items[0].icon, '🥭');
  assert.deepEqual(v.left.items[1], { text: '2', icon: '' });
  assert.equal(v.right.items[0].icon, '🟠');
  assert.deepEqual(v.both, []);
});

test('venn: dropped when an element is in two regions, labels missing, empty, or too many', () => {
  assert.equal(validateVenn({ ...venn(), both: ['Asha'] }), null);
  assert.equal(validateVenn({ ...venn(), both: ['asha'] }), null);                  // same word, other case
  assert.equal(validateVenn({ ...venn(), left: { label: '', items: ['A'] } }), null);
  assert.equal(validateVenn({ type: 'venn', left: { label: 'a', items: [] }, right: { label: 'b', items: ['x'] }, both: [] }), null); // left set empty
  assert.equal(validateVenn({ type: 'venn', left: { label: 'a', items: ['x'] }, right: { label: 'b', items: ['y'] } }) !== null, true); // disjoint sets are fine
  const items = (p) => Array.from({ length: 9 }, (_, i) => p + i);
  assert.equal(validateVenn({ type: 'venn', left: { label: 'a', items: items('a') }, right: { label: 'b', items: items('b') }, both: items('c') }), null); // 27 > 24
  assert.equal(validateVenn({ ...venn(), left: { label: 'a', items: [{ x: 1 }] } }), null);
  assert.equal(validateVenn({ ...venn(), left: { label: 'a', items: 'Asha' } }), null);
  assert.equal(validateVisual({ type: 'venn' }), null);
});

const sets = (visual) => ({
  title: 'Sets at the school fair', gradeSubjectTag: 'Class 6 · Maths · Sets', readMinutes: 2,
  scenes: [
    { label: 'hook', text: 'Asha and Ravi sold tea at the school fair.' },
    { label: 'problem', text: 'Meena sold milk, and Kiran sold both tea and milk, so who is in which group?' },
    { label: 'mathMoment', text: 'The people who sell tea are one set, those who sell milk are another, and Kiran is in both.' },
    { label: 'wrapUp', text: 'Asha drew two circles that overlap, and Kiran stood in the middle.' },
  ],
  visual, equations: [], tryTogether: { question: 'Four children like cricket, 3 like kabaddi and 1 likes both. How many children in all?', answer: '6' },
  parentPrompt: 'Draw two circles with your child.',
});

test('venn in a story: the elements must be the story\'s own', () => {
  const ok = validateStory(sets(venn()));
  assert.equal(ok.ok, true);
  assert.equal(ok.story.visual.type, 'venn');
  const foreign = validateStory(sets({ type: 'venn', left: { label: 'a', items: ['zebra', 'giraffe'] }, right: { label: 'b', items: ['lion'] }, both: ['camel'] }));
  assert.equal(foreign.ok, false);
  assert.match(foreign.issues.join(' '), /Venn diagram/);
});

test('icons: numberLine, barModel, factFamily keep a single emoji or the noun\'s icon, else none', () => {
  const nl = validateVisual({ type: 'numberLine', from: 0, to: 10, step: 1, jumps: [{ from: 2, to: 6 }], icon: '🐸' });
  assert.equal(nl.icon, '🐸');
  const bm = validateVisual({ type: 'barModel', total: 12, parts: [{ label: 'red', value: 5 }, { label: 'blue', value: 7 }], itemNoun: 'mangoes' });
  assert.equal(bm.icon, '🥭');
  const ff = validateVisual({ type: 'factFamily', a: 3, b: 4, total: 7, op: 'add', icon: '🍌' });
  assert.equal(ff.icon, '🍌');
  // not an emoji and no known noun: the key is left out (older shapes stay identical)
  const none = validateVisual({ type: 'factFamily', a: 3, b: 4, total: 7, op: 'add', icon: 'banana' });
  assert.deepEqual(none, { type: 'factFamily', a: 3, b: 4, total: 7, op: 'add' });
  assert.deepEqual(validateVisual({ type: 'numberLine', from: 0, to: 10, step: 1, jumps: [] }), { type: 'numberLine', from: 0, to: 10, step: 1, jumps: [] });
});

test('chain of additions: a bar model of its terms', () => {
  assert.deepEqual(equationVisual('2 + 3 + 4 = 9'), { type: 'barModel', parts: [{ label: '', value: 2 }, { label: '', value: 3 }, { label: '', value: 4 }], total: 9 });
  assert.equal(equationVisual('2 + 3 + 4 = 10'), null);      // wrong sum: never drawn
  assert.equal(equationVisual('1 + 2 + 3 + 4 + 5 + 6 + 7 = 28'), null); // more than 6 terms
});

test('chain of multiplications: groups, the last factor of 2 to 12 is the group count', () => {
  const g = equationVisual('2 × 3 × 4 = 24');
  assert.equal(g.type, 'groups');
  assert.equal(g.total, 24);
  assert.deepEqual(g.groups, [6, 6, 6, 6]);
  assert.equal(g.itemNoun, '');
  assert.equal(equationVisual('2 × 3 × 4 = 25'), null);
  assert.equal(equationVisual('50 × 30 × 2 = 3000'), null);   // over the 1000 items cap
  assert.equal(equationVisual('3 x 3 x 3 = 27').total, 27);   // the letter x
});

test('blanks: solved, then drawn', () => {
  // one blank in a simple equation: a fact family
  assert.deepEqual(equationVisual('4 × ___ = 24'), { type: 'factFamily', a: 4, b: 6, total: 24, op: 'multiply' });
  assert.deepEqual(equationVisual('__ + 7 = 12'), { type: 'factFamily', a: 5, b: 7, total: 12, op: 'add' });
  assert.deepEqual(equationVisual('12 − __ = 5'), { type: 'factFamily', a: 7, b: 5, total: 12, op: 'add' }); // 12 - 7 = 5
  // the founder's example: 6 x 9 = 6 x 3 x ___ (blank is 3): 3 groups of 18
  for (const eq of ['6 × 9 = 6 × 3 × ___', '6 x 9 = 6 x 3 x ___', '6 × 9 = 6 × 3 × □']) {
    const g = equationVisual(eq);
    assert.equal(g.type, 'groups', eq);
    assert.equal(g.total, 54, eq);
    assert.deepEqual(g.groups, [18, 18, 18], eq);
  }
  // an addition chain with a blank
  assert.equal(equationVisual('2 + 3 + __ = 9').type, 'barModel');
  // not solvable or not whole: no picture
  assert.equal(equationVisual('5 × __ = 12'), null);
  assert.equal(equationVisual('__ + __ = 12'), null);
  assert.equal(equationVisual('2x + 3 = 9'), null);
  assert.equal(equationVisual('half of 12 = 6'), null);
  assert.equal(equationVisual('1/2 + 1/2 = 1'), null);
});

test('plain equations keep their fact-family picture', () => {
  assert.deepEqual(equationVisual('4 × 6 = 24'), { type: 'factFamily', a: 4, b: 6, total: 24, op: 'multiply' });
  assert.deepEqual(equationVisual('9 − 4 = 5'), { type: 'factFamily', a: 4, b: 5, total: 9, op: 'add' });
});

test('a story with only a chain or blank equation gets a derived picture', () => {
  const base = {
    title: 'Ravi and the boxes', gradeSubjectTag: 'Class 4 · Maths', readMinutes: 2,
    scenes: [
      { label: 'hook', text: 'Ravi packed boxes at the shop.' },
      { label: 'problem', text: 'He wanted to count them fast.' },
      { label: 'mathMoment', text: 'He split the boxes into groups and counted the groups.' },
      { label: 'wrapUp', text: 'Now counting was easy.' },
    ],
    visual: null, equations: ['6 × 9 = 6 × 3 × ___'],
    tryTogether: { question: 'You have 8 rows of 5 pencils. How many pencils? 8 × 5 = ?', answer: '40' }, parentPrompt: 'Count in groups together.',
  };
  const r = validateStory(base);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.visualSource, 'derived');
  assert.equal(r.story.visual.type, 'groups');
  assert.equal(r.story.visual.total, 54);
});
