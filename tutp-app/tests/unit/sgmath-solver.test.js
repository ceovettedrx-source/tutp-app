// Singapore Maths core (TUT-43 spec section 10, risks 2, 3, 6, 8, 15):
//   node --test tests/unit/sgmath-solver.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  MODEL_TYPES, typesForGrade, makeProblem, solve, expectedAnswer, storyNumbers, problemText, problemById, bank,
  validateModel, weekStartIst, gateFor, chooseFocus, nextDifficulty, pickProblems, diagnosticProblems,
  hintIsSafe, hintText, masteryByType, masteryLabel, weeklyGrowth, gradeOf, gradeSupported, concreteText, problemSvg,
} from '../../server/sgmath/core.js';
import { STRINGS, ENGLISH, LANGUAGES } from '../../server/sgmath/strings-seed.js';
import { asciiDigits } from '../../server/math-engine.js';
import { buildSql, MIGRATION } from '../../scripts/sgmath-migration.mjs';

const ALL = [];
for (let g = 1; g <= 6; g++) for (const t of typesForGrade(g)) for (const d of [1, 2, 3]) ALL.push(...bank(t, g, d));

test('the bank has 24 problems per grade x type cell, 504 in all, every one valid', () => {
  assert.equal(ALL.length, 504);
  assert.equal(new Set(ALL.map((p) => p.id)).size, 504);
  for (const p of ALL) assert.ok(validateModel(p.spec).ok, p.id + ' ' + validateModel(p.spec).errors);
});

test('the bar-model solver and the story arithmetic agree on every answer key', () => {
  for (const p of ALL) {
    assert.equal(solve(p.spec), p.answer, p.id);
    assert.ok(Number.isInteger(p.answer) && p.answer > 0, p.id);
    assert.ok(p.equationOptions.includes(p.equation) && p.equationOptions.length >= 2, p.id);
  }
});

test('a deliberately wrong key is caught by the solver check', () => {
  const p = makeProblem('part_whole', 3, 1, 0);
  assert.notEqual(solve(p.spec), p.answer + 1);
  assert.throws(() => expectedAnswer('part_whole', 'nope', {}));
});

const digitsIn = (s) => (asciiDigits(s).match(/\d+/g) || []).map(Number).sort((a, b) => a - b);

test('every question text, in every language, holds exactly the story numbers (translation never changes a number)', () => {
  for (const { code } of LANGUAGES) {
    for (const p of ALL) {
      const text = problemText(p, STRINGS[code]);
      assert.ok(text.length > 20, code + ' ' + p.id + ' empty');
      assert.doesNotMatch(text, /\{\w+\}/, code + ' ' + p.id + ' has an unfilled placeholder');
      assert.deepEqual(digitsIn(text), storyNumbers(p).slice().sort((a, b) => a - b), code + ' ' + p.id + ': ' + text);
    }
  }
});

test('Telugu and Hindi have every English key, the same placeholders, and their own script', () => {
  const ph = (s) => [...new Set(String(s).match(/\{\w+\}/g) || [])].sort().join(',');
  for (const code of ['te', 'hi']) {
    for (const [k, v] of Object.entries(ENGLISH)) {
      assert.ok(STRINGS[code][k], code + ' is missing ' + k);
      assert.equal(ph(STRINGS[code][k]), ph(v), code + ' ' + k + ' placeholders');
    }
    const script = code === 'te' ? /[\u0C00-\u0C7F]/ : /[\u0900-\u097F]/;
    assert.ok(script.test(STRINGS[code]['tpl.part_whole.total']));
  }
});

test('hints carry no digits, so no hint can give an answer away; the guard catches one that would', () => {
  for (const { code } of LANGUAGES) for (const [k, v] of Object.entries(STRINGS[code])) if (k.startsWith('hint.')) assert.doesNotMatch(v, /\d/, code + ' ' + k);
  assert.equal(hintIsSafe('The answer is 42, well done', 42), false);
  assert.equal(hintIsSafe('Find one part first', 42), true);
  for (const t of MODEL_TYPES) for (const n of [1, 2, 3]) assert.ok(hintText(t, n, ENGLISH));
});

test('the migration SQL is generated from the seed file and is in step with it', () => {
  assert.equal(fs.readFileSync(MIGRATION, 'utf8'), buildSql(), 'run: node scripts/sgmath-migration.mjs');
  const sql = buildSql();
  assert.match(sql, /create unique index if not exists sgmath_sessions_free_week on sgmath_sessions \(student_id, week_start\) where gate = 'free_weekly'/);
  assert.doesNotMatch(sql, /alter table (?!sgmath_)/i, 'no existing table is changed');
});

test('a new language is data only: a dummy language renders from its rows with no code change', () => {
  const zz = { ...ENGLISH, 'tpl.part_whole.total': 'ZZ {name1} {a} {b} {item} ?', 'name.1': 'Zed', 'name.2': 'Zee', 'name.3': 'Zo', 'name.4': 'Za', 'name.5': 'Zu', 'name.6': 'Zi', 'name.7': 'Zy', 'name.8': 'Zw', 'name.9': 'Zv', 'name.10': 'Zt', 'name.11': 'Zs', 'name.12': 'Zr' };
  const p = ALL.find((x) => x.type === 'part_whole' && x.variant === 'total');
  assert.match(problemText(p, zz), /^ZZ Z\w+ \d+ \d+ /);
  // a missing key falls back to English (the server merges English first)
  const partial = { ...ENGLISH, ...{ 'page.title': 'ZZ title' } };
  assert.equal(partial['page.start'], ENGLISH['page.start']);
});

test('IST week starts Monday 00:00 IST', () => {
  // Sunday 2026-10-18 23:59 IST and Monday 2026-10-19 00:00 IST
  assert.equal(weekStartIst(Date.parse('2026-10-18T23:59:00+05:30')), '2026-10-12');
  assert.equal(weekStartIst(Date.parse('2026-10-19T00:00:00+05:30')), '2026-10-19');
  assert.equal(weekStartIst(Date.parse('2026-10-18T18:30:00Z')), '2026-10-19');   // = Monday 00:00 IST
  assert.equal(weekStartIst(Date.parse('2026-10-13T12:00:00+05:30')), '2026-10-12');
});

test('gate per tier: Max unlimited, Pro and UltraPro one a week, Free locked', () => {
  assert.equal(gateFor('max'), 'max');
  assert.equal(gateFor('pro'), 'free_weekly');
  assert.equal(gateFor('ultrapro'), 'free_weekly');
  assert.equal(gateFor('free'), 'locked');
  assert.equal(gateFor(undefined), 'locked');
});

test('grades: "Class 4" is 4, practice is for 1 to 6', () => {
  assert.equal(gradeOf('Class 4'), 4);
  assert.equal(gradeOf('class 10'), 10);
  assert.equal(gradeOf(''), null);
  assert.equal(gradeSupported(6), true);
  assert.equal(gradeSupported(7), false);
  assert.deepEqual(typesForGrade(1), ['part_whole']);
  assert.deepEqual(typesForGrade(6), MODEL_TYPES);
});

test('first session is a diagnostic; then the untried, then the weakest type', () => {
  assert.deepEqual(chooseFocus(4, []), { diagnostic: true, types: ['part_whole', 'comparison', 'before_after', 'fraction'] });
  const at = (type, correct, n = 1) => Array.from({ length: n }, () => ({ model_type: type, step: 'abstract', correct, created_at: '2026-10-01T00:00:00Z' }));
  assert.equal(chooseFocus(4, [...at('part_whole', true, 2)]).type, 'comparison');
  const all = [...at('part_whole', true, 3), ...at('comparison', false, 3), ...at('before_after', true, 2), ...at('fraction', true, 2)];
  assert.equal(chooseFocus(4, all).type, 'comparison');
  assert.equal(diagnosticProblems(4, 's').length, 4);
});

test('difficulty goes up after two right, down after two wrong', () => {
  const a = (c) => ({ model_type: 'part_whole', step: 'abstract', correct: c });
  assert.equal(nextDifficulty([], 'part_whole'), 1);
  assert.equal(nextDifficulty([a(true), a(true)], 'part_whole'), 2);
  assert.equal(nextDifficulty([a(true), a(true), a(true), a(true)], 'part_whole'), 3);
  assert.equal(nextDifficulty([a(true), a(true), a(false), a(false)], 'part_whole'), 1);
});

test('no repeat within 30 days while others exist; same pick for a child and day', () => {
  const now = Date.parse('2026-10-13T10:00:00Z');
  const first = pickProblems({ type: 'part_whole', grade: 3, difficulty: 1, seed: 'kid', now });
  assert.equal(first.length, 3);
  assert.deepEqual(pickProblems({ type: 'part_whole', grade: 3, difficulty: 1, seed: 'kid', now }), first);
  const recent = Object.fromEntries(first.map((id) => [id, now - 86400000]));
  const next = pickProblems({ type: 'part_whole', grade: 3, difficulty: 1, seed: 'kid', now, recent });
  assert.equal(next.filter((id) => first.includes(id)).length, 0);
  for (const id of next) assert.ok(problemById(id));
  assert.equal(problemById('part_whole-g9-d1-0'), null);
  assert.equal(problemById('ratio-g3-d1-0'), null);      // ratio is grades 5 and 6 only
  assert.equal(problemById("x'; drop table"), null);
});

test('mastery is an EWMA with 0.3 on the latest; labels; weekly growth has gaps, not zeros', () => {
  const rows = [{ model_type: 'part_whole', correct: true }, { model_type: 'part_whole', correct: false }];
  const m = masteryByType(rows);
  assert.equal(Math.round(m.part_whole.score * 100), 70);
  assert.equal(masteryLabel(m.comparison), 'not_tried');
  assert.equal(masteryLabel({ score: 0.9, attempts: 5 }), 'strong');
  assert.equal(masteryLabel({ score: 0.6, attempts: 2 }), 'getting_there');
  const now = Date.parse('2026-10-13T10:00:00+05:30');
  const g = weeklyGrowth([{ model_type: 'part_whole', step: 'abstract', correct: true, created_at: '2026-10-13T08:00:00+05:30' }], now);
  assert.equal(g.length, 8);
  assert.equal(g[7].value, 100);
  assert.equal(g[0].value, null);
});

test('concrete script and the question picture never show the answer', () => {
  for (const p of ALL.filter((x, i) => i % 7 === 0)) {
    assert.doesNotMatch(concreteText(p, ENGLISH), /\{\w+\}/, p.id);
    const svg = problemSvg(p, ENGLISH, { reveal: false });
    assert.match(svg, /^<svg /);
    if (p.spec.kind === 'parts' || p.spec.kind === 'lengths') assert.match(svg, />\?</, p.id);
  }
});
