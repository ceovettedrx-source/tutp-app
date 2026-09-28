// Unit tests for server/static-assets.js (content-hashed ?v= URLs):
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAssetVersions, publicReader } from '../../server/static-assets.js';

const files = (map) => (p) => (p in map ? Buffer.from(map[p]) : null);

const SITE = {
  '/app/login/index.html': [
    '<link rel="stylesheet" href="/css/tailwind.css">',
    '<script src="/app/shared/auth-messages.js"></script>',
    '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>',
    '<script src="//cdn.example.com/x.js"></script>',
    '<script src="/missing.js"></script>',
    '<script type="module">import { initPhoneAuth } from "/app/shared/phone-auth.js";</script>',
  ].join('\n'),
  '/css/tailwind.css': 'body{}',
  '/app/shared/auth-messages.js': 'window.M = { sessionEnded: "x" };',
  '/app/shared/phone-auth.js': 'import { a } from "https://www.gstatic.com/f.js";\nimport "/app/shared/auth-messages.js";\nconst l = () => import("/js/lazy.js");',
  '/js/lazy.js': 'export default 1;',
};

test('html: local script, stylesheet and module import get ?v=; external and missing do not', () => {
  const t = createAssetVersions(files(SITE));
  const html = t.html('/app/login/index.html');
  assert.match(html, /href="\/css\/tailwind\.css\?v=[0-9a-f]{10}"/);
  assert.match(html, /src="\/app\/shared\/auth-messages\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /from "\/app\/shared\/phone-auth\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /src="https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js"/);
  assert.match(html, /src="\/\/cdn\.example\.com\/x\.js"/);
  assert.match(html, /src="\/missing\.js"/);
});

test('js: side-effect and dynamic imports are versioned, external imports are not', () => {
  const body = createAssetVersions(files(SITE)).asset('/app/shared/phone-auth.js').body.toString();
  assert.match(body, /import "\/app\/shared\/auth-messages\.js\?v=[0-9a-f]{10}"/);
  assert.match(body, /import\("\/js\/lazy\.js\?v=[0-9a-f]{10}"\)/);
  assert.match(body, /from "https:\/\/www\.gstatic\.com\/f\.js"/);
});

test('a change in an imported file changes the importer\'s version too', () => {
  const before = createAssetVersions(files(SITE));
  const after = createAssetVersions(files({ ...SITE, '/app/shared/auth-messages.js': 'window.M = { sessionEnded: "y" };' }));
  assert.notEqual(before.versionOf('/app/shared/auth-messages.js'), after.versionOf('/app/shared/auth-messages.js'));
  assert.notEqual(before.versionOf('/app/shared/phone-auth.js'), after.versionOf('/app/shared/phone-auth.js'));
  assert.equal(before.versionOf('/css/tailwind.css'), after.versionOf('/css/tailwind.css'));
});

test('files that import each other do not loop', () => {
  const t = createAssetVersions(files({ '/a.js': 'import "/b.js";', '/b.js': 'import "/a.js";' }));
  assert.match(t.versionOf('/a.js'), /^[0-9a-f]{10}$/);
  assert.match(t.versionOf('/b.js'), /^[0-9a-f]{10}$/);
});

test('reader: no dotfiles, nothing outside public/', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
  const read = publicReader(dir);
  assert.ok(read('/app/shared/phone-auth.js'));
  assert.equal(read('/../server.js'), null);
  assert.equal(read('/.env'), null);
  assert.equal(read('/app/shared/'), null);
});
