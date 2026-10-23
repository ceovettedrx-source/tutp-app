// Picture billing alert (TUT-73, docs/TUT-73-spec.md). No model calls, no spend, no login:
// the e2e has no admin credential (ADMIN_TOKEN is a secret), so the red "Pictures failing"
// tile itself is covered by tests/unit/image-billing.test.js (empty data -> count 0 -> hidden).
//
//   ib1  GET /api/admin/image-billing without an admin session is refused (401/403/302), never 200
//   ib2  the admin dashboard page without an admin session is refused and holds no tile markup
//   ib3  a clean preview shows no failure state to a family: /api/illustration/request with a bad
//        picture is a 4xx, not a 500, and nothing is leaked about billing
//
// Usage: node tests/e2e/image-billing.spec.js <base-url> [--headless]
// Output: tests/e2e/output/image-billing-results.json. Exit 1 on any failure.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/image-billing.spec.js <base-url> [--headless]');
  process.exit(2);
}
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e image-billing]', ...a);

async function record(id, name, fn) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 400) });
    log(id, 'FAIL', err.message);
  }
}

const get = (p, init = {}) => fetch(BASE + p, { redirect: 'manual', ...init });

(async () => {
  await record('ib1', 'admin billing summary needs an admin session', async () => {
    const r = await get('/api/admin/image-billing');
    if (![301, 302, 303, 307, 401, 403].includes(r.status)) throw new Error('got ' + r.status);
    const t = await r.text();
    if (/first_seen|last_status/.test(t)) throw new Error('summary fields leaked');
    return 'refused with ' + r.status;
  });

  await record('ib2', 'admin dashboard needs an admin session and shows no tile', async () => {
    const r = await get('/admin/dashboard');
    if (![301, 302, 303, 307, 401, 403].includes(r.status)) throw new Error('got ' + r.status);
    const t = await r.text();
    if (/imageFailTile|Pictures failing/.test(t)) throw new Error('tile markup served without a session');
    return 'refused with ' + r.status;
  });

  await record('ib3', 'a bad picture request is a clean 4xx and says nothing about billing', async () => {
    const r = await get('/api/illustration/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ picture: { concept_key: 'x' } }),
    });
    if (r.status < 400 || r.status >= 500) throw new Error('got ' + r.status);
    const t = await r.text();
    if (/402|billing|gemini|prepay|api key/i.test(t)) throw new Error('billing detail leaked: ' + t.slice(0, 80));
    return r.status + ' without billing detail';
  });

  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}`);
  fs.writeFileSync(path.join(OUT, 'image-billing-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => { console.error('[e2e image-billing] fatal', e); process.exit(1); });
