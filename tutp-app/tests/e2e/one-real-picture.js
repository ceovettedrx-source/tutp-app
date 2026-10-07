// One real picture (img1 release check): proves the bound Gemini key works on a no-traffic preview.
// Signs in as the Pro test mother, asks for one story (model reply replayed), and lets the page
// request its picture WITHOUT the mock image header, so the real provider makes it (about 0.04 USD).
//
//   node tests/e2e/one-real-picture.js <base-url> [--headless]
//
// Prints the concept key, whether the picture loaded and its size. Exit 1 on failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) { console.error('Usage: node tests/e2e/one-real-picture.js <base-url> [--headless]'); process.exit(2); }
const RUN = Date.now().toString(36).slice(-6);
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const e2e = e2eMode('img1');

const browser = await chromium.launch({ channel: 'chrome', headless: args.includes('--headless') });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
await e2e.attach(ctx, { v2: true, keySuffix: RUN + 'real' });   // no image: 'mock'
await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
  const resp = await route.fetch();
  let body = await resp.text();
  const hook = 'const auth = getAuth(app);';
  if (!body.includes(hook)) throw new Error('phone-auth.js hook not found');
  await route.fulfill({ response: resp, body: body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;') });
});
const page = await ctx.newPage();
const gets = [];
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (/^\/api\/illustration\/[a-z0-9-]+$/.test(u.pathname) && r.request().method() === 'GET') {
    let t = ''; try { t = await r.text(); } catch { /* gone */ }
    gets.push({ status: r.status(), text: t.replace(/https?:\/\/[^"]+/g, '<url>').slice(0, 160) });
  }
});
try {
  await page.goto(BASE + '/app/login/');
  await page.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
  const status = await page.evaluate(async ({ phone, code }) => {
    await window.tutpSendOTP(phone);
    const idToken = await window.tutpVerifyOTP(code);
    const status = (await window.tutpEstablishSession(idToken)).status;
    if (status !== 200) return status;
    const me = await (await fetch('/api/session/me')).json();
    sessionStorage.setItem('tutp_family_id', me.familyId);
    sessionStorage.setItem('tutp_roles', JSON.stringify(me.roleMatches || []));
    sessionStorage.setItem('tutp_baseline_skipped', '1');
    return status;
  }, { phone: '+919999900001', code: '123456' });
  if (status !== 200) throw new Error('/api/session returned ' + status);
  await page.goto(BASE + '/app/mother/');
  await page.waitForFunction(() => typeof window.openStorytellingModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
  await page.evaluate(() => openStorytellingModal());
  await page.locator('#storyModal .sm-panel').waitFor({ state: 'visible', timeout: 10000 });
  await page.selectOption('#storyModalLang', 'English');
  await page.fill('#storyModalText', 'Magnets and their poles');
  const resp = page.waitForResponse((r) => /\/api\/homework$/.test(r.url()) && r.request().method() === 'POST', { timeout: 240000 });
  await page.click('#storyModalSubmitBtn');
  const r = await resp;
  const story = JSON.parse((await r.json()).content[0].text);
  await page.locator('#storyModalResults').waitFor({ state: 'visible', timeout: 180000 });
  if (!(story.picture && story.picture.sig)) throw new Error('no generated picture on this story (visual type ' + (story.visual && story.visual.type) + ')');
  await page.locator('#storyModalResults .tp-pic[data-state=ready]').waitFor({ timeout: 120000 });
  const size = await page.locator('#storyModalResults .tp-pic img').first().evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
  await page.screenshot({ path: path.join(OUT, 'one-real-picture.png'), fullPage: true });
  console.log('[real-picture] concept', story.picture.concept_key, 'image', size.w + 'x' + size.h, size.w > 16 ? 'REAL (not the 16x16 mock)' : 'TINY (mock-sized)');
  console.log('[real-picture] polls', JSON.stringify(gets.slice(-3)));
  if (!(size.w > 16)) process.exitCode = 1;
} catch (err) {
  console.log('[real-picture] FAIL', err.message);
  await page.screenshot({ path: path.join(OUT, 'one-real-picture-FAIL.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
