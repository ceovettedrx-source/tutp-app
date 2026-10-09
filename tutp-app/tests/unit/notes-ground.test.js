// Notes quality v2: grounding check, glossary, prompt.
//   node --test tests/unit/notes-ground.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNotes, correctionHint, numbersIn } from '../../server/notes-ground.js';
import { GLOSSARY, glossaryBlock } from '../../server/prompts/notes-glossary.js';
import { notesPrompt, notesUserText } from '../../server/prompts/notes-prompts.js';
import { systemText } from '../../server/prompt-cache.js';

const HW = '1. 6 x 9 = 6 x 3 x __\n2. 8 x 12 = 8 x 4 x __';
const notes = (o) => ({ version: 2, title: 'T', key_idea: 'K', quick_check: [{ q: '5 x 14', a: '70' }, { q: '7 x 8', a: '56' }], ...o });

test('a title sharing a number passes', () => {
  assert.equal(checkNotes(notes({ title: 'Splitting 9 into 3 x 3' }), HW).ok, true);
});
test('generic notes with no shared number, operator or keyword fail', () => {
  const r = checkNotes(notes({ title: 'Properties of multiplication', key_idea: 'Multiplication has many useful properties.' }), HW);
  assert.deepEqual(r.reasons, ['no_overlap']);
});
test('a skill described in words passes when the worked example problem has the homework shape', () => {
  const n = notes({ title: 'Breaking one factor into two', key_idea: 'Split one factor and keep both sides equal.', worked_example: { problem: '5 × 8 = 5 × 2 × __', steps: ['x'], answer: '4' } });
  assert.equal(checkNotes(n, HW).ok, true);
  assert.equal(checkNotes({ ...n, worked_example: { problem: 'name three properties', steps: ['x'], answer: 'y' } }, HW).ok, false);
});
test('a shared operator is enough', () => {
  assert.equal(checkNotes(notes({ title: 'Keep both sides equal', key_idea: 'Both sides of = must match.' }), HW).ok, true);
});
test('a shared keyword passes, with a word ending ignored', () => {
  assert.equal(checkNotes(notes({ title: 'Fractions with unlike denominators', key_idea: 'Make the denominators equal.' }), 'Add the fraction 1/2 and denominator work').ok, true);
  assert.equal(checkNotes(notes({ title: 'Plurals of nouns', key_idea: 'Add es to words ending in x.' }), 'Write the plural of: box, child, leaf.').ok, true);
  assert.equal(checkNotes(notes({ title: 'Describing words', key_idea: 'Adjectives tell more about a noun.' }), 'Write the plural of: box, child, leaf.').ok, false);
});
test('a Telugu keyword matches its inflected form', () => {
  const hw = 'కిరణజన్య సంయోగక్రియ గురించి వ్రాయండి';
  assert.equal(checkNotes(notes({ title: 'కిరణజన్య సంయోగక్రియ అంటే ఏమిటి', key_idea: 'మొక్కలు ఆహారం తయారుచేస్తాయి.' }), hw).ok, true);
  assert.equal(checkNotes(notes({ title: 'మొక్కల పెరుగుదల', key_idea: 'మొక్కలు పెరుగుతాయి.' }), hw).ok, false);
});
test('English-only homework text is not compared with Telugu notes unless numbers or operators exist', () => {
  assert.equal(checkNotes(notes({ title: 'కిరణజన్య సంయోగక్రియ', key_idea: 'మొక్కలు ఆహారం తయారుచేస్తాయి.' }), 'Photosynthesis in plants').ok, true);
});
test('empty homework, plain fallback and null pass', () => {
  assert.equal(checkNotes(notes({}), '').ok, true);
  assert.equal(checkNotes({ plain: ['a'] }, HW).ok, true);
  assert.equal(checkNotes(null, HW).ok, true);
});
test('stop words alone do not count as overlap', () => {
  assert.equal(checkNotes(notes({ title: 'Write the answer', key_idea: 'Fill the blank.' }), 'Write the answer. Fill the blank.').ok, true);  // nothing left to compare
  assert.equal(checkNotes(notes({ title: 'Write the answer', key_idea: 'Fill the blank.' }), 'Write the answer for 6 x 9').ok, false);
});
test('quick_check reusing homework numbers is flagged; new numbers pass', () => {
  assert.deepEqual(checkNotes(notes({ title: '6 x 9', quick_check: [{ q: '6 x 9 = 6 x 3 x __', a: '18' }, { q: '5 x 14', a: '70' }] }), HW).reasons, ['quick_reuse']);
  assert.deepEqual(checkNotes(notes({ title: '6 x 9', quick_check: [{ q: '7 x 8 = 7 x 4 x __', a: '14' }, { q: '5 x 14', a: '70' }] }), HW).reasons, []);
});
test('numbers ignore 0 and 1 and thousands commas', () => {
  assert.deepEqual(numbersIn('1 0 12 1,500 3.5'), ['12', '1500', '3.5']);
});
test('the correction hint covers each reason', () => {
  assert.match(correctionHint(['no_overlap']), /specific skill/);
  assert.match(correctionHint(['quick_reuse']), /different numbers/);
});

test('glossary: te and hi for every entry, block only for te and hi', () => {
  for (const g of GLOSSARY) assert.ok(g.en && g.te && g.hi);
  const te = glossaryBlock('Telugu');
  for (const t of ['వినిమయ ధర్మం', 'సహచర ధర్మం', 'విభాజక ధర్మం']) assert.ok(te.includes(t), t);
  assert.ok(te.includes('స్థానిక లక్షణం') && te.includes('Never write') && te.includes('ఎల్లప్పుడూ'));
  assert.ok(glossaryBlock('Hindi').includes('क्रम विनिमय गुण'));
  assert.equal(glossaryBlock('English'), '');
  assert.equal(glossaryBlock('Tamil'), '');
});
test('the user message lists the homework numbers for quick_check to avoid', () => {
  assert.match(notesUserText(HW), /use none of them in quick_check\): 6, 9, 3, 8, 12, 4/);
  assert.equal(notesUserText('Photosynthesis in plants'), 'Homework: Photosynthesis in plants');
});
test('prompt: skill-specific, new numbers, full sentences, glossary only for te/hi', () => {
  const te = systemText(notesPrompt({ lang: 'Telugu', childContext: 'Asha' }));
  assert.match(te, /specific skill/);
  assert.match(te, /NEW numbers/);
  assert.match(te, /full sentence/);
  assert.ok(te.includes('వినిమయ ధర్మం'));
  assert.ok(!systemText(notesPrompt({ lang: 'English', childContext: 'Asha' })).includes('MATHS TERMS'));
});
