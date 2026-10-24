// Unit tests for server/library.js (TUT-69). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePayload, contentHash, buildLearningRow, describeHomeworkReply, saveLearningItem, libraryFailRequested, PAYLOAD_CAP_BYTES } from '../../server/library.js';

const base = { familyId: 1, studentId: 'sid', mode: 'explain', title: 'Fractions', payload: { quick: 'a half' } };

test('sanitizePayload drops data: URLs, base64 runs and model bookkeeping', () => {
  const out = sanitizePayload({ a: 'data:image/png;base64,AAAA', b: 'x'.repeat(2000), c: 'ok', usage: { n: 1 }, _recordings: [1], base64: 'zzz', nested: [{ img: 'data:image/jpeg;base64,QQ', t: 'hi' }] });
  assert.deepEqual(out, { c: 'ok', nested: [{ t: 'hi' }] });
  assert.ok(!JSON.stringify(out).includes('data:'));
  // Long prose is not an image.
  const prose = 'word '.repeat(600);
  assert.equal(sanitizePayload({ t: prose }).t, prose);
});

test('contentHash differs by mode and by payload, same for the same input', () => {
  assert.equal(contentHash('explain', { a: 1 }), contentHash('explain', { a: 1 }));
  assert.notEqual(contentHash('explain', { a: 1 }), contentHash('notes', { a: 1 }));
  assert.notEqual(contentHash('explain', { a: 1 }), contentHash('explain', { a: 2 }));
});

test('same concept with different numbers, or the same text in two languages, are two items', () => {
  const a = buildLearningRow({ ...base, payload: { quick: '3/4 + 1/4' } });
  const b = buildLearningRow({ ...base, payload: { quick: '2/5 + 1/5' } });
  const c = buildLearningRow({ ...base, payload: { quick: 'ముప్పావు' } });
  assert.notEqual(a.row.content_hash, b.row.content_hash);
  assert.notEqual(a.row.content_hash, c.row.content_hash);
});

test('buildLearningRow: owner, mode, payload and size rules', () => {
  assert.equal(buildLearningRow({ ...base, familyId: null }).skip, 'no_owner');
  assert.equal(buildLearningRow({ ...base, mode: 'hack' }).skip, 'bad_mode');
  assert.equal(buildLearningRow({ ...base, payload: null }).skip, 'no_payload');
  assert.equal(buildLearningRow({ ...base, payload: { t: 'word '.repeat(PAYLOAD_CAP_BYTES / 4) } }).skip, 'too_big');
  const ok = buildLearningRow({ ...base, sourceText: 'q'.repeat(500), title: '   ' });
  assert.equal(ok.row.source_text.length, 300);
  assert.equal(ok.row.title, 'Untitled');
  assert.equal(ok.row.imported, false);
  assert.ok(!('generated_by' in ok.row));
});

test('describeHomeworkReply maps each feature to a mode and keeps only the content', () => {
  const env = (o) => ({ usage: { input_tokens: 5 }, content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] });
  const answer = describeHomeworkReply('homework_help', env({ subject: 'Maths', questions: [{ q_text: '3 + 4' }] }));
  assert.equal(answer.mode, 'answer');
  assert.equal(answer.subject, 'Maths');
  assert.equal(answer.title, '3 + 4', 'the title is what the first card shows, not the subject');
  assert.ok(!('usage' in answer.payload));
  // A lesson photo (content mode): each concept becomes a card, and the first card's heading is the title.
  const lesson = describeHomeworkReply('homework_help', env({ schema: 2, mode: 'content', subject: 'Maths', questions: [{ q_text: 'Adding a 1-digit number to a 3-digit number with carry forward' }, { q_text: 'Another idea' }] }));
  assert.equal(lesson.title, 'Adding a 1-digit number to a 3-digit number with carry forward');
  assert.equal(lesson.subject, 'Maths');
  // No cards at all: the subject is the last resort, never an empty title.
  assert.equal(describeHomeworkReply('homework_help', env({ subject: 'Maths', questions: [] })).title, 'Maths');
  assert.equal(describeHomeworkReply('homework_help', env({ title: 'Own title', subject: 'Maths', questions: [{ q_text: 'x' }] })).title, 'Own title');
  assert.equal(describeHomeworkReply('storytelling', env({ title: 'The Fox' })).mode, 'story');
  assert.equal(describeHomeworkReply('quiz', env('plain text quiz')).payload.text, 'plain text quiz');
  assert.equal(describeHomeworkReply('experiential_learning', env({ title: 'Plant a seed' })).mode, 'experiential');
  assert.equal(describeHomeworkReply('homework_explain', env({})), null);
  assert.equal(describeHomeworkReply('quiz', { content: [] }), null);
});

test('a notes card is saved as mode notes under its own title, the one the parent sees', () => {
  const notes = { version: 2, subject: 'Maths', title: 'Adding a 1-digit number to a 3-digit number with carry forward', idea: 'x', steps: ['a', 'b'] };
  const { row } = buildLearningRow({ familyId: 1, studentId: 'sid', mode: 'notes', subject: notes.subject, topic: notes.title, title: notes.title || notes.subject || 'Notes', language: 'English', payload: notes, sourceText: '1. 24 + 13' });
  assert.equal(row.mode, 'notes');
  assert.equal(row.title, notes.title);
  assert.equal(row.payload.title, notes.title);
});

test('libraryFailRequested only works on an E2E_REPLAY=1 preview', () => {
  const req = { get: (h) => (h === 'x-e2e-library-fail' ? '1' : undefined) };
  assert.equal(libraryFailRequested(req, { E2E_REPLAY: '1' }), true);
  assert.equal(libraryFailRequested(req, {}), false);
  assert.equal(libraryFailRequested(req, { E2E_REPLAY: '0' }), false);
  assert.equal(libraryFailRequested({ get: () => undefined }, { E2E_REPLAY: '1' }), false);
  assert.equal(libraryFailRequested(null, { E2E_REPLAY: '1' }), false);
});

test('forceError never reaches the database and only logs', async () => {
  let touched = false;
  const logged = [];
  const origErr = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    saveLearningItem({ from: () => { touched = true; return { insert: () => Promise.resolve({}) }; } }, base, { forceError: true });
    await new Promise(r => setTimeout(r, 20));
  } finally { console.error = origErr; }
  assert.equal(touched, false);
  assert.equal(logged.length, 1);
});

test('saveLearningItem never throws, swallows a duplicate, and logs another error', async () => {
  const logged = [];
  const origErr = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const insertWith = (result) => ({ from: () => ({ insert: () => Promise.resolve(result) }) });
    saveLearningItem(insertWith({ error: { code: '23505', message: 'dup' } }), base);
    saveLearningItem(insertWith({ error: { code: 'XX', message: 'boom' } }), base);
    saveLearningItem({ from: () => { throw new Error('sync boom'); } }, base);
    saveLearningItem({ from: () => ({ insert: () => Promise.reject(new Error('rejected')) }) }, base);
    saveLearningItem(null, base);
    await new Promise(r => setTimeout(r, 20));
  } finally { console.error = origErr; }
  assert.equal(logged.length, 3);
  assert.ok(logged.every(l => l.includes('library: save failed')));
});
