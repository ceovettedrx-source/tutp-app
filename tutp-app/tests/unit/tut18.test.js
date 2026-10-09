// TUT-18 live bugs: one language per reply, notes picture, picture labels, truncated
// answer, idea title, wrong fact.
//   node --test tests/unit/tut18.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { romanizedHindi, romanizedHindiIn } from '../../server/lang-check.js';
import { wrongFacts } from '../../server/fact-guard.js';
import { validateExplain } from '../../server/explain-schema.js';
import { normalizeNotes, cleanText } from '../../server/notes-schema.js';
import { checkNotes, correctionHint } from '../../server/notes-ground.js';
import { withNotesPicture, sameConcept } from '../../server/routes/chips.js';
import { explainPrompt } from '../../server/prompts/explain-prompts.js';
import { notesPrompt } from '../../server/prompts/notes-prompts.js';
import { systemText } from '../../server/prompt-cache.js';

const explain = (over = {}) => ({
  concept_key: 'c7-geography-wind', title: 'Wind', quick: 'Air moves from high to low pressure.', full: 'Warm air rises, cool air flows in.',
  traps: ['a', 'b', 'c'], misconception: 'Wind is made by trees.',
  parent_questions: [{ q: 'Why does wind blow?', expected_answer_hint: 'Pressure differs.' }, { q: 'Where does it blow from?', expected_answer_hint: 'High to low.' }],
  check_question: { q: 'Air moves from where?', options: ['high pressure', 'low pressure', 'sea'], correct_index: 0, right_feedback: 'Yes.', wrong_feedback: 'No.' },
  illustration: { scene_prompt: 'A kite flying over a beach.', labels: [{ text: 'High pressure', position: 'left' }] },
  ...over,
});

test('romanized Hindi needs two different Hindi words; plain English never trips it', () => {
  assert.equal(romanizedHindi('Agar ek jagah garmi hai to hawa ka kya hoga?'), true);
  assert.equal(romanizedHindi('Jaipur mein aaj garmi hai'), true);
  assert.equal(romanizedHindi('Which air is warmer? It is a hot day in Jaipur.'), false);
  assert.equal(romanizedHindi('He said hai once'), false);
  assert.equal(romanizedHindiIn({ a: ['fine', { b: 'mein aur hai' }] }), true);
});

test('explain: a romanized-Hindi check question is a hard issue with the one-language hint', () => {
  const bad = explain({ check_question: { q: 'Agar ek jagah garmi hai to hawa kya karegi?', options: ['upar', 'neeche', 'mein'], correct_index: 0, right_feedback: 'Yes.', wrong_feedback: 'No.' } });
  const r = validateExplain(bad);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /English letters/);
  assert.equal(validateExplain(explain()).ok, true);
});

test('explain: labels that are analogy words or verb phrases are dropped, science terms stay', () => {
  const r = validateExplain(explain({ illustration: { scene_prompt: 'A kite flying over a beach.', labels: [
    { text: 'High pressure', position: 'left' }, { text: "Today's roti", position: 'top' }, { text: 'steam rises', position: 'right' }, { text: 'Windward side', position: 'bottom' }] } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.explain.illustration.labels.map((l) => l.text), ['High pressure', 'Windward side']);
});

test('the wrong "cold air sinks at the subtropical high" statement is caught, the right one is not', () => {
  assert.deepEqual(wrongFacts({ n: 'At 30° north, cold air sinks and makes the subtropical high.' }), ['cold-air-sinks-subtropical']);
  assert.deepEqual(wrongFacts(['The subtropical high forms where cold air descends.']), ['cold-air-sinks-subtropical']);
  assert.deepEqual(wrongFacts('At the subtropical high, sinking air that rose at the equator comes down.'), []);
  assert.deepEqual(wrongFacts('Cold air sinks in a fridge.'), []);
  const r = validateExplain(explain({ full: 'Near 30 degrees the cold air sinks, which makes the subtropical high.' }));
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /sinking, descending air/);
});

test('notes: the same checks run on notes and give the retry hint', () => {
  const notes = normalizeNotes({ title: 'Pressure belts', key_idea: 'Winds blow from high to low pressure.', method: ['Find the belts.'],
    remember: 'Cold air sinks at the subtropical high around 30 degrees.' });
  const c = checkNotes(notes, '');
  assert.equal(c.ok, false);
  assert.ok(c.reasons.includes('fact:cold-air-sinks-subtropical'));
  assert.match(correctionHint(c.reasons, ''), /descending air/);
  const hi = normalizeNotes({ title: 'Hawa', key_idea: 'Agar ek jagah garmi hai to hawa upar jaati hai.', method: ['Mein samjhata hoon.'] });
  assert.ok(checkNotes(hi, '').reasons.includes('romanized_hindi'));
});

test('notes: a long worked-example answer is kept whole and a cut never ends on "and"', () => {
  const answer = 'Wind blows from the area of high pressure to the area of low pressure, and the greater the difference in pressure, the stronger the wind.';
  const n = normalizeNotes({ key_idea: 'Wind.', method: ['Look.'], worked_example: { problem: 'Why does wind blow?', steps: ['Compare.'], answer } });
  assert.equal(n.worked_example.answer, answer);
  const cut = cleanText('The air moves because of the difference in pressure, temperature, and the spin of the Earth and many other things that go on and on', 70);
  assert.doesNotMatch(cut, /\b(and|the|of)…$/);
  assert.match(cleanText('First sentence is here and long enough. Second sentence is much longer than the limit allows for sure.', 60), /enough\.$/);
});

test('notes picture: shared with the first question only for the same concept', () => {
  assert.equal(sameConcept('c7-geography-atmosphere-layers', 'c7-geography-atmosphere-layers'), true);
  assert.equal(sameConcept('c7-geography-atmosphere-layers', 'c7-geography-air-pressure-and-wind'), false);
  assert.equal(sameConcept('c7-geography-wind-and-pressure', 'c7-geography-wind-pressure-belts'), true);
  const notes = { version: 2, title: 'Pressure and wind', concept_key: 'c7-geography-air-pressure-and-wind', scene_prompt: 'A kite on a windy beach.' };
  const other = withNotesPicture(notes, { givenKey: 'c7-geography-atmosphere-layers', enabled: true });
  assert.equal(other.picture.concept_key, 'c7-geography-air-pressure-and-wind');
  const same = withNotesPicture({ ...notes, concept_key: 'c7-geography-wind-pressure' }, { givenKey: 'c7-geography-air-pressure-and-wind', enabled: true });
  assert.equal(same.picture.concept_key, 'c7-geography-air-pressure-and-wind');
});

test('prompts carry the new rules', () => {
  const e = systemText(explainPrompt({ lang: 'Hindi', childContext: 'Asha', subject: 'geography' }));
  assert.match(e, /ONE LANGUAGE PER REPLY/);
  assert.match(e, /LABEL RULES/);
  assert.match(e, /"labels":\[\] is correct/);
  const n = systemText(notesPrompt({ lang: 'English', childContext: 'Asha' }));
  assert.match(n, /never say cold air sinks there/);
  assert.match(n, /at most 20 words/);
  assert.match(n, /never the chapter/);
});

test('notes card: the Answer label cannot wrap and an idea card prints no second title', () => {
  const css = readFileSync('public/app/shared/notes-card.js', 'utf8');
  assert.match(css, /\.nd-ans small\{[^}]*white-space:nowrap/);
  const ep = readFileSync('public/app/shared/explain-panel.js', 'utf8');
  assert.match(ep, /if \(!ctx\.ideaTitle\) panel\.appendChild\(el\('h3'/);
  assert.match(ep, /ideaTitle: content/);
});
