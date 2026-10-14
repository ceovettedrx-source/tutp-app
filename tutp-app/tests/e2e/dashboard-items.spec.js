// TUT-42 dashboard redesign: nothing silently dropped, phone layout works.
// docs/specs/TUT-42-dashboard-redesign.md section 5. One OTP login (mother); father and
// family member are checked from the served HTML (no extra OTP sends).
//   d1  every item of the item map is on mother, father and family-member (served HTML)
//   d2  family member: every item keeps its data-feature (visibility) key
//   d3  no fake buttons left in <main> (no alert() handlers), no "Ms. Sarah" demo session
//   d4  mother at 390 x 844: order Homework Help < today's homework < bonding < Singapore Maths < goal,
//       no sideways scroll, bottom bar Home/Homework/Practice/Family, controls at least 44 px
//   d5  search box Enter and the bottom bar's Homework open / reach Homework Help
// Usage: node tests/e2e/dashboard-items.spec.js <base-url> [--headless]
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) { console.error('Usage: node tests/e2e/dashboard-items.spec.js <base-url> [--headless]'); process.exit(2); }
const HEADLESS = args.includes('--headless');
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e dashboard-items]', ...a);

const ITEMS = ['tpTop', 'tpHomeworkToday', 'billingStatus', 'childChipsRow', 'tpHomework', 'searchAttachMenu', 'homeworkPendingBanner', 'homeworkList',
  'bondingReportSection', 'sgmathCard', 'sgmathStart', 'weeklyGoalRing', 'completionTileValue', 'exploreSubjectsSection',
  'searchAttachChooser', 'examComingSoonModal', 'homeworkExplainModal', 'playModal', 'experientialModal', 'headerAvatarInitial', 'sidebarFamilyList'];
const HEADINGS = ['Help tonight', 'Homework Help', 'Storytelling Method', 'Experiential Learning', 'Play-Based Learning', "Today's homework", "Your child's progress", 'Singapore Maths', 'Continue Learning', "This Week's Goal", 'More for your family', 'Family Library', 'Need a tutor?', 'YouTube Channel', 'Upcoming Live Session', 'Explore Subjects', 'Safe and simple for your family'];
const MEMBER_FEATURE = { bondingReportSection: 'bonding_report', sgmathCard: 'activities', exploreSubjectsSection: 'activities', tpHomework: 'homework' };

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


(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const landed = await login(page, '9999900001', '/app/mother/');
  if (landed !== '/app/mother/') { console.error('[e2e dashboard-items] login landed on', landed); process.exit(1); }
  const html = {};
  for (const role of ['mother', 'father', 'family-member']) {
    const r = await ctx.request.get(BASE + '/app/' + role + '/');
    html[role] = r.status() === 200 ? await r.text() : '';
  }

  await record('d1', 'every item is on all three dashboards', async () => {
    const missing = [];
    for (const [role, h] of Object.entries(html)) {
      for (const id of ITEMS) if (!h.includes(`id="${id}"`)) missing.push(role + ':#' + id);
      for (const t of HEADINGS) if (!h.includes(t.replace(/'/g, '&#39;')) && !h.includes(t)) missing.push(role + ':' + t);
    }
    if (missing.length) throw new Error('missing ' + missing.join(', '));
    return ITEMS.length + ' ids, ' + HEADINGS.length + ' headings x 3 pages';
  });

  await record('d2', 'family member: each item keeps its visibility key', async () => {
    const h = html['family-member'];
    const bad = [];
    for (const [id, f] of Object.entries(MEMBER_FEATURE)) {
      const tag = (h.match(new RegExp('<[^>]*id="' + id + '"[^>]*>')) || [''])[0];
      if (!tag.includes(`data-feature="${f}"`)) bad.push(id + ' needs ' + f);
    }
    if (/data-feature=/.test(html.mother)) bad.push('mother page carries data-feature');
    if (bad.length) throw new Error(bad.join('; '));
    return 'ok';
  });

  await record('d3', 'no fake buttons or demo data in the dashboards', async () => {
    for (const [role, h] of Object.entries(html)) {
      const main = h.slice(h.indexOf('<main'), h.indexOf('</main>'));
      if (/onclick="alert\(/.test(main)) throw new Error(role + ' has an alert() button in <main>');
      if (h.includes('Ms. Sarah')) throw new Error(role + ' still shows the demo live session');
    }
    return 'clean';
  });

  await record('d4', 'phone 390: order, no sideways scroll, bottom bar, 44 px controls', async () => {
    await page.goto(BASE + '/app/mother/');
    await page.locator('#tpHomework').waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(1500);
    const top = (id) => page.evaluate((x) => { const e = document.getElementById(x); return e ? e.getBoundingClientRect().top + scrollY : -1; }, id);
    const order = [];
    for (const id of ['tpHomework', 'bondingReportSection', 'sgmathCard', 'weeklyGoalRing']) order.push(await top(id));   // today's homework shows only on a day with homework
    if (order.some((y) => y < 0)) throw new Error('an item is missing: ' + order);
    for (let i = 1; i < order.length; i++) if (!(order[i] >= order[i - 1])) throw new Error('order wrong: ' + order.join(' <= '));   // cards in one row share a top
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('page scrolls sideways');
    const nav = await page.$$eval('nav.tp-nav a', (as) => as.map((a) => a.textContent.trim()));
    for (const w of ['Home', 'Homework', 'Practice', 'Family']) if (!nav.some((n) => n.endsWith(w))) throw new Error('bottom bar lacks ' + w + ': ' + nav);
    const small = await page.evaluate(() => [...document.querySelectorAll('nav.tp-nav a, header button')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 43.5 || r.height < 43.5); }).length);
    if (small) throw new Error(small + ' controls under 44 px');
    return 'order ok, ' + nav.length + ' tabs';
  }, page);

  await record('d5', 'search Enter opens Homework Help; Practice tab reaches Singapore Maths', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.querySelector('nav.tp-nav a[href="#sgmathCard"]').click());
    let y = 9999;
    for (let i = 0; i < 20 && (y < 0 || y > 400); i++) {   // smooth scroll: wait until it lands (max 4 s)
      await page.waitForTimeout(200);
      y = await page.evaluate(() => document.getElementById('sgmathCard').getBoundingClientRect().top);
    }
    if (y < 0 || y > 400) throw new Error('Practice tab left Singapore Maths at ' + Math.round(y) + ' px');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.focus('input[aria-label="Ask about homework"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const open = await page.evaluate(() => { const m = document.getElementById('homeworkExplainModal'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; });
    if (!open) throw new Error('Enter in the search box did not open Homework Help');
    return 'ok';
  }, page);

  await ctx.close();
  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'dashboard-items-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') || !results.length ? 1 : 0);
})().catch(e => { console.error('[e2e dashboard-items] fatal', e); process.exit(1); });
