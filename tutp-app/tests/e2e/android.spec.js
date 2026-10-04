// Android app preparation e2e (docs/specs/android-prep.md): manifest, Digital
// Asset Links, service worker and the three policy pages. No sign-in, no model call.
//
//   node tests/e2e/android.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
//   n1  manifest.json: fields, scope, three icons served as PNG
//   n2  /.well-known/assetlinks.json: 200, application/json, no redirect, package id, fingerprints well-formed
//   n3  /sw.js and /offline.html served; the worker is revalidated, never cached for a year
//   n4  Chrome's own installability check reports no errors on the home page
//   n5  the worker takes control and caches only the offline page and one icon
//   n6  offline: a page load shows the offline page; an /api call fails (is never answered from a cache)
//   n7  /privacy/ /terms/ /delete-account/: 200, DRAFT banner, noindex, contact email, no sideways scroll at 360 px
//   n8  privacy page keeps the DPDP consent placeholder; the old claims the code contradicts are absent
// Output: tests/e2e/output/ (FAIL_n*.png, android-results.json). Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/android.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];

function log(...a) { console.log('[e2e:android]', ...a); }
async function record(id, name, fn, page) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    const f = path.join(OUT, 'FAIL_' + id + '.png');
    const p = typeof page === 'function' ? page() : page;
    if (p) await p.screenshot({ path: f, fullPage: true }).catch(() => {});
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 400), shot: p ? f : '' });
    log(id, 'FAIL', err.message);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  log('base', BASE);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
  const page = await ctx.newPage();

  await record('n1', 'manifest and icons', async () => {
    const r = await fetch(BASE + '/manifest.json');
    expect(r.status === 200, 'manifest status ' + r.status);
    const m = await r.json();
    for (const k of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'icons']) expect(m[k], 'manifest.' + k + ' missing');
    expect(m.display === 'standalone' && m.theme_color === '#005bbf' && m.scope === '/', 'manifest display/theme/scope: ' + JSON.stringify([m.display, m.theme_color, m.scope]));
    const want = [['any', '192x192'], ['any', '512x512'], ['maskable', '512x512']];
    for (const [purpose, sizes] of want) {
      const icon = m.icons.find(i => i.purpose === purpose && i.sizes === sizes);
      expect(icon, `no ${purpose} ${sizes} icon`);
      const ir = await fetch(BASE + icon.src);
      expect(ir.status === 200 && /image\/png/.test(ir.headers.get('content-type') || ''), `${icon.src} -> ${ir.status} ${ir.headers.get('content-type')}`);
    }
    return 'icons 192, 512, maskable served';
  });

  await record('n2', 'assetlinks.json', async () => {
    const r = await fetch(BASE + '/.well-known/assetlinks.json', { redirect: 'manual' });
    expect(r.status === 200, 'assetlinks status ' + r.status + ' (a redirect also fails the Android check)');
    const type = r.headers.get('content-type') || '';
    expect(/^application\/json/.test(type), 'content-type ' + type);
    const st = await r.json();
    const t = st[0] && st[0].target;
    expect(t && t.namespace === 'android_app' && t.package_name === 'online.tutp.app', 'target ' + JSON.stringify(t));
    expect(st[0].relation.includes('delegate_permission/common.handle_all_urls'), 'relation ' + JSON.stringify(st[0].relation));
    const fps = t.sha256_cert_fingerprints || [];
    expect(fps.length >= 1 && fps.every(f => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)), 'fingerprints malformed: ' + JSON.stringify(fps));
    const head = await fetch(BASE + '/.well-known/assetlinks.json', { method: 'HEAD', redirect: 'manual' });
    expect(head.status === 200, 'HEAD status ' + head.status);
    const placeholder = fps.every(f => /^(00:){31}00$/.test(f));
    return placeholder ? 'placeholder fingerprint (expected before the Play account)' : fps.length + ' real fingerprint(s)';
  });

  await record('n3', 'service worker files', async () => {
    const sw = await fetch(BASE + '/sw.js');
    expect(sw.status === 200 && /javascript/.test(sw.headers.get('content-type') || ''), `sw.js ${sw.status} ${sw.headers.get('content-type')}`);
    const cc = sw.headers.get('cache-control') || '';
    expect(/no-cache|max-age=0/.test(cc) && !/immutable|max-age=\d{4,}/.test(cc), 'sw.js cache-control "' + cc + '" (a stale worker would stick)');
    const off = await fetch(BASE + '/offline.html');
    expect(off.status === 200 && /text\/html/.test(off.headers.get('content-type') || ''), 'offline.html ' + off.status);
    expect((await off.text()).includes('No internet connection'), 'offline page text');
    return 'sw.js cache-control: ' + cc;
  });

  await record('n4', 'Chrome installability check', async () => {
    // A normal (not incognito) profile: Playwright's default context is
    // incognito, which Chrome reports as an installability error.
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tutp-android-profile-'));
    const pctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: HEADLESS, viewport: { width: 412, height: 860 } });
    try {
      const p = await pctx.newPage();
      await p.goto(BASE + '/', { waitUntil: 'load' });
      await p.evaluate(() => navigator.serviceWorker.ready);
      const cdp = await pctx.newCDPSession(p);
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      expect(installabilityErrors.length === 0, 'installability errors: ' + JSON.stringify(installabilityErrors));
      const m = await cdp.send('Page.getAppManifest');
      expect(!(m.errors || []).length, 'manifest errors: ' + JSON.stringify(m.errors));
      return 'no installability errors, no manifest errors';
    } finally {
      await pctx.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });

  await record('n5', 'worker controls the page, caches only the shell', async () => {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'load' });
    const info = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const names = await caches.keys();
      const entries = {};
      for (const n of names) entries[n] = (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname).sort();
      return { controlled: !!navigator.serviceWorker.controller, entries };
    });
    expect(info.controlled, 'page is not controlled by the worker after a reload');
    const names = Object.keys(info.entries);
    expect(names.length === 1 && names[0] === 'tutp-shell-v1', 'caches: ' + JSON.stringify(names));
    expect(JSON.stringify(info.entries['tutp-shell-v1']) === JSON.stringify(['/images/icons/icon-192.png', '/offline.html']), 'cached: ' + JSON.stringify(info.entries));
    return 'cache tutp-shell-v1: ' + info.entries['tutp-shell-v1'].join(', ');
  }, page);

  await record('n6', 'offline fallback, API never cached', async () => {
    // a signed-out visitor loads an API route first; it must not end up in a cache
    await page.evaluate(() => fetch('/api/me').catch(() => {}));
    await ctx.setOffline(true);
    try {
      await page.goto(BASE + '/app/login/', { waitUntil: 'domcontentloaded' });
      expect((await page.textContent('body')).includes('No internet connection'), 'offline page not shown');
      const apiFailed = await page.evaluate(() => fetch('/api/me').then(() => false, () => true));
      expect(apiFailed, '/api/me was answered while offline');
      const names = await page.evaluate(() => caches.keys());
      expect(names.length === 1, 'extra caches: ' + JSON.stringify(names));
    } finally {
      await ctx.setOffline(false);
    }
    return 'offline page shown, /api/me failed, one cache';
  }, page);

  for (const [route, needle] of [['/privacy/', 'Privacy Policy'], ['/terms/', 'Terms of Service'], ['/delete-account/', 'Delete your account']]) {
    const id = 'n7' + route.replace(/\W/g, '');
    await record(id, route + ' page', async () => {
      const resp = await page.goto(BASE + route, { waitUntil: 'load' });
      expect(resp.status() === 200, route + ' status ' + resp.status());
      const body = await page.textContent('body');
      expect(body.includes(needle), 'heading text ' + needle);
      expect(body.includes('DRAFT FOR LEGAL REVIEW'), 'no DRAFT banner');
      expect(body.includes('contact@tutp.online'), 'no contact email');
      const robots = await page.getAttribute('meta[name=robots]', 'content');
      expect(/noindex/.test(robots || ''), 'robots meta: ' + robots);
      await page.setViewportSize({ width: 360, height: 780 });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.setViewportSize({ width: 412, height: 860 });
      expect(wide <= 1, 'sideways scroll of ' + wide + ' px at 360 px');
      await page.screenshot({ path: path.join(OUT, 'android-' + route.replace(/\W/g, '') + '.png'), fullPage: true });
      return 'ok';
    }, page);
  }

  await record('n8', 'privacy page: DPDP placeholder, no contradicted claims', async () => {
    await page.goto(BASE + '/privacy/', { waitUntil: 'load' });
    const body = await page.textContent('body');
    expect(body.includes('[PLACEHOLDER: DPDP ACT CONSENT WORDING]'), 'DPDP placeholder missing');
    for (const t of ['Anthropic', 'Supabase', 'Razorpay', 'Firebase', 'Resend', 'Google Analytics']) expect(body.includes(t), 'not named: ' + t);
    expect(!/do not collect a child's photo/i.test(body), 'old photo claim is back');
    return 'ok';
  }, page);

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'android-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n[e2e:android] ${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log('  FAIL', f.id, f.name, '-', f.detail);
  process.exit(failed.length ? 1 : 0);
})();
