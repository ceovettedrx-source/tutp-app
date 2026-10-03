// Unit tests for server/chips/intent.js (rules classifier) and chip-config.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent } from '../../server/chips/intent.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleChips, chipPayload, CHIPS, CAPABILITIES } from '../../server/chips/chip-config.js';

const cases = [
  // English
  ['answer please', 'answer'], ['Answer the questions', 'answer'], ['solve these', 'answer'],
  ['explain please', 'explain'], ['why is the sky blue', 'explain'],
  ['notes please', 'notes'], ['short notes', 'notes'], ['summarise this chapter', 'notes'],
  ['exam preparation notes', 'exam_prep'], ['exam prep notes', 'exam_prep'],
  ['explain notes', 'notes'], ['answer and explain', 'explain'],
  ['quiz me', 'quiz'],
  // Telugu
  ['సమాధానం చెప్పండి', 'answer'], ['సమాధానాలు ఇవ్వండి', 'answer'],
  ['వివరించండి', 'explain'], ['నోట్స్ ఇవ్వండి', 'notes'], ['పరీక్ష తయారీ', 'exam_prep'],
  // Hindi
  ['जवाब बताइए', 'answer'], ['समझाइए', 'explain'], ['नोट्स दीजिए', 'notes'], ['परीक्षा की तैयारी', 'exam_prep'],
  // transliterated
  ['samadhanam cheppandi', 'answer'], ['jawab batao', 'answer'], ['samjhao please', 'explain'],
  ['vivarinchandi', 'explain'], ['pariksha notes', 'exam_prep'], ['nots pls', 'notes'],
];
for (const [text, want] of cases) {
  test(`classify "${text}" -> ${want}`, () => assert.equal(classifyIntent(text), want));
}

test('a short instruction nobody listed is other', () => {
  assert.equal(classifyIntent('draw a cat'), 'other');
  assert.equal(classifyIntent('24 + 13 = ?'), 'other');
});

test('nothing typed, or text too long to be an instruction, is none', () => {
  assert.equal(classifyIntent(''), 'none');
  assert.equal(classifyIntent(null), 'none');
  assert.equal(classifyIntent('   '), 'none');
  assert.equal(classifyIntent('Please explain the following paragraph about photosynthesis in plants and how leaves make food using sunlight'), 'none');
});

test('visible chips: exam_prep stays hidden until its flag is on, notes is shown', () => {
  const ids = visibleChips().map((c) => c.id);
  assert.deepEqual(ids, ['answer', 'explain', 'notes']);
  assert.equal(CAPABILITIES.exam_prep, false);
  assert.ok(visibleChips({ ...CAPABILITIES, exam_prep: true }).some((c) => c.id === 'exam_prep'));
  assert.ok(!chipPayload().chips.some((c) => c.id === 'exam_prep'));
});

// The page's text table (public/app/shared/search-chips.js) is a plain script
// that sets window.TUTP_CHIP_MESSAGES: load it with a fake window.
function loadMessages() {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'app', 'shared', 'search-chips.js'), 'utf8');
  const window = {};
  new Function('window', 'document', src.slice(0, src.indexOf('(function () {')))(window, {});
  return window.TUTP_CHIP_MESSAGES;
}

test('every chip is { id, intent, i18nKey, flag } and has text in en, te and hi', () => {
  const msgs = loadMessages();
  for (const c of CHIPS) {
    assert.deepEqual(Object.keys(c).sort(), ['flag', 'i18nKey', 'id', 'intent']);
    for (const lang of ['en', 'te', 'hi']) assert.ok(msgs[lang][c.i18nKey], `${lang} ${c.i18nKey}`);
  }
  assert.equal(msgs.en['chip.answer'], 'Answer please');
  assert.equal(msgs.en['chip.explain'], 'Explain please');
  assert.equal(msgs.en['chip.notes'], 'Notes please');
  assert.equal(msgs.en['chip.exam_prep'], 'Exam prep');
});

test('every string the chip script shows exists in en, te and hi with the same keys', () => {
  const msgs = loadMessages();
  const keys = Object.keys(msgs.en).sort();
  assert.ok(keys.includes('chip.retry') && keys.includes('chip.notesFailed') && keys.includes('chip.makingNotes') && keys.includes('chip.group'));
  for (const lang of ['te', 'hi']) assert.deepEqual(Object.keys(msgs[lang]).sort(), keys, lang);
  const script = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'app', 'shared', 'search-chips.js'), 'utf8');
  const used = [...script.matchAll(/labelFor\('([\w.]+)'\)/g)].map((m) => m[1]);
  for (const k of used) assert.ok(keys.includes(k), 'missing key ' + k);
  assert.ok(!/textContent = '[A-Za-z]/.test(script), 'a literal English string is set on the page');
});
