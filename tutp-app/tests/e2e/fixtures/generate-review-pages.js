// Generates the two textbook pages for the img1 phone review (tests/e2e/review-photos.spec.js):
//   relative-motion-page.jpg   printed textbook page in English, "Relative motion" (Class 9 physics, no questions)
//   telugu-textbook-page.jpg   printed textbook page in Telugu, "ధ్వని" (sound, Class 8 science, no questions)
// Made up; no names, no school, no logos. Windows fonts (Arial, Nirmala UI for Telugu), so run this on Windows.
//
//   node tests/e2e/fixtures/generate-review-pages.js
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const page = (font, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:1600px;background:#6b5e4f}
.paper{position:absolute;left:90px;top:70px;width:1020px;height:1460px;background:linear-gradient(160deg,#fcfaf4,#f1ecde);box-shadow:0 18px 40px rgba(0,0,0,.45);transform:rotate(-0.6deg);padding:60px 70px;box-sizing:border-box;font-family:${font}}
h1{font-size:54px;margin:0 0 6px;color:#0b4f8a}h2{font-size:34px;margin:34px 0 8px;color:#0b4f8a}
p{font-size:30px;line-height:1.6;margin:10px 0}.box{border:3px solid #0b4f8a;padding:16px 22px;margin-top:26px;font-size:28px;line-height:1.55;background:#eaf2fb}
.ch{font-size:24px;color:#666;letter-spacing:2px}
</style></head><body><div class="paper">${body}</div></body></html>`;

const RELATIVE = page('Arial, sans-serif', `
<div class="ch">CHAPTER 8 · MOTION</div>
<h1>Relative motion</h1>
<p>Whether an object is moving or at rest depends on the observer. A passenger sitting in a moving bus is at rest with respect to the bus, but is moving with respect to a person standing on the road. This is called <b>relative motion</b>.</p>
<h2>Reference point</h2>
<p>To describe the position of an object we choose a <b>reference point</b>. The <b>distance</b> is the total length of the path travelled. The <b>displacement</b> is the shortest straight line from the starting point to the end point, with its direction.</p>
<h2>Two trains</h2>
<p>When two trains move in the same direction, each seems slower to the other. When they move in opposite directions, each seems faster. The speed of one object as seen from another is its <b>relative speed</b>.</p>
<div class="box"><b>Remember:</b> motion is always described with respect to a reference point.</div>`);

const TELUGU = page('"Nirmala UI", "Gautami", Arial, sans-serif', `
<div class="ch">అధ్యాయం 6 · ధ్వని</div>
<h1>ధ్వని</h1>
<p>వస్తువులు కంపించినప్పుడు ధ్వని ఉత్పన్నమవుతుంది. తబలా మీద కొట్టినప్పుడు దాని పొర కంపిస్తుంది, ఆ కంపనాల వల్లే మనకు శబ్దం వినిపిస్తుంది.</p>
<h2>ధ్వని ఎలా ప్రయాణిస్తుంది</h2>
<p>ధ్వని గాలి, నీరు, ఘన పదార్థాల ద్వారా ప్రయాణిస్తుంది. శూన్యంలో ధ్వని ప్రయాణించదు. గాలిలో ధ్వని వేగం సెకనుకు సుమారు 340 మీటర్లు.</p>
<h2>ఎత్తు మరియు తీవ్రత</h2>
<p>కంపనాల సంఖ్య ఎక్కువైతే ధ్వని స్థాయి ఎక్కువగా ఉంటుంది. కంపన పరిమితి ఎక్కువైతే ధ్వని బిగ్గరగా వినిపిస్తుంది.</p>
<div class="box"><b>గుర్తుంచుకోండి:</b> కంపనం లేకుండా ధ్వని ఉండదు.</div>`);

const browser = await chromium.launch({ channel: 'chrome' });
for (const [file, html] of [['relative-motion-page.jpg', RELATIVE], ['telugu-textbook-page.jpg', TELUGU]]) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await p.setContent(html);
  await p.screenshot({ path: path.join(__dirname, file), type: 'jpeg', quality: 80 });
  await p.close();
  console.log('wrote', file, fs.statSync(path.join(__dirname, file)).size, 'bytes');
}
await browser.close();
