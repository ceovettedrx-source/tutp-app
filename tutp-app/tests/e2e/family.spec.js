// Family e2e suite (round 3, docs/specs/round-3-launch-blockers.md): add a
// child, add the other parent, duplicate-phone registration, removing a
// member ends their sign-in, fast /api/session/me and the loading spinner.
//
//   npm run test:e2e -- <base-url>          (run.js runs every spec)
//   node tests/e2e/family.spec.js <base-url> [--headless]
//
// Test data (fictional Firebase test numbers, code 123456; each must be
// listed under Firebase Console > Authentication > Sign-in method > Phone >
// Phone numbers for testing):
//   9999900001  mother of family 16 (login.spec.js), used here as a taken phone
//   9999900003  member of family 16, for the 403 probes
//   9999900004  mother of family B, registered by r3 on its first run
//               (marked is_test by the server: a test number)
//   9999900005  father of family B, added by r2 on its first run
//   9999900006  member of family B, added and removed by r4 on every run
// Family B is kept between runs: r1 adds children up to the cap of 6 on its
// first run and checks the cap after; r2 fills the father slot once and
// checks the slot is closed after. Nothing is ever deleted except r4's member.
//
// Tests:
//   r3 register: a registered phone is stopped at the OTP step with a sign-in
//      link, and /api/register refuses it (409 already_registered); family
//      B is registered on 9999900004 when it doesn't exist yet
//   r2 mother B adds the father by phone (Family page); a phone already in a
//      family is refused (409 phone_in_use); the father signs in with OTP and
//      lands on /app/father/ of family B
//   r1 add a child on the Family page; the 7th child is refused (409
//      child_limit); family 16's member gets 403 on add-child
//   r4 mother B adds member 9999900006, who signs in; the member's own
//      add-child / add-parent / remove-member get 403; the mother removes
//      them on the Family page (confirm dialog); the member's open session
//      gets 401 on its next request and its dashboard goes to /app/login/
//   r5 /api/session/me Server-Timing total under 800 ms (fast path); a slow
//      /me shows the loading spinner on a cold open, then the dashboard
//
// Output: tests/e2e/output/family-results.json, FAIL_<test>.png. Exit 1 on
// any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/family.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONES = { mother16: '9999900001', member16: '9999900003', motherB: '9999900004', fatherB: '9999900005', memberB: '9999900006' };
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e family]', ...a);

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

async function me(page) {
  return page.evaluate(async () => {
    const r = await fetch('/api/session/me', { cache: 'no-store' });
    return { status: r.status, timing: r.headers.get('server-timing') || '', body: r.ok ? await r.json() : null };
  });
}

async function post(page, url, body) {
  return page.evaluate(async ({ url, body }) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { url, body });
}

async function get(page, url) {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { cache: 'no-store' });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, url);
}

async function openFamilyPage(page) {
  await page.goto(BASE + '/app/family/');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('#memberList').waitFor({ state: 'visible', timeout: 20000 });
}

// Register page up to the OTP step for `digits`; returns 'registered' (the
// sign-in message showed) or 'new' (the form moved on to step 4).
async function registerOtp(page, digits) {
  await page.goto(BASE + '/app/register/');
  await page.waitForLoadState('networkidle').catch(() => {});
  // The page reports a failed send with alert(); keep its text for the error.
  let alertText = '';
  const onDialog = (d) => { alertText = d.message(); d.dismiss().catch(() => {}); };
  page.on('dialog', onDialog);
  await page.waitForFunction(() => typeof window.tutpSendOTP === 'function', null, { timeout: 20000 });
  await page.evaluate((d) => {
    const send = window.tutpSendOTP;
    window.tutpSendOTP = async (n) => { try { return await send(n); } catch (e) { window.__otpErr = (e.code || '') + ' ' + (e.message || ''); throw e; } };
    goToStep(2);
    document.getElementById('motherPhone').value = d;
    return proceedToPhoneVerification();
  }, digits);
  const boxes = page.locator('[data-step="3"] .otp-box');
  await boxes.first().waitFor({ state: 'visible', timeout: 60000 }).catch(async (e) => {
    const code = await page.evaluate(() => window.__otpErr || '').catch(() => '');
    throw new Error(alertText ? `send failed: ${alertText} (${code})` : e.message);
  });
  page.off('dialog', onDialog);
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(CODE[i]);
  await page.click('#verifyStep3Btn');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.locator('#regSignInLink').isVisible().catch(() => false)) return 'registered';
    if (await page.locator('[data-step="4"]:not(.step-hidden)').isVisible().catch(() => false)) return 'new';
    // Never wait on a hidden error (textContent waits 30 s for the element).
    const errEl = page.locator('#regOtpError:not(.hidden)');
    const err = (await errEl.count()) ? await errEl.textContent() : '';
    if (err && !/already registered/i.test(err)) throw new Error('otp step: ' + err);
    await page.waitForTimeout(500);
  }
  throw new Error('OTP step did not finish');
}

// A minimal registration through the real endpoint, with the page's own
// verified token (regIdToken, a top-level binding of the register page).
async function submitMinimal(page, digits) {
  return page.evaluate(async (d) => {
    const r = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        regIdToken,
        location: { country: 'India', state: 'Telangana', district: 'Hyderabad', mandal: 'Ameerpet' },
        mother: { name: 'E2E Mother B', phone: d },
        father: { name: '', phone: '' },
        extendedFamily: [],
        children: [{ name: 'E2E Child B1', class: 'Class 5', plan: 'free' }],
        consentGiven: true,
        submittedAt: new Date().toISOString(),
      }),
    });
    const body = await r.json().catch(() => null);
    if (r.ok) await window.tutpEstablishSession(regIdToken);
    return { status: r.status, body };
  }, digits);
}

(async () => {
  log('base', BASE);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 30 });
  const newCtx = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
      const resp = await route.fetch();
      const hook = 'const auth = getAuth(app);';
      const body = (await resp.text()).replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
      if (!body.includes('appVerificationDisabledForTesting')) throw new Error('phone-auth.js hook not found');
      await route.fulfill({ response: resp, body });
    });
    return ctx;
  };

  // r3 first: it creates family B on the first run.
  const regCtx = await newCtx();
  const regPage = await regCtx.newPage();
  await record('r3', 'registered phone -> sign in, never a second family', async () => {
    const out = [];
    const taken = await registerOtp(regPage, PHONES.mother16);
    out.push(`family 16 mother at OTP step: ${taken}`);
    if (taken !== 'registered') throw new Error(out.join('; '));
    const href = await regPage.getAttribute('#regSignInLink', 'href');
    if (href !== '/app/login/') throw new Error('sign-in link ' + href);
    const again = await submitMinimal(regPage, PHONES.mother16);
    out.push(`/api/register anyway: ${again.status} ${again.body && again.body.code}`);
    if (again.status !== 409 || again.body.code !== 'already_registered') throw new Error(out.join('; '));
    const b = await registerOtp(regPage, PHONES.motherB);
    out.push(`family B mother at OTP step: ${b}`);
    if (b === 'new') {
      const made = await submitMinimal(regPage, PHONES.motherB);
      out.push(`family B registered: ${made.status}`);
      if (made.status !== 200) throw new Error(out.join('; ') + ' ' + JSON.stringify(made.body));
    } else {
      out.push('family B exists: stopped at the OTP step');
    }
    return out.join('; ');
  }, regPage);
  await regCtx.close();

  const mCtx = await newCtx();
  const mPage = await mCtx.newPage();
  let familyB = null;
  await record('r2', 'add the father by phone; he signs in with OTP', async () => {
    const out = [];
    const landed = await login(mPage, PHONES.motherB, '/app/mother/');
    const m = await me(mPage);
    familyB = m.body && m.body.familyId;
    out.push(`mother B landed ${landed}, family ${familyB}`);
    if (landed !== '/app/mother/' || !familyB) throw new Error(out.join('; '));
    const taken = await post(mPage, '/api/family/add-parent', { family_id: familyB, parent: { name: 'Taken', phone: PHONES.mother16 } });
    out.push(`taken phone -> ${taken.status} ${taken.body && taken.body.code}`);
    if (taken.status !== 409 || taken.body.code !== 'phone_in_use') throw new Error(out.join('; '));
    await openFamilyPage(mPage);
    const open = await mPage.locator('#addParentCard').isVisible();
    if (open) {
      await mPage.fill('#parentName', 'E2E Father B');
      await mPage.fill('#parentPhone', '+91 99999 00005');
      await mPage.click('#addParentBtn');
      await mPage.locator('#parentStatus.text-success').waitFor({ timeout: 15000 });
      out.push('father added on the Family page');
    } else {
      const closed = await post(mPage, '/api/family/add-parent', { family_id: familyB, parent: { name: 'X', phone: '9999900007' } });
      out.push(`slot already filled -> ${closed.status} ${closed.body && closed.body.code}`);
      if (closed.status !== 409 || closed.body.code !== 'slot_filled') throw new Error(out.join('; '));
    }
    const fCtx = await newCtx();
    const fPage = await fCtx.newPage();
    try {
      const fl = await login(fPage, PHONES.fatherB, '/app/father/');
      const fm = await me(fPage);
      const roles = (fm.body && fm.body.roleMatches || []).map(r => r.role);
      out.push(`father landed ${fl}, family ${fm.body && fm.body.familyId}, roles ${roles}`);
      if (fl !== '/app/father/' || fm.body.familyId !== familyB || !roles.includes('father')) throw new Error(out.join('; '));
    } finally { await fCtx.close(); }
    return out.join('; ');
  }, mPage);

  await record('r1', 'add a child; the 7th is refused; a member gets 403', async () => {
    if (!familyB) throw new Error('no family B session (r2 failed)');
    const out = [];
    const count = async () => ((await get(mPage, `/api/family/${familyB}/students`)).body.students || []).length;
    let n = await count();
    out.push(`children before ${n}`);
    await openFamilyPage(mPage);
    if (n < 6) {
      const name = 'E2E Child B' + (n + 1);
      await mPage.fill('#childName', name);
      await mPage.selectOption('#childClass', 'Class 3');
      await mPage.click('#addChildBtn');
      await mPage.locator('#childStatus.text-success').waitFor({ timeout: 15000 });
      const kids = (await get(mPage, `/api/family/${familyB}/students`)).body.students || [];
      if (!kids.some(k => k.name === name)) throw new Error(`${name} not in the list`);
      out.push(`added ${name} on the Family page`);
      while ((n = await count()) < 6) {
        const r = await post(mPage, '/api/family/add-child', { family_id: familyB, child: { name: 'E2E Child B' + (n + 1), class: 'Class 2' } });
        if (r.status !== 200) throw new Error(`filling to 6: ${r.status}`);
      }
    }
    await mPage.fill('#childName', 'E2E Child B7');
    await mPage.click('#addChildBtn');
    await mPage.locator('#childStatus.text-error').waitFor({ timeout: 15000 });
    const msg = await mPage.textContent('#childStatus');
    const api = await post(mPage, '/api/family/add-child', { family_id: familyB, child: { name: 'E2E Child B7' } });
    out.push(`7th child: "${msg}", api ${api.status} ${api.body && api.body.code}; now ${await count()}`);
    if (!/at most 6/.test(msg) || api.status !== 409 || api.body.code !== 'child_limit' || (await count()) !== 6) throw new Error(out.join('; '));
    const c16 = await newCtx();
    const p16 = await c16.newPage();
    try {
      await login(p16, PHONES.member16, '/app/family-member/');
      const fid = (await me(p16)).body.familyId;
      const r = await post(p16, '/api/family/add-child', { family_id: fid, child: { name: 'e2e probe (not saved)' } });
      out.push(`family 16 member add-child -> ${r.status}`);
      if (r.status !== 403) throw new Error(out.join('; '));
    } finally { await c16.close(); }
    return out.join('; ');
  }, mPage);

  await record('r4', 'removed member -> 401 on the next request', async () => {
    if (!familyB) throw new Error('no family B session (r2 failed)');
    const out = [];
    const members = async () => (await get(mPage, `/api/family/${familyB}/members`)).body.members || [];
    let mine = (await members()).find(m => String(m.phone || '').endsWith(PHONES.memberB));
    if (!mine) {
      const r = await post(mPage, '/api/family/add-member', { family_id: familyB, member: { name: 'E2E Member B', role: 'Aunt', phone: PHONES.memberB } });
      if (r.status !== 200) throw new Error('add-member ' + r.status);
      mine = (await members()).find(m => String(m.phone || '').endsWith(PHONES.memberB));
    }
    const memCtx = await newCtx();
    const memPage = await memCtx.newPage();
    try {
      const landed = await login(memPage, PHONES.memberB, '/app/family-member/');
      const before = await me(memPage);
      out.push(`member landed ${landed}, me ${before.status}`);
      if (landed !== '/app/family-member/' || before.status !== 200) throw new Error(out.join('; '));
      const probes = [
        await post(memPage, '/api/family/add-child', { family_id: familyB, child: { name: 'e2e probe (not saved)' } }),
        await post(memPage, '/api/family/add-parent', { family_id: familyB, parent: { name: 'x', phone: '9999900007' } }),
        await post(memPage, '/api/family/remove-member', { family_id: familyB, member_id: mine.id }),
      ].map(r => r.status);
      out.push(`member add-child/add-parent/remove -> ${probes.join('/')}`);
      if (probes.some(s => s !== 403)) throw new Error(out.join('; '));
      await openFamilyPage(mPage);
      mPage.once('dialog', d => d.accept());
      await mPage.locator(`#memberList li[data-member-id="${mine.id}"] .remove-member-btn`).click();
      await mPage.locator('#memberListStatus.text-success').waitFor({ timeout: 15000 });
      out.push('removed on the Family page');
      // Through the context (same cookie jar): the member's open dashboard may
      // see the 401 first and navigate to /app/login/ under a page.evaluate.
      const afterRes = await memCtx.request.get(`${BASE}/api/family/${familyB}/students`);
      const after = { status: afterRes.status(), body: await afterRes.json().catch(() => null) };
      const meAfter = { status: (await memCtx.request.get(`${BASE}/api/session/me`)).status() };
      out.push(`member next request ${after.status} (${after.body && after.body.reason}), then me ${meAfter.status}`);
      if (after.status !== 401 || meAfter.status !== 401) throw new Error(out.join('; '));
      await memPage.goto(BASE + '/app/family-member/');
      await memPage.waitForURL('**/app/login/**', { timeout: 20000 });
      out.push('dashboard -> /app/login/');
      if ((await members()).some(m => m.id === mine.id)) throw new Error('member row still there');
    } finally { await memCtx.close(); }
    return out.join('; ');
  }, mPage);

  await record('r5', '/me fast path under 800 ms; spinner on a slow cold open', async () => {
    const out = [];
    const totals = [];
    for (let i = 0; i < 3; i++) {
      const r = await me(mPage);
      const t = /total;dur=(\d+)/.exec(r.timing);
      totals.push(t ? Number(t[1]) : NaN);
      if (!/family;dur=/.test(r.timing)) throw new Error('not the fast path: ' + r.timing);
    }
    out.push(`me server ms ${totals.join(', ')}`);
    if (!(Math.min(...totals) < 800)) throw new Error(out.join('; '));
    const cCtx = await newCtx();
    await cCtx.addCookies((await mCtx.cookies()).map(c => ({ name: c.name, value: c.value, url: BASE, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, expires: c.expires })));
    await cCtx.route('**/api/session/me', async (route) => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
    const cPage = await cCtx.newPage();
    try {
      cPage.goto(BASE + '/app/mother/').catch(() => {});
      await cPage.locator('#tutpGuardSpinner').waitFor({ state: 'visible', timeout: 5000 });
      out.push('spinner visible');
      await cPage.waitForFunction(() => location.pathname === '/app/mother/' && !document.getElementById('tutpGuardSpinner') && document.documentElement.style.visibility !== 'hidden' && document.readyState === 'complete', null, { timeout: 30000 });
      out.push('then the dashboard');
    } finally { await cCtx.close(); }
    return out.join('; ');
  }, mPage);

  await mCtx.close();
  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'family-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e family] fatal', e); process.exit(1); });
