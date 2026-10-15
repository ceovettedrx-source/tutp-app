// A cached card is served only in the script of the language asked for, and a picture belongs to
// one question (2026-10-15: Hindi labels under "English"; a family flying kites on the Moon question).
//   node --test tests/unit/script-language.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptMismatch, cardMatchesLanguage, visibleText } from '../../server/lang-check.js';
import { validateExplain } from '../../server/explain-schema.js';
import { questionPictureKey } from '../../server/picture-rule.js';
import { explainView } from '../../server/tier-gate.js';

const card = (o = {}) => ({
  concept_key: 'c9-socialstudies-water-vapour', title: 'Water Vapour and Weather', quick: 'Water vapour is water as a gas in the air.',
  full: 'Steam from boiling tea is water vapour; it cools and forms clouds.', tip: 'Warm air holds more vapour.',
  traps: ['a', 'b', 'c'], misconception: { text: 'Vapour is smoke.', source: 'model' },
  parent_questions: [{ q: 'Where does the steam go?', expected_answer_hint: 'into the air' }, { q: 'What forms clouds?', expected_answer_hint: 'vapour cooling' }],
  check_question: { q: 'What is water vapour?', options: ['a gas', 'a solid', 'smoke'], correct_index: 0, right_feedback: 'Yes.', wrong_feedback: 'Think of steam.' },
  illustration: { scene_prompt: 'A kettle with steam in a kitchen.', labels: [{ text: 'Vapour', position: 'top' }] },
  ...o,
});
const hindiLabels = () => card({ illustration: { scene_prompt: 'A kettle with steam in a kitchen.', labels: [{ text: 'जलवाष्प', position: 'top' }, { text: 'संघनन', position: 'left' }] } });
const hindiCheck = () => card({ check_question: { q: 'जलवाष्प क्या है?', options: ['गैस', 'ठोस', 'धुआं'], correct_index: 0, right_feedback: 'सही।', wrong_feedback: 'भाप सोचिए।' } });
const telugu = () => card({ title: 'నీటి ఆవిరి', quick: 'నీటి ఆవిరి గాలిలోని నీరు.', full: 'టీ మరిగేటప్పుడు వచ్చే ఆవిరి నీటి ఆవిరి.', tip: 'వేడి గాలి ఎక్కువ ఆవిరిని పట్టుకుంటుంది.',
  traps: ['ఒకటి', 'రెండు', 'మూడు'], misconception: { text: 'ఆవిరి పొగ కాదు.', source: 'model' }, parent_questions: [{ q: 'ఆవిరి ఎక్కడికి వెళ్తుంది?', expected_answer_hint: 'గాలిలోకి' }, { q: 'మేఘాలు ఎలా?', expected_answer_hint: 'చల్లబడి' }],
  check_question: { q: 'నీటి ఆవిరి అంటే ఏమిటి?', options: ['వాయువు', 'ఘనం', 'పొగ'], correct_index: 0, right_feedback: 'అవును.', wrong_feedback: 'ఆవిరి ఆలోచించండి.' },
  illustration: { scene_prompt: 'A kettle with steam.', labels: [{ text: 'ఆవిరి', position: 'top' }] } });

test('a Hindi-labelled cached card is not served for an English or a Telugu request', () => {
  assert.equal(cardMatchesLanguage('English', hindiLabels()), false);
  assert.equal(cardMatchesLanguage('Telugu', hindiLabels()), false);
  assert.equal(cardMatchesLanguage('Hindi', hindiLabels()), false, 'a mostly English card with Hindi labels is not a Hindi card either');
});

test('a Hindi check question in an English card is caught (labels are not the only field)', () => {
  assert.equal(cardMatchesLanguage('English', hindiCheck()), false);
});

test('the right card is served for its own language', () => {
  assert.equal(cardMatchesLanguage('English', card()), true);
  assert.equal(cardMatchesLanguage('Telugu', telugu()), true);
  assert.equal(cardMatchesLanguage('Spanish', card()), true, 'Latin script languages share a script');
});

test('an English card is not served for a Telugu request; Latin key terms inside Telugu text are fine', () => {
  assert.equal(cardMatchesLanguage('Telugu', card()), false);
  const t = telugu(); t.quick = 'నీటి ఆవిరి (water vapour) గాలిలోని నీరు.';
  assert.equal(cardMatchesLanguage('Telugu', t), true);
});

test('maths notation (pi, theta) and digits do not make an English card foreign', () => {
  assert.equal(scriptMismatch('English', ['Area = πr², angle θ = 30°', '12 × 3 = 36']), '');
});

test('the English slug, the picture prompt and the option index are not visible text', () => {
  const text = visibleText(hindiLabels()).join(' ');
  assert.ok(!text.includes('c9-socialstudies'));
  assert.ok(!text.includes('kettle'));
});

test('validateExplain asks again when an English reply carries Hindi labels or a Hindi check', () => {
  const r = validateExplain(hindiLabels(), { lang: 'English' });
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /not in English/);
  assert.equal(validateExplain(hindiCheck(), { lang: 'English' }).ok, false);
  assert.equal(validateExplain(card(), { lang: 'English' }).ok, true);
  assert.equal(validateExplain(telugu(), { lang: 'Telugu' }).ok, true);
});

test('a picture key is per question: same concept with different questions gets different pictures', () => {
  const concept = 'c9-socialstudies-importance-of-atmosphere';
  const a = questionPictureKey(concept, 'Why is the atmosphere important?');
  const b = questionPictureKey(concept, 'Why is life not possible on the Moon?');
  assert.notEqual(a, b);
  assert.equal(a, questionPictureKey(concept, '  1) why is the ATMOSPHERE important?  '), 'the same question keeps its picture');
  assert.ok(a.length <= 60 && /^[a-z0-9-]+$/.test(a));
  assert.ok(questionPictureKey('c9-' + 'x'.repeat(80), 'q one').length <= 60);
});

test('no question or no concept means no picture key', () => {
  assert.equal(questionPictureKey('c9-physics-speed', ''), '');
  assert.equal(questionPictureKey('', 'a question'), '');
});

test('the explain view hands the page the picture key to poll (free and paid)', () => {
  const e = { ...card(), illustration: { labels: [], scene_prompt: 's' } };
  assert.equal(explainView(e, { paid: true, extra: { illustrationKey: 'c9-x-qabcd1234' } }).illustration.key, 'c9-x-qabcd1234');
  assert.equal(explainView(e, { paid: false, extra: { illustrationKey: 'c9-x-qabcd1234' } }).illustration.key, 'c9-x-qabcd1234');
  assert.equal('key' in explainView(e, { paid: true }).illustration, false);
});
