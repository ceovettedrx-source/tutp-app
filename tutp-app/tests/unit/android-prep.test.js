// Unit tests for the Android app preparation (docs/specs/android-prep.md):
// manifest, Digital Asset Links, fingerprint tool, service worker, policy pages,
// Play listing limits, Bubblewrap config.
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { assetLinksHandler, ASSETLINKS_PATH, PLACEHOLDER_FINGERPRINT } from '../../server/android-links.js';
import { normalizeFingerprint, applyFingerprints, hasRealFingerprint, isPlaceholder, PLACEHOLDER } from '../../scripts/android/set-fingerprint.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const REAL = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';

// ---- manifest ---------------------------------------------------------------
test('manifest: installable fields, scope covers start_url, theme colour', () => {
  const m = json('public/manifest.json');
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'id', 'description']) {
    assert.ok(m[k], `manifest.${k} missing`);
  }
  assert.equal(m.display, 'standalone');
  assert.equal(m.theme_color, '#005bbf');
  assert.equal(m.scope, '/');
  assert.ok(m.start_url.startsWith(m.scope));
  assert.ok(m.short_name.length <= 12);
});

test('manifest: 192 and 512 icons plus a maskable one, files exist with the declared size', () => {
  const m = json('public/manifest.json');
  const size = (file) => {
    const b = fs.readFileSync(file);
    assert.equal(b.toString('latin1', 1, 4), 'PNG', file + ' is not a PNG');
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  };
  const by = (purpose, sizes) => m.icons.find((i) => i.purpose === purpose && i.sizes === sizes);
  for (const [purpose, sizes] of [['any', '192x192'], ['any', '512x512'], ['maskable', '512x512']]) {
    const icon = by(purpose, sizes);
    assert.ok(icon, `no ${purpose} ${sizes} icon`);
    assert.equal(icon.type, 'image/png');
    assert.equal(size(path.join(ROOT, 'public', icon.src)), sizes);
  }
});

test('pages that register the service worker link the manifest too', () => {
  for (const p of ['public/index.html', 'public/app/login/index.html']) {
    assert.match(read(p), /<script src="\/js\/pwa-register\.js" defer><\/script>/, p);
  }
  assert.match(read('public/index.html'), /<link rel="manifest" href="\/manifest\.json">/);
  assert.match(read('public/js/pwa-register.js'), /register\('\/sw\.js', \{ scope: '\/' \}\)/);
});

// ---- Digital Asset Links ----------------------------------------------------
test('assetlinks.json: package id, handle_all_urls, placeholder is zeros and not "real"', () => {
  const st = json('server/android/assetlinks.json');
  assert.equal(st.length, 1);
  assert.deepEqual(st[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(st[0].target.namespace, 'android_app');
  assert.equal(st[0].target.package_name, 'online.tutp.app');
  assert.deepEqual(st[0].target.sha256_cert_fingerprints, [PLACEHOLDER_FINGERPRINT]);
  assert.equal(PLACEHOLDER_FINGERPRINT, PLACEHOLDER);
  assert.equal(hasRealFingerprint(st), false);
});

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

test('assetlinks handler: JSON content type, short cache, only that path, GET/HEAD only', () => {
  const h = assetLinksHandler(path.join(ROOT, 'server/android/assetlinks.json'));
  const res = fakeRes();
  let nexted = false;
  h({ path: ASSETLINKS_PATH, method: 'GET' }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.match(res.headers['cache-control'], /max-age=\d+/);
  assert.equal(JSON.parse(res.body)[0].target.package_name, 'online.tutp.app');

  for (const req of [{ path: '/manifest.json', method: 'GET' }, { path: ASSETLINKS_PATH, method: 'POST' }]) {
    let n = false;
    h(req, fakeRes(), () => { n = true; });
    assert.equal(n, true);
  }
});

test('assetlinks handler: an unreadable file answers 404, never a broken body', () => {
  const h = assetLinksHandler(path.join(os.tmpdir(), 'does-not-exist-assetlinks.json'));
  const res = fakeRes();
  h({ path: ASSETLINKS_PATH, method: 'GET' }, res, () => assert.fail('should not fall through'));
  assert.equal(res.statusCode, 404);
});

// ---- fingerprint tool ---------------------------------------------------------
test('set-fingerprint: accepts colon, dash, plain and lower-case forms', () => {
  const plain = REAL.replace(/:/g, '');
  assert.equal(normalizeFingerprint(REAL), REAL);
  assert.equal(normalizeFingerprint(plain.toLowerCase()), REAL);
  assert.equal(normalizeFingerprint(REAL.replace(/:/g, '-')), REAL);
  assert.equal(normalizeFingerprint(' ' + REAL + '\n'), REAL);
});

test('set-fingerprint: rejects short, non-hex, SHA-1 length and the placeholder', () => {
  const st = json('server/android/assetlinks.json');
  for (const bad of ['', 'nonsense', REAL.slice(0, -3), REAL + ':00', REAL.replace('AB', 'ZZ'), PLACEHOLDER]) {
    assert.throws(() => applyFingerprints(st, [bad]), /fingerprint|placeholder|SHA-256/i, bad);
  }
  assert.throws(() => applyFingerprints(st, []), /at least one/);
});

test('set-fingerprint: replaces the placeholder, --add appends, duplicates ignored, input untouched', () => {
  const st = json('server/android/assetlinks.json');
  const before = JSON.stringify(st);
  const one = applyFingerprints(st, [REAL.toLowerCase()]);
  assert.equal(JSON.stringify(st), before);
  assert.deepEqual(one[0].target.sha256_cert_fingerprints, [REAL]);
  assert.equal(hasRealFingerprint(one), true);

  const other = REAL.replace(/^AB/, '11');
  const two = applyFingerprints(one, [other, REAL], { add: true });
  assert.deepEqual(two[0].target.sha256_cert_fingerprints, [REAL, other]);
  const replaced = applyFingerprints(two, [other]);
  assert.deepEqual(replaced[0].target.sha256_cert_fingerprints, [other]);
  assert.ok(isPlaceholder(PLACEHOLDER) && !isPlaceholder(REAL));
});

// ---- service worker ---------------------------------------------------------
function loadSw() {
  const listeners = {};
  const cachesStore = new Map();
  const opened = [];
  const caches = {
    open: async (name) => {
      opened.push(name);
      if (!cachesStore.has(name)) cachesStore.set(name, new Map());
      const store = cachesStore.get(name);
      return {
        addAll: async (urls) => { for (const u of urls) store.set(u, 'cached:' + u); },
        match: async (u) => store.get(u),
        put: async () => assert.fail('the service worker must never write responses to a cache'),
      };
    },
    keys: async () => [...cachesStore.keys()],
    delete: async (k) => cachesStore.delete(k),
  };
  const self = {
    location: { origin: 'https://tutp.online' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const sandbox = { self, caches, URL, Response: { error: () => 'network-error' }, fetch: async () => { throw new Error('offline'); } };
  vm.runInNewContext(read('public/sw.js'), sandbox);
  return { listeners, cachesStore, sandbox };
}

const fetchEvent = (request) => {
  const e = { request, responded: undefined, respondWith(p) { this.responded = p; } };
  return e;
};

test('service worker: install caches exactly the offline page and one icon', async () => {
  const { listeners, cachesStore } = loadSw();
  let waited;
  listeners.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  const all = [...cachesStore.values()].flatMap((m) => [...m.keys()]);
  assert.deepEqual(all.sort(), ['/images/icons/icon-192.png', '/offline.html']);
});

test('service worker: activate removes older caches of ours', async () => {
  const { listeners, cachesStore } = loadSw();
  let waited;
  listeners.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  cachesStore.set('tutp-shell-v0', new Map());
  listeners.activate({ waitUntil: (p) => { waited = p; } });
  await waited;
  assert.deepEqual([...cachesStore.keys()], ['tutp-shell-v1']);
});

test('service worker: only same-origin GET page loads are handled; API, POST, assets and other origins pass through', () => {
  const { listeners } = loadSw();
  const passes = [
    { method: 'POST', mode: 'navigate', url: 'https://tutp.online/app/login/' },
    { method: 'GET', mode: 'cors', url: 'https://tutp.online/api/me' },
    { method: 'GET', mode: 'no-cors', url: 'https://tutp.online/app/shared/phone-auth.js' },
    { method: 'GET', mode: 'navigate', url: 'https://example.com/' },
  ];
  for (const r of passes) {
    const e = fetchEvent(r);
    listeners.fetch(e);
    assert.equal(e.responded, undefined, `${r.method} ${r.mode} ${r.url} must not be handled`);
  }
});

test('service worker: a failed page load shows the offline page; a working one is returned untouched', async () => {
  const { listeners, cachesStore, sandbox } = loadSw();
  let waited;
  listeners.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  const nav = { method: 'GET', mode: 'navigate', url: 'https://tutp.online/app/mother/' };

  const e1 = fetchEvent(nav);
  listeners.fetch(e1);
  assert.equal(await e1.responded, 'cached:/offline.html');

  sandbox.fetch = async () => 'live-page';
  const e2 = fetchEvent(nav);
  listeners.fetch(e2);
  assert.equal(await e2.responded, 'live-page');
  assert.equal([...cachesStore.get('tutp-shell-v1').keys()].length, 2, 'nothing was added to the cache');
});

test('service worker source never mentions api, auth, cookies or child data', () => {
  const code = read('public/sw.js').replace(/\/\/.*$/gm, '');
  for (const word of ['/api', 'cookie', 'localStorage', 'sessionStorage', 'Authorization', 'cache.put', '.put(']) {
    assert.ok(!code.includes(word), `sw.js code contains ${word}`);
  }
});

test('offline page is self-contained (no external or hashed assets) and noindex', () => {
  const html = read('public/offline.html');
  assert.match(html, /noindex/);
  assert.ok(!/<link[^>]+stylesheet/i.test(html));
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/https?:\/\//i.test(html));
});

// ---- policy pages -----------------------------------------------------------
test('policy pages: DRAFT marker, noindex, contact email, linked to each other', () => {
  for (const name of ['privacy', 'terms', 'delete-account']) {
    const html = read(`public/${name}/index.html`);
    assert.match(html, /DRAFT FOR LEGAL REVIEW/, name);
    assert.match(html, /<meta name="robots" content="noindex">/, name);
    assert.match(html, /mailto:contact@tutp\.online/, name);
    assert.match(html, /<h1[^>]*>/, name);
    assert.match(html, /width=device-width/, name);
  }
  assert.match(read('public/privacy/index.html'), /href="\/delete-account\/"/);
  assert.match(read('public/terms/index.html'), /href="\/privacy\/"/);
  assert.match(read('public/delete-account/index.html'), /href="\/privacy\/"/);
});

test('privacy page: names what the audit found and keeps the DPDP wording as a placeholder', () => {
  const html = read('public/privacy/index.html');
  for (const term of ['Anthropic', 'Supabase', 'Razorpay', 'Firebase', 'Resend', 'Google Analytics', 'tutp_session', 'date of birth', 'photo']) {
    assert.ok(html.includes(term), `privacy page does not mention ${term}`);
  }
  assert.match(html, /\[PLACEHOLDER: DPDP ACT CONSENT WORDING\]/);
  // No consent clause was written: the only "consent" in the page is the placeholder and the registration box.
  assert.ok(!/I (hereby )?consent|you (hereby )?consent|by using .{0,40} you consent/i.test(html));
  // The old draft's claims that the code contradicts must not come back.
  assert.ok(!/do not collect a child's photo/i.test(html));
  assert.ok(!/never your child's name/i.test(html));
});

test('delete-account page: says deletion is by email and by hand, not a button', () => {
  const html = read('public/delete-account/index.html');
  assert.match(html, /Delete my Tut-P account/);
  assert.match(html, /by hand/);
});

// ---- Play listing ------------------------------------------------------------
test('listing: titles <= 30, short descriptions <= 80, full descriptions <= 4000 characters (all three languages)', () => {
  const md = read('docs/play-store/listing.md');
  const len = (s) => [...s].length;
  const titles = [...md.matchAll(/\*\*Title\*\*[^`\n]*`([^`]+)`/g)].map((m) => m[1]);
  const shorts = [...md.matchAll(/\*\*Short description\*\*[^`\n]*`([^`]+)`/g)].map((m) => m[1]);
  const fulls = [...md.matchAll(/\*\*Full description\*\*\s*```\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(titles.length, 3);
  assert.equal(shorts.length, 3);
  assert.equal(fulls.length, 3);
  for (const t of titles) assert.ok(len(t) <= 30, `title too long (${len(t)}): ${t}`);
  for (const s of shorts) assert.ok(len(s) <= 80, `short description too long (${len(s)}): ${s}`);
  for (const f of fulls) assert.ok(len(f) <= 4000, `full description too long (${len(f)})`);
  // No script mixing inside one Hindi / Telugu word.
  assert.ok(!/[ऀ-ॿ][ఀ-౿]|[ఀ-౿][ऀ-ॿ]/.test(md), 'Devanagari and Telugu letters are joined in one word');
});

// ---- Bubblewrap config and repo hygiene --------------------------------------
test('twa-manifest: permanent package id, host, no secrets, signing path is filled by build.ps1', () => {
  const t = json('android/twa-manifest.json');
  assert.equal(t.packageId, 'online.tutp.app');
  assert.equal(t.host, 'tutp.online');
  assert.equal(t.themeColor, '#005bbf');
  assert.equal(t.webManifestUrl, 'https://tutp.online/manifest.json');
  assert.equal(t.startUrl, '/');
  assert.equal(t.signingKey.alias, 'tutp-upload');
  assert.match(t.signingKey.path, /REPLACED-BY-build\.ps1/);
  assert.ok(!/password/i.test(JSON.stringify(t)));
  assert.ok(Number.isInteger(t.appVersionCode) && t.appVersionCode >= 1);
});

test('build.ps1: never reads, prints or stores a password; keystore lives outside the repo', () => {
  const ps = read('scripts/android/build.ps1');
  assert.ok(!/Read-Host\s+-AsSecureString/i.test(ps));
  assert.ok(!/-storepass|-keypass|BUBBLEWRAP_KEYSTORE_PASSWORD|BUBBLEWRAP_KEY_PASSWORD/i.test(ps));
  assert.match(ps, /USERPROFILE 'tutp-android-keys'/);
});

test('.gitignore and .dockerignore keep keys and Android files out', () => {
  const gi = read('.gitignore');
  for (const p of ['*.keystore', '*.jks', '/android/build/']) assert.ok(gi.includes(p), p);
  assert.match(read('.dockerignore'), /^android\/$/m);
});
