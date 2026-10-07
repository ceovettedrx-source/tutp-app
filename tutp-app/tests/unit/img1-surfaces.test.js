// img1: the language rule in the prompts, and the picture fields each surface's reply carries
// (docs/specs/img1.md sections B, C, D).
//   node --test tests/unit/img1-surfaces.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { bilingualTerms, teluguQuality, languageBlock } from '../../server/prompts/language-rule.js';
import { SCIENCE_GLOSSARY, scienceBlock } from '../../server/prompts/notes-glossary.js';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';
import { explainPrompt, EXPLAIN_PROMPT_VERSION } from '../../server/prompts/explain-prompts.js';
import { notesPrompt } from '../../server/prompts/notes-prompts.js';
import { validateAnswer } from '../../server/answer-schema.js';
import { normalizeNotes } from '../../server/notes-schema.js';
import { withNotesPicture } from '../../server/routes/chips.js';
import { verifyPicture } from '../../server/services/concept-picture.js';

const ctx = { childContext: 'Asha · Class 9' };
const story = (lang) => buildHomeworkRequest({ feature: 'storytelling', lang, ...ctx, text: 'Distance and displacement', attachments: [] }).system;
const answer = (lang) => buildHomeworkRequest({ feature: 'answer_v2', lang, ...ctx, text: '', attachments: [], extra: { board: 'state' } }).system;

test('English needs no bilingual sentence; every other language gets one with its own example', () => {
  assert.equal(bilingualTerms('English'), '');
  assert.match(bilingualTerms('Telugu'), /స్థానభ్రంశం \(Displacement\)/);
  assert.match(bilingualTerms('Hindi'), /विस्थापन \(Displacement\)/);
  assert.match(bilingualTerms('Marathi'), /the Marathi word \(Displacement\)/);
  assert.match(bilingualTerms('Telugu'), /no brackets/);
});

test('the Telugu quality rules and the science terms are only for Telugu (terms also for Hindi)', () => {
  assert.equal(teluguQuality('Hindi'), '');
  assert.equal(teluguQuality('English'), '');
  assert.match(teluguQuality('Telugu'), /school teacher/);
  assert.match(teluguQuality('Telugu'), /digits 0-9/);
  assert.equal(scienceBlock('English'), '');
  assert.equal(scienceBlock('Tamil'), '');
  assert.match(scienceBlock('Telugu'), /displacement = స్థానభ్రంశం/);
  assert.match(scienceBlock('Hindi'), /displacement = विस्थापन/);
  assert.ok(SCIENCE_GLOSSARY.every((g) => g.en && g.te && g.hi));
  assert.equal(languageBlock('English'), '');
  assert.match(languageBlock('Telugu'), /KEY TERMS/);
  assert.match(languageBlock('Telugu'), /TELUGU QUALITY/);
  assert.doesNotMatch(languageBlock('Telugu', { terms: false }), /KEY TERMS/);
});

test('one rule for every surface: answer, explain, notes and story all carry the bilingual key-term rule in Telugu', () => {
  const prompts = {
    answer: answer('Telugu'), story: story('Telugu'),
    explain: explainPrompt({ lang: 'Telugu', childContext: ctx.childContext }),
    notes: notesPrompt({ lang: 'Telugu', childContext: ctx.childContext }),
  };
  for (const [name, p] of Object.entries(prompts)) {
    assert.match(p, /write the Telugu word first and the term exactly as the page or question writes it in brackets/, name + ' lacks the bilingual rule');
    assert.match(p, /TELUGU QUALITY/, name + ' lacks the Telugu quality rules');
    assert.match(p, /SCIENCE TERMS in Telugu/, name + ' lacks the science terms');
    assert.equal((p.match(/KEY TERMS:/g) || []).length, 1, name + ' states the key-term rule more than once');
  }
  for (const [name, p] of Object.entries({ answer: answer('English'), story: story('English'), explain: explainPrompt({ lang: 'English', childContext: ctx.childContext }) })) {
    assert.doesNotMatch(p, /KEY TERMS|TELUGU QUALITY|SCIENCE TERMS/, name + ' English prompt gained rules it should not have');
  }
});

test('Answer: the child\'s notebook answer stays in the page language, the parent text is in the explain-in language', () => {
  const p = answer('Telugu');
  assert.match(p, /what the child WRITES in the exam notebook/);
  assert.match(p, /stays in the language of the page as written/);
  assert.match(p, /"why_text", "unit_direction_note" and, on a content page, every idea's "title" and "summary", is written in Telugu/);
});

test('Explain: labels and commentary in the explain-in language; the check question stays for the child', () => {
  const p = explainPrompt({ lang: 'Telugu', childContext: ctx.childContext });
  assert.match(p, /each one short Telugu word or two in Telugu's own script/);
  assert.match(p, /The check question itself is written for the child, in the language of the question/);
  assert.equal(EXPLAIN_PROMPT_VERSION, 'explain-v2.2');
});

test('Answer: a theory question carries a cleaned scene prompt, a numerical one never does; ideas too', () => {
  const q = (type, scene) => ({ q_text: 'Define displacement.', q_type: type, marks: 2, blocks: [{ type: 'text', text: 'Displacement is the shortest distance.' }], keywords: [], concept_key: 'c9-physics-displacement', scene_prompt: scene });
  const scene = 'A boy walks around a field. Write DISPLACEMENT under him.';
  const theory = validateAnswer({ status: 'ok', subject: 'Physics', questions: [q('short', scene)] }).answer.questions[0];
  assert.equal(theory.scene_prompt, 'A boy walks around a field.');
  const numerical = validateAnswer({ status: 'ok', subject: 'Physics', questions: [q('numerical', scene)] }).answer.questions[0];
  assert.equal(numerical.scene_prompt, '');
  const content = validateAnswer({ status: 'ok', mode: 'content', subject: 'Science', page_text: 'Plants make food.', concepts: [{ title: 'Photosynthesis', summary: 'Plants make food from light.', concept_key: 'c7-science-photosynthesis', scene_prompt: 'A girl waters a green plant in the sun.' }] }).answer.questions[0];
  assert.equal(content.scene_prompt, 'A girl waters a green plant in the sun.');
});

test('Notes: the model\'s picture fields are kept, then become one signed picture; plain notes get none', () => {
  const notes = normalizeNotes({ key_idea: 'Plants make food.', method: ['Look at the leaf.'], picture: { concept_key: 'c7-science-photosynthesis', scene_prompt: 'A girl waters a green plant in the sun.' } });
  assert.equal(notes.concept_key, 'c7-science-photosynthesis');
  const out = withNotesPicture(notes, { enabled: true });
  assert.equal('concept_key' in out, false);
  assert.equal('scene_prompt' in out, false);
  assert.ok(verifyPicture(out.picture.concept_key, out.picture.scene_prompt, out.picture.sig));
  // the key the Answer reply signed wins, so Answer, Explain and Notes share one picture
  assert.equal(withNotesPicture(notes, { givenKey: 'c7-science-leaves', enabled: true }).picture.concept_key, 'c7-science-leaves');
  // flag off: no picture, and the helper fields are gone
  const off = withNotesPicture(notes, { enabled: false });
  assert.equal('picture' in off, false);
  assert.equal('concept_key' in off, false);
  assert.deepEqual(withNotesPicture({ plain: ['a'] }, { enabled: true }), { plain: ['a'] });
  assert.equal(normalizeNotes({ key_idea: 'x', method: ['y'] }).concept_key, undefined);
});
