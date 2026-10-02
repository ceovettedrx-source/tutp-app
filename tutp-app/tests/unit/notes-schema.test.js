// Structured notes (notes-design-v2): validate, clamp, strip, fall back.
//   node --test tests/unit/notes-schema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotes, plainNotes, cleanText, NOTES_LIMITS_CHARS as L } from '../../server/notes-schema.js';
import { parseNotes } from '../../server/routes/chips.js';
import { notesPrompt } from '../../server/prompts/notes-prompts.js';

const full = () => ({
  title: 'Adding unlike fractions',
  key_idea: 'Make the bottoms equal, then add the tops.',
  method: ['Find a common bottom number', 'Change each fraction', 'Add the tops'],
  worked_example: { problem: '3/4 + 1/8', steps: ['3/4 = 6/8', '6/8 + 1/8 = 7/8'], answer: '7/8' },
  key_terms: [{ term: 'Denominator', meaning: 'the bottom number' }],
  common_mistakes: ['Adding the bottoms too'],
  remember: 'Same bottom first.',
  quick_check: [{ q: '1/2 + 1/4', a: '3/4' }, { q: '1/3 + 1/6', a: '1/2' }],
  tell_your_child: 'First make the bottoms the same. Then add the tops.',
});
const reply = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] });

test('a complete reply passes through with version 2', () => {
  const n = normalizeNotes(full());
  assert.equal(n.version, 2);
  assert.deepEqual(n.method.length, 3);
  assert.equal(n.worked_example.answer, '7/8');
  assert.equal(n.quick_check.length, 2);
  assert.equal(n.tell_your_child, 'First make the bottoms the same. Then add the tops.');
});

test('missing fields are omitted, never padded', () => {
  const n = normalizeNotes({ key_idea: 'Only an idea.' });
  assert.deepEqual(n, { version: 2, key_idea: 'Only an idea.' });
  const m = normalizeNotes({ method: ['one', 'two'], key_terms: [], common_mistakes: [''], quick_check: [{ q: 'x' }] });
  assert.deepEqual(Object.keys(m).sort(), ['method', 'version']);
});

test('no key idea and no method is not structured', () => {
  assert.equal(normalizeNotes({ title: 'T', remember: 'r' }), null);
  assert.equal(normalizeNotes(null), null);
  assert.equal(normalizeNotes([]), null);
  assert.equal(normalizeNotes('text'), null);
});

test('lists are capped: method 5, terms 4, mistakes 3, quick check 2, example steps 5', () => {
  const o = full();
  o.method = Array.from({ length: 9 }, (_, i) => 'step ' + i);
  o.key_terms = Array.from({ length: 9 }, (_, i) => ({ term: 't' + i, meaning: 'm' }));
  o.common_mistakes = ['a', 'b', 'c', 'd', 'e'];
  o.quick_check = [1, 2, 3, 4].map((i) => ({ q: 'q' + i, a: 'a' + i }));
  o.worked_example.steps = Array.from({ length: 8 }, (_, i) => 's' + i);
  const n = normalizeNotes(o);
  assert.deepEqual([n.method.length, n.key_terms.length, n.common_mistakes.length, n.quick_check.length, n.worked_example.steps.length], [5, 4, 3, 2, 5]);
});

test('strings are clamped at a word boundary', () => {
  const long = 'word '.repeat(200);
  const s = cleanText(long, L.keyIdea);
  assert.ok(s.length <= L.keyIdea + 1);
  assert.ok(s.endsWith('…'));
  assert.ok(!/wor…$/.test(s));
  assert.equal(cleanText('short', 50), 'short');
});

test('tags, LaTeX markers and control characters are stripped', () => {
  assert.equal(cleanText('<b>Add</b> the <script>alert(1)</script>tops', 100), 'Add the alert(1) tops');
  assert.equal(cleanText('$\\frac{3}{4}$ plus \\(1/8\\)', 100), '3/4 plus 1/8');
  assert.equal(cleanText('2 \\times 3 \\div 1', 100), '2 × 3 ÷ 1');
  assert.equal(cleanText('a\u0000b\nc', 100), 'a b c');
  const n = normalizeNotes({ key_idea: '<img src=x onerror=alert(1)>Idea', method: ['<i>one</i>'] });
  assert.ok(!/[<>]/.test(JSON.stringify(n)));
});

test('numbers are accepted as strings, other types are dropped', () => {
  assert.equal(cleanText(7, 10), '7');
  assert.equal(cleanText({ a: 1 }, 10), '');
  assert.equal(cleanText(null, 10), '');
  const n = normalizeNotes({ key_idea: 'x', method: [1, null, {}, 'real'], worked_example: { problem: 'p', steps: [], answer: 7 } });
  assert.deepEqual(n.method, ['1', 'real']);
  assert.equal(n.worked_example.answer, '7');
});

test('an example needs a problem and a step or an answer', () => {
  assert.equal(normalizeNotes({ key_idea: 'x', worked_example: { steps: ['s'] } }).worked_example, undefined);
  assert.equal(normalizeNotes({ key_idea: 'x', worked_example: { problem: 'p' } }).worked_example, undefined);
});

test('parseNotes: structured, plain fallback, null', () => {
  assert.equal(parseNotes(reply(full())).version, 2);
  assert.equal(parseNotes(reply('Sure! ```json\n' + JSON.stringify(full()) + '\n```')).version, 2);
  assert.deepEqual(parseNotes(reply({ subject: 'Math', notes: ['a', 'b'] })), { plain: ['a', 'b'], subject: 'Math' });
  assert.equal(parseNotes(reply('{"title":"x"')), null);
  assert.equal(parseNotes(reply('{}')), null);
  assert.equal(parseNotes({ content: [] }), null);
});

test('plainNotes: strings only, bounded', () => {
  const p = plainNotes({ title: 'T', remember: 'r', extra: { deep: ['x'] } });
  assert.ok(p.plain.length >= 2);
  assert.equal(plainNotes({}), null);
});

test('prompt: JSON shape, language, no HTML, no invented curriculum', () => {
  const p = notesPrompt({ lang: 'Telugu', childContext: 'Asha · Class 5' });
  for (const k of ['title', 'key_idea', 'method', 'worked_example', 'key_terms', 'common_mistakes', 'remember', 'quick_check', 'tell_your_child']) assert.ok(p.includes(k), k);
  assert.ok(p.includes('Telugu') && p.includes('Asha'));
  assert.ok(/No LaTeX and no HTML/.test(p));
  assert.ok(/do not invent/i.test(p));
});
