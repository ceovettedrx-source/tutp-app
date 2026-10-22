// Watch & Learn (TUT-66, docs/specs/tut-66-watch-learn.md): YouTube videos under lesson results.
// The preview runs with E2E_REPLAY=1, so the YouTube API is the mock in server/youtube/e2e-mock.js:
// no network, no quota, no spend. Each run uses lesson names that are new to the cache table.
//
//   w1  Pro child: a new lesson makes 3 API calls and returns 5 videos (2 + 2 + 1)
//   w2  the same lesson again, spelt differently, makes 0 API calls (cache hit)
//   w3  quota error: 200 with no videos (the card hides), results are not affected
//   w4  Free child: 1 video and 4 locked, none of the 4 hidden ids is in the response
//   w5  report: the video is gone for the lesson, the next one takes its place, still 5
//   w6  a bad video id, another family's child, and no session are refused
//   w7  360 px: card shows title + thumbnail + channel, no iframe and no YouTube request before
//       the tap, no horizontal scroll, the tap loads a youtube-nocookie embed
//   w8  Free at 360 px: locked cards are blurred and "Unlock with Pro" opens the plan chooser
//
// Usage: node tests/e2e/watch-learn.spec.js <base-url> [--headless]
// Output: tests/e2e/output/watch-learn-results.json, FAIL_<test>.png. Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/watch-learn.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e watch-learn]', ...a);
const RUN = Date.now().toString(36);                       // a lesson name no earlier run has cached
const lessonOf = (n) => `Mock lesson ${n} ${RUN}`;

async function record(id, name, fn, page) {
  try {
    let timer;
    const detail = await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('test timed out after 90 s')), 90000); }),
    ]).finally(() => clearTimeout(timer));
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

async function call(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const r = await fetch(url, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  }, { method, url, body });
}

const q = (o) => '/api/watch-learn?' + Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if ((await login(page, '9999900001', '/app/mother/')) !== '/app/mother/') { console.error('[e2e watch-learn] pro login failed'); process.exit(1); }
  const fid = (await call(page, 'GET', '/api/session/me')).body.familyId;
  const kids = (await call(page, 'GET', `/api/billing/status/${fid}`)).body.children || [];
  const pro = kids.find(c => c.active && c.tier !== 'free');
  if (!pro) { console.error('[e2e watch-learn] no paid test child'); process.exit(1); }
  const L = (n, extra = {}) => ({ studentId: pro.studentId, lesson: lessonOf(n), subject: 'Maths', language: 'Telugu', ...extra });

  let firstIds = [];
  await record('w1', 'Pro child, new lesson: 3 API calls, 5 videos (2 + 2 + 1)', async () => {
    const r = await call(page, 'GET', q(L('a')));
    if (r.status !== 200) throw new Error('status ' + r.status);
    const b = r.body;
    if (b.videos.length !== 5 || b.locked !== 0) throw new Error(`videos ${b.videos.length}, locked ${b.locked}`);
    if (b.api_calls !== 3) throw new Error('api_calls ' + b.api_calls + ' (want 2 searches + 1 videos call)');
    const lang = b.videos.map(v => v.id.slice(4, 6));        // mock ids: mock<code><i>abcde
    if (lang.join() !== 'te,te,en,en,te') throw new Error('order ' + lang.join());
    for (const v of b.videos) if (!v.id || !v.title || !v.channel) throw new Error('video missing a field');
    firstIds = b.videos.map(v => v.id);
    return 'api_calls 3; te,te,en,en,te';
  });

  await record('w2', 'same lesson spelt differently: 0 API calls (cache hit)', async () => {
    const r = await call(page, 'GET', q(L('a', { lesson: '  ' + lessonOf('a').toUpperCase() + '. ', language: 'te' })));
    if (r.status !== 200 || r.body.videos.length !== 5) throw new Error(`got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    if (r.body.api_calls !== 0) throw new Error('api_calls ' + r.body.api_calls);
    if (r.body.videos.map(v => v.id).join() !== firstIds.join()) throw new Error('different videos from the cache');
    return 'api_calls 0, same 5 videos';
  });

  await record('w3', 'quota error: 200 with no videos, nothing cached, the page is not affected', async () => {
    const r = await call(page, 'GET', q(L('b', { lesson: 'quotatest ' + lessonOf('b') })));
    if (r.status !== 200) throw new Error('status ' + r.status);
    if (r.body.videos.length !== 0) throw new Error('videos shown on a quota error');
    const again = await call(page, 'GET', q(L('c')));       // the next lesson still works (no stuck cooldown on the preview)
    if (again.body.videos.length !== 5) throw new Error('next lesson after a quota error: ' + again.body.videos.length);
    return 'empty card, next lesson 5 videos';
  });

  await record('w5', 'report hides the video for the lesson, the next candidate takes its place', async () => {
    const lesson = L('d');
    const first = (await call(page, 'GET', q(lesson))).body;
    const bad = first.videos[0].id;
    const rep = await call(page, 'POST', '/api/watch-learn/report', { ...lesson, videoId: bad });
    if (rep.status !== 200 || !rep.body.ok) throw new Error('report ' + rep.status);
    const after = (await call(page, 'GET', q(lesson))).body;
    if (after.videos.some(v => v.id === bad)) throw new Error('reported video still shown');
    if (after.videos.length !== 5) throw new Error('lesson now has ' + after.videos.length);
    if (after.api_calls !== 0) throw new Error('a report made API calls');
    const other = (await call(page, 'GET', q(L('e')))).body;      // another lesson is untouched
    if (!other.videos.some(v => v.id === bad)) throw new Error('report leaked to another lesson');
    return 'hidden for that lesson only, 5 videos, 0 API calls';
  });

  await record('w6', 'a bad video id, another family\'s child and a missing session are refused', async () => {
    const bad = await call(page, 'POST', '/api/watch-learn/report', { ...L('f'), videoId: '<script>' });
    if (bad.status !== 400) throw new Error('bad id ' + bad.status);
    const foreign = await call(page, 'GET', q({ studentId: '00000000-0000-4000-8000-000000000000', lesson: 'Fractions', language: 'English' }));
    if (foreign.status !== 403) throw new Error('foreign child ' + foreign.status);
    const anon = await browser.newContext();
    const ap = await anon.newPage();
    await ap.goto(BASE + '/app/login/');
    const r = await call(ap, 'GET', q(L('f')));
    await anon.close();
    if (r.status !== 401) throw new Error('no session ' + r.status);
    return '400, 403, 401';
  });

  await record('w7', '360 px: nothing before the tap, no horizontal scroll, the tap loads a youtube-nocookie embed', async () => {
    const small = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const p = await small.newPage();
    const yt = [];
    p.on('request', (rq) => { if (/youtube|ytimg|googlevideo/.test(rq.url())) yt.push(rq.url()); });
    await p.route(/youtube-nocookie\.com/, (route) => route.abort());
    try {
      const landed = await login(p, '9999900001', '/app/mother/');
      if (landed !== '/app/mother/') throw new Error('landed ' + landed);
      await p.waitForFunction(() => window.TutpWatchLearn, null, { timeout: 20000 });
      const shown = await p.evaluate(async ({ id, lesson }) => {
        const host = document.createElement('div'); host.id = 'wlHost'; document.body.appendChild(host);
        return window.TutpWatchLearn.mount(host, { studentId: id, lesson, subject: 'Maths', language: 'Telugu' });
      }, { id: pro.studentId, lesson: lessonOf('g') });
      if (!shown) throw new Error('card not shown');
      const root = p.locator('#wlHost .wl-root');
      if (!/Watch & Learn/.test(await root.locator('.wl-title').innerText())) throw new Error('no title');
      const items = root.locator('.wl-item');
      if ((await items.count()) !== 5) throw new Error('items ' + (await items.count()));
      const first = items.first();
      if (!(await first.locator('.wl-vtitle').innerText()) || !(await first.locator('.wl-channel').innerText()) || !(await first.locator('img').count())) throw new Error('item lacks title, channel or thumbnail');
      if (await p.locator('#wlHost iframe').count()) throw new Error('iframe before the tap');
      const early = yt.filter(u => /youtube-nocookie|googlevideo/.test(u));
      if (early.length) throw new Error('YouTube request before the tap: ' + early[0]);
      const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (wide > 1) throw new Error('horizontal scroll ' + wide + 'px');
      const box = await first.locator('.wl-report').boundingBox();
      if (!box || box.height < 40) throw new Error('report link too small to tap');
      await first.locator('.wl-play').click();
      const src = await p.locator('#wlHost .wl-item').first().locator('iframe').getAttribute('src');
      if (!/^https:\/\/www\.youtube-nocookie\.com\/embed\//.test(src || '')) throw new Error('embed src ' + src);
      return 'no iframe or request before the tap; embed after; no scroll';
    } finally { await small.close(); }
  });

  // Free child (family 18): one video, the rest locked.
  const freeCtx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const fp = await freeCtx.newPage();
  const freeLanded = await login(fp, '9999900004', '/app/mother/').catch(() => '');
  let free = null;
  if (freeLanded === '/app/mother/') {
    const ffid = (await call(fp, 'GET', '/api/session/me')).body.familyId;
    free = ((await call(fp, 'GET', `/api/billing/status/${ffid}`)).body.children || []).find(c => !c.active && c.tier === 'free') || null;
  }

  await record('w4', 'Free child: 1 video + 4 locked, and no id of a locked video in the response', async () => {
    if (!free) throw new Error('no Free test child (family 18) to test with');
    const lesson = { studentId: free.studentId, lesson: lessonOf('a'), subject: 'Maths', language: 'Telugu' };
    const r = await call(fp, 'GET', q(lesson));
    if (r.status !== 200) throw new Error('status ' + r.status);
    if (r.body.videos.length !== 1 || r.body.locked !== 4) throw new Error(`videos ${r.body.videos.length}, locked ${r.body.locked}`);
    const text = JSON.stringify(r.body);
    for (const id of firstIds.slice(1)) if (text.includes(id)) throw new Error('a locked video id was sent: ' + id);
    return '1 video, 4 locked, 0 hidden ids';
  }, fp);

  await record('w8', 'Free at 360 px: locked cards are blurred, "Unlock with Pro" opens the plan chooser', async () => {
    if (!free) throw new Error('no Free test child');
    await fp.waitForFunction(() => window.TutpWatchLearn && window.TutpBilling, null, { timeout: 20000 });
    await fp.waitForTimeout(1500);
    const shown = await fp.evaluate(async ({ id, lesson }) => {
      const host = document.createElement('div'); host.id = 'wlHost'; document.body.appendChild(host);
      return window.TutpWatchLearn.mount(host, { studentId: id, lesson, subject: 'Maths', language: 'Telugu' });
    }, { id: free.studentId, lesson: lessonOf('a') });
    if (!shown) throw new Error('card not shown for the Free child');
    const locked = fp.locator('#wlHost .wl-locked');
    if ((await locked.count()) !== 4) throw new Error('locked cards ' + (await locked.count()));
    const blur = await locked.first().locator('.wl-meta').evaluate(e => getComputedStyle(e).filter);
    if (!/blur/.test(blur)) throw new Error('locked card is not blurred: ' + blur);
    const wide = await fp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error('horizontal scroll ' + wide + 'px');
    await locked.first().locator('.wl-unlock').click();
    await fp.locator('#billingChooser').waitFor({ state: 'visible', timeout: 10000 });
    return '4 blurred, chooser opens';
  }, fp);

  await freeCtx.close();
  await ctx.close();
  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'watch-learn-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e watch-learn] fatal', e); process.exit(1); });
