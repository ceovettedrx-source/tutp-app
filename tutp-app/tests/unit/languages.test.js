// One language list for the whole app, and every surface has what each language needs (TUT-19).
//   node --test tests/unit/languages.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { HOMEWORK_LANGUAGES } from '../../server/prompts/homework-prompts.js';
import { fontFor, scriptOf } from '../../server/lang-fonts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODES = { English: 'en', Hindi: 'hi', Telugu: 'te', Tamil: 'ta', Marathi: 'mr', Spanish: 'es', French: 'fr', German: 'de', Arabic: 'ar' };

// Run a plain browser script in a sandbox and give back the window.
function sandbox(file) {
  const win = { addEventListener() {}, localStorage: null };
  win.window = win;
  const doc = { getElementById: () => null, createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, addEventListener() {} };
  const ctx = vm.createContext({ window: win, document: doc, navigator: { languages: ['en'] }, console, sessionStorage: { getItem: () => null } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  return win;
}

test('the chips log uses the app\'s one language list', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/chips/log.js'), 'utf8');
  assert.match(src, /const LANGUAGES = HOMEWORK_LANGUAGES/);
  assert.ok(!/'Hindi', 'Telugu'/.test(src), 'a second hand-typed list is back');
});

test('the code table in this test covers every language in HOMEWORK_LANGUAGES (a new language fails here first)', () => {
  assert.deepEqual([...HOMEWORK_LANGUAGES].sort(), Object.keys(CODES).sort());
});

test('notes-card has all eleven headings for every language', () => {
  const w = sandbox('public/app/shared/notes-card.js');
  const keys = Object.keys(w.TUTP_NOTES_MESSAGES.en);
  assert.equal(keys.length, 11);
  for (const name of HOMEWORK_LANGUAGES) {
    const t = w.TUTP_NOTES_MESSAGES[CODES[name]];
    assert.ok(t, name + ' has no notes headings');
    for (const k of keys) assert.ok(t[k] && t[k].length > 0, `${name} lacks ${k}`);
  }
});

test('explain-panel chrome strings exist for every language', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/app/shared/explain-panel.js'), 'utf8');
  const m = src.match(/var MSG = (\{[\s\S]*?\n    \});/);
  assert.ok(m, 'MSG table not found');
  const MSG = vm.runInNewContext('(' + m[1] + ')');
  for (const name of HOMEWORK_LANGUAGES) {
    const t = MSG[CODES[name]];
    assert.ok(t, name);
    for (const k of ['checked', 'answer', 'remember', 'couldNot']) assert.ok(t[k], `${name} lacks ${k}`);
  }
});

test('every non-Latin language has a font for its script', () => {
  const sample = { Hindi: 'हिंदी', Telugu: 'తెలుగు', Tamil: 'தமிழ்', Marathi: 'मराठी', Arabic: 'العربية' };
  for (const [name, text] of Object.entries(sample)) {
    assert.ok(HOMEWORK_LANGUAGES.includes(name));
    assert.ok(fontFor(scriptOf(text)), name + ' has no font');
  }
});

test('the feature inventory names every surface the app has and every language comes from the code', () => {
  const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/e2e/inventory.json'), 'utf8'));
  for (const s of ['answer', 'explain', 'notes', 'story', 'el']) {
    assert.ok(inv.surfaces[s], 'inventory has no entry for ' + s);
    assert.ok(Array.isArray(inv.surfaces[s].required) && inv.surfaces[s].required.length, s + ' lists no required element');
  }
  assert.equal(inv.languages, 'from-code');
});
