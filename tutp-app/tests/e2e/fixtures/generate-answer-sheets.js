// Generates the synthetic photos used by answer-explain.spec.js and
// tests/golden/latency.js (Answer/Explain v2). Everything is made up.
//   te-8.jpg            8 printed Telugu questions (4 word problems, 2 definitions, 1 difference, 1 fill)
//   te-8-blurred.jpg    the same page, blurred beyond reading ("unreadable photo")
//   landscape.jpg       a drawn landscape, no text ("non-academic photo")
//   mixed-3.jpg         English, Telugu and Hindi questions on one page ("mixed-language page")
// Long edge <= 1568 px, the size the page uploads (HW_PHOTO_MAX_EDGE).
//   node tests/e2e/fixtures/generate-answer-sheets.js
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const FONTS = "'Nirmala UI', 'Gautami', 'Noto Sans Telugu', 'Noto Sans Devanagari', Arial, sans-serif";

const TE_8 = [
  'ఒక రైలు 3 గంటల్లో 180 కి.మీ. ప్రయాణించింది. దాని సగటు వేగం ఎంత?',
  'ఒక పెన్ను ఖరీదు ₹12. అయితే 5 పెన్నుల ఖరీదు ఎంత?',
  'ఒక దీర్ఘచతురస్ర పొడవు 8 సెం.మీ., వెడల్పు 5 సెం.మీ. అయితే దాని వైశాల్యం ఎంత?',
  'రాము వద్ద ₹100 ఉన్నాయి. అతడు ₹65 ఖర్చు చేశాడు. అతని వద్ద మిగిలిన డబ్బు ఎంత?',
  'కిరణజన్య సంయోగక్రియ అంటే ఏమిటి?',
  'దూరం మరియు స్థానభ్రంశం మధ్య తేడాలు రాయండి.',
  'భారతదేశ రాజధాని ఏది?',
  'నీరు ____ °C వద్ద మరుగుతుంది. (ఖాళీని పూరించండి)',
];
const MIXED = [
  'Name two states in South India and their capitals.',
  'భారతదేశ జాతీయ పక్షి ఏది?',
  'भारत में कितने राज्य हैं? (1 अंक)',
];

const page = (qs, blur = 0) => `<!doctype html><html><meta charset="utf-8"><body style="margin:0;background:#fffef8;font-family:${FONTS};filter:blur(${blur}px)">
<div style="padding:46px 52px;width:1000px">
<div style="font-size:26px;font-weight:bold;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:26px">Homework · Class 7</div>
${qs.map((q, i) => `<div style="font-size:27px;line-height:1.75;margin:0 0 26px">${i + 1}) ${q}</div>`).join('')}
</div></body></html>`;

const LANDSCAPE = `<!doctype html><html><body style="margin:0;width:1000px;height:700px;position:relative;background:linear-gradient(#8ec9ff,#e9f6ff 60%,#7cc576 60%,#4f9d4c)">
<div style="position:absolute;left:760px;top:70px;width:110px;height:110px;border-radius:50%;background:#ffd23f"></div>
<div style="position:absolute;left:100px;top:250px;border-left:200px solid transparent;border-right:200px solid transparent;border-bottom:260px solid #7a8a99"></div>
<div style="position:absolute;left:380px;top:300px;border-left:170px solid transparent;border-right:170px solid transparent;border-bottom:210px solid #8e9eab"></div>
<div style="position:absolute;left:150px;top:470px;width:30px;height:120px;background:#6b4a2b"></div>
<div style="position:absolute;left:105px;top:380px;width:120px;height:120px;border-radius:50%;background:#2e7d32"></div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
async function shot(html, file, width, height) {
  const p = await browser.newPage({ viewport: { width, height } });
  await p.setContent(html);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 82, fullPage: true });
  await p.close();
  console.log('wrote', file);
}
await shot(page(TE_8), 'te-8.jpg', 1100, 1000);
await shot(page(TE_8, 9), 'te-8-blurred.jpg', 1100, 1000);
await shot(LANDSCAPE, 'landscape.jpg', 1000, 700);
await shot(page(MIXED), 'mixed-3.jpg', 1100, 500);
await browser.close();
