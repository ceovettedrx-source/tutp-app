// One language per request (server/language.js). node --test tests/unit/language.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage, lastLanguageUsed } from '../../server/language.js';
import { validateExplain } from '../../server/explain-schema.js';

// A stand-in for the supabase client: usage_events rows, newest first.
const fake = (rows, { fail = false } = {}) => ({
  from() {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve(fail ? { data: null, error: { message: 'down' } } : { data: rows, error: null }) };
    return q;
  },
});
const session = { familyId: 6 };

test('the language the page sent wins, and no database is read', async () => {
  const boom = { from() { throw new Error('must not be called'); } };
  assert.deepEqual(await resolveLanguage({ requested: 'Telugu', session }, boom), { language: 'Telugu', source: 'page' });
});

test('no language sent: the family\'s last used language', async () => {
  const c = fake([{ properties: { feature: 'homework_help', language: 'Telugu' } }, { properties: { language: 'Hindi' } }]);
  assert.deepEqual(await resolveLanguage({ requested: undefined, session }, c), { language: 'Telugu', source: 'last' });
});

test('an empty, unknown or non-string language counts as none sent', async () => {
  const c = fake([{ properties: { language: 'Tamil' } }]);
  for (const requested of ['', 'Klingon', null, 7, { a: 1 }]) {
    assert.deepEqual(await resolveLanguage({ requested, session }, c), { language: 'Tamil', source: 'last' });
  }
});

test('last-used rows without a valid language are skipped; nothing usable gives English', async () => {
  assert.equal(await lastLanguageUsed(6, fake([{ properties: {} }, { properties: { language: 'Klingon' } }, { properties: { language: 'Marathi' } }])), 'Marathi');
  assert.deepEqual(await resolveLanguage({ session }, fake([{ properties: {} }])), { language: 'English', source: 'default' });
});

test('no session, no database or a failing lookup: English, never a throw', async () => {
  assert.deepEqual(await resolveLanguage({}, fake([{ properties: { language: 'Telugu' } }])), { language: 'English', source: 'default' });
  assert.deepEqual(await resolveLanguage({ session }, null), { language: 'English', source: 'default' });
  assert.deepEqual(await resolveLanguage({ session }, fake(null, { fail: true })), { language: 'English', source: 'default' });
});

// The romanized-Hindi check runs for every language but German ("mein" is a German word).
const card = (text) => ({
  title: text, concept_key: 'c5-science-light', quick_answer: text, full_explanation: text, trap: text,
  illustration: { scene_prompt: 'a simple picture', labels: [] }, practice_question: text, check_question: text,
});
test('romanized Hindi is refused in English and Telugu replies, and allowed in German', () => {
  const leak = 'Agar light mein hai to shadow banta hai';
  for (const lang of ['English', 'Telugu', 'Hindi', '']) {
    const r = validateExplain(card(leak), { lang });
    assert.equal(r.ok, false, lang + ' leaked card must be refused');
    assert.ok(r.issues.some((i) => /Hindi written in English letters/.test(i)), lang + ': ' + r.issues.join('; '));
  }
  const de = validateExplain(card(leak), { lang: 'German' });
  assert.ok(de.ok || !de.issues.some((i) => /Hindi written in English letters/.test(i)));
});
