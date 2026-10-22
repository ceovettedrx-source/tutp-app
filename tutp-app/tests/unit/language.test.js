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

// ---- per-parent language (feat/parent-language) ----
import { parentLanguageOf, applyRegistrationLanguage, saveParentLanguage } from '../../server/language.js';

// family_registrations rows by id, usage_events as before; records updates.
const db = ({ families = {}, events = [] } = {}) => {
  const updates = [];
  return {
    updates,
    from(table) {
      const q = { _id: null };
      q.select = () => q; q.eq = (c, v) => { if (c === 'id') q._id = v; return q; }; q.order = () => q;
      q.limit = () => Promise.resolve({ data: events, error: null });
      q.maybeSingle = () => Promise.resolve({ data: families[q._id] ? { data: families[q._id] } : null, error: null });
      q.update = (patch) => ({ eq: (c, id) => { updates.push([table, id, patch]); families[id] = patch.data; return Promise.resolve({ error: null }); } });
      return q;
    },
  };
};
const asMother = async () => ['mother'];

test('a chosen parent language beats the family\'s last used, and the page still beats both', async () => {
  const c = db({ families: { 6: { mother: { language: 'Telugu' }, father: { language: 'Hindi' } } }, events: [{ properties: { language: 'Tamil' } }] });
  assert.deepEqual(await resolveLanguage({ session, requested: '' }, c, asMother), { language: 'Telugu', source: 'parent' });
  assert.deepEqual(await resolveLanguage({ session, requested: 'Hindi' }, c, asMother), { language: 'Hindi', source: 'page' });
  assert.deepEqual(await resolveLanguage({ session }, c, async () => ['father']), { language: 'Hindi', source: 'parent' });
});

test('each parent keeps their own language; a family member and a parent with none fall through', async () => {
  const c = db({ families: { 6: { mother: { language: 'Telugu' }, father: { name: 'Ravi' } } }, events: [{ properties: { language: 'Tamil' } }] });
  assert.equal(await parentLanguageOf(session, c, async () => ['family_member']), '');
  assert.deepEqual(await resolveLanguage({ session }, c, async () => ['father']), { language: 'Tamil', source: 'last' });
  assert.equal(await parentLanguageOf(session, c, async () => { throw new Error('x'); }), '');
});

test('a stored language that is not in the list is ignored', async () => {
  const c = db({ families: { 6: { mother: { language: 'Klingon' } } } });
  assert.equal(await parentLanguageOf(session, c, asMother), '');
});

test('registration: the language goes to the parent whose phone was verified, nothing else is kept', () => {
  const p = applyRegistrationLanguage({ parent_language: 'Telugu', mother: { phone: '+91 99999 00001', language: 'Hindi' }, father: { phone: '9999900002', language: 'Tamil' } }, '9999900001');
  assert.equal(p.mother.language, 'Telugu');
  assert.equal(p.father.language, undefined);
  assert.equal('parent_language' in p, false);
  const q = applyRegistrationLanguage({ parent_language: 'Klingon', mother: { phone: '9999900001' } }, '9999900001');
  assert.equal(q.mother.language, undefined);
  const r = applyRegistrationLanguage({ parent_language: 'Telugu', mother: { phone: '9999900001' } }, '9999900009');
  assert.equal(r.mother.language, undefined);
  assert.deepEqual(applyRegistrationLanguage({}, '1'), {});
});

test('saving: only a parent, only a listed language, and only that parent\'s slot changes', async () => {
  const c = db({ families: { 6: { mother: { name: 'Asha', phone: '1' }, father: { name: 'Ravi', language: 'Hindi' } } } });
  assert.equal((await saveParentLanguage({ client: c, familyId: 6, role: 'family_member', language: 'Telugu' })).status, 403);
  assert.equal((await saveParentLanguage({ client: c, familyId: 6, role: 'mother', language: 'Klingon' })).status, 400);
  assert.equal((await saveParentLanguage({ client: c, familyId: 99, role: 'mother', language: 'Telugu' })).status, 404);
  assert.equal(c.updates.length, 0);
  assert.deepEqual(await saveParentLanguage({ client: c, familyId: 6, role: 'mother', language: 'Telugu' }), { ok: true, language: 'Telugu' });
  const saved = c.updates[0][2].data;
  assert.deepEqual(saved.mother, { name: 'Asha', phone: '1', language: 'Telugu' });
  assert.deepEqual(saved.father, { name: 'Ravi', language: 'Hindi' });
});
