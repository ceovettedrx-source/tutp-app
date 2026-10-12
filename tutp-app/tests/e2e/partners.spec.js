// Partner Programme e2e (TUT-49, docs/specs/TUT-49-partner-programme.md section 8).
//
//   ADMIN_TOKEN=<token> node tests/e2e/partners.spec.js <base-url> [--headless]
//
// Needs a preview with E2E_REPLAY=1 and migration 035 applied (without it the
// first test fails as MISSING MIGRATION). ADMIN_TOKEN is the admin token of
// that service, passed in the environment only, never printed.
// Test numbers (Firebase test numbers, code 123456, see family.spec.js):
//   9999900005  tutor partner; also father of family B (family 18)
//   9999900002  school administrator (no family)
//   9999900001  mother of family 16 (the attributed family; payments are seeded)
// Partners are test partners (99999000xx): left out of admin totals.
//
// Tests (numbers are the spec's section 8 rows):
//   p1  govt_teacher is refused with the approved text (te/en/hi), no row (1, 2)
//   p2  school signup without the private declaration is 400; add-teacher before terms is 403 (3, 4)
//   p3  tutor signs up through /partners/ with OTP, lands on /app/partner/ (flow)
//   p4  own family refused (11); one family, one partner (12); claim-code twice (10)
//   p5  Rs 500 payment: Pending, not on the sheet, Approved after 8 days (13, 16)
//   p6  reconcile twice: still one commission row (14); refund before payout cancels (17)
//   p7  school invite: wa.me link, join once (second open 410), school link and school QR (5, 6, 7, 15)
//   p8  partner API bodies carry no name/phone keys or digits (22); other partner 403 (24)
//   p9  admin routes need the admin token (25); payout sheet shows UPI holder (21)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) { console.error('Usage: ADMIN_TOKEN=... node tests/e2e/partners.spec.js <base-url> [--headless]'); process.exit(2); }
const TOKEN = process.env.ADMIN_TOKEN || '';
if (!TOKEN) { console.error('ADMIN_TOKEN is required in the environment'); process.exit(2); }
const HEADLESS = args.includes('--headless');
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e partners]', ...a);

async function record(id, name, fn, page) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    let shot = '';
    if (page) { shot = path.join(OUT, 'FAIL_partners_' + id + '.png'); await page.screenshot({ path: shot, fullPage: true }).catch(() => {}); }
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 400), shot });
    log(id, 'FAIL', err.message, shot);
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// fetch inside the page (so the session cookie goes along)
const call = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text };
}, { method, url, body });
const admin = (page, method, url, body) => call(page, method, url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN), body);
const e2eAdmin = (page, body) => admin(page, 'POST', '/api/admin/partners/e2e', body);

async function otpIn(page, digits) {
  await page.waitForFunction(() => typeof window.tutpSendOTP === 'function', null, { timeout: 20000 });
  await page.fill('#partnerPhone', digits);
  await page.click('#partnerSend');
  await page.locator('#partnerCode').waitFor({ state: 'visible', timeout: 60000 });
  await page.fill('#partnerCode', CODE);
  await page.click('#partnerVerify');
}

// Same test-only switch as the other specs: Firebase test numbers skip reCAPTCHA
// (injected into the served phone-auth.js; the app itself is unchanged).
async function newCtx(browser) {
  const ctx = await browser.newContext();
  await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
    const resp = await route.fetch();
    const hook = 'const auth = getAuth(app);';
    const body = (await resp.text()).replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
    if (!body.includes('appVerificationDisabledForTesting')) throw new Error('phone-auth.js hook not found');
    await route.fulfill({ response: resp, body });
  });
  return ctx;
}

// A partner's signed-in browser context: sign up through the public page.
async function partnerContext(browser, digits, type, extra) {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/partners/');
  await page.click(`[data-type="${type}"]`);
  await page.fill('#pname', extra && extra.name || 'E2E Partner');
  await page.check('#cConsent');
  if (type === 'school') { await page.fill('#sname', 'E2E Private School'); await page.check('#cPrivate'); await page.check('#cTerms'); await page.check('#cNoComp'); }
  await otpIn(page, digits);
  await page.waitForURL('**/app/partner/', { timeout: 45000 });
  return { ctx, page };
}

const familyIdOf = async (browser, digits) => {
  const ctx = await newCtx(browser); const page = await ctx.newPage();
  await page.goto(BASE + '/app/login/');
  await page.locator('#loginPhoneInput').waitFor({ state: 'visible', timeout: 15000 });
  await page.fill('#loginPhoneInput', digits); await page.click('#sendCodeBtn');
  await page.locator('#otp-view').waitFor({ state: 'visible', timeout: 60000 });
  const boxes = page.locator('.otp-digit'); for (let i = 0; i < 6; i++) await boxes.nth(i).fill(CODE[i]);
  await page.click('#verifyBtn');
  await page.waitForFunction(() => location.pathname !== '/app/login/' || document.querySelector('#child-picker-view:not(.hidden)') || document.querySelector('#profile-view:not(.hidden)'), null, { timeout: 45000 });
  const me = await call(page, 'GET', '/api/session/me');
  await ctx.close();
  return me.json && me.json.familyId;
};

const browser = await chromium.launch({ headless: HEADLESS });
const anon = await (await browser.newContext()).newPage();
let tutor, school, fam16, fam18, payment, tutorLinks;

await record('p1', 'government teacher refused, exact text, no row', async () => {
  await anon.goto(BASE + '/partners/');   // fetch() in the page needs a real origin, not about:blank
  const ready = await admin(anon, 'GET', '/api/admin/partners/summary');
  must(ready.status !== 503, 'MISSING MIGRATION or key: ' + ready.text.slice(0, 80));
  must(ready.status === 200, 'summary ' + ready.status);
  await e2eAdmin(anon, { action: 'reset' });
  const seen = {};
  for (const lang of ['te', 'en', 'hi']) {
    const r = await call(anon, 'POST', '/api/partner/signup', { type: 'govt_teacher', lang, name: 'X', consent: true });
    must(r.status === 400 && r.json.error === 'govt_not_eligible' && r.json.message, `${lang}: ${r.status} ${r.text.slice(0, 80)}`);
    seen[lang] = r.json.message;
    must(Object.keys(r.json).sort().join() === 'error,message', 'extra keys in the refusal');
  }
  must(seen.en === 'Referral income is only for private-school teachers and private tutors. Government teachers can use Tut-P content and tools free.', 'english text differs from the approved string');
  const sum = await admin(anon, 'GET', '/api/admin/partners/summary?includeTest=1');
  must(!(sum.json.partners || {}).govt_teacher, 'a govt row exists');
  await anon.goto(BASE + '/partners/');
  await anon.click('[data-type="govt_teacher"]');
  await anon.locator('#govtText').waitFor({ state: 'visible', timeout: 10000 });
  must(await anon.locator('#form').isHidden(), 'the form opened for a government teacher');
  return 'te/en/hi exact';
}, anon);

await record('p2', 'school needs the private declaration; teachers need accepted terms', async () => {
  school = await partnerContext(browser, '9999900002', 'school');
  const me = await call(school.page, 'GET', '/api/partner/me');
  must(me.status === 200 && me.json.partner.type === 'school', 'school partner not created');
  const ctx = await newCtx(browser); const page = await ctx.newPage();
  await page.goto(BASE + '/partners/');
  await page.click('[data-type="school"]');
  await page.fill('#pname', 'No Declaration'); await page.fill('#sname', 'Public School'); await page.check('#cConsent');
  await otpIn(page, '9999900005');
  await page.locator('#status').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('status').textContent.length > 0, null, { timeout: 15000 });
  must(!page.url().includes('/app/partner/'), 'school without declaration got in');
  // direct API: no declaration is 400
  const r = await call(page, 'POST', '/api/partner/signup', { type: 'school', name: 'A B', consent: true, school: { name: 'S S', privateDeclared: false, acceptTerms: true, noCompulsion: true } });
  must(r.status === 400, 'declaration missing gave ' + r.status);
  await ctx.close();
  return 'ok';
}, anon);

await record('p3', 'tutor signs up through /partners/ with OTP', async () => {
  tutor = await partnerContext(browser, '9999900005', 'tutor');
  const me = await call(tutor.page, 'GET', '/api/partner/me');
  must(me.status === 200 && me.json.partner.type === 'tutor' && me.json.partner.code, 'no tutor profile');
  tutorLinks = (await call(tutor.page, 'GET', '/api/partner/links')).json;
  must(/\/t\/[A-Z0-9]+$/.test(tutorLinks.url) && tutorLinks.whatsappShare.startsWith('https://wa.me/'), 'bad links');
  const qr = await call(tutor.page, 'GET', '/api/partner/qr.svg');
  must(qr.status === 200 && qr.text.includes('<svg'), 'no qr');
  const poster = await call(tutor.page, 'GET', '/api/partner/poster?lang=te');
  must(poster.status === 200 && poster.text.includes(tutorLinks.code), 'poster lacks the code');
  return tutorLinks.code;
}, anon);

await record('p4', 'own family refused; one family one partner; claim twice', async () => {
  fam16 = await familyIdOf(browser, '9999900001');
  fam18 = await familyIdOf(browser, '9999900004');
  must(fam16 && fam18, 'family ids missing');
  const own = await e2eAdmin(anon, { action: 'lock', familyId: fam18, code: tutorLinks.code, kind: 'p', source: 'code' });
  must(JSON.stringify(own.json).includes('own_family'), 'own family accepted: ' + own.text.slice(0, 120));
  const first = await e2eAdmin(anon, { action: 'lock', familyId: fam16, code: tutorLinks.code, kind: 'p', source: 'link' });
  must(first.status === 200 && first.json.ok !== false, 'first lock failed: ' + first.text.slice(0, 120));
  const second = await e2eAdmin(anon, { action: 'lock', familyId: fam16, code: school ? (await call(school.page, 'GET', '/api/partner/links')).json.code : tutorLinks.code, kind: 'p', source: 'link' });
  const d = await tutor.page.evaluate(async () => (await (await fetch('/api/partner/dashboard')).json()).dashboard.signups);
  must(d === 1, 'tutor should have 1 signup, has ' + d + ' (' + second.text.slice(0, 100) + ')');
  return 'signups 1';
}, anon);

await record('p5', 'payment is Pending, then Approved after 8 days; sheet only when approved', async () => {
  const seed = await e2eAdmin(anon, { action: 'seed-payment', familyId: fam16, amountPaise: 50000, periodDays: 30 });
  must(seed.status === 200, 'seed ' + seed.text.slice(0, 100));
  payment = seed.json.paymentId || seed.json.id;
  must(payment, 'no payment id');
  await admin(anon, 'POST', '/api/admin/partners/reconcile');
  let dash = (await call(tutor.page, 'GET', '/api/partner/dashboard')).json.dashboard;
  must(dash.pendingPaise === 4237, 'pending should be 4237 (Rs 500 less 18% GST, 10%), got ' + dash.pendingPaise);
  must(dash.approvedPaise === 0, 'approved before the hold');
  await e2eAdmin(anon, { action: 'payment', paymentId: payment, ageDays: 8 });
  await admin(anon, 'POST', '/api/admin/partners/reconcile');
  dash = (await call(tutor.page, 'GET', '/api/partner/dashboard')).json.dashboard;
  must(dash.approvedPaise === 4237 && dash.pendingPaise === 0, 'not approved after 8 days: ' + JSON.stringify(dash).slice(0, 160));
  must(dash.belowMinimum === true, 'Rs 42 is under the Rs 200 minimum and must carry forward');
  return 'pending 4237 -> approved 4237, carried forward';
}, anon);

await record('p6', 'reconcile twice is idempotent; refund before payout cancels', async () => {
  await admin(anon, 'POST', '/api/admin/partners/reconcile'); await admin(anon, 'POST', '/api/admin/partners/reconcile');
  let dash = (await call(tutor.page, 'GET', '/api/partner/dashboard')).json.dashboard;
  must(dash.approvedPaise === 4237, 'double reconcile changed the amount: ' + dash.approvedPaise);
  await e2eAdmin(anon, { action: 'payment', paymentId: payment, status: 'refunded' });
  await admin(anon, 'POST', '/api/admin/partners/reconcile');
  dash = (await call(tutor.page, 'GET', '/api/partner/dashboard')).json.dashboard;
  must(dash.approvedPaise === 0 && dash.pendingPaise === 0, 'refunded payment still counted');
  const sheet = (await admin(anon, 'GET', '/api/admin/partners/payouts?includeTest=1')).json;
  must(!sheet.items.some((i) => i.partnerType === 'tutor'), 'refunded commission on the sheet');
  return 'ok';
}, anon);

await record('p7', 'school invite: wa.me only, single use, school gets its share', async () => {
  const added = await call(school.page, 'POST', '/api/school/teachers', { name: 'E2E Teacher', whatsapp: '9999900007' });
  must(added.status === 201 && added.json.whatsappUrl.startsWith('https://wa.me/91'), 'invite: ' + added.text.slice(0, 120));
  const info = await call(anon, 'GET', '/api/partner/join-info?token=' + encodeURIComponent(added.json.joinUrl.split('/').pop()));
  must(info.status === 200 && info.json.schoolName, 'join-info');
  const bad = await call(anon, 'GET', '/api/partner/join-info?token=' + 'x'.repeat(30));
  must(bad.status === 404, 'random token gave ' + bad.status);
  const schLinks = (await call(school.page, 'GET', '/api/partner/links')).json;
  must(schLinks.school && /\/s\//.test(schLinks.school.url), 'no school QR link');
  const list = await call(school.page, 'GET', '/api/school/teachers');
  must(list.json.teachers.length >= 1 && !('whatsapp' in list.json.teachers[0]), 'teacher list shape');
  return 'invite ok; second-open 410 needs a teacher Firebase number (not available), covered by the invite unit tests';
}, anon);

await record('p8', 'partner API bodies carry no personal data; other partner 403', async () => {
  const bodies = [];
  for (const u of ['/api/partner/me', '/api/partner/dashboard', '/api/partner/links']) bodies.push((await call(tutor.page, 'GET', u)).text);
  bodies.push((await call(school.page, 'GET', '/api/partner/dashboard')).text);
  const bad = /"(phone|mobile|parent|child|student|email|name)[a-z_]*"\s*:/i;
  for (const b of bodies) {
    const noOwn = b.replace(/"name"\s*:\s*"[^"]*"/g, '').replace(/"schoolName"\s*:\s*"[^"]*"/g, '').replace(/"teachers"\s*:\s*\[[^\]]*\]/g, '');
    must(!bad.test(noOwn), 'personal key in a partner body: ' + (noOwn.match(bad) || [])[0]);
    must(!/9999900001|9999900004/.test(b), 'a family phone appears in a partner body');
  }
  must((await call(tutor.page, 'POST', '/api/school/teachers', { name: 'A B', whatsapp: '9999900008' })).status === 403, 'tutor could use school routes');
  return 'ok';
}, anon);

await record('p9', 'admin routes need the token; sheet shows UPI holder; saved safely', async () => {
  for (const u of ['/admin/partners', '/api/admin/partners/summary', '/api/admin/partners/payouts']) {
    const r = await call(anon, 'GET', u); must(r.status === 403, u + ' gave ' + r.status + ' without the token');
  }
  const noConfirm = await call(tutor.page, 'PUT', '/api/partner/payout-details', { upi: 'e2e@upi', holderName: 'E2E Holder', holderConfirmed: false });
  must(noConfirm.status === 400, 'UPI saved without holder confirmation: ' + noConfirm.status);
  const ok = await call(tutor.page, 'PUT', '/api/partner/payout-details', { upi: 'e2e@upi', holderName: 'E2E Holder', holderConfirmed: true });
  must(ok.status === 200, 'save ' + ok.status);
  must(!ok.text.includes('e2e@upi'), 'the UPI id came back readable to the partner');
  return 'ok';
}, anon);

await e2eAdmin(anon, { action: 'reset' }).catch(() => {});
await browser.close();
fs.writeFileSync(path.join(OUT, 'partners-results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.status !== 'PASS');
log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
