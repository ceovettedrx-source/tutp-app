// TUT-104: each e2e account logs in once per run; every spec reuses that session.
//
// run.js makes a temp dir (makeAuthDir), logs the shared accounts in once
// (loginAll) and passes the dir to every spec process as E2E_AUTH_DIR. preload.mjs
// (loaded into every spec) calls installSessionCache on each browser context:
// when a spec asks for an OTP for a cached account, the cached session cookie is
// put on the context instead and no OTP is sent. Login state is the server's
// session cookie (JWT, no server-side state; login.spec b proves cookies alone
// restore a session). The Firebase IndexedDB entry is saved in the state file
// (storageState indexedDB:true) but the dashboards never read it after login.
//
// Specs that must keep a fresh real login are not in CACHED_SPECS: login.spec.js
// (OTP screen, logout, role guard), family.spec.js (registration, r4 removes a
// member), partners.spec.js, cache.spec.js, cron.spec.js.
//
// Never commit the state files: they sit in os.tmpdir() and run.js deletes them.
import fs from 'fs';
import os from 'os';
import path from 'path';

export const CACHED_SPECS = ['el', 'story', 'library', 'homework', 'chips', 'img1', 'learning-library', 'answer-explain', 'visual-tutor']
  .map((s) => s + '.spec.js');
// Family 16 (mother, father, member) and family B's mother. 9999900005/06 belong to
// family.spec.js (r4 adds and removes 06 on every run), which stays fresh.
export const CACHED_PHONES = ['9999900001', '9999900002', '9999900003', '9999900004'];
export const OTP_TARGET = 30;
export const OTP_HARD = 50;
export const CACHED_TOKEN = 'tutp-e2e-cached-session'; // a marker string, not a credential. secret-scan:allow
const DIR_PREFIX = 'tutp-e2e-auth-';
const OTP_LOG = 'otp-count.log';
const OTP_URL = 'accounts:sendVerificationCode';

export const phone10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
export const authDir = () => process.env.E2E_AUTH_DIR || null;
export const statePath = (dir, phone) => path.join(dir, phone10(phone) + '.json');
export const isCachedSpec = (file) => CACHED_SPECS.includes(path.basename(String(file || '')));

export function makeAuthDir() { return fs.mkdtempSync(path.join(os.tmpdir(), DIR_PREFIX)); }
export function removeAuthDir(dir) {
  if (!dir) return;
  if (!path.basename(dir).startsWith(DIR_PREFIX) && !path.basename(dir).startsWith(DIR_PREFIX + 'test-')) throw new Error('refusing to delete a dir that is not an e2e auth dir: ' + dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

// storageState({ indexedDB: true }) output. The "logged out" marker cookie is
// dropped so a restored session is never treated as logged out.
export function saveState(dir, phone, state) {
  const clean = { ...state, cookies: (state.cookies || []).filter((c) => c.name !== 'tutp_logged_out') };
  fs.writeFileSync(statePath(dir, phone), JSON.stringify(clean), { mode: 0o600 });
}
export function readCookies(dir, phone) {
  try { return JSON.parse(fs.readFileSync(statePath(dir, phone), 'utf8')).cookies || null; } catch { return null; }
}

export const recordOtp = (dir) => fs.appendFileSync(path.join(dir, OTP_LOG), 'send\n');
export function countOtp(dir) {
  try { return fs.readFileSync(path.join(dir, OTP_LOG), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}
export const budgetVerdict = (n) => (n > OTP_HARD ? 'fail' : n > OTP_TARGET ? 'over-target' : 'ok');

// Counts every Firebase "send verification code" request a context makes
// (the real quota unit), cached or not.
export function countOtpRequests(ctx, dir) {
  ctx.on('request', (r) => { if (r.url().includes(OTP_URL)) recordOtp(dir); });
}

// In the page: tutpSendOTP for a cached account puts the cookie on the context
// (through the exposed binding) and sends nothing; tutpVerifyOTP then returns a
// marker and tutpEstablishSession turns it into a /api/session/me check.
const INIT = `(() => {
  const TOKEN = ${JSON.stringify(CACHED_TOKEN)};
  let cached = false;
  const wrap = (name, make) => {
    let real;
    Object.defineProperty(window, name, { configurable: true, enumerable: true, get() { return real ? make(real) : real; }, set(v) { real = v; } });
  };
  wrap('tutpSendOTP', (real) => async (phone) => {
    cached = !!(window.__tutpCachedLogin && await window.__tutpCachedLogin(phone));
    if (!cached) return real(phone);
  });
  wrap('tutpVerifyOTP', (real) => async (code) => (cached ? TOKEN : real(code)));
  wrap('tutpEstablishSession', (real) => async (t) => {
    if (t !== TOKEN) return real(t);
    const r = await fetch('/api/session/me');
    return { ok: r.ok, status: r.status, data: null };
  });
})();`;

export async function installSessionCache(ctx, dir) {
  await ctx.exposeBinding('__tutpCachedLogin', async ({ context }, phone) => {
    const cookies = readCookies(dir, phone);
    if (!cookies || !cookies.length) return false;
    await context.addCookies(cookies);
    return true;
  });
  await ctx.addInitScript(INIT);
}

// One real login per cached account. A failed login is logged and skipped: the
// specs then send a real OTP for that account, as they did before the cache.
export async function loginAll(base, dir, { headless = true, code = '123456', log = console.log } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless });
  let ok = 0;
  try {
    for (const phone of CACHED_PHONES) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
      ctx.setDefaultTimeout(30000);
      countOtpRequests(ctx, dir);
      await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
        const resp = await route.fetch();
        const body = await resp.text();
        const hook = 'const auth = getAuth(app);';
        await route.fulfill({ response: resp, body: body.includes(hook) ? body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;') : body });
      });
      try {
        const page = await ctx.newPage();
        await page.goto(base + '/app/login/');
        await page.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
        const status = await page.evaluate(async ({ phone, code }) => {
          await window.tutpSendOTP(phone);
          const idToken = await window.tutpVerifyOTP(code);
          return (await window.tutpEstablishSession(idToken)).status;
        }, { phone: '+91' + phone, code });
        if (status !== 200) throw new Error('/api/session returned ' + status);
        saveState(dir, phone, await ctx.storageState({ indexedDB: true }));
        ok++;
      } catch (e) {
        log(`[auth-cache] login for ...${phone.slice(-4)} failed (${String(e.message || e).slice(0, 120)}); its specs log in on their own`);
      } finally {
        await ctx.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return ok;
}
