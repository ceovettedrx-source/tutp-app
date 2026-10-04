// Explain Please v2 reply checks, tier gating and the no-text image prompt
// (docs/specs/answer-explain-v2.md sections B, D, E).
//   node --test tests/unit/explain-schema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExplain, normalizeConceptKey, cleanScenePrompt, finalScenePrompt, IMAGE_SUFFIX } from '../../server/explain-schema.js';
import { explainView, PAID_ONLY_FIELDS, UPSELL } from '../../server/tier-gate.js';
import { explainPrompt } from '../../server/prompts/explain-prompts.js';

const good = () => ({
  concept_key: 'C9 Physics: Distance vs Displacement!', title: 'Distance and displacement', quick: 'Distance is the path; displacement is the shortest line with a direction.',
  full: 'Walk from home to the kirana shop by the lane: 300 m. The straight line is 200 m.', traps: ['a', 'b', 'c'],
  misconception: 'They are the same thing.',
  parent_questions: [{ q: 'Which is longer?', expected_answer_hint: 'the path' }, { q: 'Which has a direction?', expected_answer_hint: 'displacement' }],
  check_question: { q: 'Walk 3 m east then 3 m west. Displacement?', options: ['6 m', '0 m', '3 m'], correct_index: 1, right_feedback: 'Yes, you are back at the start.', wrong_feedback: 'Compare the start and the end point.' },
  illustration: { scene_prompt: 'A boy walks along a winding lane to a village shop. The shop has a sign saying SHOP. Mango trees line the lane.', labels: [{ text: 'ఇల్లు', position: 'bottom-left' }, { text: 'x', position: 'nowhere' }] },
});

test('a complete reply passes; key slug, shuffle keeps the right option, labels cleaned', () => {
  const r = validateExplain(good());
  assert.equal(r.ok, true);
  const e = r.explain;
  assert.equal(e.concept_key, 'c9-physics-distance-vs-displacement');
  assert.equal(e.check_question.options[e.check_question.correct_index], '0 m');
  assert.equal(e.check_question.options.length, 3);
  assert.deepEqual(e.illustration.labels.map((l) => l.position), ['bottom-left', 'center']);
  assert.equal(e.misconception.source, 'model');
});

test('the shuffle is deterministic and does not always keep the right option first', () => {
  const positions = new Set();
  for (let i = 0; i < 12; i++) {
    const g = good(); g.concept_key = 'c9-physics-topic-' + i; g.check_question.q = 'question ' + i;
    const e = validateExplain(g).explain;
    positions.add(e.check_question.correct_index);
    assert.equal(validateExplain(g).explain.check_question.correct_index, e.check_question.correct_index);
  }
  assert.ok(positions.size > 1);
});

test('problems: counts of traps, questions and options, bad index, no scene', () => {
  const cases = [
    (g) => { g.traps = ['a', 'b']; }, (g) => { g.parent_questions = [g.parent_questions[0]]; },
    (g) => { g.check_question.options = ['a', 'b']; }, (g) => { g.check_question.correct_index = 3; },
    (g) => { g.illustration.scene_prompt = ''; }, (g) => { g.concept_key = '!!'; }, (g) => { g.quick = ''; },
  ];
  for (const mut of cases) { const g = good(); mut(g); const r = validateExplain(g); assert.equal(r.ok, false); assert.ok(r.issues.length); }
  assert.equal(validateExplain([]).ok, false);
});

test('scene prompt: clauses asking for text are cut and the no-text suffix is always there', () => {
  const e = validateExplain(good()).explain;
  assert.doesNotMatch(e.illustration.scene_prompt.replace(IMAGE_SUFFIX, ''), /\b(sign|text|label|number|letter|saying)\b/i);
  assert.match(e.illustration.scene_prompt, /winding lane/);
  assert.ok(e.illustration.scene_prompt.endsWith(IMAGE_SUFFIX));
  assert.match(IMAGE_SUFFIX, /no text.*no letters.*no numbers.*no labels/i);
  assert.equal(cleanScenePrompt('Write the word MANGO on a board.'), '');
  assert.match(finalScenePrompt('', 'c9-physics-speed'), /physics speed/);
  assert.ok(finalScenePrompt('Two boys play cricket.').includes(IMAGE_SUFFIX));
});

test('concept keys', () => {
  assert.equal(normalizeConceptKey('  Class 5 / Maths: Fractions  '), 'class-5-maths-fractions');
  assert.equal(normalizeConceptKey('x'), '');
  assert.equal(normalizeConceptKey('a'.repeat(100)).length <= 60, true);
});

test('free view: only concept_key, title and quick, never a paid field, with the upsell', () => {
  const e = validateExplain(good()).explain;
  const v = explainView(e, { paid: false });
  assert.deepEqual(Object.keys(v).sort(), ['concept_key', 'locked', 'quick', 'tier', 'title', 'upsell']);
  for (const f of PAID_ONLY_FIELDS) assert.equal(f in v, false, f);
  assert.equal(v.upsell.label, 'Pro ₹500/month');
  assert.equal(v.upsell, UPSELL);
  assert.equal(JSON.stringify(v).includes(e.full), false);
  assert.equal(JSON.stringify(v).includes(e.traps[0] + '"'), false);
});

test('pro view: everything, the scene prompt never goes to the browser, kg overrides', () => {
  const e = validateExplain(good()).explain;
  const v = explainView(e, { paid: true, illustration: { status: 'ready', url: 'https://x/y.png' } });
  for (const f of ['full', 'traps', 'misconception', 'parent_questions', 'check_question', 'illustration']) assert.ok(f in v, f);
  assert.equal(v.illustration.url, 'https://x/y.png');
  assert.equal('scene_prompt' in v.illustration, false);
  assert.equal(v.prev_link, undefined);
  const kg = explainView(e, { paid: true, kg: { misconception: { text: 'KG text', source: 'kg' }, prev: { title: 'before' }, next: { title: 'after' } } });
  assert.deepEqual(kg.misconception, { text: 'KG text', source: 'kg' });
  assert.equal(kg.prev_link.title, 'before');
  assert.equal(kg.next_link.title, 'after');
});

test('the explain prompt: parent commentary in the explain-in language only, forced key', () => {
  const p = explainPrompt({ lang: 'Telugu', childContext: 'Asha', conceptKey: 'c9-physics-speed' });
  assert.match(p, /Everything you say to the PARENT is written in Telugu/);
  assert.match(p, /never translated/);
  assert.match(p, /Use exactly this concept_key: "c9-physics-speed"/);
  assert.match(p, /NO words, letters, numbers, signs or labels/);
});
