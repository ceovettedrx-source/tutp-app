// Visual tutor e2e: image mode on two synthetic worksheet photos.
//
//   node tests/e2e/visual-tutor.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs this after login.spec.js)
//
// Signs in as the test mother 9999900001 (code 123456; see login.spec.js for
// the test numbers and the test-only reCAPTCHA switch), opens the labs page
// so the photo goes through the real TutPointer.prepareImage (long edge 1280,
// JPEG 0.85), and calls POST /api/visual-tutor in image mode for:
//   v1  fixtures/worksheet-blank.jpg     printed sheet, no answers
//   v2  fixtures/worksheet-5-wrong.jpg   8 handwritten answers, 5 wrong
// Each must return 200 with 1-4 steps, every box inside 0-1000 with
// x1 < x2 and y1 < y2, the server's own time (X-Server-Time-Ms) under
// 8 seconds, and speech that never states how many more mistakes there are
// ("3 more", "two more to check": the model miscounted, which misleads the
// parent). The end-to-end time seen here is reported only, never a failure:
// it includes this machine's network, which stalled for 16-28 s on
// 2026-09-27 while the server answered in 3-6 s.
// Fixtures are made up; regenerate with fixtures/generate-worksheets.js.
//
// A live run makes 2 real model calls; by default the preview replays them
// (tests/e2e/e2e-mode.js). Output: tests/e2e/output/ (FAIL_v*.png,
// visual-tutor-results.json). Exit code 1 if any check fails.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e2e = e2eMode('visual-tutor');
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/visual-tutor.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const MOTHER = '+919999900001';
const CODE = '123456';
const MAX_SERVER_MS = 8000;
// "3 more", "two more", "3 more mistakes", "3 others": a count of what is
// left. Problem numbers ("problems 2 and 3") are fine.
const REMAINING_COUNT = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(more|others?)\b/i;
const QUESTION = 'Where did my child go wrong in this homework?';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];

function log(...a) { console.log('[e2e:vt]', ...a); }

async function record(id, name, fn, page) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    const f = path.join(OUT, 'FAIL_' + id + '.png');
    if (page) await page.screenshot({ path: f, fullPage: true }).catch(() => {});
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 400), shot: page ? f : '' });
    log(id, 'FAIL', err.message);
  }
}

// Every drawn box must be inside the 0-1000 image space and not inverted.
function checkSteps(json) {
  const steps = Array.isArray(json.steps) ? json.steps : [];
  if (steps.length < 1 || steps.length > 4) throw new Error(`expected 1-4 steps, got ${steps.length}`);
  const boxes = [];
  for (const s of steps) {
    for (const t of [s.target, s.from]) {
      if (!t) continue;
      if (t.kind !== 'image' || !Array.isArray(t.box) || t.box.length !== 4) throw new Error('step target is not an image box: ' + JSON.stringify(t));
      const [x1, y1, x2, y2] = t.box;
      if (![x1, y1, x2, y2].every(v => Number.isFinite(v) && v >= 0 && v <= 1000) || !(x1 < x2) || !(y1 < y2)) {
        throw new Error('box outside 0-1000 or inverted: ' + JSON.stringify(t.box));
      }
      boxes.push(t.box);
    }
  }
  return { steps: steps.length, boxes: boxes.length };
}

(async () => {
  log('base', BASE);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await e2e.attach(ctx);
  // Test-only reCAPTCHA switch, as in login.spec.js.
  await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
    const resp = await route.fetch();
    let body = await resp.text();
    const hook = 'const auth = getAuth(app);';
    if (!body.includes(hook)) throw new Error('phone-auth.js hook not found');
    body = body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
    await route.fulfill({ response: resp, body });
  });
  const page = await ctx.newPage();

  let signedIn = false;
  await record('v0', 'sign in as the test mother', async () => {
    await page.goto(BASE + '/app/login/');
    await page.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
    const s = await page.evaluate(async ({ phone, code }) => {
      await window.tutpSendOTP(phone);
      const idToken = await window.tutpVerifyOTP(code);
      const r = await window.tutpEstablishSession(idToken);
      return r.status;
    }, { phone: MOTHER, code: CODE });
    if (s !== 200) throw new Error('/api/session returned ' + s);
    signedIn = true;
    return 'session 200';
  }, page);

  if (signedIn) {
    await page.goto(BASE + '/labs/visual-tutor-test.html');
    await page.waitForFunction(() => window.TutPointer && typeof window.TutPointer.prepareImage === 'function', null, { timeout: 20000 });

    for (const [id, file] of [['v1', 'worksheet-blank.jpg'], ['v2', 'worksheet-5-wrong.jpg']]) {
      await record(id, `image mode: ${file} -> 200, 1-4 steps, boxes in 0-1000, server < ${MAX_SERVER_MS / 1000}s`, async () => {
        const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', file)).toString('base64');
        const r = await page.evaluate(async ({ b64, question }) => {
          const img = new Image();
          img.src = 'data:image/jpeg;base64,' + b64;
          await img.decode();
          const image = window.TutPointer.prepareImage(img);
          const t0 = performance.now();
          const res = await fetch('/api/visual-tutor', {
            method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ mode: 'image', question, image }),
          });
          const ms = Math.round(performance.now() - t0);
          const serverMs = res.headers.get('x-server-time-ms');
          const json = await res.json().catch(() => null);
          return { status: res.status, ms, serverMs: serverMs === null ? null : Number(serverMs), json,
            sent: { w: image.width, h: image.height, kb: Math.round(image.base64.length * 3 / 4 / 1024) } };
        }, { b64, question: QUESTION });
        const where = `${r.status}, server ${r.serverMs} ms, end-to-end ${r.ms} ms (sent ${r.sent.w}x${r.sent.h}, ${r.sent.kb} KB)`;
        if (r.status !== 200) throw new Error(`status ${where}: ${JSON.stringify(r.json)}`);
        const { steps, boxes } = checkSteps(r.json);
        if (!Number.isFinite(r.serverMs)) throw new Error(`no X-Server-Time-Ms header: ${where}`);
        if (r.serverMs >= MAX_SERVER_MS) throw new Error(`server too slow: ${where}; ${steps} steps`);
        const allText = [r.json.speech, ...(r.json.steps || []).map(s => s.say)].filter(Boolean).join(' ');
        const counted = allText.match(REMAINING_COUNT);
        if (counted) throw new Error(`speech states a count of remaining mistakes ("${counted[0]}"): "${allText.slice(0, 200)}"`);
        const speech = (r.json.speech || '').slice(0, 120);
        return `${where}; ${steps} steps, ${boxes} boxes ok; speech: "${speech}"`;
      }, page);
    }
  }

  await e2e.finish();
  await browser.close();
  console.log('\nRESULTS (visual tutor)');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'visual-tutor-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e:vt] fatal', e); process.exit(1); });
