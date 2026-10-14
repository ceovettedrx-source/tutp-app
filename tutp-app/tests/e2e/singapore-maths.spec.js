// Singapore Maths Method (TUT-43, docs/specs/TUT-43-singapore-maths.md section 10).
// Needs a preview with E2E_REPLAY=1 (the X-E2E-Tier header and /api/sgmath/e2e/reset are
// honoured only there, and only for the test family) and migration 033 run. No model call
// is made anywhere in this feature, so there is nothing to record or replay.
//
//   s0  precondition: /api/sgmath/strings answers (migration 033 run) and the test child is in classes 1-6
//   s1  on mother, father and family member the card opens /app/singapore-maths/, never the homework modal
//   s2  Free: start is 402 locked; the preview has a picture and a question, no answer/spec; page shows Unlock
//   s3  Pro: one free session a week, used when the Pictorial starts; next start 409 free_used; page says so
//   s4  Pro: two parallel starts + Pictorials leave at most one free session used (next start 409)
//   s5  Max: three sessions in a row, no 409
//   s6  phone 390 x 844 with touch: a full session through the UI (wrong builds and answers until the
//       reveal, so no answer key is needed), every control at least 44 x 44 px, a drag changes a size
//   s7  privacy: progress for a child of another family is 403
//
// Usage: node tests/e2e/singapore-maths.spec.js <base-url> [--headless]
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) { console.error('Usage: node tests/e2e/singapore-maths.spec.js <base-url> [--headless]'); process.exit(2); }
const HEADLESS = args.includes('--headless');
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e singapore-maths]', ...a);
const ROLES = [
  { name: 'mother', phone: '9999900001', want: '/app/mother/' },
  { name: 'father', phone: '9999900002', want: '/app/father/' },
  { name: 'family-member', phone: '9999900003', want: '/app/family-member/' },
];

async function record(id, name, fn, page) {
  try {
    let timer;
    const detail = await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('test timed out after 90 s')), 90000); })]).finally(() => clearTimeout(timer));
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    let shot = '';
    if (page) { shot = path.join(OUT, 'FAIL_' + id + '.png'); await page.screenshot({ path: shot, fullPage: true }).catch(() => {}); }
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 400), shot });
    log(id, 'FAIL', err.message, shot);
  }
}

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
    if (await page.locator('#child-picker-view').isVisible().catch(() => false)) await page.locator('#childPickerList button').first().click();
    else if (await page.locator('#profile-view').isVisible().catch(() => false)) { const tile = page.locator(`#profileGrid a[href="${want}"]`).first(); if (await tile.count()) await tile.click(); }
    else if (await page.locator('#otpError:not(.hidden)').isVisible().catch(() => false)) throw new Error('otp error: ' + (await page.textContent('#otpError')));
    await page.waitForTimeout(700);
  }
  return new URL(page.url()).pathname;
}

async function call(page, method, url, body, tier) {
  return page.evaluate(async ({ method, url, body, tier }) => {
    const headers = { 'Content-Type': 'application/json' };
    if (tier) headers['X-E2E-Tier'] = tier;
    const r = await fetch(url, { method, cache: 'no-store', headers, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  }, { method, url, body, tier });
}

// Every /api/sgmath/ request of a context carries the tier the test wants.
async function tierRoute(ctx, holder) {
  await ctx.route(/\/api\/sgmath\//, (route) => route.continue({ headers: { ...route.request().headers(), ...(holder.tier ? { 'x-e2e-tier': holder.tier } : {}) } }));
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const holder = { tier: 'max' };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await tierRoute(ctx, holder);
  const page = await ctx.newPage();
  const landed = await login(page, ROLES[0].phone, ROLES[0].want);
  if (landed !== '/app/mother/') { console.error('[e2e singapore-maths] login landed on', landed); process.exit(1); }
  await page.waitForFunction(() => window.tutpChildReady, null, { timeout: 15000 }).catch(() => {});
  const studentId = (await page.evaluate(() => window.tutpChildReady)) || (await page.evaluate(() => sessionStorage.getItem('tutp_student_id')));
  const reset = () => call(page, 'POST', '/api/sgmath/e2e/reset', { studentId });
  let ready = false;

  await record('s0', 'precondition: migration 033 run, test child in classes 1-6', async () => {
    if (!studentId) throw new Error('no student id after login');
    const s = await call(page, 'GET', '/api/sgmath/strings?lang=en');
    if (s.status === 503) throw new Error('migration 033 not run: /api/sgmath/strings is 503 not_ready');
    if (s.status !== 200 || !s.body.strings['page.title']) throw new Error('strings ' + s.status);
    const c = await call(page, 'GET', '/api/sgmath/card?studentId=' + studentId, null, 'max');
    if (c.body.state === 'grade') throw new Error('the test child is in class ' + c.body.grade + '; practice exists for classes 1-6 only');
    const r = await reset();
    if (r.status !== 200) throw new Error('reset ' + r.status + ' (is E2E_REPLAY=1 on this preview?)');
    ready = true;
    return 'grade ' + c.body.grade;
  });
  if (!ready) return finish(browser, [ctx]);

  await record('s1', 'card opens /app/singapore-maths/ on all three dashboards, never the homework modal', async () => {
    const seen = [];
    for (const role of ROLES) {
      if (role.name !== 'mother') {
        // father and family member: the served HTML is enough (no extra OTP logins, which count against the Firebase daily quota)
        const res = await ctx.request.get(BASE + role.want);
        if (res.status() !== 200) throw new Error(role.name + ' page status ' + res.status());
        const html = await res.text();
        const from = html.indexOf('id="sgmathCard"');
        const sIdx = html.indexOf('id="sgmathStart"', from);
        if (from < 0 || sIdx < 0) throw new Error(role.name + ' has no #sgmathCard / #sgmathStart');
        const card = html.slice(from, html.indexOf('</a>', sIdx) + 4);
        const href = (card.match(/id="sgmathStart"[^>]*href="([^"]*)"/) || card.match(/href="([^"]*)"[^>]*id="sgmathStart"/) || [])[1];
        if (!href || !href.startsWith('/app/singapore-maths/')) throw new Error(role.name + ' href ' + href);
        if (card.includes('openHomeworkModal')) throw new Error(role.name + ' card still calls openHomeworkModal');
        seen.push(role.name);
        continue;
      }
      const p = page;
      await p.goto(BASE + role.want);
      const btn = p.locator('#sgmathStart');
      await p.locator('#sgmathCard').waitFor({ state: 'attached', timeout: 20000 });
      await p.waitForTimeout(1500);
      await btn.waitFor({ state: 'visible', timeout: 20000 });
      const title = await p.locator('#sgmathCard .dc-title').textContent();
      if (title.trim() !== 'Singapore Maths Method') throw new Error(role.name + ' title ' + title);
      await p.waitForTimeout(1200);       // card.js has set the button for the child's tier
      if (await p.locator('#sgmathCard [onclick*="openHomeworkModal"]').count()) throw new Error(role.name + ' card still calls openHomeworkModal');
      const href = await btn.getAttribute('href');
      if (!/^\/app\/singapore-maths\/\?/.test(href)) throw new Error(role.name + ' href ' + href);
      await p.goto(BASE + href);
      await p.locator('#sgView').waitFor({ state: 'visible', timeout: 15000 });
      if (await p.locator('#homeworkModal:visible').count()) throw new Error(role.name + ' homework modal opened');
      seen.push(role.name);
    }
    return seen.join(', ');
  }, page);

  await record('s2', 'Free: 402 locked, preview without answer, page offers Unlock with Pro', async () => {
    holder.tier = 'free';
    const r = await call(page, 'POST', '/api/sgmath/session/start', { studentId, language: 'en' }, 'free');
    if (r.status !== 402 || r.body.error !== 'locked') throw new Error(`start ${r.status} ${JSON.stringify(r.body)}`);
    const pv = await call(page, 'GET', '/api/sgmath/preview?studentId=' + studentId, null, 'free');
    if (pv.status !== 200 || !/^<svg /.test(pv.body.svg || '')) throw new Error('preview ' + pv.status);
    for (const k of ['answer', 'spec', 'equation', 'equationOptions']) if (k in pv.body) throw new Error('preview has ' + k);
    await page.goto(BASE + `/app/singapore-maths/?from=mother&studentId=${studentId}`);
    await page.locator('#sgPreview').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#sgUnlock').waitFor({ state: 'visible', timeout: 5000 });
    return 'locked + preview';
  }, page);

  await record('s3', 'Pro: one free session a week, then 409 free_used', async () => {
    holder.tier = 'pro';
    await reset();
    const a = await call(page, 'POST', '/api/sgmath/session/start', { studentId, language: 'en', gate: 'max', tier: 'max' }, 'pro');
    if (a.status !== 200 || a.body.session.gate !== 'free_weekly') throw new Error(`start ${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
    const id = a.body.session.id;
    const pic = await call(page, 'POST', `/api/sgmath/session/${id}/pictorial`, null, 'pro');
    if (pic.status !== 200) throw new Error('pictorial ' + pic.status);
    await call(page, 'POST', `/api/sgmath/session/${id}/finish`, null, 'pro');
    const b = await call(page, 'POST', '/api/sgmath/session/start', { studentId, language: 'en' }, 'pro');
    if (b.status !== 409 || b.body.error !== 'free_used') throw new Error(`second start ${b.status}`);
    await page.goto(BASE + `/app/singapore-maths/?from=mother&studentId=${studentId}`);
    await page.locator('#sgFreeUsed').waitFor({ state: 'visible', timeout: 15000 });
    return '409 free_used';
  }, page);

  await record('s4', 'Pro: parallel starts leave at most one free session used', async () => {
    await reset();
    const starts = await Promise.all([1, 2].map(() => call(page, 'POST', '/api/sgmath/session/start', { studentId, language: 'en' }, 'pro')));
    const ids = [...new Set(starts.filter((s) => s.status === 200).map((s) => s.body.session.id))];
    if (!ids.length) throw new Error('no session started: ' + starts.map((s) => s.status));
    const pics = await Promise.all(ids.map((id) => call(page, 'POST', `/api/sgmath/session/${id}/pictorial`, null, 'pro')));
    const ok = pics.filter((p) => p.status === 200).length;
    if (ok !== 1) throw new Error('pictorial 200s: ' + ok + ' of ' + ids.length);
    for (const id of ids) await call(page, 'POST', `/api/sgmath/session/${id}/finish`, null, 'pro');
    const again = await call(page, 'POST', '/api/sgmath/session/start', { studentId, language: 'en' }, 'pro');
    if (again.status !== 409) throw new Error('after: ' + again.status);
    return `${ids.length} session(s), 1 used`;
  }, page);

  await record('s5', 'Max: three sessions in a row, no 409', async () => {
    holder.tier = 'max';
    await reset();
    for (let i = 0; i < 3; i++) {
      const s = await call(page, 'POST', '/api/sgmath/session/start', { studentId, language: 'en' }, 'max');
      if (s.status !== 200 || s.body.session.gate !== 'max') throw new Error(`start ${i}: ${s.status}`);
      const p = await call(page, 'POST', `/api/sgmath/session/${s.body.session.id}/pictorial`, null, 'max');
      if (p.status !== 200) throw new Error('pictorial ' + p.status);
      await call(page, 'POST', `/api/sgmath/session/${s.body.session.id}/finish`, null, 'max');
    }
    return '3 sessions';
  }, page);

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await ctx.storageState() });
  await tierRoute(phoneCtx, holder);
  const phone = await phoneCtx.newPage();
  await record('s6', 'phone 390x844: full session through the UI, 44 px controls, drag works', async () => {
    holder.tier = 'max';
    await reset();
    await phone.goto(BASE + `/app/singapore-maths/?from=mother&studentId=${studentId}&lang=en`);
    await phone.locator('#sgStart').click();
    let checked44 = false, dragged = false, problems = 0;
    for (let guard = 0; guard < 40; guard++) {
      await phone.waitForTimeout(400);
      if (await phone.locator('#sgBegin').count()) { await phone.locator('#sgBegin').click(); continue; }
      if (await phone.locator('#sgWeDidIt').count()) { await phone.locator('#sgWeDidIt').click(); continue; }
      if (await phone.locator('#sgFinish').count()) break;
      if (await phone.locator('#sgCheck').count()) {
        if (!checked44) {
          const small = await phone.evaluate(() => [...document.querySelectorAll('#sgBuilder button, #sgBuilder select, #sgBuilder .sgb-handle, #sgCheck')]
            .map((n) => n.getBoundingClientRect()).filter((r) => r.width && (r.width < 43.5 || r.height < 43.5)).length);
          if (small) throw new Error(small + ' controls smaller than 44 px');
          checked44 = true;
        }
        if (!dragged && await phone.locator('.sgb-handle').count()) {
          const before = await phone.locator('.sgb-val').first().textContent();
          const box = await phone.locator('.sgb-handle').first().boundingBox();
          await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await phone.mouse.down();
          await phone.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
          await phone.mouse.up();
          const after = await phone.locator('.sgb-val').first().textContent();
          if (after === before) throw new Error('drag did not change the size');
          dragged = true;
        }
        // three checks without building the right model: the third reveals it
        for (let k = 0; k < 3 && await phone.locator('#sgCheck').count(); k++) { await phone.locator('#sgCheck').click(); await phone.waitForTimeout(500); }
        await phone.locator('#sgNext').click();
        problems++;
        continue;
      }
      if (await phone.locator('#sgAbsCheck').count()) {
        for (let k = 0; k < 3 && await phone.locator('#sgAbsCheck').count(); k++) { await phone.fill('#sgAnswer', '0'); await phone.locator('#sgAbsCheck').click(); await phone.waitForTimeout(500); }
        await phone.locator('#sgNext').click();
        continue;
      }
    }
    await phone.locator('#sgFinish').waitFor({ state: 'visible', timeout: 15000 });
    const scrollX = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (scrollX) throw new Error('page scrolls sideways at 390 px');
    return `${problems} problems, drag ${dragged}`;
  }, phone);

  await record('s7', 'privacy: another family\'s child is 403', async () => {
    const r = await call(page, 'GET', '/api/sgmath/progress?studentId=00000000-0000-4000-8000-000000000000', null, 'max');
    if (r.status !== 403) throw new Error('got ' + r.status);
    return '403';
  }, page);

  await reset();
  return finish(browser, [phoneCtx, ctx]);
})().catch(e => { console.error('[e2e singapore-maths] fatal', e); process.exit(1); });

async function finish(browser, ctxs) {
  for (const c of ctxs) await c.close().catch(() => {});
  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'singapore-maths-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') || !results.length ? 1 : 0);
}
