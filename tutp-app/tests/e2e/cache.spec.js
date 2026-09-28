// Cache-safe static files (server/static-assets.js), plain HTTP, no login:
//   node tests/e2e/cache.spec.js <base-url>
//
//   1  pages (/, /app/login/, /app/mother/) are "no-cache", and every local
//      script, stylesheet and module import on them carries ?v=<hash>
//   2  every versioned JS/CSS, followed through its own imports, is served
//      "immutable" and its ?v= is the sha256 of the served body (so a changed
//      file can never keep its old URL)
//   3  phone-auth.js imports auth-messages.js with a ?v= (the file phones
//      kept stale on 2026-09-28)
//   4  the same file without ?v=, or with an old hash, is "no-cache"
//
// Exit code 1 if any check fails.
import crypto from 'crypto';

const BASE = (process.argv.slice(2).find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/cache.spec.js <base-url>');
  process.exit(2);
}
const PAGES = ['/', '/app/login/', '/app/mother/'];
const REF = /(?:\b(?:src|href)\s*=\s*|\bfrom\s*|\bimport\s*\(?\s*)["'](\/[^\/"'#\s][^"'#\s]*\.(?:m?js|css)(?:\?[^"'#\s]*)?)["']/g;

const failures = [];
function check(ok, msg) {
  if (!ok) failures.push(msg);
  console.log('[cache]', ok ? 'PASS' : 'FAIL', msg);
}

function localRefs(text) {
  return [...text.matchAll(REF)].map(m => m[1]);
}

async function get(url) {
  const r = await fetch(BASE + url, { cache: 'no-store' });
  return { status: r.status, cc: r.headers.get('cache-control') || '', body: Buffer.from(await r.arrayBuffer()) };
}

const seen = new Set();
async function checkAsset(ref, from) {
  const [p, q] = ref.split('?');
  const v = new URLSearchParams(q || '').get('v');
  check(!!v, `${from}: ${p} has ?v=`);
  if (!v || seen.has(ref)) return;
  seen.add(ref);
  const r = await get(ref);
  const hash = crypto.createHash('sha256').update(r.body).digest('hex').slice(0, 10);
  check(r.status === 200 && r.cc.includes('immutable'), `${ref} 200 immutable (got ${r.status} "${r.cc}")`);
  check(hash === v, `${ref} ?v= matches the served body (sha ${hash})`);
  // A file naming itself (session-guard.js's usage comment) can't carry its own hash.
  if (/\.m?js$/.test(p)) for (const inner of localRefs(r.body.toString('utf8'))) if (inner !== p) await checkAsset(inner, p);
}

for (const page of PAGES) {
  const r = await get(page);
  check(r.status === 200 && r.cc === 'no-cache', `${page} 200 no-cache (got ${r.status} "${r.cc}")`);
  const refs = localRefs(r.body.toString('utf8'));
  check(refs.length > 0, `${page} has local scripts/styles (${refs.length})`);
  for (const ref of refs) await checkAsset(ref, page);
}

const phoneAuth = [...seen].find(s => s.startsWith('/app/shared/phone-auth.js?v='));
check(!!phoneAuth, 'login page loads phone-auth.js?v=');
if (phoneAuth) {
  const body = (await get(phoneAuth)).body.toString('utf8');
  check(/import "\/app\/shared\/auth-messages\.js\?v=[0-9a-f]{10}"/.test(body), 'phone-auth.js imports auth-messages.js?v=');
}

for (const url of ['/app/shared/auth-messages.js', '/app/shared/auth-messages.js?v=0000000000', '/css/tailwind.css']) {
  const r = await get(url);
  check(r.status === 200 && r.cc === 'no-cache', `${url} 200 no-cache (got ${r.status} "${r.cc}")`);
}

console.log(failures.length ? `\n${failures.length} FAILED` : `\nALL CACHE CHECKS PASSED (${seen.size} assets)`);
// exitCode, not exit(): exiting with fetch sockets still closing trips a
// libuv assertion on Windows.
process.exitCode = failures.length ? 1 : 0;
