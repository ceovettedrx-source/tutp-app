// Upload security e2e (round upload-security, docs/specs/upload-security.md):
// no file goes in or comes out without a signed-in member of the owning
// family; reads are 15 minute signed urls; the home page no longer uploads.
//
//   npm run test:e2e -- <base-url>          (run.js runs every spec)
//   node tests/e2e/uploads.spec.js <base-url> [--headless]
//
// Test data: the fictional Firebase test numbers of family.spec.js (code
// 123456): 9999900001 mother of family A (family 16), 9999900004 mother of
// family B (registered by family.spec.js; run it first on a new database).
// Every upload is a 70-byte PNG under families/<id>/ of a test family.
//
// Tests:
//   u1 no sign-in: /api/upload 401 (family, teacher and bad-token registration
//      purposes), /api/files/open 401
//   u2 family A upload: random path under families/<A>/, type from the bytes
//      (html 415 even when it claims image/png, 13 MB 413), a child of family
//      B as studentId 403, purpose teacher 403
//   u3 family A cannot read B's file and B cannot read A's (403); bad, legacy
//      and traversal paths 400
//   u4 signed url: expiresIn 900, the file downloads, a 3 s url (preview
//      only) stops working after 5 s
//   u5 home page attach: no /api/upload request, the file waits in
//      sessionStorage, and after login the dashboard opens it in the modal
//   u6 HEIC: stored as a JPEG (signed url, jpeg bytes); a too-large HEIC gets
//      a clear 415 on /api/upload and on /api/homework (no model call)
//
// Output: tests/e2e/output/uploads-results.json, FAIL_<test>.png. Exit 1 on
// any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/uploads.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONES = { motherA: '9999900001', motherB: '9999900004' };
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e uploads]', ...a);
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function record(id, name, fn, page) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    let shot = '';
    if (page) { shot = path.join(OUT, 'FAIL_' + id + '.png'); await page.screenshot({ path: shot, fullPage: true }).catch(() => {}); }
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 400), shot });
    log(id, 'FAIL', err.message, shot);
  }
}
function eq(actual, want, what) { if (actual !== want) throw new Error(`${what}: got ${actual}, want ${want}`); }

async function login(page, digits, want) {
  await page.goto(BASE + '/app/login/');
  await page.waitForFunction(() => !document.documentElement.classList.contains('tutp-checking'), null, { timeout: 15000 }).catch(() => {});
  await page.locator('#loginPhoneInput').waitFor({ state: 'visible', timeout: 15000 });
  await page.fill('#loginPhoneInput', digits);
  await page.click('#sendCodeBtn');
  await page.locator('#otp-view').waitFor({ state: 'visible', timeout: 60000 });
  const boxes = page.locator('.otp-digit');
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(CODE[i]);
  await page.click('#verifyBtn');
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const p = new URL(page.url()).pathname;
    if (p !== '/app/login/') return p;
    if (await page.locator('#child-picker-view').isVisible().catch(() => false)) {
      await page.locator('#childPickerList button').first().click();
    } else if (await page.locator('#profile-view').isVisible().catch(() => false)) {
      const tile = page.locator(`#profileGrid a[href="${want}"]`).first();
      if (await tile.count()) await tile.click();
    } else if (await page.locator('#otpError:not(.hidden)').isVisible().catch(() => false)) {
      throw new Error('otp error: ' + (await page.textContent('#otpError')));
    }
    await page.waitForTimeout(700);
  }
  return new URL(page.url()).pathname;
}

// fetch from inside the signed-in page (same cookies as the app).
const api = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', redirect: 'manual' });
  return { status: r.status, body: await r.json().catch(() => null) };
}, { method, url, body });
const me = (page) => api(page, 'GET', '/api/session/me');
const upload = (page, extra) => api(page, 'POST', '/api/upload', { dataBase64: PNG_B64, ...extra });
const open = (page, p, q = '') => api(page, 'GET', '/api/files/open?format=json&path=' + encodeURIComponent(p) + q);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 30 });
  try {
    const anon = await browser.newContext();
    await record('u1', 'no sign-in: upload and open are refused', async () => {
      const post = (data) => anon.request.post(BASE + '/api/upload', { data });
      eq((await post({ dataBase64: PNG_B64 })).status(), 401, 'family upload');
      eq((await post({ dataBase64: PNG_B64, purpose: 'teacher' })).status(), 401, 'teacher upload');
      eq((await post({ dataBase64: PNG_B64, purpose: 'registration', regIdToken: 'not-a-token' })).status(), 401, 'registration upload, bad token');
      eq((await post({ dataBase64: PNG_B64, studentId: 1 })).status(), 401, 'upload with a child id');
      const open401 = await anon.request.get(BASE + '/api/files/open?path=families/16/x.png', { maxRedirects: 0 });
      eq(open401.status(), 401, 'open');
      return '401 x5';
    });

    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageA = await ctxA.newPage();
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageB = await ctxB.newPage();
    await login(pageA, PHONES.motherA, '/app/mother/');
    await login(pageB, PHONES.motherB, '/app/mother/');
    const meA = (await me(pageA)).body;
    const meB = (await me(pageB)).body;
    log('family A', meA.familyId, 'family B', meB.familyId);
    if (!meA.familyId || !meB.familyId || meA.familyId === meB.familyId) throw new Error('need two different test families');
    let pathA = null; let pathB = null;

    await record('u2', 'family upload: owner folder, type from bytes, size, other family\'s child', async () => {
      const ok = await upload(pageA, { studentId: meA.children[0].id });
      eq(ok.status, 200, 'upload');
      if (!new RegExp(`^families/${meA.familyId}/[0-9a-f-]{36}\\.png$`).test(ok.body.path)) throw new Error('path ' + ok.body.path);
      pathA = ok.body.path;
      const again = await upload(pageA, { filename: '../../evil.png', path: 'families/1/x.png' });
      eq(again.status, 200, 'second upload');
      if (again.body.path === pathA || !again.body.path.startsWith(`families/${meA.familyId}/`)) throw new Error('client path or name was used: ' + again.body.path);
      const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
      eq((await upload(pageA, { dataBase64: html })).status, 415, 'html');
      eq((await upload(pageA, { dataBase64: html, contentType: 'image/png', filename: 'a.png' })).status, 415, 'html claiming png');
      const big = Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(9 * 1024 * 1024)]).toString('base64');
      eq((await upload(pageA, { dataBase64: big })).status, 413, '9 MB');
      eq((await upload(pageA, { studentId: meB.children[0].id })).status, 403, 'other family\'s child');
      eq((await upload(pageA, { purpose: 'teacher' })).status, 403, 'teacher purpose with a family session');
      eq((await upload(pageA, { dataBase64: '' })).status, 400, 'empty');
      return pathA;
    }, pageA);

    await record('u3', 'a member of one family cannot read the other family\'s file', async () => {
      pathB = (await upload(pageB)).body.path;
      if (!pathB || !pathB.startsWith(`families/${meB.familyId}/`)) throw new Error('family B upload failed: ' + pathB);
      eq((await open(pageA, pathB)).status, 403, 'A opens B');
      eq((await open(pageB, pathA)).status, 403, 'B opens A');
      eq((await open(pageA, pathA)).status, 200, 'A opens A');
      eq((await open(pageB, pathB)).status, 200, 'B opens B');
      eq((await open(pageA, `families/${meA.familyId}/../${meB.familyId}/x.png`)).status, 400, 'traversal');
      eq((await open(pageA, '1759000000000-abc123-photo.jpg')).status, 400, 'bare legacy name');
      eq((await open(pageA, 'registration/' + 'a'.repeat(24) + '/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.png')).status, 403, 'registration folder');
      return 'A/B 403 both ways';
    }, pageA);

    await record('u4', 'signed url works, then expires', async () => {
      const r = await open(pageA, pathA);
      eq(r.body.expiresIn, 900, 'expiresIn');
      const file = await fetch(r.body.url);
      eq(file.status, 200, 'signed url');
      const bytes = Buffer.from(await file.arrayBuffer());
      eq(bytes.subarray(1, 4).toString('latin1'), 'PNG', 'file bytes');
      eq(file.headers.get('content-type'), 'image/png', 'content type');
      const bare = await fetch(r.body.url.split('?')[0]);
      if (bare.status === 200) throw new Error('the object url without its token still works');
      const short = await open(pageA, pathA, '&ttl=3');
      eq(short.body.expiresIn, 3, 'preview ttl override');
      eq((await fetch(short.body.url)).status, 200, 'short url, at once');
      await sleep(5500);
      const late = await fetch(short.body.url);
      if (late.status === 200) throw new Error('the 3 second url still works after 5.5 s');
      // the redirect form (what a page link uses) points at a signed url too
      const red = await pageA.evaluate(async (p) => { const x = await fetch(p, { redirect: 'manual' }); return { type: x.type }; }, '/api/files/open?path=' + encodeURIComponent(pathA));
      eq(red.type, 'opaqueredirect', 'redirect form');
      return `expired after 5.5 s (late status ${late.status})`;
    }, pageA);

    await record('u6', 'HEIC is converted to JPEG before it is stored; a too-large or broken one gets a clear message', async () => {
      const heic = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.heic'));
      const ok = await upload(pageA, { dataBase64: heic.toString('base64'), contentType: 'image/heic' });
      eq(ok.status, 200, 'heic upload');
      if (!new RegExp(`^families/${meA.familyId}/[0-9a-f-]{36}\\.jpg$`).test(ok.body.path)) throw new Error('stored as ' + ok.body.path);
      const r = await open(pageA, ok.body.path);
      const file = await fetch(r.body.url);
      eq(file.status, 200, 'signed url');
      eq(file.headers.get('content-type'), 'image/jpeg', 'content type');
      eq(Buffer.from(await file.arrayBuffer()).subarray(0, 3).toString('hex'), 'ffd8ff', 'jpeg bytes');
      const big = Buffer.from(heic);
      const at = big.indexOf('ispe', 0, 'latin1');
      big.writeUInt32BE(20000, at + 8); big.writeUInt32BE(20000, at + 12);
      const huge = await upload(pageA, { dataBase64: big.toString('base64') });
      eq(huge.status, 415, 'too large heic');
      eq(huge.body.code, 'heic_too_large', 'code');
      if (!/take it again|smaller/i.test(huge.body.error)) throw new Error('message: ' + huge.body.error);
      // the model route turns HEIC bytes into JPEG too (even when they claim image/jpeg); a refusal never reaches the model
      const hw = await api(pageA, 'POST', '/api/homework', { studentId: meA.children[0].id, text: 'help', attachments: [{ mediaType: 'image/jpeg', base64: big.toString('base64') }] });
      eq(hw.status, 415, 'homework with a too-large heic');
      eq(hw.body.code, 'heic_too_large', 'homework code');
      return ok.body.path + ' (jpeg)';
    }, pageA);

    await ctxA.close(); await ctxB.close();

    const ctxH = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const home = await ctxH.newPage();
    await record('u5', 'home page attach waits in the tab, dashboard opens it after login', async () => {
      const uploadsSeen = [];
      home.on('request', (r) => { if (r.url().includes('/api/upload')) uploadsSeen.push(r.url()); });
      await home.goto(BASE + '/');
      await home.locator('#homeFilePhoto').setInputFiles({ name: 'hw.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') });
      await home.waitForFunction(() => /attached/.test(document.getElementById('homeAttachStatus')?.textContent || ''), null, { timeout: 15000 });
      if (uploadsSeen.length) throw new Error('home page called /api/upload: ' + uploadsSeen.join());
      await home.evaluate(() => chooseHomeAttachMode('homework'));
      await home.waitForURL('**/app/login/**', { timeout: 15000 });
      const stored = await home.evaluate(() => ({ url: (sessionStorage.getItem('tutp_pending_attach_url') || '').slice(0, 22), name: sessionStorage.getItem('tutp_pending_attach_name') }));
      eq(stored.url, 'data:image/png;base64,', 'stored file');
      eq(stored.name, 'hw.png', 'stored name');
      await login(home, PHONES.motherA, '/app/mother/');
      await home.locator('#hwModalThumb:not(.hidden)').waitFor({ state: 'visible', timeout: 20000 });
      return 'no upload call; thumbnail in the homework modal';
    }, home);
    await ctxH.close();
  } finally {
    await browser.close();
  }
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'uploads-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e uploads] fatal', e); process.exit(1); });
