// Story image library, run-time side: candidate lookup, legend language
// fallback, the hide rule (3 families, 30 days), the cache, and validateStory
// accepting only offered, approved ids.
//   node --test tests/unit/image-library.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatesFor, buildLibraryVisual, hiddenFromReports, createHiddenCache, classNumber, storyLibraryContext, promptLine, loadLibrary, MAX_CANDIDATES,
} from '../../server/image-library.js';
import { validateStory } from '../../server/story-schema.js';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';
import { systemText } from '../../server/prompt-cache.js';

const img = (id, over = {}) => ({
  id, status: 'approved', subject: 'Science', classMin: 8, classMax: 12, description: `about ${id}`, alt: `alt ${id}`, file: `${id}.webp`,
  aliases: { en: [id.replace(/-/g, ' ')], te: [], hi: [], ta: [] },
  anchors: [{ key: 'nucleus', x: 0.5, y: 0.4 }, { key: 'nope', x: 0.1, y: 0.1 }, { key: 'dna', x: 0.2, y: 0.8 }],
  ...over,
});
const lib = {
  images: [
    img('animal-cell', { aliases: { en: ['animal cell', 'cell membrane', 'cell'], te: ['జంతు కణం'], hi: ['कोशिका'], ta: [] } }),
    img('human-eye', { aliases: { en: ['eye', 'retina'], te: [], hi: [], ta: [] }, classMin: 6, classMax: 10 }),
    img('hidden-one', { status: 'hidden', aliases: { en: ['volcano'], te: [], hi: [], ta: [] } }),
  ],
  glossary: {
    nucleus: { en: 'Nucleus', te: 'కేంద్రకం', hi: 'केंद्रक' },
    dna: { en: 'DNA', hi: 'डीएनए' },
  },
};

test('classNumber reads the class from a text', () => {
  assert.equal(classNumber('Class 5'), 5);
  assert.equal(classNumber('7th'), 7);
  assert.equal(classNumber('Grade 12 · CBSE'), 12);
  assert.equal(classNumber('nursery'), null);
  assert.equal(classNumber(null), null);
  assert.equal(classNumber('Class 40'), null);
});

test('candidates: aliases in any language, whole words, best first', () => {
  assert.deepEqual(candidatesFor(lib, { text: 'The animal cell has a cell membrane', classNum: 9 }).map((c) => c.id), ['animal-cell']);
  assert.deepEqual(candidatesFor(lib, { text: 'జంతు కణం గురించి', classNum: 9 }).map((c) => c.id), ['animal-cell']);
  assert.deepEqual(candidatesFor(lib, { text: 'कोशिका', classNum: 9 }).map((c) => c.id), ['animal-cell']);
  // "eye" must not match inside "they"; plural "eyes" does match
  assert.deepEqual(candidatesFor(lib, { text: 'they said hello', classNum: 8 }), []);
  assert.deepEqual(candidatesFor(lib, { text: 'both eyes', classNum: 8 }).map((c) => c.id), ['human-eye']);
});

test('candidates: hidden and unapproved images are never offered; the class only ranks typed-text matches', () => {
  assert.deepEqual(candidatesFor(lib, { text: 'a volcano erupts', classNum: 9 }), []);
  assert.deepEqual(candidatesFor(lib, { text: 'animal cell', classNum: 9, hidden: new Set(['animal-cell']) }), []);
  assert.equal(candidatesFor(lib, { text: 'animal cell', classNum: 3 }).length, 1);    // outside the class range: still offered
  assert.equal(candidatesFor(lib, { text: 'animal cell', classNum: null }).length, 1); // class unknown
  // same score, the class-fitting image comes first
  const two = { images: [img('b-one', { aliases: { en: ['light'], te: [], hi: [], ta: [] }, classMin: 1, classMax: 3 }), img('a-two', { aliases: { en: ['light'], te: [], hi: [], ta: [] } })], glossary: {} };
  assert.deepEqual(candidatesFor(two, { text: 'light', classNum: 9 }).map((c) => c.id), ['a-two', 'b-one']);
});

test('candidates: no typed text offers the class-fitting images (2 classes slack); never more than 15', () => {
  assert.deepEqual(candidatesFor(lib, { text: '', classNum: 9 }).map((c) => c.id), ['animal-cell', 'human-eye']);
  assert.deepEqual(candidatesFor(lib, { text: '', classNum: 3 }).map((c) => c.id), []);          // 3 < 6 - 2
  assert.deepEqual(candidatesFor(lib, { text: '', classNum: 4 }).map((c) => c.id), ['human-eye']); // within the slack of 6..10
  assert.equal(candidatesFor(lib, { text: '', classNum: null }).length, 2);
  const many = { images: Array.from({ length: 30 }, (_, i) => img(`img-${String(i).padStart(2, '0')}`)), glossary: {} };
  assert.equal(candidatesFor(many, { text: '', classNum: 9 }).length, MAX_CANDIDATES);
  const matching = { images: Array.from({ length: 30 }, (_, i) => img(`img-${i}`, { aliases: { en: ['photo'], te: [], hi: [], ta: [] } })), glossary: {} };
  assert.equal(candidatesFor(matching, { text: 'a photo', classNum: 9 }).length, MAX_CANDIDATES);
});

test('library visual: legend in the story language, English source in brackets, English fallback', () => {
  const te = buildLibraryVisual(lib, 'animal-cell', 'Telugu');
  assert.equal(te.type, 'library');
  assert.equal(te.src, '/imglib/animal-cell.webp');
  assert.equal(te.alt, 'alt animal-cell');
  // 'nope' has no glossary entry: its pin is left out; dna has no Telugu: English, no brackets
  assert.deepEqual(te.labels, [
    { n: 1, x: 0.5, y: 0.4, term: 'కేంద్రకం', source: 'Nucleus' },
    { n: 2, x: 0.2, y: 0.8, term: 'DNA', source: '' },
  ]);
  const hi = buildLibraryVisual(lib, 'animal-cell', 'Hindi');
  assert.equal(hi.labels[1].term, 'डीएनए');
  assert.equal(hi.labels[1].source, 'DNA');
  const mr = buildLibraryVisual(lib, 'animal-cell', 'Marathi');      // no glossary language: English
  assert.deepEqual(mr.labels.map((l) => [l.term, l.source]), [['Nucleus', ''], ['DNA', '']]);
});

test('library visual: null for an unknown, unapproved or hidden id', () => {
  assert.equal(buildLibraryVisual(lib, 'nothing', 'English'), null);
  assert.equal(buildLibraryVisual(lib, 'hidden-one', 'English'), null);
  assert.equal(buildLibraryVisual(lib, 'animal-cell', 'English', new Set(['animal-cell'])), null);
});

const NOW = Date.parse('2026-10-03T00:00:00Z');
const row = (fam, id, daysAgo) => ({ family_id: fam, properties: { image_id: id }, created_at: new Date(NOW - daysAgo * 86400000).toISOString() });

test('hide rule: 3 distinct families in 30 days', () => {
  assert.deepEqual([...hiddenFromReports([row(1, 'a', 1), row(2, 'a', 2), row(3, 'a', 3)], { now: NOW })], ['a']);
  // the same family three times is one family
  assert.deepEqual([...hiddenFromReports([row(1, 'a', 1), row(1, 'a', 2), row(1, 'a', 3)], { now: NOW })], []);
  // two families only
  assert.deepEqual([...hiddenFromReports([row(1, 'a', 1), row(2, 'a', 2)], { now: NOW })], []);
  // one report is older than 30 days
  assert.deepEqual([...hiddenFromReports([row(1, 'a', 1), row(2, 'a', 2), row(3, 'a', 31)], { now: NOW })], []);
  // another image is counted on its own
  assert.deepEqual([...hiddenFromReports([row(1, 'a', 1), row(2, 'a', 1), row(3, 'b', 1)], { now: NOW })], []);
  // rubbish rows are ignored
  assert.deepEqual([...hiddenFromReports([null, {}, row(null, 'a', 1), { family_id: 1, properties: {}, created_at: 'x' }], { now: NOW })], []);
});

test('hide rule: reports from before the image was regenerated do not count', () => {
  const rows = [row(1, 'a', 10), row(2, 'a', 9), row(3, 'a', 8)];
  assert.deepEqual([...hiddenFromReports(rows, { now: NOW, notBefore: { a: NOW - 5 * 86400000 } })], []);
  assert.deepEqual([...hiddenFromReports(rows, { now: NOW, notBefore: { a: NOW - 20 * 86400000 } })], ['a']);
});

test('hidden cache: one lookup per ttl, invalidate forces a new one, a failed lookup keeps the last set', async () => {
  let t = 1000, calls = 0, fail = false;
  const rows = [row(1, 'a', 1), row(2, 'a', 1), row(3, 'a', 1)];
  const cache = createHiddenCache({
    ttlMs: 5 * 60 * 1000, now: () => NOW + t,
    fetchRows: async () => { calls++; if (fail) throw new Error('db down'); return rows; },
  });
  assert.deepEqual([...await cache.get()], ['a']);
  await cache.get(); await cache.get();
  assert.equal(calls, 1);
  t += 6 * 60 * 1000;
  await cache.get();
  assert.equal(calls, 2);
  cache.invalidate();
  await cache.get();
  assert.equal(calls, 3);
  fail = true;
  cache.invalidate();
  assert.deepEqual([...await cache.get()], ['a']);   // kept
});

const story = (visual) => ({
  title: 'Meena and the cell', gradeSubjectTag: 'Class 8 · Science · Cells', readMinutes: 2,
  scenes: [
    { label: 'hook', text: 'Meena looked at a drop of water through the school microscope.' },
    { label: 'problem', text: 'She could not tell what the tiny round thing was.' },
    { label: 'mathMoment', text: 'Her teacher said it is a cell, and the nucleus is its control room.' },
    { label: 'wrapUp', text: 'Meena smiled: now she knew.' },
  ],
  visual, equations: [], tryTogether: { question: 'What is the control room of a cell called?', answer: 'The nucleus' }, parentPrompt: 'Ask what the nucleus does.',
});
const ctx = () => ({ library: storyLibraryContext(lib, { text: 'animal cell nucleus', classNum: 8, langName: 'Telugu' }) });

test('validateStory keeps an offered library id and drops everything else', () => {
  const ok = validateStory(story({ type: 'library', id: 'animal-cell' }), ctx());
  assert.equal(ok.ok, true);
  assert.equal(ok.visualSource, 'library');
  assert.equal(ok.story.visual.type, 'library');
  assert.equal(ok.story.visual.labels[0].term, 'కేంద్రకం');
  // not offered (human-eye is a real approved image, but not a candidate for this lesson)
  const notOffered = validateStory(story({ type: 'library', id: 'human-eye' }), ctx());
  assert.equal(notOffered.story.visual, null);
  assert.equal(notOffered.visualSource, 'none');
  assert.equal(notOffered.fixed, 1);
  // an invented id, a hidden image, a missing id, no library at all
  assert.equal(validateStory(story({ type: 'library', id: 'made-up' }), ctx()).story.visual, null);
  assert.equal(validateStory(story({ type: 'library', id: 'hidden-one' }), ctx()).story.visual, null);
  assert.equal(validateStory(story({ type: 'library' }), ctx()).story.visual, null);
  assert.equal(validateStory(story({ type: 'library', id: 'animal-cell' })).story.visual, null);
  // an image that was hidden after the prompt was built is dropped too
  const late = storyLibraryContext(lib, { text: 'animal cell', classNum: 8, langName: 'English' });
  late.build = (id) => buildLibraryVisual(lib, id, 'English', new Set(['animal-cell']));
  assert.equal(validateStory(story({ type: 'library', id: 'animal-cell' }), { library: late }).story.visual, null);
});

test('prompt: only the candidates are offered; none means no library rule; scene 3 and conflict rules', () => {
  const cands = candidatesFor(lib, { text: 'animal cell', classNum: 8 }).map(promptLine);
  const withLib = systemText(buildHomeworkRequest({ feature: 'storytelling', lang: 'Telugu', childContext: 'Asha · Class 8', text: 'animal cell', attachments: [], libraryCandidates: cands }).system);
  assert.match(withLib, /LIBRARY PICTURES/);
  assert.match(withLib, /animal-cell: about animal-cell/);
  assert.doesNotMatch(withLib, /human-eye/);
  const without = systemText(buildHomeworkRequest({ feature: 'storytelling', lang: 'Telugu', childContext: 'Asha · Class 8', text: 'volcano', attachments: [] }).system);
  assert.doesNotMatch(without, /LIBRARY PICTURES/);
  for (const p of [withLib, without]) {
    assert.match(p, /simple the parent language/);
    assert.match(p, /The parent language is Telugu/);
    assert.match(p, /never a pasted textbook paragraph/);
    assert.match(p, /conflict/);
    assert.match(p, /resolution/);
    assert.match(p, /"type":"venn"/);
  }
});

test('the hand-written e2e replies (tests/e2e/recordings-handwritten.mjs) pass the story checks and exist on disk', async () => {
  const fs = await import('node:fs');
  const { TOPICS, STORIES, keyFor } = await import('../e2e/recordings-handwritten.mjs');
  const real = loadLibrary();
  const expected = { library: 'library', invented: 'none', venn: 'model', bar: 'model', chain: 'derived' };
  for (const [name, topic] of Object.entries(TOPICS)) {
    assert.ok(fs.existsSync(new URL(`../e2e/recordings/${keyFor(topic)}.json`, import.meta.url)), `${name}: recording file (run node tests/e2e/recordings-handwritten.mjs)`);
    const c = storyLibraryContext(real, { text: topic, classNum: 5, langName: 'English' });
    const r = validateStory(STORIES[name], { library: c });
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.issues)}`);
    assert.equal(r.visualSource, expected[name], name);
  }
  // the topic of the library story really offers the chromosome picture, the invented-id topic offers it too but not the eye
  const offered = (t) => storyLibraryContext(real, { text: t, classNum: 5, langName: 'English' }).candidates.map((x) => x.id);
  assert.deepEqual(offered(TOPICS.library), ['chromosome']);
  assert.deepEqual(offered(TOPICS.invented), ['chromosome']);
});

test('the shipped library loads and every approved image has its file, anchors in range and glossary names', async () => {
  const fs = await import('node:fs');
  const real = loadLibrary();
  for (const m of real.images.filter((i) => i.status === 'approved')) {
    assert.ok(fs.existsSync(new URL(`../../public/imglib/${m.file}`, import.meta.url)), `${m.id} file`);
    assert.ok(m.anchors.length >= 1, `${m.id} anchors`);
    for (const a of m.anchors) {
      assert.ok(a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1, `${m.id} ${a.key} in range`);
      assert.ok(real.glossary[a.key] && real.glossary[a.key].en, `${m.id} ${a.key} in glossary`);
    }
    assert.ok(m.alt && m.description, `${m.id} alt`);
    assert.equal(m.review.claude, true);
  }
});
