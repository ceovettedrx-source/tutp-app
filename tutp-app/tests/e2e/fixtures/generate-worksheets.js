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

function html({ withAnswers }) {
  const rows = PROBLEMS.map(([q, a], i) => `
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

const browser = await chromium.launch({ channel: 'chrome' });
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
