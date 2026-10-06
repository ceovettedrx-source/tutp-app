// Generates the four "content page" photos used by photo-live.spec.js: school
// pages that teach something but have NO questions to answer.
//   textbook-page.jpg       printed textbook page, "Photosynthesis" (Class 7 science)
//   notebook-page.jpg       handwritten notebook notes on ruled paper, "The water cycle"
//   whatsapp-textbook.jpg   the textbook page as a forwarded WhatsApp photo (800 px wide, heavy JPEG)
//   screenshot-notes.png    a phone screenshot of a notes card, 500 x 566 px (the size that failed on 2026-10-06)
// Everything is made up; no names, no school, no logos. Windows fonts (Arial,
// Ink Free / Segoe Print, fallback Comic Sans MS), so run this on Windows.
//
//   node tests/e2e/fixtures/generate-content-pages.js
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEXTBOOK = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:1600px;background:#6b5e4f}
.paper{position:absolute;left:90px;top:70px;width:1020px;height:1460px;background:linear-gradient(160deg,#fcfaf4,#f1ecde);box-shadow:0 18px 40px rgba(0,0,0,.45);transform:rotate(-1.2deg);font-family:Arial,sans-serif;color:#1d1d1d;padding:70px 80px;box-sizing:border-box}
h1{font-size:54px;margin:0 0 6px;color:#0b4f8a}h2{font-size:34px;margin:34px 0 8px;color:#0b4f8a}
p{font-size:30px;line-height:1.55;margin:10px 0}.box{border:3px solid #0b4f8a;padding:16px 22px;margin-top:26px;font-size:28px;line-height:1.5;background:#eaf2fb}
.ch{font-size:24px;color:#666;letter-spacing:2px}
</style></head><body><div class="paper">
<div class="ch">CHAPTER 1 · NUTRITION IN PLANTS</div>
<h1>Photosynthesis</h1>
<p>Green plants make their own food. The food is made in the leaves by a process called <b>photosynthesis</b>. The word means "putting together with light".</p>
<h2>What the plant needs</h2>
<p>The plant takes in <b>carbon dioxide</b> from the air through tiny pores on the leaf called <b>stomata</b>. The roots take in <b>water</b> from the soil. The green pigment <b>chlorophyll</b> in the leaf traps energy from sunlight.</p>
<h2>What the plant makes</h2>
<p>Using sunlight, the leaf changes carbon dioxide and water into <b>glucose</b>, a kind of sugar, and releases <b>oxygen</b> into the air. The extra glucose is stored as <b>starch</b>.</p>
<div class="box"><b>Remember:</b> carbon dioxide + water, in sunlight and chlorophyll, gives glucose + oxygen.</div>
</div></body></html>`;

const NOTEBOOK = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:1600px;background:#5a4d3f}
.paper{position:absolute;left:90px;top:70px;width:1020px;height:1460px;background:repeating-linear-gradient(#fbfaf3 0,#fbfaf3 62px,#9db8d6 63px,#fbfaf3 64px);box-shadow:0 18px 40px rgba(0,0,0,.45);transform:rotate(1.6deg);padding:20px 70px 0 110px;box-sizing:border-box;font-family:'Ink Free','Segoe Print','Comic Sans MS',cursive;color:#1a2a6c;border-left:4px solid #d9534f}
h1{font-size:50px;margin:0;line-height:64px;text-decoration:underline}
p,li{font-size:36px;line-height:64px;margin:0}ul{margin:0;padding-left:44px}
</style></head><body><div class="paper">
<h1>The Water Cycle</h1>
<p>Water keeps moving around the Earth.</p>
<ul>
<li>Evaporation: the sun heats water in</li>
<li>seas and rivers and it becomes vapour.</li>
<li>Condensation: the vapour rises, cools</li>
<li>and forms tiny drops = clouds.</li>
<li>Precipitation: drops get heavy and fall</li>
<li>as rain, hail or snow.</li>
<li>Collection: water flows into rivers,</li>
<li>lakes and the sea again.</li>
</ul>
<p>So the same water is used again and again.</p>
</div></body></html>`;

const CARD = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:500px;height:566px;background:#f4f5f7;font-family:Arial,sans-serif}
.bar{height:44px;background:#e9ebef;font-size:14px;color:#555;display:flex;align-items:center;padding:0 14px;justify-content:space-between}
.card{margin:14px;background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
h1{font-size:21px;margin:0 0 8px;color:#0b4f8a}p{font-size:16px;line-height:1.45;margin:6px 0;color:#222}
</style></head><body><div class="bar"><span>9:41</span><span>Class 6 Science notes</span><span>5G ▮▮▮</span></div>
<div class="card"><h1>Parts of a flower</h1>
<p><b>Sepals</b> are the green leaf-like parts that protect the bud.</p>
<p><b>Petals</b> are the coloured parts that attract insects.</p>
<p><b>Stamen</b> is the male part. It makes pollen in the anther.</p>
<p><b>Pistil</b> is the female part. Its base, the ovary, holds the ovules. After fertilisation the ovule becomes a seed.</p>
<p>Pollination is the moving of pollen from the anther to the stigma.</p></div></body></html>`;

async function shot(browser, html, width, height, file, opts) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, file), ...opts });
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  await shot(browser, TEXTBOOK, 1200, 1600, 'textbook-page.jpg', { type: 'jpeg', quality: 82 });
  await shot(browser, NOTEBOOK, 1200, 1600, 'notebook-page.jpg', { type: 'jpeg', quality: 82 });
  await shot(browser, CARD, 500, 566, 'screenshot-notes.png', { type: 'png' });
  // WhatsApp-size: the textbook photo re-encoded small and heavy, like a forwarded picture.
  const page = await browser.newPage({ viewport: { width: 800, height: 1067 } });
  const b64 = fs.readFileSync(path.join(__dirname, 'textbook-page.jpg')).toString('base64');
  await page.setContent(`<body style="margin:0"><img id="i" style="width:800px;height:1067px" src="data:image/jpeg;base64,${b64}"></body>`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'whatsapp-textbook.jpg'), type: 'jpeg', quality: 45 });
  await browser.close();
  for (const f of ['textbook-page.jpg', 'notebook-page.jpg', 'whatsapp-textbook.jpg', 'screenshot-notes.png']) {
    console.log(f, Math.round(fs.statSync(path.join(__dirname, f)).size / 1024) + ' KB');
  }
})();
