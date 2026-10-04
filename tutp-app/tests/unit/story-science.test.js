// Round print-a4-and-science-tryit: the science try-together rule, scene 3 of
// 1 to 3 sentences, the concept log and the coverage ranking.
//   node --test tests/unit/story-science.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStory, splitSentences, trimToSentences, isMathsStory, percentQuestionIssue,
} from '../../server/story-schema.js';
import { normalizeConcept, topicFromTag, missingConceptFor, topMissingConcepts, STORY_IMAGE_MISSING } from '../../server/image-library.js';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';

const science = () => ({
  title: 'Meera and the two threads',
  gradeSubjectTag: 'Class 10 · Science · Chromosomes',
  concept: 'Chromosomes',
  readMinutes: 2,
  scenes: [
    { label: 'hook', text: 'Meera sat on the veranda with her grandmother.' },
    { label: 'problem', text: 'She could not see how one chromosome becomes two.' },
    { label: 'mathMoment', text: 'After copying, a chromosome is two sister chromatids joined at the centromere. They stay joined until the cell divides.' },
    { label: 'wrapUp', text: 'Meera tied two strings in the middle and understood.' },
  ],
  visual: null,
  equations: [],
  tryTogether: { question: 'A cell has 3 chromosomes and copies each one. How many chromatids does it have now?', answer: '6 chromatids' },
  parentPrompt: 'Ask your child to show the centromere with two strings.',
});

// ---- the percentage rule ----------------------------------------------------
test('percentQuestionIssue: a percentage with another number is flagged, in any language', () => {
  assert.match(percentQuestionIssue('If a chromosome weighs 50 units and 40% of it is DNA, how many units is DNA?'), /percentage/);
  assert.match(percentQuestionIssue('What is 40 percent of 200 grams?'), /percentage/);
  assert.match(percentQuestionIssue('50 గ్రాముల్లో 40 శాతం DNA అయితే DNA ఎంత?'), /percentage/);
  assert.match(percentQuestionIssue('200 में से 40 प्रतिशत कितना है?'), /percentage/);
  assert.match(percentQuestionIssue('40% of 50 = ?'), /percentage/);
});

test('percentQuestionIssue: a recall question with no other number, or no percentage, passes', () => {
  assert.equal(percentQuestionIssue('What percent of a chromosome is DNA?'), '');
  assert.equal(percentQuestionIssue('A cell has 3 chromosomes and copies each one. How many chromatids does it have now?'), '');
  assert.equal(percentQuestionIssue('Name the part that joins the two chromatids.'), '');
  assert.equal(percentQuestionIssue(''), '');
});

test('validateStory: a science story with a percent-of-N question is sent back (the one retry), a count question passes', () => {
  assert.equal(validateStory(science()).ok, true);
  const bad = science();
  bad.tryTogether = { question: 'A chromosome weighs 50 units and 40% of it is DNA. How many units of DNA is that?', answer: '20 units' };
  const r = validateStory(bad);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /percentage/);
  // the last try does not wave it through either
  assert.equal(validateStory(bad, { final: true }).ok, false);
});

test('validateStory: a maths story may use a percentage question', () => {
  const m = {
    ...science(), gradeSubjectTag: 'Class 7 · Maths · Percentages', concept: 'percentages',
    tryTogether: { question: 'What is 40% of 50?', answer: '20' },
  };
  assert.equal(validateStory(m).ok, true);
});

test('isMathsStory: by the subject tag, in any language, else by the picture or equations', () => {
  assert.equal(isMathsStory({ tag: 'Class 5 · Maths · Fractions' }), true);
  assert.equal(isMathsStory({ tag: 'తరగతి 5 · గణితం · భిన్నాలు' }), true);
  assert.equal(isMathsStory({ tag: 'कक्षा 5 · गणित · भिन्न' }), true);
  assert.equal(isMathsStory({ tag: 'Class 10 · Science · Chromosomes', visual: { type: 'groups' }, equations: ['1 + 1 = 2'] }), false);
  assert.equal(isMathsStory({ tag: 'Class 3 · Hindi · Poem' }), false);
  assert.equal(isMathsStory({ tag: '', visual: { type: 'groups' } }), true);
  assert.equal(isMathsStory({ tag: '', visual: { type: 'library' }, equations: [] }), false);
  assert.equal(isMathsStory({ tag: '', equations: ['4 × 6 = 24'] }), true);
  assert.equal(isMathsStory({}), false);
});

// ---- scene 3 ----------------------------------------------------------------
test('splitSentences: full stops, ? ! and the danda; not decimals, abbreviations or initials', () => {
  assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  assert.equal(splitSentences('The cell is 3.5 microns wide. It divides.').length, 2);
  assert.equal(splitSentences('Dr. Rao showed Fig. 2 to the class. Everyone looked.').length, 2);
  assert.equal(splitSentences('Meera met A. P. J. Abdul Kalam. He smiled.').length, 2);
  assert.equal(splitSentences('Wait... then it split. Done.').length, 2);
  assert.equal(splitSentences("'Why?' asked Meera. 'Because,' said Amma.").length, 2);
  assert.equal(splitSentences('కణం విభజన చెందుతుంది. తరువాత రెండు కణాలు అవుతాయి.').length, 2);
  assert.equal(splitSentences('कोशिका बँटती है। फिर दो बनती हैं।').length, 2);
  assert.deepEqual(splitSentences('  '), []);
  assert.deepEqual(splitSentences('No end punctuation'), ['No end punctuation']);
});

test('trimToSentences keeps whole sentences only', () => {
  assert.equal(trimToSentences('A one. B two. C three. D four. E five.', 3), 'A one. B two. C three.');
  assert.equal(trimToSentences('Only one.', 3), 'Only one.');
});

test('scene 3 of more than 3 sentences is an issue; 1, 2 and 3 sentences pass', () => {
  for (const text of ['One idea.', 'One idea. A second.', 'One idea. A second. A third.']) {
    const s = science(); s.scenes[2].text = text;
    assert.equal(validateStory(s).ok, true, text);
  }
  const long = science();
  long.scenes[2].text = 'First. Second. Third. Fourth. Fifth.';
  const r = validateStory(long);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /scene 3 has 5 sentences/);
});

test('the last try trims scene 3 at a sentence boundary and counts it as fixed', () => {
  const long = science();
  long.scenes[2].text = 'First idea here. Second idea here. Third idea here. Fourth idea, which is long and goes on. Fifth.';
  const r = validateStory(long, { final: true });
  assert.equal(r.ok, true);
  assert.equal(r.story.scenes[2].text, 'First idea here. Second idea here. Third idea here.');
  assert.ok(r.fixed >= 1);
  assert.equal(r.story.scenes[0].text, long.scenes[0].text); // the other scenes are not touched
});

test('only scene 3 is held to 3 sentences', () => {
  const s = science();
  s.scenes[1].text = 'One. Two. Three. Four.';
  assert.equal(validateStory(s).ok, true);
});

// ---- concept and coverage ----------------------------------------------------
test('normalizeConcept: lowercase letters only, plural folded, no names, no numbers', () => {
  assert.equal(normalizeConcept('Chromosomes'), 'chromosome');
  assert.equal(normalizeConcept('  Water   Cycle! '), 'water cycle');
  assert.equal(normalizeConcept('Class 7: Photosynthesis'), 'class photosynthesis'); // digits and punctuation dropped
  assert.equal(normalizeConcept('cell-cycle'), 'cell cycle');
  assert.equal(normalizeConcept('గణితం భిన్నాలు'), 'గణితం భిన్నాలు');
  assert.equal(normalizeConcept('Mitosis', { childName: 'Meera' }), 'mitosis');
  assert.equal(normalizeConcept('How Meera saw mitosis', { childName: 'Meera' }), '');
  assert.equal(normalizeConcept('asha@example.com'), '');
  assert.equal(normalizeConcept('call 9876543210'), '');
  assert.equal(normalizeConcept('a'), '');
  assert.equal(normalizeConcept(''), '');
  assert.equal(normalizeConcept(null), '');
  assert.ok(normalizeConcept('one two three four five six seven eight').split(' ').length <= 5);
  assert.ok(normalizeConcept('x'.repeat(80) + ' y').length <= 50);
  assert.equal(normalizeConcept('glass'), 'glass'); // not a plural
});

test('topicFromTag: the topic part of "Class · Subject · Topic"', () => {
  assert.equal(topicFromTag('Class 7 · Science · Water Cycle'), 'Water Cycle');
  assert.equal(topicFromTag('Class 7 · Science'), '');
  assert.equal(topicFromTag(''), '');
});

test('missingConceptFor: only a checked story of a lesson that is not maths and has no library picture', () => {
  const sci = validateStory(science());
  assert.equal(missingConceptFor(sci, sci.story), 'chromosome');
  // no model concept: the tag's topic
  const noConcept = validateStory({ ...science(), concept: undefined });
  assert.equal(missingConceptFor(noConcept, noConcept.story), 'chromosome');
  // a maths story, a library picture, a failed check, a name: nothing
  const maths = validateStory({ ...science(), gradeSubjectTag: 'Class 5 · Maths · Fractions' });
  assert.equal(missingConceptFor(maths, maths.story), '');
  assert.equal(missingConceptFor(sci, { ...sci.story, visual: { type: 'library', id: 'x' } }), '');
  assert.equal(missingConceptFor({ ok: false, issues: ['x'] }, sci.story), '');
  assert.equal(missingConceptFor(sci, sci.story, { childName: 'Chromosomes' }), '');
  assert.equal(missingConceptFor(null, null), '');
});

test('topMissingConcepts: the last 30 days, most stories first, 30 at most', () => {
  const now = Date.parse('2026-10-04T00:00:00Z');
  const row = (concept, family, days, offered = 0) => ({ family_id: family, properties: { concept, offered }, created_at: new Date(now - days * 86400000).toISOString() });
  const rows = [
    row('water cycle', 'a', 1), row('water cycle', 'b', 2), row('water cycle', 'a', 3, 2),
    row('mitosis', 'a', 1), row('mitosis', 'b', 5),
    row('old topic', 'a', 45),
    row('photosynthesis', 'c', 2),
    { family_id: 'a', properties: {}, created_at: new Date(now).toISOString() },
    null,
  ];
  const top = topMissingConcepts(rows, { now });
  assert.deepEqual(top.map((t) => t.concept), ['water cycle', 'mitosis', 'photosynthesis']);
  assert.deepEqual(top[0], { concept: 'water cycle', count: 3, families: 2, noCandidate: 2 });
  assert.equal(topMissingConcepts(Array.from({ length: 50 }, (_, i) => row('c' + i, 'a', 1)), { now }).length, 30);
  assert.deepEqual(topMissingConcepts([], { now }), []);
  assert.equal(STORY_IMAGE_MISSING, 'story.image_missing');
});

// ---- the prompt ---------------------------------------------------------------
test('the story prompt carries the science try-together rule, the 3-sentence big idea and the concept field', () => {
  const { system } = buildHomeworkRequest({ feature: 'storytelling', lang: 'English', childContext: 'Asha · Class 10', text: 'chromosomes', attachments: [], photos: [] });
  assert.match(system, /never arithmetic built from a percentage/);
  assert.match(system, /how many chromatids 3 replicated chromosomes have/);
  assert.match(system, /never longer than 3 sentences/);
  assert.match(system, /"concept":/);
  assert.match(system, /only the lesson's technical terms, names and numbers stay exactly as written in the lesson, in its original language/);
});
