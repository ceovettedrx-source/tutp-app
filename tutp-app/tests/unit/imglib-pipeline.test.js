// Image pipeline helpers (scripts/imglib/lib.mjs): review verdicts, the spend
// cap, JSON extraction, anchors. No model is called.
//   node --test tests/unit/imglib-pipeline.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChecks, combineVerdicts, Spend, SpendCapError, extractJson, cleanAnchors, checklistOf, generationPrompt, loadRecipes, readJson, GLOSSARY } from '../../scripts/imglib/lib.mjs';

const allPass = (n) => ({ checks: Array.from({ length: n }, (_, i) => ({ item: i + 1, pass: true, note: '' })), issues: [] });

test('evaluateChecks: every item must be present and true', () => {
  assert.deepEqual(evaluateChecks(allPass(3), 3), { pass: true, issues: [] });
  const j = allPass(3); j.checks[1] = { item: 2, pass: false, note: 'text in the corner' };
  const r = evaluateChecks(j, 3);
  assert.equal(r.pass, false);
  assert.match(r.issues[0], /check 2: text in the corner/);
  // a missing item, a string "true", no checks, rubbish: all fail, never pass
  assert.equal(evaluateChecks({ checks: allPass(2).checks }, 3).pass, false);
  assert.equal(evaluateChecks({ checks: [{ item: 1, pass: 'true' }] }, 1).pass, false);
  assert.equal(evaluateChecks(null, 3).pass, false);
  assert.equal(evaluateChecks({}, 1).pass, false);
});

test('combineVerdicts: Claude alone without a Gemini key, both with one', () => {
  const ok = { pass: true, issues: [] }, bad = { pass: false, issues: ['x'] };
  assert.deepEqual(combineVerdicts(ok, null), { pass: true, secondPass: false, issues: [], claude: true, gemini: null });
  assert.equal(combineVerdicts(bad, null).pass, false);
  assert.equal(combineVerdicts(ok, ok).pass, true);
  assert.equal(combineVerdicts(ok, bad).pass, false);       // the second model can veto
  assert.equal(combineVerdicts(bad, ok).pass, false);
  assert.deepEqual(combineVerdicts(bad, { pass: false, issues: ['y'] }).issues, ['x', 'y']);
  assert.equal(combineVerdicts(null, null).pass, false);
});

test('Spend: a call that would pass the cap is refused, spent adds up', () => {
  const s = new Spend(1);
  s.need(0.5, 'a');
  s.total = 0.7;
  assert.throws(() => s.need(0.4, 'b'), SpendCapError);
  assert.doesNotThrow(() => s.need(0.3, 'c'));
  assert.equal(s.canAfford(0.31), false);
});

test('extractJson: finds the object inside text, null for rubbish', () => {
  assert.deepEqual(extractJson('Here: {"a":1} done'), { a: 1 });
  assert.equal(extractJson('no json'), null);
  assert.equal(extractJson('{broken'), null);
  assert.equal(extractJson(undefined), null);
});

test('cleanAnchors: only the asked keys, numbers clamped to 0..1', () => {
  const j = { anchors: [{ key: 'a', x: 0.5, y: 1.4 }, { key: 'b', x: 'x', y: 0.2 }, { key: 'zzz', x: 0.1, y: 0.1 }, { key: 'c', x: -2, y: 0.12345 }] };
  assert.deepEqual(cleanAnchors(j, ['a', 'b', 'c']), [{ key: 'a', x: 0.5, y: 1 }, { key: 'c', x: 0, y: 0.123 }]);
  assert.deepEqual(cleanAnchors(null, ['a']), []);
});

test('recipes: every recipe is complete, its label keys are in the glossary, ids are unique', () => {
  const recipes = loadRecipes();
  const gloss = readJson(GLOSSARY);
  assert.ok(recipes.length >= 15);
  assert.equal(new Set(recipes.map((r) => r.id)).size, recipes.length);
  for (const r of recipes) {
    for (const f of ['id', 'subject', 'description', 'alt', 'prompt']) assert.ok(r[f], `${r.id} ${f}`);
    assert.ok(r.classMin >= 1 && r.classMax <= 12 && r.classMin <= r.classMax, `${r.id} class range`);
    assert.ok(r.aliases.en.length >= 2, `${r.id} aliases`);
    assert.ok(r.labelKeys.length >= 2, `${r.id} label keys`);
    for (const k of r.labelKeys) assert.ok(gloss[k] && gloss[k].en, `${r.id}: ${k} missing from the glossary`);
    assert.ok(checklistOf(r).length > 5, `${r.id} checklist`);
    assert.match(generationPrompt(r), /No text|no text/);
  }
});
