// Generates the two synthetic worksheet photos used by visual-tutor.spec.js:
//   worksheet-blank.jpg      printed sheet, no answers
//   worksheet-5-wrong.jpg    same sheet, 8 handwritten answers, 5 of them wrong
// Everything is made up: no names (the Name line is left empty), no school,
// no logos or watermarks. Printed text uses Arial; answers use the Windows
// handwriting-style fonts Ink Free / Segoe Print (fallback Comic Sans MS),
// so run this on Windows to reproduce the committed images exactly.
// "Phone photo" look: slight rotation, uneven lighting, a little blur and a
// seeded pixel noise (same noise every run).
//
//   node tests/e2e/fixtures/generate-worksheets.js
//   node tests/e2e/fixtures/generate-worksheets.js --rows
//   node tests/e2e/fixtures/generate-worksheets.js --sheet12
//   node tests/e2e/fixtures/generate-worksheets.js --sheet4
// --sheet4 writes worksheet-4.jpg and worksheet-4-rows.json only: the first
// four problems of the 8-problem sheet (rows 2 and 3 wrong), for the live
// smoke set.
// --sheet12 writes worksheet-12.jpg and worksheet-12-rows.json only: a denser
// sheet closer to a real one (round B2, 2026-09-28): an instruction line and
// a printed worked example above 12 problems, rows about 2/3 as tall, a
// slight perspective tilt and a shadow across one corner; 5 answers wrong.
// --rows writes only worksheet-rows.json (the images are left alone): where
// each problem row sits on the sheet, in 0..1000 of the image, for the
// "Show on photo" and "Check mistakes" tests in homework.spec.js. The rows
// are rotated with the paper, so each entry is the axis-aligned box around
// the rotated row.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// question, handwritten answer, correct answer
const PROBLEMS = [
  ['24 + 13 =', '37', '37'],
  ['45 − 18 =', '33', '27'],   // subtracted the smaller digit from the larger
  ['56 + 27 =', '73', '83'],   // forgot to carry
  ['90 − 42 =', '48', '48'],
  ['7 × 8 =', '54', '56'],
  ['63 − 29 =', '46', '34'],
  ['15 + 38 =', '53', '53'],
  ['72 ÷ 8 =', '8', '9'],
];

function html({ withAnswers, problems = PROBLEMS }) {
  const rows = problems.map(([q, a], i) => `
    <div class="row">
      <span class="n">${i + 1})</span>
      <span class="q">${q}</span>
      <span class="a">${withAnswers ? a : ''}</span>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 1600px; overflow: hidden; }
  body { background: radial-gradient(ellipse at 40% 35%, #8a7a66 0%, #5d5144 70%, #3f372e 100%); }
  .paper {
    position: absolute; left: 110px; top: 90px; width: 980px; height: 1400px;
    background: linear-gradient(160deg, #fbf9f3 0%, #f3efe4 55%, #e9e3d4 100%);
    box-shadow: 0 18px 40px rgba(0,0,0,.45);
    transform: rotate(-1.8deg); transform-origin: 50% 50%;
    filter: blur(0.45px);
    font-family: Arial, sans-serif; color: #1f1f1f;
    padding: 70px 80px; box-sizing: border-box;
  }
  h1 { font-size: 40px; margin: 0 0 10px; }
  .meta { font-size: 26px; margin-bottom: 50px; display: flex; gap: 60px; }
  .meta span { border-bottom: 2px solid #555; min-width: 260px; display: inline-block; }
  .row { display: flex; align-items: baseline; height: 132px; border-bottom: 1px dashed #c9c2b2; }
  .n { width: 70px; font-size: 34px; color: #444; }
  .q { width: 330px; font-size: 46px; }
  .a { font-family: "Ink Free", "Segoe Print", "Comic Sans MS", cursive; font-size: 56px;
       color: #1d2a6b; transform: rotate(-3deg) translateY(4px); display: inline-block; }
  .light { position: absolute; inset: 0; pointer-events: none;
           background: radial-gradient(ellipse at 30% 20%, rgba(255,255,240,.18), rgba(0,0,0,.18) 80%); }
  canvas { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply; opacity: .55; }
  </style></head><body>
  <div class="paper">
    <h1>Practice Sheet: Add, Subtract, Multiply, Divide</h1>
    <div class="meta"><div>Name: <span></span></div><div>Class: 3</div><div>Date: <span style="min-width:160px"></span></div></div>
    ${rows}
  </div>
  <div class="light"></div>
  <canvas id="noise" width="1200" height="1600"></canvas>
  <script>
    // Seeded noise (mulberry32) so the image is the same on every run.
    let s = 20260927;
    const rand = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const c = document.getElementById('noise'), g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 200 + Math.floor(rand() * 55);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    window.noiseDone = true;
  </script>
  </body></html>`;
}

// The 12-problem sheet: question, handwritten answer, correct answer.
const PROBLEMS_12 = [
  ['36 + 25 =', '61', '61'],
  ['84 − 37 =', '53', '47'],   // subtracted the smaller digit from the larger
  ['9 × 6 =', '54', '54'],
  ['63 + 18 =', '71', '81'],   // forgot to carry
  ['100 − 45 =', '55', '55'],
  ['7 × 7 =', '42', '49'],
  ['48 ÷ 6 =', '8', '8'],
  ['29 + 44 =', '73', '73'],
  ['72 − 38 =', '46', '34'],
  ['8 × 9 =', '72', '72'],
  ['56 ÷ 7 =', '9', '8'],
  ['45 + 39 =', '84', '84'],
];

function html12() {
  const rows = PROBLEMS_12.map(([q, a], i) => `
    <div class="row">
      <span class="n">${i + 1}.</span>
      <span class="q">${q}</span>
      <span class="a">${a}</span>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 1600px; overflow: hidden; }
  body { background: radial-gradient(ellipse at 55% 40%, #7d7466 0%, #544b40 70%, #3a332b 100%); perspective: 1800px; }
  .paper {
    position: absolute; left: 120px; top: 70px; width: 960px; height: 1460px;
    background: linear-gradient(170deg, #fcfaf5 0%, #f2eee3 60%, #e6dfcf 100%);
    box-shadow: 0 18px 40px rgba(0,0,0,.45);
    transform: rotateX(7deg) rotate(1.4deg); transform-origin: 50% 60%;
    filter: blur(0.5px);
    font-family: Arial, sans-serif; color: #1f1f1f;
    padding: 56px 70px; box-sizing: border-box;
  }
  h1 { font-size: 34px; margin: 0 0 6px; }
  .meta { font-size: 22px; margin-bottom: 18px; display: flex; gap: 50px; }
  .meta span { border-bottom: 2px solid #555; min-width: 220px; display: inline-block; }
  .instr { font-size: 22px; margin: 0 0 8px; }
  .example { font-size: 26px; margin: 0 0 16px; color: #333; }
  .row { display: flex; align-items: baseline; height: 88px; border-bottom: 1px dashed #c9c2b2; }
  .n { width: 60px; font-size: 28px; color: #444; }
  .q { width: 290px; font-size: 38px; }
  .a { font-family: "Ink Free", "Segoe Print", "Comic Sans MS", cursive; font-size: 46px;
       color: #22307a; transform: rotate(-4deg) translateY(3px); display: inline-block; }
  .shade { position: absolute; inset: 0; pointer-events: none;
           background: linear-gradient(120deg, rgba(0,0,0,0) 55%, rgba(0,0,0,.28) 100%); }
  canvas { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply; opacity: .5; }
  </style></head><body>
  <div class="paper">
    <h1>Maths Practice: Mixed Operations</h1>
    <div class="meta"><div>Name: <span></span></div><div>Class: 4</div><div>Date: <span style="min-width:140px"></span></div></div>
    <p class="instr">Solve each problem. Write the answer on the line.</p>
    <p class="example">Example: 12 + 5 = <b>17</b></p>
    ${rows}
  </div>
  <div class="shade"></div>
  <canvas id="noise" width="1200" height="1600"></canvas>
  <script>
    let s = 20260928;
    const rand = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const c = document.getElementById('noise'), g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 200 + Math.floor(rand() * 55);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    window.noiseDone = true;
  </script>
  </body></html>`;
}

// Row positions in 0..1000 of a 1200 x 1600 image, from the rendered page:
// the box around the row's text (number, problem, written answer), not the
// whole row, whose empty space below the text would move its centre down.
async function rowBoxes(page, problems) {
  const rects = await page.evaluate(() => [...document.querySelectorAll('.row')].map((r) => {
    const parts = [...r.querySelectorAll('.n, .q, .a')].map((s) => s.getBoundingClientRect());
    return [Math.min(...parts.map((b) => b.left)), Math.min(...parts.map((b) => b.top)),
            Math.max(...parts.map((b) => b.right)), Math.max(...parts.map((b) => b.bottom))];
  }));
  return problems.map(([q, written, correct], i) => {
    const [x1, y1, x2, y2] = rects[i];
    return {
      n: i + 1, question: q, written, correct, wrong: written !== correct,
      box: [Math.round(x1 / 1.2), Math.round(y1 / 1.6), Math.round(x2 / 1.2), Math.round(y2 / 1.6)],
    };
  });
}

// The 4-problem sheet for the live smoke set (round 2): the first four rows
// of the 8-problem sheet (two right, two wrong), so a live run costs less.
const PROBLEMS_4 = PROBLEMS.slice(0, 4);

const browser = await chromium.launch({ channel: 'chrome' });
if (process.argv.includes('--sheet4')) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.setContent(html({ withAnswers: true, problems: PROBLEMS_4 }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.noiseDone === true);
  await page.screenshot({ path: path.join(__dirname, 'worksheet-4.jpg'), type: 'jpeg', quality: 78 });
  const rows = await rowBoxes(page, PROBLEMS_4);
  fs.writeFileSync(path.join(__dirname, 'worksheet-4-rows.json'), JSON.stringify({ image: 'worksheet-4.jpg', size: [1200, 1600], rows }, null, 2) + '\n');
  console.log('wrote worksheet-4.jpg, worksheet-4-rows.json');
  await browser.close();
  process.exit(0);
}
if (process.argv.includes('--sheet12')) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.setContent(html12());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.noiseDone === true);
  await page.screenshot({ path: path.join(__dirname, 'worksheet-12.jpg'), type: 'jpeg', quality: 78 });
  const rows = await rowBoxes(page, PROBLEMS_12);
  fs.writeFileSync(path.join(__dirname, 'worksheet-12-rows.json'), JSON.stringify({ image: 'worksheet-12.jpg', size: [1200, 1600], rows }, null, 2) + '\n');
  console.log('wrote worksheet-12.jpg, worksheet-12-rows.json');
  await browser.close();
  process.exit(0);
}
if (process.argv.includes('--rows')) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.setContent(html({ withAnswers: true }));
  await page.evaluate(() => document.fonts.ready);
  const rects = await page.evaluate(() => [...document.querySelectorAll('.row')].map((r) => {
    const b = r.getBoundingClientRect();
    return [b.left, b.top, b.right, b.bottom];
  }));
  const rows = PROBLEMS.map(([q, written, correct], i) => {
    const [x1, y1, x2, y2] = rects[i];
    return {
      n: i + 1, question: q, written, correct, wrong: written !== correct,
      box: [Math.round(x1 / 1.2), Math.round(y1 / 1.6), Math.round(x2 / 1.2), Math.round(y2 / 1.6)],
    };
  });
  fs.writeFileSync(path.join(__dirname, 'worksheet-rows.json'), JSON.stringify({ image: 'worksheet-5-wrong.jpg', size: [1200, 1600], rows }, null, 2) + '\n');
  console.log('wrote worksheet-rows.json');
  await browser.close();
  process.exit(0);
}
for (const [file, withAnswers] of [['worksheet-blank.jpg', false], ['worksheet-5-wrong.jpg', true]]) {
  // A fresh page per image, and wait for the fonts and the noise layer.
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.setContent(html({ withAnswers }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.noiseDone === true);
  await page.screenshot({ path: path.join(__dirname, file), type: 'jpeg', quality: 78 });
  await page.close();
  console.log('wrote', file);
}
await browser.close();
