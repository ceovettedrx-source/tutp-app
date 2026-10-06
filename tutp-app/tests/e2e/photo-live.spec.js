// Live photo smoke (round upsec2 hotfix): a real photo goes to the REAL model
// (never replay) and the answer and the notes are about what is on the photo.
//
//   node tests/e2e/photo-live.spec.js <base-url> [--headless]
//   (not part of run.js: it always spends model money, about $0.15 per run)
//
// Run it against a revision WITHOUT E2E_REPLAY (the release revision), or send
// nothing special: the server answers live whenever the request has no
// X-E2E-Mode header or the revision has no E2E_REPLAY. Test family A
// (9999900001, family 16, paid until 2027) is used, so no free limit.
//   l1  fixtures/worksheet-4.jpg to /api/homework (Answer please): status ok,
//       4 cards, the correct answers 37, 27, 83 appear in the cards
//   l2  /api/homework-notes with the questions read from l1: 200, notes about
//       the same sums (not "could not be made")
//   l3  the same sheet shrunk to 500 px wide (what a small screenshot looks
//       like): reported with its status; fails only on a 5xx or a 4xx
//   l4  fixtures/sample.heic to /api/homework: converted on the server (not a
//       415, not a 5xx), the model is called
//   l5  fixtures/landscape.jpg: status not_homework (the check that a real
//       non-homework picture is still refused)
//   c1-c4 pages with NO questions (generate-content-pages.js): textbook page,
//       notebook notes page, WhatsApp-size photo, 500 x 566 screenshot. Each:
//       status ok in content mode, idea cards about the page, Notes please
//       built from the page text with zero questions, Explain on the first card
//
// Output: tests/e2e/output/photo-live-results.json, FAIL_<test>.png. Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/photo-live.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e photo-live]', ...a);
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
const fixtureHeic = () => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.heic'));
let spend = 0;

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
function ok(cond, what) { if (!cond) throw new Error(what); }

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

// fetch from inside the signed-in page (same cookies as the app); no X-E2E-Mode
// header, so a revision with E2E_REPLAY still answers... only if told to. This
// spec is meant for the release revision, which has none.
const post = (page, url, body) => page.evaluate(async ({ url, body }) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-E2E-Mode': 'live' }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: r.status, answerStatus: r.headers.get('x-answer-status'), usd: Number(r.headers.get('x-model-usd') || 0), json, text: text.slice(0, 600) };
}, { url, body });
const getJson = (page, url) => page.evaluate(async (url) => { const r = await fetch(url); return { status: r.status, json: await r.json().catch(() => null) }; }, url);

// The model's reply sits as JSON text in content[0].text.
function answerOf(res) {
  const t = res.json && res.json.content && res.json.content[0] && res.json.content[0].text;
  try { return JSON.parse(t); } catch (e) { return null; }
}

// The sheet shrunk in the browser the way a small screenshot looks.
const shrink = (page, b64, width) => page.evaluate(async ({ b64, width }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/jpeg;base64,' + b64; });
  const s = width / img.naturalWidth;
  const c = document.createElement('canvas');
  c.width = width; c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8).split(',')[1];
}, { b64, width });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 30 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Same test-only hook as family.spec.js: the fictional test numbers sign in without the captcha.
  await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
    const resp = await route.fetch();
    const hook = 'const auth = getAuth(app);';
    const body = (await resp.text()).replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
    if (!body.includes('appVerificationDisabledForTesting')) throw new Error('phone-auth.js hook not found');
    await route.fulfill({ response: resp, body });
  });
  const page = await ctx.newPage();
  try {
    await login(page, '9999900001', '/app/mother/');
    const me = (await getJson(page, '/api/session/me')).json || {};
    const kids = (await getJson(page, '/api/family/' + me.familyId + '/students')).json || {};
    const studentId = (kids.students || [])[0] && kids.students[0].id;
    ok(studentId, 'no child found for the test family');
    const sheet = fixture('worksheet-4.jpg').toString('base64');
    const sheetShown = { mediaType: 'image/jpeg', base64: sheet };
    const homework = (att, text = '') => post(page, '/api/homework', { feature: 'homework_help', text, language: 'English', studentId, attachments: [att] });
    let l1questions = [];

    await record('l1', 'worksheet photo: answer is about the sheet', async () => {
      const t0 = Date.now();
      const r = await homework(sheetShown);
      spend += r.usd;
      ok(r.status === 200, 'status ' + r.status + ' ' + r.text.slice(0, 200));
      const a = answerOf(r);
      ok(a, 'reply is not JSON');
      ok(a.status === 'ok', 'answer status ' + a.status + ' (header ' + r.answerStatus + ')');
      const cards = JSON.stringify(a);
      for (const n of ['37', '27', '83']) ok(cards.includes(n), 'the answer 37, 27, 83 should appear; missing ' + n);
      l1questions = (a.extracted_questions || []).map(q => q && q.question).filter(Boolean);
      ok(l1questions.length >= 4, 'questions read: ' + l1questions.length);
      return `${(a.questions || []).length} cards, ${l1questions.length} questions, ${((Date.now() - t0) / 1000).toFixed(1)} s, $${r.usd}`;
    }, page);

    await record('l2', 'notes for the photographed questions', async () => {
      ok(l1questions.length, 'l1 gave no questions to make notes from');
      const r = await post(page, '/api/homework-notes', { studentId, language: 'English', questions: l1questions, topic: '' });
      spend += r.usd;
      ok(r.status === 200, 'status ' + r.status + ' ' + r.text.slice(0, 200));
      const text = JSON.stringify(r.json);
      ok(/add|plus|sum|subtract|minus|take away|regroup|carry|borrow|\+|−|-/i.test(text), 'the notes do not mention the sums: ' + text.slice(0, 200));
      return 'notes ok, $' + r.usd;
    }, page);

    await record('l3', 'sheet shrunk to 500 px wide', async () => {
      const small = await shrink(page, sheet, 500);
      const r = await homework({ mediaType: 'image/jpeg', base64: small });
      spend += r.usd;
      ok(r.status === 200, 'status ' + r.status + ' ' + r.text.slice(0, 200));
      const a = answerOf(r);
      ok(a, 'reply is not JSON');
      return `answer status ${a.status}, ${(a.questions || []).length} cards (500 px wide, ${Math.round(small.length * 0.75 / 1024)} KB)`;
    }, page);

    await record('l4', 'HEIC photo is converted and sent to the model', async () => {
      const r = await homework({ mediaType: 'image/heic', base64: fixtureHeic().toString('base64') });
      spend += r.usd;
      ok(r.status !== 415, 'HEIC refused: ' + r.text.slice(0, 200));
      ok(r.status === 200, 'status ' + r.status + ' ' + r.text.slice(0, 200));
      const a = answerOf(r);
      ok(a && ['ok', 'not_homework', 'unreadable'].includes(a.status), 'no answer status');
      return `answer status ${a.status}, $${r.usd}`;
    }, page);

    await record('l5', 'a landscape picture is still not homework', async () => {
      const r = await homework({ mediaType: 'image/jpeg', base64: fixture('landscape.jpg').toString('base64') });
      spend += r.usd;
      ok(r.status === 200, 'status ' + r.status);
      const a = answerOf(r);
      ok(a && a.status === 'not_homework', 'answer status ' + (a && a.status));
      return 'not_homework, $' + r.usd;
    }, page);

    // Content pages: school pages with NO questions (2026-10-06 regression:
    // "does not look like homework" / "notes could not be made"). Each must give
    // status ok in content mode, cards about the page, Notes built from the page
    // text with zero questions, and Explain on the first card.
    const contentCase = (id, name, file, mediaType, about) => record(id, name, async () => {
      const photo = fixture(file).toString('base64');
      const r = await homework({ mediaType, base64: photo });
      spend += r.usd;
      ok(r.status === 200, 'status ' + r.status + ' ' + r.text.slice(0, 200));
      const a = answerOf(r);
      ok(a, 'reply is not JSON');
      ok(a.status === 'ok', 'answer status ' + a.status);
      ok(a.mode === 'content', 'mode ' + a.mode + ' (a page with no questions should be a content page)');
      ok((a.questions || []).length >= 1, 'no idea cards');
      ok(about.test(JSON.stringify(a)), 'the cards do not mention the page: ' + JSON.stringify(a).slice(0, 200));
      ok(a.concept_explanation && a.concept_explanation.length > 40, 'no page text for the notes');
      ok((a.extracted_questions || []).length === 0, 'content page should have no extracted questions');
      const n = await post(page, '/api/homework-notes', { studentId, language: 'English', questions: [], topic: a.concept_explanation });
      spend += n.usd;
      ok(n.status === 200, 'notes status ' + n.status + ' ' + n.text.slice(0, 200));
      ok(about.test(JSON.stringify(n.json)), 'the notes do not mention the page: ' + JSON.stringify(n.json).slice(0, 200));
      const c = a.questions[0];
      const e = await post(page, '/api/explain-please', { studentId, question: c.context || c.q_text, qType: c.q_type, subject: a.subject || '', language: 'English', concept_key: c.concept_key || undefined, concept_sig: c.concept_sig || undefined });
      spend += e.usd;
      ok(e.status === 200, 'explain status ' + e.status + ' ' + e.text.slice(0, 200));
      ok(about.test(JSON.stringify(e.json)), 'the explanation does not mention the page: ' + JSON.stringify(e.json).slice(0, 200));
      return `${a.questions.length} idea cards, notes ok, explain ok, ${Math.round(photo.length * 0.75 / 1024)} KB, $${(r.usd + n.usd + e.usd).toFixed(4)}`;
    }, page);
    await contentCase('c1', 'textbook page (printed, no questions)', 'textbook-page.jpg', 'image/jpeg', /photosynthesis|chlorophyll|glucose|stomata/i);
    await contentCase('c2', 'notebook notes page (handwritten, no questions)', 'notebook-page.jpg', 'image/jpeg', /water cycle|evaporat|condensat|precipitat/i);
    await contentCase('c3', 'WhatsApp-size forwarded photo of a textbook page', 'whatsapp-textbook.jpg', 'image/jpeg', /photosynthesis|chlorophyll|glucose|stomata/i);
    await contentCase('c4', 'screenshot of notes, 500 x 566 PNG', 'screenshot-notes.png', 'image/png', /flower|petal|stamen|pistil|pollen/i);
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'photo-live-results.json'), JSON.stringify({ spendUsd: spend, results }, null, 2));
  const failed = results.filter(r => r.status !== 'PASS');
  log(`model spend $${spend.toFixed(4)}`);
  console.log(failed.length ? 'FAILED: ' + failed.map(f => f.id).join(', ') : 'ALL PHOTO-LIVE TESTS PASSED');
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error('photo-live crashed:', err); process.exit(1); });
