// Answer Please v2 reply checks (docs/specs/answer-explain-v2.md section A).
//   node --test tests/unit/answer-schema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswer, mergeAnswers, extractAnswerJson, answerCorrectionHint } from '../../server/answer-schema.js';
import { marksFromText, resolveMarks, boardKind, defaultMarks } from '../../server/answer-marks.js';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';

const numerical = () => ({
  q_text: 'A car covers 120 km in 4 hours. Find its speed. (3 marks)', q_type: 'numerical', marks: null, concept_key: 'C9-Physics Speed',
  blocks: [{ type: 'steps', given: ['d = 120 km', 't = 4 h'], find: 'speed', formula: [{ text: 'v = d / t', why_text: 'speed is distance per unit time' }], substitution: ['v = 120 / 4'], final_answer: '30 km/h' }],
  keywords: ['speed', 'not in the answer'], diagram: null, unit_direction_note: 'speed has no direction',
});
const diff = () => ({
  q_text: 'Differentiate between distance and displacement.', q_type: 'difference', marks: 4,
  blocks: [{ type: 'compare_table', headers: ['Distance', 'Displacement'], rows: [['scalar', 'vector'], ['path length', 'shortest line']] }],
  keywords: ['scalar', 'vector'], diagram: { template: 'path_vs_straight', params: { path_length: 10, straight_length: 6, unit: 'm' } },
});

test('a numerical question passes: marks from the text, bad keyword dropped, key normalised', () => {
  const r = validateAnswer({ status: 'ok', subject: 'Physics', questions: [numerical()] }, { board: 'state' });
  assert.equal(r.ok, true);
  const q = r.answer.questions[0];
  assert.equal(q.marks, 3);
  assert.deepEqual(q.keywords, ['speed']);
  assert.equal(q.concept_key, 'c9-physics-speed');
  assert.equal(r.answer.schema, 2);
});

test('the old page fields are filled: extracted_questions with answer and reasoning', () => {
  const r = validateAnswer({ status: 'ok', questions: [numerical(), diff()] });
  const [a, b] = r.answer.extracted_questions;
  assert.equal(a.answer, '30 km/h');
  assert.equal(a.reasoning, 'speed is distance per unit time');
  assert.match(b.answer, /1\. scalar \| vector/);
});

test('a wrong plain-arithmetic answer is recomputed in code', () => {
  const q = { q_text: '45 - 18 = ?', q_type: 'numerical', blocks: [{ type: 'steps', given: [], find: 'x', formula: [], substitution: [], final_answer: '33' }], keywords: [] };
  const r = validateAnswer({ status: 'ok', questions: [q] });
  assert.equal(r.answer.questions[0].blocks[0].final_answer, '27');
  assert.equal(r.fixed, 1);
});

test('a diagram goes through the template builder; a bad one is dropped', () => {
  const r = validateAnswer({ status: 'ok', questions: [diff()] });
  assert.match(r.answer.questions[0].diagram.svg, /^<svg /);
  const bad = diff(); bad.diagram = { template: 'model_drawn_svg', params: { svg: '<svg onload=alert(1)>' } };
  assert.equal(validateAnswer({ status: 'ok', questions: [bad] }).answer.questions[0].diagram, null);
});

test('hard problems fail with reasons (the one retry uses them)', () => {
  const noFinal = numerical(); delete noFinal.blocks[0].final_answer;
  const oneCol = diff(); oneCol.blocks[0].rows = [['only one cell']];
  const unknown = numerical(); unknown.blocks = [{ type: 'poem', text: 'x' }];
  for (const q of [noFinal, oneCol, unknown, { q_text: '', blocks: [] }]) {
    const r = validateAnswer({ status: 'ok', questions: [q] });
    assert.equal(r.ok, false);
    assert.ok(r.issues.length >= 1);
  }
  assert.equal(validateAnswer({ status: 'ok', questions: [] }).ok, false);
  assert.equal(validateAnswer(null).ok, false);
  assert.equal(validateAnswer({ status: 'maybe' }).ok, false);
  assert.match(answerCorrectionHint(['a', 'b']), /failed these checks: a; b/);
});

test('unreadable and non-homework pass with no questions; an empty batch is allowed only when asked', () => {
  assert.equal(validateAnswer({ status: 'unreadable', questions: [] }).answer.status, 'unreadable');
  assert.equal(validateAnswer({ status: 'not_homework' }).answer.questions.length, 0);
  assert.equal(validateAnswer({ status: 'ok', questions: [] }, { allowEmpty: true }).ok, true);
});

test('at most 8 questions, the rest counted', () => {
  const qs = Array.from({ length: 11 }, () => diff());
  const r = validateAnswer({ status: 'ok', questions: qs });
  assert.equal(r.answer.questions.length, 8);
  assert.equal(r.answer.more_questions, 3);
});

test('a last batch can report the questions after the 8th, and the merge adds them up', () => {
  const a = validateAnswer({ status: 'ok', subject: 'Maths', questions: [diff(), diff(), diff(), diff()] }).answer;
  const b = validateAnswer({ status: 'ok', questions: [diff(), diff(), diff(), diff()], more_questions: 5 }, { allowEmpty: true }).answer;
  assert.equal(b.more_questions, 5);
  assert.equal(mergeAnswers([a, b]).more_questions, 5);
  assert.equal(validateAnswer({ status: 'ok', questions: [], more_questions: 2 }, { allowEmpty: true }).answer.more_questions, 2);
  assert.equal(validateAnswer({ status: 'ok', questions: [diff()], more_questions: -4 }).answer.more_questions, undefined);
});

test('a Telugu question keeps its script for fonts', () => {
  const q = { q_text: 'దూరం మరియు స్థానభ్రంశం మధ్య తేడా ఏమిటి?', q_type: 'short', blocks: [{ type: 'text', text: 'దూరం అంటే మార్గం పొడవు' }], keywords: ['మార్గం పొడవు'] };
  const r = validateAnswer({ status: 'ok', questions: [q] });
  assert.equal(r.answer.questions[0].script, 'telugu');
  assert.deepEqual(r.answer.questions[0].keywords, ['మార్గం పొడవు']);
});

test('merging two batches keeps page order and the 8 cap', () => {
  const a = validateAnswer({ status: 'ok', subject: 'Maths', questions: [numerical(), diff(), diff(), diff()] }).answer;
  const b = validateAnswer({ status: 'ok', subject: '', questions: [diff(), diff()] }).answer;
  const m = mergeAnswers([a, b]);
  assert.equal(m.questions.length, 6);
  assert.equal(m.extracted_questions.length, 6);
  assert.equal(m.questions[0].q_text.startsWith('A car'), true);
  assert.equal(m.subject, 'Maths');
});

test('marks: printed beats model beats default; boards', () => {
  assert.equal(marksFromText('Explain (5 marks)'), 5);
  assert.equal(marksFromText('వివరించండి 4 మార్కులు'), 4);
  assert.equal(marksFromText('no marks here'), null);
  assert.equal(resolveMarks({ questionText: 'Q (2 marks)', modelMarks: 5, qType: 'long', board: 'cbse' }), 2);
  assert.equal(resolveMarks({ questionText: 'Q', modelMarks: 3, qType: 'long', board: 'cbse' }), 3);
  assert.equal(resolveMarks({ questionText: 'Q', modelMarks: null, qType: 'long', board: 'cbse' }), 5);
  assert.equal(defaultMarks('long', 'state'), 4);
  assert.equal(boardKind('State Board', ''), 'state');
  assert.equal(boardKind('', 'Telangana'), 'state');
  assert.equal(boardKind('CBSE', 'Telangana'), 'cbse');
  assert.equal(boardKind('Cambridge', ''), 'other');
});

test('extractAnswerJson reads the first text block', () => {
  assert.deepEqual(extractAnswerJson({ content: [{ type: 'text', text: 'x {"a":1} y' }] }), { a: 1 });
  assert.equal(extractAnswerJson({ content: [] }), null);
});

test('the answer prompt: language rules, board, batch range, box rule only with photos', () => {
  const base = { feature: 'answer_v2', lang: 'Hindi', childContext: 'Asha · Class 9', text: '', attachments: [] };
  const p = buildHomeworkRequest({ ...base, extra: { board: 'cbse' } }).system;
  assert.match(p, /ONLY the commentary to the parent, "why_text" and "unit_direction_note", is written in Hindi/);
  assert.match(p, /CBSE exam/);
  assert.match(p, /never guess at text you cannot read/);
  assert.doesNotMatch(p, /Show on photo/);
  const batch = buildHomeworkRequest({ ...base, photos: [{ index: 0, width: 800, height: 600 }], extra: { board: 'state', range: { from: 5, to: 8 } } }).system;
  assert.match(batch, /questions 5 to 8/);
  assert.match(batch, /Show on photo/);
});
