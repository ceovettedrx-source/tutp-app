// Unit tests for server/exam-prep.js, server/mind-map-svg.js and the
// knowledge graph's getChapter (round 4, docs/specs/round-4-exam-prep-pilot.md):
//   npm run test:unit
// x9 of the spec (a failed gate lands in "needs your review", never
// rejected) is here, with a stand-in model, since a failure can't be forced
// on a real model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  noteKey, kgVersion, pilotFor, classNumber, checkShape, checkScript, checkCopied, checkFractionFacts,
  writeNote, decide, undoLatest, startVersion, ReviewError, noteFor, pilotChapter, chapterInfo, weekTotals, mcqLesson,
  saveWritten, reportMistake, weeklySample,
} from '../../server/exam-prep.js';
import { getChapter, clearCache } from '../../server/services/knowledgeGraph.js';
import { mindMapSvg, wrap } from '../../server/mind-map-svg.js';

const cards = (n) => ({ cards: Array.from({ length: n }, (_, i) => ({ front: `Card ${i + 1}`, back: `1/2 = ${i + 1}/${2 * (i + 1)}` })) });
const questions = (n) => ({
  questions: Array.from({ length: n }, (_, i) => ({
    type: i % 2 ? 'short' : 'mcq', question: `Q${i + 1}`, answer: '2/4', explanation: 'e',
    tag: ['logical_reasoning', 'understanding', 'application', 'skill_based'][i % 4],
    ...(i % 2 ? {} : { options: ['1/4', '2/4', '3/4', '4/4'] }),
  })),
});

// ------------------------------------------------------------ knowledge graph

test('getChapter finds both pilot boards and nothing else', async () => {
  clearCache();
  for (const board of ['andhra-pradesh', 'telangana']) {
    const ch = await getChapter(board, 5, 'mathematics', 'Chapter 13: Fractions');
    assert.equal(ch.sourced, true, board);
    assert.equal(ch.components.length, 2);
    assert.ok(ch.components.every((c) => c.learningComponent.verification_status === 'agent_reviewed'));
    assert.ok(ch.components.every((c) => c.learningComponent.key_terms_en.length && c.learningComponent.key_terms_te.length));
    assert.ok(ch.tier3Texts.length > 0, 'tier-3 source texts for the copy check');
  }
  assert.equal((await getChapter('telangana', 4, 'mathematics', 'Chapter 13: Fractions')).sourced, false);
  assert.equal((await getChapter('telangana', 5, 'mathematics', 'Chapter 12: Decimals')).sourced, false);
  assert.equal((await getChapter('karnataka', 5, 'mathematics', 'Chapter 13: Fractions')).sourced, false);
});

test('AP says "based on the 2019 edition", TS does not', async () => {
  assert.equal(chapterInfo(await pilotChapter('andhra-pradesh')).editionNote, 'Based on the 2019 edition');
  assert.equal(chapterInfo(await pilotChapter('telangana')).editionNote, null);
});

// ------------------------------------------------------------ pilot and keys

test('only a Class 5 AP/TS state-board child is in the pilot', () => {
  assert.deepEqual(pilotFor({ cls: 'Class 5', state: 'Telangana' }), { eligible: true, board: 'telangana' });
  assert.deepEqual(pilotFor({ cls: 'Class 5', state: 'Andhra Pradesh', curriculum: 'State Board' }), { eligible: true, board: 'andhra-pradesh' });
  assert.equal(pilotFor({ cls: 'Class 4', state: 'Telangana' }).reason, 'class');
  assert.equal(pilotFor({ cls: 'Class 5', state: 'Karnataka' }).reason, 'state');
  assert.equal(pilotFor({ cls: 'Class 5', state: 'Telangana', curriculum: 'CBSE' }).reason, 'board');
  assert.equal(pilotFor({ cls: null, state: 'Telangana' }).reason, 'class');
  assert.equal(classNumber('Class 15'), 15);
  assert.equal(classNumber('Class 5A'), null);
});

test('cache key is stable and changes with every part', async () => {
  const ch = await pilotChapter('telangana');
  const kv = kgVersion(ch);
  assert.equal(kv, kgVersion(await pilotChapter('telangana')));
  const base = { mode: 'flashcards', board: 'telangana', grade: 5, chapter: 'Chapter 13: Fractions', lang: 'en', kgVersion: kv };
  const k = noteKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(k, noteKey({ ...base }));
  for (const change of [{ mode: 'key_points' }, { board: 'andhra-pradesh' }, { lang: 'te' }, { promptVersion: 'ep0' }, { kgVersion: 'x' }, { isTest: true }, { grade: 4 }]) {
    assert.notEqual(noteKey({ ...base, ...change }), k, JSON.stringify(change));
  }
  assert.equal(noteFor({ chapter: ch, mode: 'flashcards', lang: 'en' }).key, k);
});

// ------------------------------------------------------------ gate

test('shape and counts', () => {
  assert.equal(checkShape('flashcards', cards(12)).pass, true);
  assert.equal(checkShape('flashcards', cards(9)).pass, false);
  assert.equal(checkShape('flashcards', cards(16)).pass, false);
  assert.equal(checkShape('practice_questions', questions(10)).pass, true);
  assert.equal(checkShape('practice_questions', questions(7)).pass, false);
  const q = questions(10);
  q.questions[0].answer = '5/4';
  assert.match(checkShape('practice_questions', q).errors.join(), /not one of the options/);
  q.questions[0].answer = '2/4';
  q.questions[1].tag = 'memory';
  assert.match(checkShape('practice_questions', q).errors.join(), /tag "memory"/);
  assert.equal(checkShape('key_points', { points: [{ heading: 'a', text: 'b' }], formulas: [] }).pass, false);
  assert.equal(checkShape('revision_notes', null).pass, false);
});

test('a wrong fraction fails the gate', () => {
  assert.equal(checkFractionFacts(cards(12)).pass, true);
  const c = cards(12);
  c.cards[3].back = '1/2 = 2/2';
  const r = checkFractionFacts(c);
  assert.equal(r.pass, false);
  assert.match(r.errors[0], /1\/2 = 2\/2/);
});

test('English in Telugu mode fails; Telugu passes', () => {
  assert.equal(checkScript('te', { cards: [{ front: 'What is a fraction?', back: 'A part of a whole' }] }).pass, false);
  assert.equal(checkScript('te', { cards: [{ front: 'భిన్నం అంటే ఏమిటి?', back: 'పూర్ణంలో ఒక భాగం, ఉదా. 1/2' }] }).pass, true);
  assert.equal(checkScript('en', { cards: [{ front: 'What?', back: 'x' }] }).pass, true);
});

test('text copied from a tier-3 source fails', () => {
  const src = ['The quick brown fox jumps over the lazy dog near the old river bank today'];
  assert.equal(checkCopied({ a: 'my own words about fractions and parts of a whole' }, src).pass, true);
  assert.equal(checkCopied({ a: 'So the quick brown fox jumps over the lazy dog near the old river bank.' }, src).pass, false);
  assert.equal(checkCopied({ a: 'the quick brown fox jumps over the lazy dog near the' }, src).pass, true, '12 words are allowed');
});

test('MCQs go to Gates A/B with their letters', () => {
  const lesson = mcqLesson(questions(10));
  assert.equal(lesson.student_sections[0].items.length, 5);
  assert.match(lesson.student_sections[0].items[0].text, /\(A\) 1\/4 \(B\) 2\/4 .* Correct answer: \(B\)/);
});

// ------------------------------------------------------------ writing (x9)

function fakeClaude(replies) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const next = replies[args.feature].shift();
    if (next && next.status) return { ok: false, status: next.status, errText: 'down' };
    return { ok: true, status: 200, data: { content: [{ type: 'text', text: typeof next === 'string' ? next : JSON.stringify(next) }] } };
  };
  fn.calls = calls;
  return fn;
}
const passCheck = { correct: true, on_syllabus: true, age_appropriate: true, issues: [] };

test('x9: a note that fails the gate twice lands in needs_review with the failed checks, never rejected', async () => {
  const chapter = await pilotChapter('telangana');
  const bad = cards(12);
  bad.cards[0].back = '1/2 = 2/2';
  const claude = fakeClaude({
    exam_prep_generate: [bad, bad],
    exam_prep_check: [{ ...passCheck, correct: false, issues: ['card 1 is wrong'] }, passCheck],
  });
  const r = await writeNote({ mode: 'flashcards', lang: 'en', chapter, deps: { callClaude: claude } });
  assert.equal(r.status, 'needs_review');
  assert.equal(r.checks.passed, false);
  assert.equal(r.checks.final.fractions.pass, false);
  assert.equal(r.checks.attempts.length, 2);
  assert.deepEqual(claude.calls.filter((c) => c.feature === 'exam_prep_generate').map((c) => c.body.model), ['claude-haiku-4-5', 'claude-sonnet-5']);
  assert.equal(r.model, 'claude-sonnet-5');
  assert.ok(claude.calls.every((c) => !JSON.stringify(c.body).match(/Ishika|photo/i)), 'neutral context only');
});

test('a note that passes on Haiku is not retried and may be approved by the AI', async () => {
  const chapter = await pilotChapter('telangana');
  const claude = fakeClaude({ exam_prep_generate: [cards(12)], exam_prep_check: [passCheck] });
  const r = await writeNote({ mode: 'flashcards', lang: 'en', chapter, deps: { callClaude: claude } });
  assert.equal(r.status, 'needs_review');
  assert.equal(r.checks.passed, true);
  assert.equal(r.autoApprove, true);
  assert.equal(r.model, 'claude-haiku-4-5');
  assert.equal(claude.calls.length, 2);
});

test('ai review: only "every gate passed and Haiku wrote it" may auto-approve', async () => {
  const chapter = await pilotChapter('telangana');
  const bad = cards(12);
  bad.cards[0].back = '1/2 = 2/2';
  // Haiku fails a gate, Sonnet's retry passes: Sonnet wrote it -> founder's queue.
  const sonnet = fakeClaude({ exam_prep_generate: [bad, cards(12)], exam_prep_check: [passCheck, passCheck] });
  const a = await writeNote({ mode: 'flashcards', lang: 'en', chapter, deps: { callClaude: sonnet } });
  assert.equal(a.checks.passed, true);
  assert.equal(a.model, 'claude-sonnet-5');
  assert.equal(a.autoApprove, false);
  // Haiku's reply passes the deterministic checks but the independent check fails.
  const failed = fakeClaude({ exam_prep_generate: [cards(12), cards(12)], exam_prep_check: [{ ...passCheck, correct: false, issues: ['x'] }, { ...passCheck, correct: false, issues: ['x'] }] });
  assert.equal((await writeNote({ mode: 'flashcards', lang: 'en', chapter, deps: { callClaude: failed } })).autoApprove, false);
  // A version written for a needs-fix never approves itself, even when every gate passes.
  const fix = fakeClaude({ exam_prep_generate: [cards(12)], exam_prep_check: [passCheck] });
  const f = await writeNote({ mode: 'flashcards', lang: 'en', chapter, fixReason: 'card 3 unclear', deps: { callClaude: fix } });
  assert.equal(f.checks.passed, true);
  assert.equal(f.autoApprove, false);
  // Telugu follows the same rule: English text in Telugu mode fails the script check, so no auto-approve.
  const te = fakeClaude({ exam_prep_generate: [cards(12), cards(12)], exam_prep_check: [passCheck, passCheck] });
  const t = await writeNote({ mode: 'flashcards', lang: 'te', chapter, deps: { callClaude: te } });
  assert.equal(t.checks.final.script.pass, false);
  assert.equal(t.autoApprove, false);
});

test('practice questions run Gates A/B; a model error ends as failed', async () => {
  const chapter = await pilotChapter('andhra-pradesh');
  let verified = null;
  const verify = async (lesson) => { verified = lesson; return { checked: true, all_passed: false, details: [{ item_text: 'Q1', gate_a_pass: false, gate_b_pass: true, issue: 'two options fit' }] }; };
  const claude2 = fakeClaude({ exam_prep_generate: [questions(10), questions(10)], exam_prep_check: [passCheck, passCheck] });
  const r = await writeNote({ mode: 'practice_questions', lang: 'en', chapter, deps: { callClaude: claude2, verifyMcqSections: verify } });
  assert.equal(verified.student_sections[0].items.length, 5);
  assert.equal(r.status, 'needs_review');
  assert.match(r.checks.final.mcq_gates.errors[0], /Gate A: two options fit/);
  const down = fakeClaude({ exam_prep_generate: [{ status: 529 }], exam_prep_check: [] });
  assert.equal((await writeNote({ mode: 'flashcards', lang: 'en', chapter, deps: { callClaude: down } })).status, 'failed');
});

// ------------------------------------------------------------ review rules

function memoryStore() {
  const rows = [], decisions = [], reports = [];
  let t = 0;
  const served = (key) => rows.find((r) => r.key === key && r.status === 'approved') || null;
  return {
    rows, allDecisions: decisions,
    version: async (id) => rows.find((r) => r.id === id) || null,
    versions: async (key) => rows.filter((r) => r.key === key).sort((a, b) => b.version - a.version),
    served: async (key) => served(key),
    insertVersion: async (row) => { const r = { id: crypto.randomUUID(), content: null, ...row }; rows.push(r); return r; },
    update: async (id, f) => {
      const r = rows.find((x) => x.id === id);
      if (f.status === 'approved' && served(r.key) && served(r.key).id !== id) throw new Error('unique approved violated');
      Object.assign(r, f);
      return r;
    },
    decisions: async (key) => decisions.filter((d) => d.key === key).sort((a, b) => b.t - a.t),
    insertDecision: async (row) => { const d = { id: crypto.randomUUID(), t: ++t, undone_at: null, ...row }; decisions.push(d); return d; },
    markUndone: async (id) => { const d = decisions.find((x) => x.id === id); d.undone_at = new Date().toISOString(); return d; },
    reports,
    openReports: async (versionId) => reports.filter((r) => r.version_id === versionId && !r.resolved_at),
    insertReport: async (row) => {
      if (reports.some((r) => r.version_id === row.version_id && r.student_id === row.student_id && !r.resolved_at)) return null;
      const r = { id: crypto.randomUUID(), resolved_at: null, resolved_by_decision: null, ...row };
      reports.push(r);
      return r;
    },
    closeReports: async (versionId, decisionId) => reports.filter((r) => r.version_id === versionId && !r.resolved_at).forEach((r) => { r.resolved_at = 'now'; r.resolved_by_decision = decisionId; }),
    reopenReports: async (decisionId) => reports.filter((r) => r.resolved_by_decision === decisionId).forEach((r) => { r.resolved_at = null; r.resolved_by_decision = null; }),
  };
}
const NOTE = (key) => ({ key, mode: 'flashcards', board: 'telangana', grade: 5, chapter: 'Chapter 13: Fractions', lang: 'en', promptVersion: 'ep1', kgVersion: 'k', isTest: true });
async function ready(store, key) {
  const v = await startVersion(store, NOTE(key));
  return store.update(v.id, { status: 'needs_review', content: cards(12) });
}
const status = (store) => Object.fromEntries(store.rows.map((r) => [`${r.key}#${r.version}`, r.status]));

test('approve serves one version; undo brings back the one approved before', async () => {
  const s = memoryStore();
  const v1 = await ready(s, 'A');
  await decide(s, { versionId: v1.id, action: 'approve' });
  const v2 = await ready(s, 'A');
  await decide(s, { versionId: v2.id, action: 'approve' });
  assert.deepEqual(status(s), { 'A#1': 'superseded', 'A#2': 'approved' });
  await undoLatest(s, 'A');
  assert.deepEqual(status(s), { 'A#1': 'approved', 'A#2': 'needs_review' });
  await undoLatest(s, 'A');
  assert.deepEqual(status(s), { 'A#1': 'needs_review', 'A#2': 'needs_review' });
  await assert.rejects(undoLatest(s, 'A'), (e) => e.code === 'nothing_to_undo');
});

test('x7: one reject touches only that note; it needs a reason and a confirm; undo serves it again', async () => {
  const s = memoryStore();
  for (const k of ['A', 'B', 'C']) await decide(s, { versionId: (await ready(s, k)).id, action: 'approve' });
  const a = (await s.served('A')).id;
  await assert.rejects(decide(s, { versionId: a, action: 'reject', confirm: true }), (e) => e.code === 'reason_required');
  await assert.rejects(decide(s, { versionId: a, action: 'reject', reason: 'wrong' }), (e) => e.code === 'confirm_required');
  await assert.rejects(decide(s, { versionId: [a, a], action: 'reject', reason: 'x', confirm: true }), (e) => e.status === 400 && e.code === 'one_version_only');
  await decide(s, { versionId: a, action: 'reject', reason: 'wrong fact', confirm: true });
  assert.deepEqual(status(s), { 'A#1': 'rejected', 'B#1': 'approved', 'C#1': 'approved' });
  assert.equal(await s.served('A'), null);
  await undoLatest(s, 'A');
  assert.equal((await s.served('A')).id, a);
});

test('x8: needs fix keeps the served version unless "hide now"; only that note gets a new version', async () => {
  const s = memoryStore();
  for (const k of ['A', 'B']) await decide(s, { versionId: (await ready(s, k)).id, action: 'approve' });
  const a1 = (await s.served('A')).id;
  await assert.rejects(decide(s, { versionId: a1, action: 'needs_fix', reason: '  ' }), (e) => e.code === 'reason_required');
  const r = await decide(s, { versionId: a1, action: 'needs_fix', reason: 'card 3 unclear' });
  assert.equal(r.newVersion.fix_reason, 'card 3 unclear');
  assert.equal(r.newVersion.version, 2);
  assert.deepEqual(status(s), { 'A#1': 'approved', 'B#1': 'approved', 'A#2': 'generating' });
  // Undo: the new version is kept as superseded.
  await undoLatest(s, 'A');
  assert.deepEqual(status(s), { 'A#1': 'approved', 'B#1': 'approved', 'A#2': 'superseded' });
  // Hide now: coming soon until the new version is approved.
  const h = await decide(s, { versionId: a1, action: 'needs_fix', reason: 'wrong answer', hide: true });
  assert.equal(await s.served('A'), null);
  await s.update(h.newVersion.id, { status: 'needs_review', content: cards(11) });
  await decide(s, { versionId: h.newVersion.id, action: 'approve' });
  assert.equal((await s.served('A')).id, h.newVersion.id);
  assert.equal((await s.served('B')).status, 'approved');
});

test('approve refuses a version with no content or the wrong status', async () => {
  const s = memoryStore();
  const v = await startVersion(s, NOTE('A'));
  await assert.rejects(decide(s, { versionId: v.id, action: 'approve' }), (e) => e.code === 'bad_status');
  await s.update(v.id, { status: 'needs_review' });
  await assert.rejects(decide(s, { versionId: v.id, action: 'approve' }), (e) => e.code === 'no_content');
  await assert.rejects(decide(s, { versionId: v.id, action: 'delete' }), (e) => e instanceof ReviewError && e.code === 'bad_action');
});

// ------------------------------------------------------------ ai review

const written = (over = {}) => ({ status: 'needs_review', autoApprove: true, content: cards(12), model: 'claude-haiku-4-5', usd: 0.01, checks: { passed: true }, ...over });

test('ai approval: served with reviewed_by ai, recorded as a decision, and Undo brings the old version back', async () => {
  const s = memoryStore();
  const first = await startVersion(s, NOTE('A'));
  const r1 = await saveWritten(s, first, written());
  assert.equal(r1.autoApproved, true);
  assert.equal((await s.served('A')).reviewed_by, 'ai');
  assert.equal(s.allDecisions[0].decided_by, 'ai');
  assert.equal(s.allDecisions[0].action, 'approve');
  // A founder approval of the next version: reviewed_by founder; the ai one is superseded.
  const v2 = await ready(s, 'A');
  await decide(s, { versionId: v2.id, action: 'approve' });
  assert.equal((await s.served('A')).reviewed_by, 'founder');
  assert.equal(s.allDecisions.at(-1).decided_by, 'founder');
  // Undo the founder's approve: the ai-approved version is served again, still 'ai'.
  await undoLatest(s, 'A');
  assert.equal((await s.served('A')).id, first.id);
  assert.equal((await s.served('A')).reviewed_by, 'ai');
  // Undo the ai approval itself: nothing is served, the version waits in the founder's queue.
  await undoLatest(s, 'A');
  assert.equal(await s.served('A'), null);
  const back = await s.version(first.id);
  assert.equal(back.status, 'needs_review');
  assert.equal(back.reviewed_by, null);
});

test('a version that is not autoApprove, or failed, is not served', async () => {
  const s = memoryStore();
  const a = await saveWritten(s, await startVersion(s, NOTE('A')), written({ autoApprove: false }));
  assert.equal(a.autoApproved, false);
  assert.equal(a.saved.status, 'needs_review');
  assert.equal(await s.served('A'), null);
  const b = await saveWritten(s, await startVersion(s, NOTE('B')), written({ status: 'failed', content: null, autoApprove: true }));
  assert.equal(b.saved.status, 'failed');
  assert.equal(await s.served('B'), null);
  assert.equal(s.allDecisions.length, 0);
});

test('report a mistake: keeps serving, opens one report per child; Keep closes it, Undo re-opens', async () => {
  const s = memoryStore();
  await assert.rejects(reportMistake(s, { key: 'A', studentId: 'c1', familyId: 1, message: 'x' }), (e) => e.code === 'not_served');
  const v = await startVersion(s, NOTE('A'));
  await saveWritten(s, v, written());
  const r = await reportMistake(s, { key: 'A', studentId: 'c1', familyId: 1, message: '  the 3rd card is wrong ' + 'x'.repeat(600) });
  assert.equal(r.duplicate, false);
  assert.equal(s.reports[0].message.length, 500);
  assert.equal((await reportMistake(s, { key: 'A', studentId: 'c1', familyId: 1 })).duplicate, true);
  assert.equal((await reportMistake(s, { key: 'A', studentId: 'c2', familyId: 2 })).duplicate, false);
  assert.equal((await s.served('A')).id, v.id, 'still served');
  assert.equal((await s.openReports(v.id)).length, 2);
  await decide(s, { versionId: v.id, action: 'keep' });
  assert.equal((await s.openReports(v.id)).length, 0);
  assert.equal((await s.served('A')).reviewed_by, 'founder');
  await undoLatest(s, 'A');
  assert.equal((await s.openReports(v.id)).length, 2);
  assert.equal((await s.served('A')).reviewed_by, 'ai');
  // Nothing to keep once the founder is the reviewer and no reports are open.
  await decide(s, { versionId: v.id, action: 'keep' });
  await assert.rejects(decide(s, { versionId: v.id, action: 'keep' }), (e) => e.code === 'nothing_to_keep');
});

test('a reported note can still be sent for a fix or rejected; that closes its reports and undo re-opens them', async () => {
  const s = memoryStore();
  const v = await startVersion(s, NOTE('A'));
  await saveWritten(s, v, written());
  await reportMistake(s, { key: 'A', studentId: 'c1', familyId: 1 });
  await decide(s, { versionId: v.id, action: 'reject', reason: 'wrong', confirm: true });
  assert.equal((await s.openReports(v.id)).length, 0);
  await undoLatest(s, 'A');
  assert.equal((await s.openReports(v.id)).length, 1);
  assert.equal((await s.served('A')).id, v.id);
});

test('weekly sample: 2 notes, stable for a week, different weeks may differ', () => {
  const ids = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}` }));
  const w1 = weeklySample(ids, '2026-09-28T00:00:00Z').map((x) => x.id);
  assert.equal(w1.length, 2);
  assert.deepEqual(weeklySample([...ids].reverse(), '2026-09-28T00:00:00Z').map((x) => x.id), w1);
  const weeks = new Set(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((w) => weeklySample(ids, w).map((x) => x.id).join()));
  assert.ok(weeks.size > 1);
  assert.equal(weeklySample(ids.slice(0, 1), 'w').length, 1);
  assert.deepEqual(weeklySample([], 'w'), []);
});

// ------------------------------------------------------------ mind map, week

test('mind map SVG: one branch per key point, text escaped', () => {
  const svg = mindMapSvg({ title: 'Fractions', points: [{ heading: 'Equal <parts>', text: 'A & B' }, { heading: 'Compare', text: 'x' }] });
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<rect x=/g) || []).length, 2);
  assert.ok(svg.includes('Equal &lt;parts&gt;') && svg.includes('A &amp; B'));
  assert.ok(!svg.includes('<parts>'));
  assert.equal((mindMapSvg({ title: 't', points: Array(12).fill({ heading: 'h', text: 't' }) }).match(/<rect x=/g) || []).length, 8);
  assert.deepEqual(wrap('one two three four five', 9, 2), ['one two', 'three…']);
});

test('week totals: visible time per open capped at 30 minutes', () => {
  const e = (event_name, properties = {}) => ({ event_name, properties });
  const t = weekTotals([
    e('exam_prep.opened'), e('exam_prep.closed', { open_id: 'a', seconds: 120 }), e('exam_prep.closed', { open_id: 'a', seconds: 300 }),
    e('exam_prep.opened'), e('exam_prep.closed', { open_id: 'b', seconds: 99999 }),
    e('exam_prep.flashcard_answered'), e('exam_prep.flashcard_answered'), e('exam_prep.question_answered'),
  ]);
  assert.deepEqual(t, { minutes: 35, flashcards: 2, questions: 1, opens: 2 });
});
