// Max on sale, flag off (TUT-45, docs/specs/TUT-45-max-on-sale.md): MAX_ON_SALE is
// unset on the preview, so Max is shown as "Coming soon" and checkout refuses it.
// No Razorpay order is ever created here (the refusals come before it), no model
// calls, no spend.
//
//   m1  /api/billing/status: max_monthly listed with buyable false, tier on every child,
//       the paid test child (family 16) is still tier pro and active (Pro unchanged)
//   m2  POST /api/billing/checkout plan max_monthly -> 400 not_for_sale; an unknown plan
//       -> 400 Invalid plan
//   m3  the plan chooser shows Max as a disabled "Coming soon" button, Pro stays clickable
//
// Usage: node tests/e2e/max-plan.spec.js <base-url> [--headless]
// Output: tests/e2e/output/max-plan-results.json, FAIL_<test>.png. Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/max-plan.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e max-plan]', ...a);

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

// JSON call made by the page itself, so it carries the session cookie.
async function call(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const r = await fetch(url, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  }, { method, url, body });
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const landed = await login(page, '9999900001', '/app/mother/');
  if (landed !== '/app/mother/') { console.error('[e2e max-plan] login landed on', landed); process.exit(1); }
  const fid = (await call(page, 'GET', '/api/session/me')).body.familyId;
  let status = null;

  await record('m1', 'status lists Max as not buyable, tier on every child, Pro unchanged', async () => {
    const r = await call(page, 'GET', `/api/billing/status/${fid}`);
    if (r.status !== 200) throw new Error('status ' + r.status);
    status = r.body;
    const max = (status.plans || []).find(p => p.key === 'max_monthly');
    if (!max) throw new Error('max_monthly not listed');
    if (max.buyable !== false || max.tier !== 'max') throw new Error('max plan ' + JSON.stringify(max));
    const pro = (status.plans || []).find(p => p.key === 'pro_monthly');
    if (!pro || pro.buyable !== true) throw new Error('pro_monthly not buyable');
    const kids = status.children || [];
    if (!kids.length) throw new Error('no children');
    for (const c of kids) if (!['free', 'pro', 'ultrapro', 'max'].includes(c.tier)) throw new Error('bad tier ' + c.tier);
    const paid = kids.find(c => c.active);
    if (!paid || paid.tier !== 'pro') throw new Error('paid test child not pro: ' + JSON.stringify(paid));
    return `tiers ${kids.map(c => c.tier).join(',')}`;
  });

  await record('m2', 'checkout refuses Max while the flag is off', async () => {
    const kid = ((status && status.children) || [])[0];
    if (!kid) throw new Error('no child');
    const r = await call(page, 'POST', '/api/billing/checkout', { studentId: kid.studentId, plan: 'max_monthly' });
    if (r.status !== 400 || !r.body || r.body.error !== 'not_for_sale') throw new Error(`got ${r.status} ${JSON.stringify(r.body)}`);
    const bad = await call(page, 'POST', '/api/billing/checkout', { studentId: kid.studentId, plan: 'nope' });
    if (bad.status !== 400 || bad.body.error !== 'Invalid plan') throw new Error(`unknown plan: ${bad.status}`);
    return '400 not_for_sale; unknown plan 400';
  });

  await record('m3', 'chooser: Max is a disabled "Coming soon" button, Pro stays clickable', async () => {
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => window.TutpBilling, null, { timeout: 20000 });
    const kid = status.children[0];
    await page.waitForTimeout(1500);   // billing.js refresh() has loaded the plans
    await page.evaluate(id => window.TutpBilling.choosePlan(id), kid.studentId);
    const max = page.locator('#billingChooser button[data-plan="max_monthly"]');
    await max.waitFor({ state: 'visible', timeout: 10000 });
    const txt = (await max.textContent()).trim();
    if (!(await max.isDisabled())) throw new Error('Max button is enabled');
    if (!/coming soon/i.test(txt)) throw new Error('Max text: ' + txt);
    const pro = page.locator('#billingChooser button[data-plan="pro_monthly"]');
    if (await pro.isDisabled()) throw new Error('Pro button disabled');
    return txt;
  }, page);

  await ctx.close();
  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'max-plan-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e max-plan] fatal', e); process.exit(1); });
