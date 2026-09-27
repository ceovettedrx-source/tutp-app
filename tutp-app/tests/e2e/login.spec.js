// Login e2e suite: phone OTP, session restore, logout, error text, role guard.
//
//   npm run test:e2e -- <base-url> [tests] [--headless]
//   e.g. npm run test:e2e -- https://preview---tutp-demo-vs4743puka-uc.a.run.app
//        npm run test:e2e -- https://preview---tutp-demo-vs4743puka-uc.a.run.app fgij
//
// Run it against a no-traffic preview revision (Definition of done in
// CLAUDE.md). Needs Google Chrome installed; headed by default.
//
// Test data (fictional Firebase test numbers, code 123456):
//   9999900001  mother of the test family (family 16)
//   9999900002  father of the same family
//   9999900003  family member of the same family
// Each number must be listed under Firebase Console > Authentication >
// Sign-in method > Phone > Phone numbers for testing, and must belong to
// exactly one family: a number shared by two families makes login ambiguous.
//
// reCAPTCHA serves an image challenge to automated Chrome, so the test
// browser (only) gets Firebase's documented test switch
// (appVerificationDisabledForTesting), which works with test numbers only.
// It is injected into the served /app/shared/phone-auth.js; the app itself
// is unchanged. The reCAPTCHA path itself is therefore NOT exercised here:
// check a failed send / resend by hand on a real device.
//
// Tests:
//   u  unit check, always run first: normalizePhone("+91 99999 00003") ===
//      "+919999900003" (plus dashes, plain digits, blank, too short)
//   a  mother login -> mother dashboard (and the session has the mother role)
//   b  cookies only (no tab state) -> /app/login/ lands on the dashboard, no OTP
//   c  logout -> a fresh browser with the remaining cookies sees the phone form
//   d  wrong code -> plain-language message, no raw Firebase text
//   e  after d: Resend, then the right code -> logged in
//   f  father -> own dashboard; mother's data 403 and /app/mother/ redirects
//   g  member -> own dashboard; mother's/father's data 403, both pages redirect,
//      a foreign member id in the tab is reset to the member's own
//   h  parent dashboard -> child view loads without a redirect to login
//   i  role guard fails closed: with empty roles cached in the tab the page
//      goes through /app/login/?pick=1 (which re-asks the server) instead of
//      staying open; with /api/session/me answering roleMatches: [] it ends
//      on /app/login/ and the profile picker
//   j  phone normalization: the family member entered as "+91 99999 00003" is
//      stored as "+919999900003" and signs in to their own dashboard. If
//      family 16 has no member with that number, the test adds one through
//      the Family page first (this exercises the add-member write path)
//
// Output: tests/e2e/output/ (results.json, FAIL_<test>.png). Exit code 1 if
// any test fails.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePhone } from '../../server/services/phone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: npm run test:e2e -- <base-url> [tests] [--headless]');
  process.exit(2);
}
const only = (args.find(a => /^[a-j]+$/.test(a)) || 'abcdefghij').split('');
const HEADLESS = args.includes('--headless');

const PHONES = { mother: '9999900001', father: '9999900002', member: '9999900003' };
const CODE = '123456';
const DASH = { mother: '/app/mother/', father: '/app/father/', member: '/app/family-member/' };
const ROLE_KEY = { mother: 'mother', father: 'father', member: 'family_member' };
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];

function log(...a) { console.log('[e2e]', ...a); }

// Copy cookies as host-only (url, not domain), like a real browser holds
// them; addCookies with `domain` makes a domain cookie the server's
// host-only clear on logout cannot remove.
function hostOnly(cookies) {
  return cookies.map(c => ({ name: c.name, value: c.value, url: BASE, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, expires: c.expires }));
}

async function shot(page, name) {
  const f = path.join(OUT, name + '.png');
  try { await page.screenshot({ path: f, fullPage: true }); } catch (e) {}
  return f;
}

async function record(id, name, fn, page) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    const p = page ? (typeof page === 'function' ? page() : page) : null;
    const f = p ? await shot(p, 'FAIL_' + id) : '';
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 300), shot: f });
    log(id, 'FAIL', err.message, f);
  }
}

async function waitCheckDone(page) {
  await page.waitForFunction(() => !document.documentElement.classList.contains('tutp-checking'), null, { timeout: 15000 }).catch(() => {});
}

async function enterCode(page, code) {
  const boxes = page.locator('.otp-digit');
  await boxes.first().waitFor({ state: 'visible', timeout: 30000 });
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).fill('');
  for (let i = 0; i < n; i++) await boxes.nth(i).fill(code[i]);
}

async function sendCode(page, digits) {
  await page.goto(BASE + '/app/login/');
  await waitCheckDone(page);
  await page.locator('#loginPhoneInput').waitFor({ state: 'visible', timeout: 15000 });
  await page.fill('#loginPhoneInput', digits);
  await page.click('#sendCodeBtn');
  // Either the OTP view appears or the phone error shows.
  await Promise.race([
    page.locator('#otp-view').waitFor({ state: 'visible', timeout: 60000 }),
    page.locator('#phoneError:not(.hidden)').waitFor({ state: 'visible', timeout: 60000 }).then(async () => {
      throw new Error('send failed: ' + (await page.textContent('#phoneError')));
    })
  ]);
}

// After a correct code: picks the first child, or the role's profile tile
// when the login page shows the grid.
async function finishLanding(page, role) {
  const want = DASH[role];
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const url = new URL(page.url());
    if (url.pathname === want) return url.pathname;
    if (url.pathname !== '/app/login/') return url.pathname;
    if (await page.locator('#child-picker-view').isVisible().catch(() => false)) {
      await page.locator('#childPickerList button').first().click();
    } else if (await page.locator('#profile-view').isVisible().catch(() => false)) {
      await page.locator('#profileGrid [data-profile-tile]').first().waitFor({ timeout: 15000 }).catch(() => {});
      const tile = page.locator(`#profileGrid a[href="${want}"]`).first();
      if (await tile.count()) await tile.click();
    } else if (await page.locator('#otpError:not(.hidden)').isVisible().catch(() => false)) {
      throw new Error('otp error: ' + (await page.textContent('#otpError')));
    }
    await page.waitForTimeout(700);
  }
  return new URL(page.url()).pathname;
}

async function login(page, role) {
  await sendCode(page, PHONES[role]);
  await enterCode(page, CODE);
  await page.click('#verifyBtn');
  return finishLanding(page, role);
}

// Opens a path and returns where the page settles (redirects followed).
async function settle(page, p) {
  await page.goto(BASE + p);
  let last = '', stable = 0;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && stable < 4) {
    await page.waitForTimeout(500);
    const cur = new URL(page.url()).pathname;
    stable = cur === last ? stable + 1 : 0;
    last = cur;
  }
  return last;
}

// page.evaluate that survives a navigation landing mid-call (the guard's
// restore reload, or the login page's round trip back to a dashboard): wait
// for the page to finish loading, and retry once if a navigation still
// destroyed the context.
async function evalAfterLoad(page, fn, arg) {
  for (let attempt = 0; ; attempt++) {
    await page.waitForLoadState('load').catch(() => {});
    try {
      return await page.evaluate(fn, arg);
    } catch (err) {
      if (attempt > 0 || !/Execution context was destroyed|navigation/i.test(err.message)) throw err;
    }
  }
}

async function sessionMe(page) {
  return page.evaluate(async () => {
    const r = await fetch('/api/session/me', { cache: 'no-store' });
    return { status: r.status, body: r.ok ? await r.json() : null };
  });
}

async function apiStatus(page, url) {
  return page.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, url);
}

// The session must carry this role; a test number shared by two families
// shows up here as no roles at all.
function assertRole(me, role) {
  const roles = (me.body && me.body.roleMatches || []).map(r => r.role);
  if (!roles.includes(ROLE_KEY[role])) {
    throw new Error(`session roles [${roles.join(',')}] lack ${ROLE_KEY[role]} (test number shared by two families?)`);
  }
  return roles;
}

(async () => {
  log('base', BASE, 'tests', only.join(''));

  // Unit check, always run: the stored phone format (server/services/phone.js).
  await record('u', 'normalizePhone("+91 99999 00003") === "+919999900003"', async () => {
    const cases = [
      ['+91 99999 00003', '+919999900003'],
      ['99999-00003', '+919999900003'],
      ['9999900003', '+919999900003'],
      ['', null],
      ['12345', null]
    ];
    for (const [input, want] of cases) {
      const got = normalizePhone(input);
      if (got !== want) throw new Error(`normalizePhone(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
    return cases.length + ' cases';
  });
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 50 });
  const newCtx = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/app/shared/phone-auth.js', async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      const hook = 'const auth = getAuth(app);';
      if (!body.includes(hook)) throw new Error('phone-auth.js hook not found');
      body = body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
      await route.fulfill({ response: resp, body });
    });
    return ctx;
  };

  let motherCookies = null;
  let motherPage = null;

  if (only.some(t => 'abchij'.includes(t))) {
    const ctx = await newCtx();
    motherPage = await ctx.newPage();
    await record('a', 'mother login -> mother dashboard', async () => {
      const p = await login(motherPage, 'mother');
      if (p !== DASH.mother) throw new Error('landed on ' + p);
      const me = await sessionMe(motherPage);
      const roles = assertRole(me, 'mother');
      motherCookies = await ctx.cookies();
      return `landed ${p}; familyId ${me.body.familyId}; children ${me.body.children.length}; roles ${roles.join(',')}`;
    }, motherPage);
  }

  if (only.includes('h') && motherPage) {
    await record('h', 'parent dashboard -> child view loads', async () => {
      await motherPage.goto(BASE + DASH.mother);
      await motherPage.waitForLoadState('networkidle').catch(() => {});
      const btn = motherPage.locator('button[onclick*="/app/child/"]').first();
      if (await btn.count()) await btn.click(); else await motherPage.goto(BASE + '/app/child/');
      await motherPage.waitForURL('**/app/child/**', { timeout: 15000 });
      await motherPage.waitForTimeout(4000);
      const p = new URL(motherPage.url()).pathname;
      if (p !== '/app/child/') throw new Error('ended on ' + p);
      return 'stayed on /app/child/ after 4s';
    }, motherPage);
  }

  if (only.includes('i')) {
    let iPage = null;
    await record('i', 'role guard fails closed with no roles -> /app/login/ profile picker', async () => {
      if (!motherCookies) throw new Error('no mother cookies (test a failed or skipped)');
      const out = [];
      const expectPicker = async (page, label) => {
        await settle(page, DASH.mother);
        // The login page shows "Checking your login…" while it asks the
        // server, so give the picker up to 10s to appear.
        const picker = await page.locator('#profile-view').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
        const end = new URL(page.url()).pathname;
        out.push(`${label}: /app/mother/ -> ${end}${picker ? ' (profile picker)' : ''}`);
        if (end !== '/app/login/' || !picker) throw new Error(`${label} did not fail closed (${out.join('; ')})`);
      };
      // 1. Empty roles cached in the tab: the page must not stay open. The
      // guard sends it to /app/login/?pick=1, which asks the server again;
      // this session really is the mother, so it comes back to /app/mother/
      // with the roles re-fetched.
      const c1 = await newCtx(); await c1.addCookies(hostOnly(motherCookies));
      iPage = await c1.newPage();
      await settle(iPage, DASH.mother);
      await evalAfterLoad(iPage, () => sessionStorage.setItem('tutp_roles', '[]'));
      const visited = [];
      const onNav = (fr) => { if (fr === iPage.mainFrame()) visited.push(new URL(fr.url()).pathname + new URL(fr.url()).search); };
      iPage.on('framenavigated', onNav);
      await settle(iPage, DASH.mother);
      // The login page may still be asking the server (slow on a freshly
      // started revision), so wait for the way back instead of trusting
      // "no change for 2s".
      await iPage.waitForURL((u) => new URL(u).pathname === DASH.mother, { timeout: 15000 }).catch(() => {});
      const end1 = new URL(iPage.url()).pathname;
      iPage.off('framenavigated', onNav);
      const roles1 = await evalAfterLoad(iPage, () => sessionStorage.getItem('tutp_roles'));
      out.push(`cached []: ${visited.join(' > ')}; roles now ${roles1}`);
      if (!visited.includes('/app/login/?pick=1')) throw new Error(`cached [] did not go through /app/login/?pick=1 (${out.join('; ')})`);
      if (end1 !== DASH.mother || !/"mother"/.test(roles1 || '')) throw new Error(`cached [] did not come back with the mother role (${out.join('; ')})`);
      await c1.close();
      // 2. The server reports no roles (as for a phone shared by two families).
      const c2 = await newCtx(); await c2.addCookies(hostOnly(motherCookies));
      await c2.route('**/api/session/me', async (route) => {
        const resp = await route.fetch();
        const body = await resp.json().catch(() => null);
        if (!body) return route.fulfill({ response: resp });
        await route.fulfill({ response: resp, json: { ...body, roleMatches: [] } });
      });
      iPage = await c2.newPage();
      await expectPicker(iPage, 'server []');
      await c2.close();
      iPage = null;
      return out.join('; ');
    }, () => iPage);
  }

  if (only.includes('j')) {
    let jPage = null;
    await record('j', 'member entered as "+91 99999 00003" is stored normalized and signs in', async () => {
      if (!motherPage || !motherCookies) throw new Error('no mother session (test a failed or skipped)');
      jPage = motherPage;
      const out = [];
      const members = async () => jPage.evaluate(async () => {
        const fid = sessionStorage.getItem('tutp_family_id');
        return ((await (await fetch('/api/family/' + fid + '/members')).json()).members || []).map(m => m.phone || '');
      });
      await settle(jPage, DASH.mother);
      let phones = await members();
      let stored = phones.find(p => p.replace(/\D/g, '').endsWith(PHONES.member));
      if (!stored) {
        await jPage.goto(BASE + '/app/family/');
        await jPage.locator('#memberName').waitFor({ state: 'visible', timeout: 20000 });
        await jPage.selectOption('#memberRole', 'Other');
        await jPage.fill('#memberName', 'Test Member');
        await jPage.fill('#memberPhone', '+91 99999 00003');
        const [resp] = await Promise.all([
          jPage.waitForResponse(r => r.url().includes('/api/family/add-member'), { timeout: 20000 }),
          jPage.click('#addBtn')
        ]);
        if (resp.status() !== 200) throw new Error('add-member returned ' + resp.status());
        out.push('added via Family page as "+91 99999 00003"');
        phones = await members();
        stored = phones.find(p => p.replace(/\D/g, '').endsWith(PHONES.member));
      } else {
        out.push('member already present');
      }
      out.push(`stored as ${stored}`);
      if (stored !== '+91' + PHONES.member) throw new Error(`member phone not normalized (${out.join('; ')})`);
      const c = await newCtx();
      jPage = await c.newPage();
      const landed = await login(jPage, 'member');
      out.push(`member sign-in -> ${landed}`);
      if (landed !== DASH.member) throw new Error(`member sign-in ended on ${landed} (${out.join('; ')})`);
      await c.close();
      jPage = null;
      return out.join('; ');
    }, () => jPage);
  }

  let bPage = null, bCtx = null;
  if (only.includes('b')) {
    await record('b', 'cookies-only context -> /app/login/ lands on dashboard, no OTP', async () => {
      if (!motherCookies) throw new Error('no mother cookies (test a failed or skipped)');
      bCtx = await newCtx();
      await bCtx.addCookies(hostOnly(motherCookies));
      bPage = await bCtx.newPage();
      let otpShown = false;
      await bPage.goto(BASE + '/app/login/');
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await bPage.locator('#otp-view').isVisible().catch(() => false)) otpShown = true;
        if (new URL(bPage.url()).pathname !== '/app/login/') break;
        if (await bPage.locator('#child-picker-view').isVisible().catch(() => false)) break;
        await bPage.waitForTimeout(300);
      }
      const p = new URL(bPage.url()).pathname;
      if (otpShown) throw new Error('OTP view was shown');
      if (p !== DASH.mother) throw new Error('ended on ' + p + (await bPage.locator('#child-picker-view').isVisible() ? ' (child picker)' : ''));
      return 'landed ' + p + ' without OTP';
    }, () => bPage);
  }

  if (only.includes('c')) {
    let p2 = null;
    await record('c', 'logout -> new context -> phone form', async () => {
      let page = bPage, ctx = bCtx;
      if (!page) {
        if (!motherCookies) throw new Error('no mother session (test a failed or skipped)');
        ctx = await newCtx(); await ctx.addCookies(hostOnly(motherCookies)); page = await ctx.newPage();
      }
      if (new URL(page.url()).pathname !== DASH.mother) await page.goto(BASE + DASH.mother);
      // Log out while the dashboard is still loading: in-flight requests
      // must not bring the session back.
      await page.waitForLoadState('load');
      await page.waitForFunction(() => typeof window.logout === 'function', null, { timeout: 20000 });
      page.once('dialog', d => d.accept());
      const link = page.locator('a[onclick^="logout"]:visible').first();
      if (await link.count()) await link.click(); else await page.evaluate(() => window.logout());
      await page.waitForURL('**/app/login/**', { timeout: 15000 });
      await page.waitForTimeout(3000);
      const c2 = await newCtx(); await c2.addCookies(hostOnly(await ctx.cookies()));
      p2 = await c2.newPage();
      await p2.goto(BASE + '/app/login/');
      await waitCheckDone(p2);
      await p2.locator('#loginPhoneInput').waitFor({ state: 'visible', timeout: 10000 });
      const me = await sessionMe(p2);
      await c2.close();
      if (me.status !== 401) throw new Error('/api/session/me after logout = ' + me.status);
      return 'phone form shown; /api/session/me = 401';
    }, () => p2 || bPage);
  }

  if (only.some(t => 'de'.includes(t))) {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    let dOk = false;
    await record('d', 'wrong code -> plain-language message', async () => {
      await sendCode(page, PHONES.mother);
      await enterCode(page, '000000');
      await page.click('#verifyBtn');
      await page.locator('#otpError:not(.hidden)').waitFor({ timeout: 30000 });
      const t = (await page.textContent('#otpError')).trim();
      if (!t) throw new Error('empty error');
      if (/firebase|auth\//i.test(t)) throw new Error('raw Firebase text: ' + t);
      dOk = true;
      return `"${t}"`;
    }, page);
    if (only.includes('e')) {
      await record('e', 'after wrong code: Resend, then 123456 -> logged in', async () => {
        if (!dOk) throw new Error('depends on d');
        await page.click('#resendCodeBtn');
        await page.waitForFunction(() => {
          const r = document.getElementById('resendCodeBtn').textContent;
          const e = document.getElementById('otpError');
          return /Code sent/.test(r) || (e && !e.classList.contains('hidden') && e.textContent.trim());
        }, null, { timeout: 60000 });
        const resendTxt = (await page.textContent('#resendCodeBtn')).trim();
        const errVisible = await page.locator('#otpError:not(.hidden)').isVisible();
        if (errVisible && !/Code sent/.test(resendTxt)) throw new Error('resend failed: ' + (await page.textContent('#otpError')));
        await enterCode(page, CODE);
        await page.click('#verifyBtn');
        const p = await finishLanding(page, 'mother');
        if (p !== DASH.mother) throw new Error('landed on ' + p);
        return 'resend OK, landed ' + p;
      }, page);
    }
    await ctx.close();
  }

  for (const [id, role, forbidden] of [['f', 'father', ['mother']], ['g', 'member', ['mother', 'father']]]) {
    if (!only.includes(id)) continue;
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await record(id, `${role} login -> own dashboard; other roles' pages redirect, data 403`, async () => {
      const p = await login(page, role);
      if (p !== DASH[role]) throw new Error('landed on ' + p);
      const me = await sessionMe(page);
      assertRole(me, role);
      const fid = me.body.familyId;
      const out = [];
      for (const other of forbidden) {
        const s = await apiStatus(page, `/api/bonding-score/${fid}/${other}`);
        out.push(`${other} bonding-score=${s}`);
        if (s !== 403) throw new Error(`${other} data returned ${s}, expected 403 (${out.join('; ')})`);
        const endedOn = await settle(page, DASH[other]);
        out.push(`open ${DASH[other]} -> ${endedOn}`);
        if (endedOn !== DASH[role]) throw new Error(`opening ${DASH[other]} ended on ${endedOn}, expected ${DASH[role]} (${out.join('; ')})`);
      }
      // Same check with cookies only (no tab state): restore, then role guard.
      const c2 = await newCtx(); await c2.addCookies(hostOnly(await ctx.cookies()));
      const p2 = await c2.newPage();
      const coldEnd = await settle(p2, DASH[forbidden[0]]);
      await c2.close();
      out.push(`cold open ${DASH[forbidden[0]]} -> ${coldEnd}`);
      if (coldEnd !== DASH[role]) throw new Error(`cold open ended on ${coldEnd} (${out.join('; ')})`);
      if (role === 'member') {
        // Another member id in the tab must be replaced by the own one.
        const own = await page.evaluate(() => sessionStorage.getItem('tutp_family_member_id'));
        await page.evaluate(() => sessionStorage.setItem('tutp_family_member_id', '999999'));
        const endMem = await settle(page, DASH.member);
        const nowId = await page.evaluate(() => sessionStorage.getItem('tutp_family_member_id'));
        out.push(`foreign member id -> ${nowId === own ? 'reset to own' : 'kept ' + nowId}`);
        if (endMem !== DASH.member || nowId !== own) throw new Error(`member id not reset (${out.join('; ')})`);
      }
      return `landed ${p}; ${out.join('; ')}`;
    }, page);
    await ctx.close();
  }

  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e] fatal', e); process.exit(1); });
