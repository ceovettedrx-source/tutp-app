// Generates maths-8b.jpg: the TUT-19 worksheet (maths-8.jpg) with question 4 of the TUT-28 ticket
// ("24 + 29 + __ = 10 + 14 + 29", answer 0). Made up, no names, no school. maths-8.jpg itself is not
// regenerated: its bytes are part of the a15 recording keys.
//   node tests/e2e/fixtures/generate-maths-8b.js
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS = ['9 = 3 × ____', '100 × 5 = 25 × ____', '25 × 0 + 75 = ____', '24 + 29 + ____ = 10 + 14 + 29', '9 + 3 = ____', '31 × 0 = ____', '45 − 18 = ____', '8 ÷ 2 = ____'];
const html = `<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="width:900px;padding:40px 60px">
<h2 style="margin:0 0 6px">Maths practice</h2><div style="margin-bottom:26px;font-size:18px">Fill in the blanks.</div>
${QUESTIONS.map((q, i) => `<div style="font-size:30px;margin:0 0 34px">${i + 1}) &nbsp; ${q}</div>`).join('')}
</div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1020, height: 760 } });
await page.setContent(html);
await page.screenshot({ path: path.join(__dirname, 'maths-8b.jpg'), type: 'jpeg', quality: 88, fullPage: true });
await browser.close();
console.log('wrote maths-8b.jpg');
