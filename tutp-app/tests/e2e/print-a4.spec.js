// Print layout of the story modal (docs/specs/print-a4-and-science-tryit.md).
//
//   node tests/e2e/print-a4.spec.js [--headless]
//   (npm run test:e2e runs it with the other specs; it needs no base URL)
//
// Serves public/ itself, loads story-modal.js and story-modal.css into a bare
// page, shows three stories through the modal's own submit path (a long
// science story with the library picture "chromosome", a maths story with a
// picture, a short story) and renders each to a PDF with the page's print
// styles, at A4 (the page's own @page size) and at Legal. The PDF is read
// back with tests/e2e/pdf-ink.js.
//   p1  chromosome at A4: at most 2 pages
//   p2  every page but the last is at most 40% empty (A4 and Legal, all stories)
//   p3  the Try Together answer is printed, below the scenes, even unrevealed;
//       no on-screen control is printed
//   p4  the picture block (picture + legend) is not split across pages and the
//       picture is at most 70 mm tall in print
// Output: tests/e2e/output/print-*.pdf and print-results.json. Exit 1 on any failure.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pdfPages } from './pdf-ink.js';
import { loadLibrary, buildLibraryVisual } from '../../server/image-library.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', '..', 'public');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const HEADLESS = true;
const results = [];
const PT_PER_MM = 72 / 25.4;
const MAX_EMPTY = 0.4;

const lib = loadLibrary();
const chromosomeVisual = buildLibraryVisual(lib, 'chromosome', 'English', new Set());

// Scenes are 3 sentences each, at the length the validator allows.
const STORIES = {
  chromosome: {
    title: 'Meera and the Two Matching Threads',
    gradeSubjectTag: 'Class 10 · Science · Chromosomes',
    readMinutes: 3,
    scenes: [
      { label: 'hook', text: 'Meera sat on the veranda in Guntur while her grandmother unrolled two matching skeins of red wool for the Sankranti kites. "Why do you always keep them tied in the middle?" Meera asked, and her grandmother smiled and said the knot was what kept the pair together.' },
      { label: 'problem', text: 'That night Meera read in her science book that every cell must copy its chromosomes before it divides, and she could not picture how one chromosome could become two without getting tangled. She worried that the copies would drift apart, and then each new cell would get the wrong amount of the cell\'s instructions.' },
      { label: 'mathMoment', text: 'Meera saw the picture on the next page: after copying, one chromosome is two identical sister chromatids joined at the centromere, like her grandmother\'s two skeins tied at the knot. The chromatids stay joined until the cell divides, and then the centromere lets go so each new cell gets exactly one chromatid, now called a chromosome.' },
      { label: 'wrapUp', text: 'Meera ran back to the veranda and tied her two kite strings together at one point, then pulled them apart one by one. "That is how a cell shares its instructions fairly," she told her grandmother, who laughed and handed her the bigger kite.' },
    ],
    visual: chromosomeVisual,
    equations: [],
    tryTogether: { question: 'A cell has 3 chromosomes and copies each of them before dividing. How many sister chromatids does the cell have now?', answer: '6 sister chromatids (2 for every chromosome).' },
    parentPrompt: 'Ask your child to show with two pieces of string tied in the middle what the centromere does, and to say what happens to the knot when the cell divides.',
  },
  maths: {
    title: 'Ravi and the Laddu Plates',
    gradeSubjectTag: 'Class 4 · Maths · Multiplication',
    readMinutes: 2,
    scenes: [
      { label: 'hook', text: 'Ravi helped his mother pack Diwali sweets in the kitchen in Hyderabad. There were four steel plates on the table and a big tray of laddus beside them.' },
      { label: 'problem', text: 'His aunt wanted the same number of laddus on every plate, but Ravi did not know how many laddus to put on each one. He had counted 24 laddus in all and did not want any plate to look smaller.' },
      { label: 'mathMoment', text: 'Ravi shared the laddus one by one until the tray was empty, and every plate had 6 laddus. So 4 groups of 6 make 24, and 4 × 6 = 24.' },
      { label: 'wrapUp', text: 'The plates looked beautiful and his aunt clapped. Ravi decided to check the count the next time with groups.' },
    ],
    visual: { type: 'groups', itemNoun: 'laddus', icon: '🟠', total: 24, groups: [6, 6, 6, 6] },
    equations: ['4 × 6 = 24', '24 ÷ 4 = 6'],
    tryTogether: { question: 'You pack 14 pencils in each of 6 boxes. How many pencils is that in all?', answer: '84 pencils (14 × 6 = 84).' },
    parentPrompt: 'Ask your child to share 12 small things between 3 plates and to say the multiplication.',
  },
  short: {
    title: 'Asha and the Rain',
    gradeSubjectTag: 'Class 3 · EVS · Weather',
    readMinutes: 1,
    scenes: [
      { label: 'hook', text: 'Asha watched dark clouds over the market.' },
      { label: 'problem', text: 'Her clothes were drying outside.' },
      { label: 'mathMoment', text: 'Clouds hold water that falls as rain.' },
      { label: 'wrapUp', text: 'She brought the clothes in just in time.' },
    ],
    visual: null,
    equations: [],
    tryTogether: { question: 'Name one thing that tells you rain is coming.', answer: 'Dark clouds.' },
    parentPrompt: 'Ask your child what they like to do on a rainy day.',
  },
};

function serve() {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.html': 'text/html' };
  const harness = (name) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>print ${name}</title>
<link rel="stylesheet" href="/css/story-modal.css"></head><body><main><p>Dashboard content that must not be printed.</p></main>
<script>
  window.attachFilePickerMulti = function () { return function () {}; };
  window.startStagedLoading = function () { return function () {}; };
  window.showFreeLimitModal = function () {};
  window.submitFeedback = function () {};
  window.callHomeworkApi = async function () { return window.__story; };
</script>
<script src="/app/shared/story-modal.js"></script></body></html>`;
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const m = /^\/harness\/(\w+)$/.exec(url);
    if (m) { res.setHeader('content-type', 'text/html'); return res.end(harness(m[1])); }
    const imglib = url.startsWith('/imglib/');
    const file = path.join(PUBLIC, url);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
    return imglib;
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function record(id, name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, ok: true, detail, ms: Date.now() - t });
    console.log(`PASS ${id} ${name}${detail ? ' - ' + detail : ''}`);
  } catch (e) {
    results.push({ id, name, ok: false, error: e.message, ms: Date.now() - t });
    console.log(`FAIL ${id} ${name} - ${e.message}`);
  }
}

// A story shown through the modal's own submit path, then rendered for print.
async function show(browser, base, key) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto(`${base}/harness/${key}`);
  await page.evaluate((s) => { window.__story = s; }, STORIES[key]);
  await page.evaluate(() => window.openStorytellingModal());
  await page.fill('#storyModalText', 'lesson text');
  await page.click('#storyModalSubmitBtn');
  await page.waitForSelector('#storyModalResults .sm-scene');
  if (STORIES[key].visual && STORIES[key].visual.type === 'library') {
    await page.waitForFunction(() => { const i = document.querySelector('.sm-lib-img'); return i && i.complete && i.naturalWidth > 0; });
  }
  return page;
}

async function pdfOf(page, name, format) {
  await page.evaluate(() => { document.documentElement.classList.add('sm-printing'); });
  await page.emulateMedia({ media: 'print' });
  const opts = format === 'A4' ? { preferCSSPageSize: true, printBackground: true } : { format, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } };
  const buf = await page.pdf(opts);
  fs.writeFileSync(path.join(OUT, `print-${name}-${format.toLowerCase()}.pdf`), buf);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => { document.documentElement.classList.remove('sm-printing'); });
  return pdfPages(buf);
}

// The share of a page's content area (inside the 12 mm margins) below the
// lowest drawn thing: 1 for a blank page, 0 for a full one.
const emptyShare = (p) => {
  if (p.minY == null) return 1;
  const margin = 12 * PT_PER_MM;
  const area = p.height - 2 * margin;
  const used = (p.height - margin) - p.minY;
  return Math.min(1, Math.max(0, 1 - used / area));
};

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: HEADLESS });
const pages = {};
try {
  for (const key of Object.keys(STORIES)) {
    const page = await show(browser, base, key);
    pages[key] = {};
    for (const format of ['A4', 'Legal']) pages[key][format] = await pdfOf(page, key, format);
    if (key === 'chromosome') {
      await record('p3', 'the answer is printed below the scenes, no control is printed', async () => {
        await page.evaluate(() => { document.documentElement.classList.add('sm-printing'); });
        await page.emulateMedia({ media: 'print' });
        const r = await page.evaluate(() => {
          const box = document.getElementById('storyModalResults');
          const shown = (sel) => { const e = box.querySelector(sel); return !!e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'; };
          const pa = box.querySelector('.sm-print-only'), scenes = box.querySelector('.sm-scenes'), ask = box.querySelector('.sm-ask');
          const pos = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
          const dash = document.querySelector('main');
          return {
            answer: pa ? pa.textContent : '', printed: shown('.sm-print-only'), below: pos(scenes, pa) && pos(ask, pa),
            screenAnswer: shown('.sm-answer'), reveal: shown('.sm-reveal'), bar: shown('.sm-bar'), audio: shown('.sm-audio'), again: shown('.sm-again'), feedback: shown('.sm-feedback'),
            dashboardPrinted: getComputedStyle(dash).display !== 'none', modalPosition: getComputedStyle(document.getElementById('storyModal')).position,
            panelOverflow: getComputedStyle(document.querySelector('.sm-panel')).overflowY,
          };
        });
        await page.emulateMedia({ media: 'screen' });
        await page.evaluate(() => { document.documentElement.classList.remove('sm-printing'); });
        expect(r.printed && r.answer.includes(STORIES.chromosome.tryTogether.answer), 'the answer is not in the print view: ' + JSON.stringify(r));
        expect(r.below, 'the answer is not after the scenes and the "Ask your child" card');
        expect(!r.screenAnswer && !r.reveal && !r.bar && !r.audio && !r.again && !r.feedback, 'a control is printed: ' + JSON.stringify(r));
        expect(!r.dashboardPrinted, 'the page behind the modal is printed');
        expect(r.modalPosition === 'static' && r.panelOverflow === 'visible', 'the modal is still a fixed scroll box in print: ' + JSON.stringify(r));
        return 'answer printed after the scenes and the card';
      });
      await record('p4', 'the picture block is whole on one page and the picture is at most 70 mm', async () => {
        await page.evaluate(() => { document.documentElement.classList.add('sm-printing'); });
        await page.emulateMedia({ media: 'print' });
        const r = await page.evaluate(() => {
          const img = document.querySelector('.sm-lib-img'), fig = document.querySelector('.sm-visual'), stage = document.querySelector('.sm-lib-stage');
          const mm = (px) => px * 25.4 / 96;
          return { imgMm: mm(img.getBoundingClientRect().height), figBreak: getComputedStyle(fig).breakInside, sceneBreak: getComputedStyle(document.querySelector('.sm-scene')).breakInside, stageW: stage.getBoundingClientRect().width, imgW: img.getBoundingClientRect().width };
        });
        await page.emulateMedia({ media: 'screen' });
        await page.evaluate(() => { document.documentElement.classList.remove('sm-printing'); });
        expect(r.imgMm <= 70.5, 'the picture is ' + r.imgMm.toFixed(1) + ' mm tall in print');
        expect(r.figBreak === 'avoid', 'the picture block can be split (break-inside ' + r.figBreak + ')');
        expect(r.sceneBreak !== 'avoid', 'a scene has break-inside avoid: scenes must flow');
        expect(Math.abs(r.stageW - r.imgW) < 2, 'the pins no longer sit on the picture: stage ' + r.stageW + ' px, picture ' + r.imgW + ' px');
        return 'picture ' + r.imgMm.toFixed(0) + ' mm, block avoid, scene ' + r.sceneBreak;
      });
    }
    await page.close();
  }

  await record('p1', 'chromosome at A4 is at most 2 pages', async () => {
    const n = pages.chromosome.A4.length;
    expect(n >= 1 && n <= 2, 'the chromosome story is ' + n + ' pages at A4');
    return n + ' page(s)';
  });
  await record('p2', 'no page but the last is more than 40% empty', async () => {
    const lines = [];
    for (const key of Object.keys(pages)) {
      for (const format of ['A4', 'Legal']) {
        const ps = pages[key][format];
        const shares = ps.map(emptyShare);
        ps.forEach((p, i) => {
          if (i < ps.length - 1) expect(shares[i] <= MAX_EMPTY, `${key} at ${format}: page ${i + 1} of ${ps.length} is ${(shares[i] * 100).toFixed(0)}% empty`);
        });
        lines.push(`${key}/${format}: ${ps.length}p [${shares.map((s) => (s * 100).toFixed(0) + '%').join(' ')}]`);
      }
    }
    return 'empty share per page: ' + lines.join('; ');
  });
} finally {
  await browser.close();
  server.close();
}

fs.writeFileSync(path.join(OUT, 'print-results.json'), JSON.stringify({ results, pages }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
