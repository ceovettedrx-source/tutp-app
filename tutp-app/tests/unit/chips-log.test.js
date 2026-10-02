// Unit tests for server/chips/scrub.js and server/chips/log.js (pure parts) and
// the notes helpers in server/routes/chips.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubPhrase } from '../../server/chips/scrub.js';
import { familyHash, chipHashKey, classBand, boardOf, buildEventRow, istDate, createChipLog } from '../../server/chips/log.js';
import { parseNotes, notesInput, createNotesCache, NOTES_LIMITS } from '../../server/routes/chips.js';
import { buildHomeworkRequest, PROMPT_FEATURES } from '../../server/prompts/homework-prompts.js';

test('scrub: numbers, phones, emails, links and names are removed', () => {
  assert.equal(scrubPhrase('call me on 9876543210'), 'call me on');
  assert.equal(scrubPhrase('mail amma@example.com now'), 'mail now');
  assert.equal(scrubPhrase('see https://x.example/a?b=1 please'), 'see please');
  assert.equal(scrubPhrase('help Ravi with maths', ['Ravi']), 'help with maths');
  assert.equal(scrubPhrase('tell Sunita Sharma story'), 'tell story');      // capitalised mid-sentence words dropped
  assert.equal(scrubPhrase('draw 3 cats 12'), 'draw cats');
});

test('scrub: at most 6 words, null when nothing is left', () => {
  assert.equal(scrubPhrase('one two three four five six seven eight'), 'one two three four five six');
  assert.equal(scrubPhrase('12345 6789'), null);
  assert.equal(scrubPhrase(''), null);
});

test('family hash is stable, differs per family, and is not the id', () => {
  const a = familyHash(16, 'k'), b = familyHash(17, 'k');
  assert.equal(a, familyHash(16, 'k'));
  assert.notEqual(a, b);
  assert.notEqual(a, familyHash(16, 'other-key'));
  assert.ok(!a.includes('16') || a.length === 24);
  assert.match(a, /^[0-9a-f]{24}$/);
});

test('class band and board', () => {
  assert.equal(classBand('Class 5'), '3-5');
  assert.equal(classBand('2'), '1-2');
  assert.equal(classBand('8th'), '6-8');
  assert.equal(classBand('10'), '9-10');
  assert.equal(classBand('12'), '11-12');
  assert.equal(classBand('LKG'), 'pre');
  assert.equal(classBand(''), 'unknown');
  const reg = { children: [{ name: 'Asha', curriculum: 'CBSE' }, { name: 'Ravi', curriculum: 'State Board' }] };
  assert.equal(boardOf(reg, 'ravi'), 'state_board');
  assert.equal(boardOf(reg, 'nobody'), 'cbse');
  assert.equal(boardOf(null, 'x'), 'unknown');
});

const CTX = { classBand: '3-5', board: 'cbse', familyHash: 'abc', names: [], now: Date.UTC(2026, 9, 1, 20, 0) };

test('event row: only allowed kinds, chips and intents', () => {
  assert.equal(buildEventRow({ kind: 'bogus' }, CTX), null);
  assert.equal(buildEventRow({ kind: 'tap', chip: 'hack' }, CTX), null);
  assert.equal(buildEventRow({ kind: 'tap', chip: 'notes', intent: 'zzz' }, CTX), null);
  const row = buildEventRow({ kind: 'tap', chip: 'notes', intent: 'notes', language: 'Telugu' }, CTX);
  assert.deepEqual(row, {
    kind: 'tap', chip_id: 'notes', intent: 'notes', language: 'Telugu', class_band: '3-5', board: 'cbse',
    event_date: '2026-10-02', family_hash: 'abc', phrase: null,       // 20:00 UTC is already 2 Oct in IST
  });
  assert.equal(istDate(Date.UTC(2026, 9, 1, 10, 0)), '2026-10-01');
});

test('event row: a phrase only for the "other" intent, scrubbed, never the raw text', () => {
  const known = buildEventRow({ kind: 'submit', intent: 'answer', text: 'answer please 9876543210' }, CTX);
  assert.equal(known.phrase, null);
  const other = buildEventRow({ kind: 'submit', intent: 'other', text: 'draw a cat 9876543210' }, CTX);
  assert.equal(other.phrase, 'draw a cat');
  assert.ok(!JSON.stringify(other).includes('9876543210'));
  assert.equal(buildEventRow({ kind: 'tap', chip: 'answer', intent: 'other', text: 'draw a cat' }, CTX).phrase, null);
  assert.equal(Object.keys(other).includes('text'), false);
});

// A fake supabase: records inserts, can fail with a missing table.
function fakeSupabase({ failWith = null } = {}) {
  const calls = { inserts: [], updates: 0 };
  const chain = (table) => ({
    select: () => chain(table),
    eq: () => chain(table),
    maybeSingle: async () => ({ data: table === 'students' ? { name: 'Asha', class: 'Class 4' } : { data: { children: [{ name: 'Asha', curriculum: 'ICSE' }] } } }),
    insert: async (rows) => { calls.inserts.push(...rows); return { error: failWith }; },
    update: () => ({ not: () => ({ lt: async () => { calls.updates++; return { error: null }; } }) }),
  });
  return { calls, client: { from: (t) => chain(t) } };
}

test('logger: records rows with the family hash, skips test families, never throws', async () => {
  process.env.CHIP_HASH_SALT = 'test-salt-0123456789';
  const fake = fakeSupabase();
  const log = createChipLog({ supabase: fake.client, isTestFamily: async (id) => id === 99 });
  await log.record(16, 'stu', [{ kind: 'impression', chip: 'answer', intent: 'answer', language: 'English' }]);
  assert.equal(fake.calls.inserts.length, 1);
  assert.equal(fake.calls.inserts[0].board, 'icse');
  assert.equal(fake.calls.inserts[0].class_band, '3-5');
  assert.notEqual(fake.calls.inserts[0].family_hash, '16');
  await log.record(99, 'stu', [{ kind: 'tap', chip: 'answer', intent: 'answer' }]);
  assert.equal(fake.calls.inserts.length, 1);              // the test family left no row
  assert.equal(fake.calls.updates, 1);                      // the hourly 30-day phrase clearing ran
});

test('logger: no hash key (unset or too short) switches logging off: no fallback key, nothing printed', async () => {
  const saved = process.env.CHIP_HASH_SALT;
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    for (const bad of [undefined, '', 'short']) {
      if (bad === undefined) delete process.env.CHIP_HASH_SALT; else process.env.CHIP_HASH_SALT = bad;
      assert.equal(chipHashKey(), null);
      assert.throws(() => familyHash(16), /not set/);
      const fake = fakeSupabase();
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-that-must-not-become-a-salt';
      await createChipLog({ supabase: fake.client, isTestFamily: async () => false }).record(16, 'stu', [{ kind: 'tap', chip: 'notes', intent: 'notes' }]);
      assert.equal(fake.calls.inserts.length, 0, 'logged with key ' + JSON.stringify(bad));
    }
  } finally {
    console.warn = origWarn;
    process.env.CHIP_HASH_SALT = saved;
  }
  assert.ok(warnings.some((w) => /CHIP_HASH_SALT/.test(w)));
  assert.ok(!warnings.some((w) => /service-role-key-that-must|test-salt/.test(w)), 'a key was printed');
});

test('logger: a missing table pauses logging instead of failing', async () => {
  const fake = fakeSupabase({ failWith: { code: '42P01', message: 'relation "search_chip_events" does not exist' } });
  const log = createChipLog({ supabase: fake.client, isTestFamily: async () => false });
  await log.record(1, null, [{ kind: 'tap', chip: 'notes', intent: 'notes' }]);
  await log.record(1, null, [{ kind: 'tap', chip: 'notes', intent: 'notes' }]);
  assert.equal(fake.calls.inserts.length, 1);              // the second call never reached the table
  await createChipLog({ supabase: null, isTestFamily: async () => false }).record(1, null, [{ kind: 'tap', chip: 'notes' }]);
});

test('notes: input is the numbered questions, else the topic; capped', () => {
  assert.equal(notesInput({ questions: ['24 + 13', ' ', 'what is 5 x 5'] }), '1. 24 + 13\n2. what is 5 x 5');
  assert.equal(notesInput({ questions: [], topic: 'fractions' }), 'fractions');
  assert.equal(notesInput({}), '');
  assert.equal(notesInput({ questions: Array(20).fill('q') }).split('\n').length, 8);
  assert.equal(notesInput({ topic: 'x'.repeat(5000) }).length, 1500);
});

test('notes: caps and server cache', () => {
  assert.deepEqual([NOTES_LIMITS.perTenMinutes, NOTES_LIMITS.perDay], [20, 30]);
  let t = 0;
  const cache = createNotesCache({ max: 2, ttlMs: 1000, now: () => t });
  cache.set('a', { notes: ['1'] });
  cache.set('b', { notes: ['2'] });
  assert.deepEqual(cache.get('a'), { notes: ['1'] });
  cache.set('c', { notes: ['3'] });                  // over the max: the oldest (a) goes
  assert.equal(cache.get('a'), null);
  assert.equal(cache.size(), 2);
  t = 1500;                                           // past the ttl
  assert.equal(cache.get('b'), null);
});

test('notes: parseNotes falls back to plain strings, or null when nothing is readable', () => {
  const reply = (t) => ({ content: [{ type: 'text', text: t }] });
  assert.deepEqual(parseNotes(reply('{"subject":"Math","notes":["a","  b  ",""]}')), { plain: ['a', 'b'], subject: 'Math' });
  assert.equal(parseNotes(reply('{"notes":[]}')), null);
  assert.equal(parseNotes(reply('no json')), null);
  assert.equal(parseNotes(null), null);
});

test('notes prompt: reached only through the dispatcher hook, not through /api/homework', () => {
  assert.ok(!PROMPT_FEATURES.includes('notes'));
  const { system, content } = buildHomeworkRequest({ feature: 'notes', lang: 'Telugu', childContext: 'Asha', text: '1. 24 + 13', attachments: [] });
  assert.match(system, /Telugu/);
  assert.match(system, /"key_idea":/);
  assert.equal(content.length, 1);
  assert.equal(content[0].text, 'Homework: 1. 24 + 13');
});
