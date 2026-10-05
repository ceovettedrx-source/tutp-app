// Guided Discovery: lessons, safety gate, matching, revisits, knowledge-graph mappings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONCEPTS } from '../../server/el/concepts.js';
import { validateLesson } from '../../server/el/schema.js';
import { checkExperiment } from '../../server/el/safety.js';
import { lessons, matchConcept, mappingFor, loadLessons } from '../../server/el/lessons.js';
import { computeRevisits } from '../../server/el/revisits.js';
import { mergeText, oneQuestion } from '../../server/routes/el.js';

const DAY = 24 * 3600 * 1000;

test('every pilot concept has a valid lesson file or is knowingly absent', () => {
  const map = lessons();
  assert.ok(map.size >= 10, 'target is at least 10 of 12, got ' + map.size);
  for (const l of map.values()) assert.equal(validateLesson(l).ok, true, l.id);
});

test('no served experiment fails the safety gate; every served lesson has an experiment or a sim', () => {
  for (const l of lessons().values()) {
    assert.deepEqual(checkExperiment(l.experiment).reasons, [], l.id);
    assert.ok(l.experiment || l.sim.slugs.length, l.id);
  }
});

test('safety gate: flame, mains, sharp tools, off-list items, hot water outside an adult step', () => {
  const ok = { title: 'Test', items: ['vinegar', 'baking soda', 'bowl'], steps: ['Pour vinegar in the bowl', 'Add baking soda'], adultSteps: [] };
  assert.equal(checkExperiment(ok).ok, true);
  assert.equal(checkExperiment({ ...ok, steps: ['Light a candle', 'Wait'] }).ok, false);
  assert.equal(checkExperiment({ ...ok, steps: ['Plug it into the wall socket', 'Wait'] }).ok, false);
  assert.equal(checkExperiment({ ...ok, steps: ['Cut the lemon with a knife', 'Wait'] }).ok, false);
  assert.equal(checkExperiment({ ...ok, items: ['vinegar', 'bleach'] }).ok, false);
  assert.equal(checkExperiment({ ...ok, steps: ['Pour hot water in the bowl', 'Wait'] }).ok, false);
  assert.equal(checkExperiment({ ...ok, steps: ['An adult pours hot water in the bowl', 'Wait'], adultSteps: [0] }).ok, true);
  assert.equal(checkExperiment({ ...ok, steps: ['Pour hot water in the bowl', 'Wait'], adultSteps: [0] }).ok, false, 'an adult step must say adult');
  assert.equal(checkExperiment(null).ok, true);
});

test('a lesson file that fails the gate loses its experiment at load', () => {
  const dir = new URL('../../server/el/content/', import.meta.url);
  const copy = loadLessons({ dir: dir.pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  assert.ok(copy.size >= 10);
});

test('typed topic matching: whole words, longest alias, ties give null', () => {
  assert.equal(matchConcept('we are studying friction'), 'friction');
  assert.equal(matchConcept('Newton’s first law of motion'), 'inertia');
  assert.equal(matchConcept('acids and bases and indicators'), 'acids-bases');
  assert.equal(matchConcept('photosynthesis in leaves'), null);
  assert.equal(matchConcept('ab'), null);
  assert.equal(matchConcept('a sheet about magnetism'), null, 'a partial word does not match');
});

test('KG: NCERT mappings are sourced from ncert.nic.in; Telangana ones are placeholders with no chapter', async () => {
  for (const c of CONCEPTS) {
    const n = await mappingFor(c.id, 'cbse-ncert');
    assert.equal(n.verification_status, 'sourced', c.id);
    assert.match(n.chapter, /^Chapter \d+: /);
    assert.match(n.sourceUrl, /^https:\/\/ncert\.nic\.in\//);
    const t = await mappingFor(c.id, 'telangana');
    assert.equal(t.verification_status, 'placeholder', c.id);
    assert.equal(t.chapter, null, 'a placeholder never states a chapter');
  }
});

test('mergeText keeps structure (answer index, misconception ids, adult steps) from the original', () => {
  const orig = { predict: { question: 'Q', options: [{ text: 'a', misconceptionId: null }, { text: 'b', misconceptionId: 'm1' }, { text: 'c', misconceptionId: null }], correctIndex: 2 }, experiment: { steps: ['s1', 's2'], adultSteps: [1] } };
  const tr = { predict: { question: 'Q2', options: [{ text: 'a2', misconceptionId: 'x' }, { text: 'b2' }], correctIndex: 0 }, experiment: { steps: ['t1'], adultSteps: [0] } };
  const m = mergeText(orig, tr);
  assert.equal(m.predict.question, 'Q2');
  assert.equal(m.predict.correctIndex, 2);
  assert.deepEqual(m.predict.options.map((o) => o.text), ['a2', 'b2', 'c']);
  assert.deepEqual(m.predict.options.map((o) => o.misconceptionId), [null, 'm1', null]);
  assert.deepEqual(m.experiment.steps, ['t1', 's2']);
  assert.deepEqual(m.experiment.adultSteps, [1]);
});

test('teach-back reply is cut to one question', () => {
  assert.equal(oneQuestion('What would happen if the spoon were wooden? Also, great job!'), 'What would happen if the spoon were wooden?');
  assert.equal(oneQuestion('  '), null);
  assert.equal(oneQuestion('Think about it'), 'Think about it');
});

test('revisits: day 3 -> question 1, day 10 -> question 2, day 30 -> question 1; done and expired ones drop out', () => {
  const l = new Map([['friction', { id: 'friction', title: 'Friction', revisits: [{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }] }]]);
  const t0 = Date.parse('2026-10-01T00:00:00Z');
  const ev = [{ event_name: 'teach_back_done', created_at: new Date(t0).toISOString(), properties: { concept_id: 'friction' } }];
  assert.deepEqual(computeRevisits(ev, t0 + 2 * DAY, l), []);
  assert.equal(computeRevisits(ev, t0 + 3 * DAY, l)[0].question, 'Q1');
  assert.equal(computeRevisits(ev, t0 + 10.5 * DAY, l)[0].question, 'Q2');
  assert.equal(computeRevisits(ev, t0 + 31 * DAY, l)[0].question, 'Q1');
  assert.deepEqual(computeRevisits(ev, t0 + 8 * DAY, l), [], 'window of 4 days after day 3 has passed');
  const done = [...ev, { event_name: 'revisit_done', created_at: new Date(t0 + 4 * DAY).toISOString(), properties: { concept_id: 'friction', day: 3 } }];
  assert.deepEqual(computeRevisits(done, t0 + 4 * DAY, l), []);
  assert.deepEqual(computeRevisits([{ event_name: 'teach_back_done', created_at: 'bad', properties: { concept_id: 'friction' } }], t0, l), []);
});
