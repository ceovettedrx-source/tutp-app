// Writes tests/e2e/recordings/yt-fixture.json: hand-written YouTube answers
// for the 12 Guided Discovery concepts (see server/video/fixtures.js).
//   node tests/e2e/fixtures/make-yt-fixture.js
// Per concept: 2 Telugu (one with description chapters, one with a Gemini-style
// segment), 2 English (one with chapters, one with no segment at all, for the
// "missing segment falls back to the full video" test), 1 best-in-world (Hindi,
// chapters) and 1 video the review must reject. Ids are fake test ids.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONCEPTS } from '../../../server/el/concepts.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'recordings', 'yt-fixture.json');
const chapters = (title) => `In this video we look at ${title}.\n0:00 Introduction\n1:00 ${title} explained\n4:30 Summary and quick quiz\n`;

const out = {};
CONCEPTS.forEach((c, i) => {
  const n = String(i + 1).padStart(2, '0');
  const mk = (k, language, title, description, extra = {}) => ({
    id: `fxt${n}${k}`.padEnd(11, 'x'), title, channel: 'Test Channel ' + k, duration: 600, description, language, ...extra,
  });
  out[c.id] = [
    mk('a', 'te', `${c.title} (Telugu)`, chapters(c.title)),
    mk('b', 'te', `${c.title} experiment (Telugu)`, 'A short experiment.', { fixtureSegment: { start: 40, end: 240, moments: [{ t: 40, label: 'The set-up' }, { t: 140, label: 'What happens' }] } }),
    mk('c', 'en', `${c.title} for Class ${c.grade}`, chapters(c.title)),
    mk('d', 'en', `${c.title} quick demo`, 'A short demo with no chapters.'),
    mk('e', 'hi', `${c.title} (best in the world)`, chapters(c.title), { best: true }),
    mk('f', 'en', `REJECT ${c.title} prank video`, 'Off topic.'),
  ];
});
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', OUT, Object.keys(out).length, 'concepts');
