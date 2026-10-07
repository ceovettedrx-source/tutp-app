// Script sanity for model text (server/lang-check.js).
//   node --test tests/unit/lang-check.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { foreignScript, foreignScriptIn } from '../../server/lang-check.js';
import { checkNotes, correctionHint } from '../../server/notes-ground.js';
import { validateExplain } from '../../server/explain-schema.js';
import { validateAnswer } from '../../server/answer-schema.js';

test('a Georgian letter inside a Telugu word is caught (the glitch seen in a recorded Telugu note)', () => {
  assert.equal(foreignScript('ఆక్సిజన్‌ బైపროడక్ట్‌గా విడుదల'), 'რ');
  assert.equal(foreignScript('ఆక్సిజన్‌ విడుదల అవుతుంది'), '');
});

test('Latin, every Indian script, digits, symbols and punctuation pass', () => {
  for (const s of ['Displacement', 'స్థానభ్రంశం (Displacement)', 'विस्थापन', 'இடப்பெயர்ச்சி', 'ಕನ್ನಡ', 'മലയാളം', 'বাংলা', 'ગુજરાતી', 'ਪੰਜਾਬੀ', 'ଓଡ଼ିଆ', 'اردو', '3/4 × 2 = 1.5 m/s² ₹500 ✓', '', null]) {
    assert.equal(foreignScript(s), '', String(s));
  }
  assert.equal(foreignScript('привет'), 'п');
  assert.equal(foreignScript('日本語'), '日');
});

test('it looks inside objects and arrays', () => {
  assert.equal(foreignScriptIn({ a: ['ok', { b: 'bad რ' }] }), 'რ');
  assert.equal(foreignScriptIn({ a: ['ok', { b: 'fine' }], n: 4 }), '');
});

test('notes with a foreign letter fail the quality check and the retry hint says so', () => {
  const notes = { version: 2, title: 'కిరణజన్య సంయోగక్రియ', key_idea: 'ఆకులు ఆహారం తయారుచేస్తాయి', method: ['గమనించు'], remember: 'ఆక్సిజన్‌ బైపროడక్ట్‌' };
  const r = checkNotes(notes, 'Photosynthesis');
  assert.ok(r.reasons.includes('foreign_script'));
  assert.match(correctionHint(r.reasons, 'x'), /wrong script/);
  assert.equal(checkNotes({ ...notes, remember: 'ఆక్సిజన్‌' }, '').ok, true, 'a clean note passes even with no homework text');
});

const goodExplain = () => ({
  concept_key: 'c9-physics-displacement', title: 'స్థానభ్రంశం (Displacement)', quick: 'మొదటి స్థానం నుండి చివరి స్థానానికి ఉన్న తక్కువ దూరం.', full: 'ఒక బస్సు ఊరు నుండి చుట్టూ తిరిగి వచ్చినా, స్థానభ్రంశం చివరి స్థానం వరకే లెక్కిస్తారు.',
  traps: ['a', 'b', 'c'], misconception: { text: 'దూరమే స్థానభ్రంశం అనుకోవడం' }, parent_questions: [{ q: 'q1', expected_answer_hint: 'h' }, { q: 'q2', expected_answer_hint: 'h' }],
  check_question: { q: 'q', options: ['a', 'b', 'c'], correct_index: 0, right_feedback: 'r', wrong_feedback: 'w' },
  illustration: { scene_prompt: 'A boy walks a winding lane to a shop.', labels: [] },
});

test('Explain: a foreign letter anywhere is a hard issue (so the route asks the model again)', () => {
  assert.equal(validateExplain(goodExplain()).ok, true);
  const bad = goodExplain();
  bad.full = 'ఒక బస్సు ఊరు నుండి బైపროడక్ట్';
  const r = validateExplain(bad);
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /wrong script/);
});

test('Answer: a foreign letter in any question text or block is a hard issue', () => {
  const q = (text) => ({ q_text: 'కిరణజన్య సంయోగక్రియ అంటే ఏమిటి?', q_type: 'short', marks: 2, blocks: [{ type: 'text', text }], keywords: [], concept_key: 'c7-bio-photosynthesis' });
  assert.equal(validateAnswer({ status: 'ok', subject: 'Biology', questions: [q('మొక్కలు ఆహారం తయారుచేసుకునే ప్రక్రియ')] }).ok, true);
  const r = validateAnswer({ status: 'ok', subject: 'Biology', questions: [q('మొక్కలు బైపროడక్ట్')] });
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /wrong script/);
});
