// The Answer/Explain v2 golden set, replayed from the recorded model replies
// (tests/e2e/recordings): no model spend. Record again, after a change to a
// prompt or to server/models.js, with `node tests/golden/run.js --record`.
//   node --test tests/unit/golden.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES } from '../golden/cases.js';
import { runCase, checkCase, asciiDigits } from '../golden/golden.js';

for (const c of CASES) {
  test(`golden ${c.id}`, async () => {
    const run = await runCase(c, { mode: 'replay' });
    const { failures } = checkCase(c, run);
    assert.deepEqual(failures, []);
  });
}

test('the golden set covers what the brief asks for', () => {
  assert.equal(CASES.length, 13);
  assert.equal(CASES.filter((c) => c.content).length, 3);              // pages with no questions
  const classes = CASES.map((c) => Number(c.cls.match(/\d+/)[0]));
  assert.ok(Math.min(...classes) <= 3 && Math.max(...classes) >= 10);
  for (const s of ['maths', 'physics', 'biology', 'social', 'english']) assert.ok(CASES.some((c) => c.subject === s), s);
  for (const l of ['English', 'Telugu', 'Hindi']) assert.ok(CASES.some((c) => c.lang === l), l);
  assert.ok(CASES.some((c) => c.board === 'cbse') && CASES.some((c) => c.board === 'state'));
  assert.ok(CASES.filter((c) => c.expect.length).length >= 6);          // numerical cases
});

test('a checker that catches a wrong number, a missing unit and a transliterated label', async () => {
  const c = CASES.find((x) => x.id.startsWith('g7'));
  const run = await runCase(c, { mode: 'replay' });
  const bad = structuredClone(run);
  bad.ans.answer.questions[1].blocks.find((b) => b.type === 'steps').final_answer = '65 m';
  const f = checkCase(c, bad).failures.join(' | ');
  assert.match(f, /expected 60/);
  assert.match(f, /unit missing/);
  const bad2 = structuredClone(run);
  bad2.explain.illustration.labels = [{ text: 'ghar', position: 'left' }];
  assert.match(checkCase(c, bad2).failures.join(' | '), /transliterated/);
  assert.equal(asciiDigits('౨౦ మీ'), '20 మీ');
});
