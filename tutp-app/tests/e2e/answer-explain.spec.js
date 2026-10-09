// Answer Please / Explain Please v2 e2e (docs/specs/answer-explain-v2.md).
//
//   node tests/e2e/answer-explain.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// Needs a preview with E2E_REPLAY=1 and migration 031 run. The browser sends
// X-E2E-Answer-V2: 1 (and, for the picture tests, X-E2E-Image: mock and a
// per-run X-E2E-Key-Suffix), which a preview honours and production ignores
// (server/e2e-overrides.js), so the same preview also serves the flag-off
// suites. Model calls are replayed from tests/e2e/recordings; a new case is
// recorded with E2E_MODE=record (about $0.30 for the whole spec).
// Test families: mother 9999900001 (family 16, paid = Pro) and mother B
// 9999900004 (family B, free), code 123456 (see login.spec.js, family.spec.js).
//   a0  sign in (Pro mother and free mother B)
//   a1  typed numerical question: one card, marks chip, formula with "why" toggle, final answer 60 km/h, keywords highlighted
//   a2  "why" toggle and Notebook toggle (ruled lines)
//   a3  a question with no numbers ("differentiate"): compare table, 2 columns, numbered rows
//   a4  8 questions in one Telugu photo: 8 cards, batched in two calls, Telugu script, Telugu font loaded; no explain call before the Explain tap, then one for each of the 8 questions (img1: Explain please explains every question)
//   a5  unreadable (blurred) photo: asks for a clearer photo, no cards, no guessing
//   a6  non-academic photo: says so, no cards
//   a7  mixed-language page: 3 cards, each in its own script
//   a8  Explain please (Pro): the layers In 30 seconds / The full explanation / Exam traps stacked (no tabs), misconception box without a Knowledge Graph label, tonight card, "I asked" logs, check question feedback logs
//   a9  free vs Pro, on the real API payloads: the free reply has no paid field (and none of the paid text) but its picture status; Pro has all; the free page shows one upsell card
//   a10 picture, no key: fallback with the reason logged, shimmer gone, the diagram stays, answer never waited
//   a11 picture with the mock provider: shimmer, then the picture (signed URL, private bucket), second call is a cache hit (no model call, picture ready at once)
//   a12 print view: tools hidden, notebook rules kept, diagram shown while the picture is not ready
//   a13 "Coming soon: check <child>'s written answer" logs answer_check_interest
//   a14 flag off (no header): /api/homework answers in the old shape and the new routes are 404
//
// Output: tests/e2e/output/ (FAIL_a*.png, answer-explain-results.json, answer-explain-*.png). Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e2e = e2eMode('answer-explain');
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/answer-explain.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONES = { mother: '+919999900001', motherB: '+919999900004' };
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-6);
const results = [];
const SPEED_Q = 'A car travels 120 km in 2 hours. Find its average speed. (3 marks)';
const DIFF_Q = 'Differentiate between distance and displacement. (4 marks)';

function log(...a) { console.log('[e2e:answer]', ...a); }
// E2E_ONLY=a15 (a0 always runs): the one live run of the TUT-19 golden photo, without the rest.
const ONLY = (process.env.E2E_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
async function record(id, name, fn, page) {
  if (ONLY.length && id !== 'a0' && !ONLY.includes(id)) return;
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    const f = path.join(OUT, 'FAIL_' + id + '.png');
    const p = typeof page === 'function' ? page() : page;
    if (p) await p.screenshot({ path: f, fullPage: true }).catch(() => {});
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 500), shot: p ? f : '' });
    log(id, 'FAIL', err.message);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  log('base', BASE, 'run', RUN);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  const newCtx = async (opts, viewport = { width: 1000, height: 900 }) => {
    const ctx = await browser.newContext({ viewport });
    await e2e.attach(ctx, opts);
    await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      const hook = 'const auth = getAuth(app);';
      if (!body.includes(hook)) throw new Error('phone-auth.js hook not found');
      body = body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
      await route.fulfill({ response: resp, body });
    });
    return ctx;
  };
  const V2 = { v2: true, image: 'none', keySuffix: RUN };   // no key: the revision may bind a real one, a9/a10 test the no-key path

  async function signIn(who, opts = V2, viewport) {
    const ctx = await newCtx(opts, viewport);
    const page = await ctx.newPage();
    const seen = { requests: [], events: [], consoleErrors: [] };
    page.on('request', (r) => { if (/\/api\//.test(r.url())) seen.requests.push(r.method() + ' ' + new URL(r.url()).pathname); });
    page.on('console', (m) => { if (m.type() === 'error') seen.consoleErrors.push(m.text()); });
    page.on('response', async (r) => {
      if (/\/api\/answer-events$/.test(r.url())) {
        let body = {};
        try { body = JSON.parse(r.request().postData() || '{}'); } catch { /* not JSON */ }
        seen.events.push({ ...body, status: r.status() });
      }
    });
    await page.goto(BASE + '/app/login/');
    await page.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
    const status = await page.evaluate(async ({ phone, code }) => {
      await window.tutpSendOTP(phone);
      const idToken = await window.tutpVerifyOTP(code);
      const status = (await window.tutpEstablishSession(idToken)).status;
      if (status !== 200) return status;
      const me = await (await fetch('/api/session/me')).json();
      sessionStorage.setItem('tutp_family_id', me.familyId);
      sessionStorage.setItem('tutp_roles', JSON.stringify(me.roleMatches || []));
      // a family that never answered the baseline survey would get its overlay: skip it like a parent would
      sessionStorage.setItem('tutp_baseline_skipped', '1');
      return status;
    }, { phone: PHONES[who], code: CODE });
    if (status !== 200) throw new Error(`${who}: /api/session returned ${status}`);
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const studentId = await page.evaluate(() => window.tutpChildReady);
    if (!studentId) throw new Error(`${who}: no child selected`);
    return { page, studentId, seen };
  }

  // Opens Homework Help, asks, waits for cards or a message. Returns what the server said.
  async function ask(page, { text = '', file = null, language = 'English' }) {
    await page.evaluate(() => openHomeworkModal('homework'));
    await page.locator('#homeworkExplainModal').waitFor({ state: 'visible', timeout: 10000 });
    await page.selectOption('#hwModalLang', language);
    if (text) await page.fill('#hwModalText', text);
    if (file) {
      await page.setInputFiles('#hwModalAttachInput', path.join(__dirname, 'fixtures', file));
      await page.locator('#hwModalThumb').waitFor({ state: 'visible', timeout: 10000 });
    }
    const resp = page.waitForResponse((r) => /\/api\/homework$/.test(r.url()) && r.request().method() === 'POST', { timeout: 240000 });
    const t0 = Date.now();
    await page.click('#hwModalSubmitBtn');
    const r = await resp;
    await Promise.race([
      page.locator('#hwModalQuestionsArea .ae-card, #hwModalQuestionsArea .ae-msg').first().waitFor({ state: 'visible', timeout: 240000 }),
      page.locator('#hwModalErrBox:not(.hidden)').waitFor({ state: 'visible', timeout: 240000 }).then(async () => {
        throw new Error('modal error: ' + (await page.textContent('#hwModalErrBox')));
      }),
    ]);
    const headers = r.headers();
    return {
      status: r.status(), headers, ms: Date.now() - t0,
      steps: Object.fromEntries((headers['server-timing'] || '').split(',').map((s) => s.trim().match(/^(\w+);dur=(\d+)/)).filter(Boolean).map((m) => [m[1], +m[2]])),
    };
  }
  const cards = (page) => page.locator('#hwModalQuestionsArea .ae-card');
  const api = (page, url, body, method = 'POST') => page.evaluate(async ({ url, body, method }) => {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, headers: Object.fromEntries(r.headers.entries()), text, json };
  }, { url, body, method });

  let pro = null, free = null;
  await record('a0', 'sign in as the Pro mother (family 16) and the free mother B', async () => {
    pro = await signIn('mother');
    free = await signIn('motherB');
    return `pro child ${pro.studentId}, free child ${free.studentId}`;
  }, () => pro && pro.page);
  if (!pro || !free) { await browser.close(); console.log('no session: stopping'); process.exit(1); }
  const { page } = pro;

  // ---- a1, a2: typed numerical question
  await record('a1', 'typed numerical question: card, marks chip, steps, final answer, keywords', async () => {
    const r = await ask(page, { text: SPEED_Q });
    expect(r.status === 200, 'status ' + r.status);
    expect(r.headers['x-answer-status'] === 'ok', 'X-Answer-Status ' + r.headers['x-answer-status']);
    expect(r.headers['x-answer-batched'] === '0', 'typed text must be one call: X-Answer-Batched ' + r.headers['x-answer-batched']);
    expect(await cards(page).count() === 1, 'cards ' + await cards(page).count());
    expect((await page.locator('.ae-marks').first().textContent()).trim() === '3 marks', 'marks chip');
    const text = await cards(page).first().innerText();
    expect(/\b60\b/.test(text) && /km\s*\/\s*h/i.test(text), 'final answer 60 km/h missing: ' + text.slice(0, 200));
    expect(await page.locator('.ae-final').count() === 1, 'no final answer box');
    expect(await page.locator('mark.ae-kw').count() >= 1, 'no highlighted keyword');
    expect(await page.locator('.ae-chip').count() >= 1, 'no keyword chips');
    expect(await page.locator('#hwModalQuestionsArea [data-script]').count() >= 1, 'no data-script');
    return `${r.ms} ms, server ${JSON.stringify(r.steps)}`;
  }, page);

  await record('a2', '"why" toggle and Notebook toggle', async () => {
    const why = page.locator('.ae-why').first();
    expect(await why.count() === 1, 'no why button');
    expect(await why.getAttribute('aria-expanded') === 'false', 'why starts closed');
    expect(!(await page.locator('.ae-whytext').first().isVisible()), 'why text visible before the tap');
    await why.click();
    expect(await why.getAttribute('aria-expanded') === 'true' && await page.locator('.ae-whytext').first().isVisible(), 'why did not open');
    await why.click();
    expect(!(await page.locator('.ae-whytext').first().isVisible()), 'why did not close');
    const nb = page.locator('.ae-card button', { hasText: 'Notebook' }).first();
    await nb.click();
    expect(await nb.getAttribute('aria-pressed') === 'true', 'notebook not pressed');
    expect(/repeating-linear-gradient/.test(await page.locator('.ae-body').first().evaluate((e) => getComputedStyle(e).backgroundImage)), 'no ruled lines');
    await page.screenshot({ path: path.join(OUT, 'answer-explain-notebook.png'), fullPage: true });
    await nb.click();
    expect(await nb.getAttribute('aria-pressed') === 'false', 'notebook did not switch off');
    const small = await page.$$eval('#hwModalQuestionsArea .ae-btn', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).length);
    expect(small === 0, small + ' buttons under 44px');
  }, page);

  // ---- a3: no numbers
  await record('a3', 'question with no numbers: compare table, 2 columns, numbered rows', async () => {
    const r = await ask(page, { text: DIFF_Q });
    expect(r.status === 200 && r.headers['x-answer-status'] === 'ok', 'status ' + r.status);
    expect(await page.locator('.ae-table').count() === 1, 'no compare table');
    expect(await page.locator('.ae-table thead th').count() === 3, 'table is not 2 columns plus the number column');
    const nums = await page.$$eval('.ae-table td.ae-n', (e) => e.map((x) => x.textContent.trim()));
    expect(nums.length >= 2 && nums.every((n, i) => n === String(i + 1)), 'rows not numbered: ' + nums.join());
    expect(await page.locator('.ae-final').count() === 0, 'a numbers-style final box on a no-number question');
    return nums.length + ' rows';
  }, page);

  // ---- a4: 8 questions in one Telugu photo
  await record('a4', '8 questions in one Telugu photo: 8 cards, batched, Telugu font, Explain only on tap', async () => {
    const before = pro.seen.requests.length;
    const r = await ask(page, { file: 'te-8.jpg', language: 'Telugu' });
    expect(r.status === 200 && r.headers['x-answer-status'] === 'ok', 'status ' + r.status);
    expect(r.headers['x-answer-batched'] === '1', 'photo not batched: ' + r.headers['x-answer-batched']);
    const n = await cards(page).count();
    expect(n === 8, 'cards ' + n);
    const scripts = await page.$$eval('#hwModalQuestionsArea .ae-qtext', (e) => e.map((x) => x.dataset.script));
    expect(scripts.every((s) => s === 'telugu'), 'scripts ' + scripts.join());
    expect(/[ఀ-౿]/.test(await cards(page).first().innerText()), 'no Telugu text');
    expect(await page.$$eval('link[href*="fonts.googleapis"]', (l) => l.some((x) => x.href.includes('Noto+Sans+Telugu'))), 'Noto Sans Telugu not loaded');
    expect(!pro.seen.requests.slice(before).some((x) => x.endsWith('/api/explain-please')), 'explain was asked for before any tap');
    const marks = await page.$$eval('.ae-marks', (e) => e.map((x) => x.textContent.trim()));
    expect(marks.length === 8, 'marks chips ' + marks.length);
    await page.screenshot({ path: path.join(OUT, 'answer-explain-te-8.png'), fullPage: true });
    // img1: one tap on an answer card's Explain button switches to Explain please, which explains
    // EVERY question of the photo at once, each shown as it arrives; no further tap.
    await page.locator('.ae-cta button', { hasText: 'Explain' }).nth(4).click();
    await page.locator('#hwExplainBlock .ae-explain h3').nth(7).waitFor({ timeout: 240000 });
    expect(pro.seen.requests.slice(before).filter((x) => x.endsWith('/api/explain-please')).length === 8, 'Explain please should ask once for each of the 8 questions');
    expect(await page.locator('#hwExplainBlock .ae-explain-card').count() === 8, 'not 8 explanation cards');
    return `8 cards; response ${r.ms} ms; server ${JSON.stringify(r.steps)}; fixed ${r.headers['x-answer-fixed']}`;
  }, page);

  // ---- a5, a6, a7: photo edge cases
  await record('a5', 'unreadable (blurred) photo: asks for a clearer photo, no cards, no guess', async () => {
    const r = await ask(page, { file: 'te-8-blurred.jpg', language: 'English' });
    expect(r.status === 200, 'status ' + r.status);
    expect(r.headers['x-answer-status'] === 'unreadable', 'X-Answer-Status ' + r.headers['x-answer-status']);
    // the model writes the retake request in the parent's language (its own words), else the page's English default
    const msg = (await page.locator('.ae-msg').first().innerText()).trim();
    expect(msg.length >= 20 && /photo|picture|image|clear|sharp|light/i.test(msg), 'no clearer-photo message: ' + msg);
    expect(await cards(page).count() === 0, 'cards on an unreadable photo');
  }, page);

  await record('a6', 'non-academic photo: says so, no cards', async () => {
    const r = await ask(page, { file: 'landscape.jpg', language: 'English' });
    expect(r.status === 200 && r.headers['x-answer-status'] === 'not_homework', 'X-Answer-Status ' + r.headers['x-answer-status']);
    expect(/does not look like/i.test(await page.locator('.ae-msg').first().innerText()), 'no message');
    expect(await cards(page).count() === 0, 'cards on a landscape');
  }, page);

  await record('a7', 'mixed-language page: 3 cards, each in its own script', async () => {
    const r = await ask(page, { file: 'mixed-3.jpg', language: 'English' });
    expect(r.status === 200 && r.headers['x-answer-status'] === 'ok', 'status ' + r.status);
    const scripts = await page.$$eval('#hwModalQuestionsArea .ae-qtext', (e) => e.map((x) => x.dataset.script));
    expect(scripts.join() === 'latin,telugu,devanagari', 'scripts ' + scripts.join());
  }, page);

  // ---- a8: Explain, Pro. Uses a typed question so the answer carries a signed concept key.
  await record('a8', 'Explain please (Pro): the three layers stacked, misconception without a KG label, tonight card, I asked, check question', async () => {
    await ask(page, { text: SPEED_Q });
    const explainResp = page.waitForResponse((r) => /\/api\/explain-please$/.test(r.url()), { timeout: 180000 });
    await page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
    const er = await explainResp;
    expect(er.status() === 200, 'explain status ' + er.status());
    const view = await er.json();
    await page.locator('.ae-explain h3').first().waitFor({ timeout: 30000 });
    // img1: Explain please shows every layer straight away (no tabs, no extra tap)
    expect((await page.locator('.ae-explain .ae-layer-h').allTextContents()).join() === 'In 30 seconds,The full explanation,Exam traps', 'layers');
    expect(await page.locator('.ae-explain [role=tab]').count() === 0, 'tabs in Explain please mode');
    expect((await page.locator('.ae-explain .ae-layer').nth(1).innerText()).length > 80, 'full explanation empty');
    expect(await page.locator('.ae-explain .ae-layer li').count() === 3, 'traps not 3');
    expect(await page.locator('.ae-miscon').isVisible(), 'no misconception box');
    expect(!(await page.locator('.ae-explain').innerText()).includes('Knowledge Graph'), 'a "Knowledge Graph" label on a model-sourced misconception');
    expect(await page.locator('.ae-tonight li').count() === 2, 'tonight card needs 2 questions');
    await page.locator('.ae-tonight button', { hasText: 'I asked' }).click();
    await expectEvent(pro, 'parent_asked');
    const cq = view.check_question;
    const wrong = (cq.correct_index + 1) % 3;
    await page.locator('.ae-check .ae-opt').nth(wrong).click();
    expect((await page.locator('.ae-feedback').innerText()).trim() === cq.wrong_feedback.trim(), 'wrong feedback');
    expect(await page.locator('.ae-opt[data-state=right]').count() === 1, 'right option not marked');
    const ev = await expectEvent(pro, 'explain_check');
    expect(ev.correct === false, 'explain_check correct flag ' + ev.correct);
    await page.locator('.ae-explain button', { hasText: 'Save to notes' }).click();
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('tutp_saved_explanations_'))), 'not saved');
    await page.screenshot({ path: path.join(OUT, 'answer-explain-explain-pro.png'), fullPage: true });
    return 'key ' + view.concept_key + ', cache ' + er.headers()['x-explain-cache'];
  }, page);

  async function expectEvent(who, name, timeoutMs = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const e = who.seen.events.filter((x) => x.event === name).pop();
      if (e) { expect(e.status === 204, `${name} answered ${e.status}`); return e; }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`event ${name} was not logged`);
  }

  // ---- a9: free vs Pro on the real payloads
  let proPayload = null;
  await record('a9', 'free vs Pro: payloads from the server, upsell card on the free page', async () => {
    // A real answer gives a signed concept key (the same on both families).
    const ans = await api(pro.page, '/api/homework', { feature: 'homework_help', text: SPEED_Q, language: 'English', studentId: pro.studentId, attachments: [] });
    expect(ans.status === 200, 'answer status ' + ans.status);
    const parsed = JSON.parse(JSON.parse(ans.text).content[0].text);
    const q = parsed.questions[0];
    expect(q.concept_key && q.concept_sig, 'the answer carries no signed concept key');
    const body = (sid) => ({ studentId: sid, question: q.q_text, qType: q.q_type, subject: parsed.subject, language: 'English', concept_key: q.concept_key, concept_sig: q.concept_sig });
    const p = await api(pro.page, '/api/explain-please', body(pro.studentId));
    const f = await api(free.page, '/api/explain-please', body(free.studentId));
    expect(p.status === 200 && f.status === 200, `statuses pro ${p.status} free ${f.status}`);
    proPayload = p.json;
    for (const k of ['full', 'traps', 'misconception', 'parent_questions', 'check_question', 'illustration']) expect(k in p.json, 'Pro reply lacks ' + k);
    const freeKeys = Object.keys(f.json).filter((k) => k !== '_recordings').sort().join();
    // img1: a free reply also carries the picture's status (the page polls it; one picture a day is shown in full)
    expect(freeKeys === 'concept_key,illustration,locked,quick,tier,title,upsell', 'free keys: ' + freeKeys);
    expect(Object.keys(f.json.illustration).join() === 'status', 'the free picture object holds more than its status: ' + Object.keys(f.json.illustration));
    expect(f.json.tier === 'free' && f.json.locked === true, 'free flags');
    expect(f.json.upsell.label === 'Pro ₹500/month', 'upsell label');
    for (const secret of [p.json.full, p.json.traps[0], p.json.check_question.q, p.json.parent_questions[0].q, p.json.misconception.text, p.json.illustration.labels[0].text].filter((s) => String(s).length >= 12)) {   // a one-word trap or label also appears in the free title legitimately
      // record mode adds _recordings (the raw model reply, never sent to browsers in production)
      expect(!JSON.stringify({ ...f.json, _recordings: undefined }).includes(secret), 'free reply leaks: ' + secret.slice(0, 40));
    }
    expect(!/scene_prompt/.test(JSON.stringify({ ...p.json, _recordings: undefined })), 'the image prompt is sent to the browser');
    // img1: a free family may poll (it gets the picture, or a blurred preview): never a 403 any more
    const pic = await api(free.page, `/api/illustration/${encodeURIComponent(f.json.concept_key)}?studentId=${free.studentId}`, null, 'GET');
    expect(pic.status === 200, 'a free family polling a picture: ' + pic.status);
    // The free page: the real free payload through the real page code.
    await free.page.route('**/api/homework', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: ans.text }));
    await ask(free.page, { text: SPEED_Q });
    await free.page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
    await free.page.locator('.ae-explain h3').first().waitFor({ timeout: 180000 });
    expect(await free.page.locator('.ae-explain .ae-layer-h').count() === 1, 'free page shows more than the 30 second layer');
    expect(await free.page.locator('[data-role=explain-upsell]').count() === 1, 'not exactly one upsell card');
    expect((await free.page.locator('.ae-upsell').innerText()).includes('Pro ₹500/month'), 'no upsell card');
    expect(await free.page.locator('.ae-tonight, .ae-check, .ae-miscon').count() === 0, 'paid blocks on the free page');
    await free.page.screenshot({ path: path.join(OUT, 'answer-explain-free.png'), fullPage: true });
    await free.page.unroute('**/api/homework');
    return 'free keys ' + freeKeys;
  }, () => free && free.page);

  // ---- a10: no key / flag off: silent fallback
  await record('a10', 'picture without a key: fallback, reason logged, shimmer gone, diagram stays', async () => {
    expect(proPayload, 'a9 gave no Pro payload');
    expect(proPayload.illustration.status === 'fallback', 'status ' + proPayload.illustration.status);
    const poll = await api(pro.page, `/api/illustration/${encodeURIComponent(proPayload.concept_key)}?studentId=${pro.studentId}`, null, 'GET');
    expect(poll.status === 200 && poll.json.status === 'fallback', 'poll ' + poll.text);
    expect(poll.json.reason === 'flag_off' || poll.json.reason === 'no_key', 'reason ' + poll.json.reason);
    // in the page: no shimmer, no console error from the picture
    await ask(page, { text: SPEED_Q });
    await page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
    await page.locator('.ae-explain h3').first().waitFor({ timeout: 180000 });
    await page.waitForTimeout(1500);
    // img1: with no picture and no diagram to show instead, the figure is simply gone
    expect(await page.locator('.tp-pic-shimmer').count() === 0, 'shimmer still shown on a fallback');
    expect(await page.locator('.tp-pic img').count() === 0, 'an image without a provider');
    expect(await page.locator('.tp-pic[data-state=ready], .tp-pic[data-state=blurred]').count() === 0, 'a picture was shown without a provider');
    return 'reason ' + poll.json.reason;
  }, page);

  // ---- a11: the mock provider
  let img = null;
  await record('a11', 'picture with the mock provider: shimmer, picture by signed URL, 2nd call a cache hit', async () => {
    img = await signIn('mother', { v2: true, image: 'mock', keySuffix: RUN + 'i' });
    const ans = await api(img.page, '/api/homework', { feature: 'homework_help', text: SPEED_Q, language: 'English', studentId: img.studentId, attachments: [] });
    const q = JSON.parse(JSON.parse(ans.text).content[0].text).questions[0];
    const body = { studentId: img.studentId, question: q.q_text, qType: q.q_type, subject: 'Physics', language: 'English', concept_key: q.concept_key, concept_sig: q.concept_sig };
    const first = await api(img.page, '/api/explain-please', body);
    expect(first.status === 200, 'first explain ' + first.status);
    expect(first.json.illustration.status === 'pending', 'first call picture status ' + first.json.illustration.status);
    let st = null;
    for (let i = 0; i < 30; i++) {
      st = (await api(img.page, `/api/illustration/${encodeURIComponent(first.json.concept_key)}?studentId=${img.studentId}`, null, 'GET')).json;
      if (st.status !== 'pending') break;
      await img.page.waitForTimeout(1000);
    }
    expect(st.status === 'ready' && st.url, 'picture not ready: ' + JSON.stringify(st));
    expect(/\/storage\/v1\/object\/sign\/illustrations\//.test(st.url) && /token=/.test(st.url), 'not a signed URL of the private bucket: ' + st.url.slice(0, 120));
    expect(!/\/object\/public\//.test(st.url), 'a public URL');
    const file = await img.page.request.get(st.url);
    expect(file.status() === 200 && /image\/png/.test(file.headers()['content-type'] || ''), 'picture fetch ' + file.status());
    const publicTry = await img.page.request.get(st.url.replace('/object/sign/', '/object/public/').split('?')[0]);
    expect(publicTry.status() !== 200, 'the bucket answers on a public URL (' + publicTry.status() + ')');
    // second call, same concept: no model call, picture ready at once
    const second = await api(img.page, '/api/explain-please', body);
    expect(second.headers['x-explain-cache'] === 'hit', 'second call X-Explain-Cache ' + second.headers['x-explain-cache']);
    expect(second.json.illustration.status === 'ready', 'second call picture status ' + second.json.illustration.status);
    // and through the page: shimmer, then the picture
    await ask(img.page, { text: SPEED_Q });
    await img.page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
    await img.page.locator('.ae-explain .tp-pic').waitFor({ timeout: 180000 });
    await img.page.waitForFunction(() => document.querySelector('.tp-pic').dataset.state === 'ready', null, { timeout: 30000 });
    expect(await img.page.locator('.tp-pic img').first().evaluate((i) => i.naturalWidth > 0), 'image did not load');
    expect(await img.page.locator('.tp-pic .tp-pic-shimmer').count() === 0, 'shimmer after the picture');
    expect(await img.page.locator('.tp-pic .tp-pic-label').count() >= 1, 'no label chips over the picture');
    return `ready, signed URL ok, cache ${second.headers['x-explain-cache']}`;
  }, () => img && img.page);

  // ---- a12: print
  await record('a12', 'print view: tools hidden, notebook rules kept, diagram shown while the picture is not ready', async () => {
    await ask(page, { text: DIFF_Q });
    await page.locator('.ae-card button', { hasText: 'Notebook' }).first().click();
    await page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
    await page.locator('.ae-explain h3').first().waitFor({ timeout: 180000 });
    // The real print button marks the panel as the print target (the page's own printResult); the dialog itself is stubbed.
    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('.ae-explain .ae-tools button', { hasText: 'Print' }).first().click();
    await page.emulateMedia({ media: 'print' });
    try {
      expect(await page.locator('.ae-explain.print-target').count() === 1, 'the print button did not mark the panel');
      expect(await page.locator('.ae-tools:visible').count() === 0, 'tools printed');
      expect(await page.locator('.ae-cta:visible').count() === 0, 'explain button printed');
      expect(/repeating-linear-gradient/.test(await page.locator('.ae-body').first().evaluate((e) => getComputedStyle(e).backgroundImage)), 'notebook rules not printed');
      const shown = await page.locator('.ae-explain .ae-layer:visible').count();
      expect(shown === 3, `not all three layers printed (visible ${shown} of 3)`);
      await page.screenshot({ path: path.join(OUT, 'answer-explain-print.png'), fullPage: true });
    } finally { await page.emulateMedia({ media: 'screen' }); }
  }, page);

  // ---- a13: coming soon
  await record('a13', '"Coming soon: check written answer" logs answer_check_interest', async () => {
    await ask(page, { text: SPEED_Q });
    expect(/Coming soon/.test(await page.locator('.ae-soon').innerText()), 'no coming-soon card');
    await page.locator('.ae-soon button').click();
    const ev = await expectEvent(pro, 'answer_check_interest');
    expect(ev.studentId === pro.studentId, 'event student');
  }, page);

  // ---- a14: flag off (a browser that sends no header)
  await record('a14', 'flag off: old reply shape, new routes 404', async () => {
    const ctx = await newCtx(null);
    const p = await ctx.newPage();
    await p.goto(BASE + '/app/login/');
    await p.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
    const status = await p.evaluate(async ({ phone, code }) => {
      await window.tutpSendOTP(phone); const idToken = await window.tutpVerifyOTP(code);
      return (await window.tutpEstablishSession(idToken)).status;
    }, { phone: PHONES.mother, code: CODE });
    expect(status === 200, 'login ' + status);
    const me = await p.evaluate(async () => (await (await fetch('/api/session/me')).json()));
    const ex = await api(p, '/api/explain-please', { studentId: pro.studentId, question: 'x' });
    expect(ex.status === 404, 'explain-please without the flag: ' + ex.status);
    const ev = await api(p, '/api/answer-events', { event: 'parent_asked', studentId: pro.studentId });
    expect(ev.status === 404, 'answer-events without the flag: ' + ev.status);
    const rq = await api(p, '/api/illustration/request', { studentId: pro.studentId, picture: { concept_key: 'c9-physics-speed', scene_prompt: 'A boy runs.', sig: 'x' } });
    expect(rq.status === 404, 'illustration request without the flag: ' + rq.status);
    const old = await api(p, '/api/homework', { feature: 'homework_help', text: '24 + 13 = ?', language: 'English', studentId: pro.studentId, attachments: [] });
    expect(old.status === 200, 'old path status ' + old.status + ' ' + old.text.slice(0, 120));
    const oldJson = JSON.parse(JSON.parse(old.text).content[0].text);
    expect(oldJson.schema === undefined && Array.isArray(oldJson.extracted_questions), 'the old reply shape changed');
    void me;
    await ctx.close();
  }, null);

  // ---- a15 (TUT-19, golden): the 8 maths questions of the live bug, in one photo
  await record('a15', 'golden maths photo: 8 questions, each card has its own numbers and answer, "checked", diagrams from code, at most one picture; the same photo again is all cache hits', async () => {
    const photo = [];                                  // every explain-please call of this test: { body, json, cache }
    const onResp = async (r) => {
      if (!/\/api\/explain-please$/.test(r.url())) return;
      try { photo.push({ body: JSON.parse(r.request().postData() || '{}'), json: await r.json(), cache: r.headers()['x-explain-cache'] }); } catch { /* not JSON */ }
    };
    pro.page.on('response', onResp);
    const rr = await ask(pro.page, { file: 'maths-8.jpg', language: 'English' });
    expect(rr.status === 200 && rr.headers['x-answer-status'] === 'ok', 'photo status ' + rr.status);
    const n = await cards(pro.page).count();
    expect(n === 8, 'cards ' + n);
    await pro.page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
    await pro.page.waitForFunction(() => document.querySelectorAll('#hwExplainBlock .ae-explain-card').length === 8 && document.querySelectorAll('#hwExplainBlock .ae-explain-card [data-inv="card.steps"], #hwExplainBlock .ae-explain-card [data-inv="card.could-not-check"]').length === 8, null, { timeout: 240000 });
    pro.page.off('response', onResp);
    expect(photo.length === 8, 'explain calls ' + photo.length);
    const texts = await pro.page.$$eval('#hwExplainBlock .ae-explain-card', (cs) => cs.map((c) => ({
      q: c.querySelector('.ae-qtext').textContent,
      steps: (c.querySelector('[data-inv="card.steps"]') || {}).innerText || '',
      answer: (c.querySelector('[data-inv="card.answer"] .ae-answer-val') || {}).textContent || '',
      checked: !!c.querySelector('[data-inv="card.checked"]'),
      diagram: !!c.querySelector('[data-inv="card.diagram"] svg'),
      hasPicture: !!c.querySelector('[data-inv="picture"]'),
    })));
    const { parseQuestion } = await import('../../server/math-engine.js');
    const { buildMathDiagram } = await import('../../server/services/diagrams.js');
    const nums = (s) => new Set((s.match(/\d+/g) || []));
    texts.forEach((t, i) => {
      const p = parseQuestion(t.q);
      expect(p, `card ${i + 1}: the engine cannot read "${t.q}"`);
      expect(t.checked && t.answer === p.answerText, `card ${i + 1} "${t.q}": answer "${t.answer}", expected ${p.answerText}, checked ${t.checked}`);
      for (const x of p.numbers) expect(nums(t.steps).has(x), `card ${i + 1} "${t.q}": its steps lack ${x}`);
      expect(!!buildMathDiagram(p) === t.diagram, `card ${i + 1} "${t.q}": diagram ${t.diagram}, expected ${!!buildMathDiagram(p)}`);
      // a card never carries ANOTHER question's text: not two or more of that question's own numbers
      // (two digits or more) that are not this question's. One such number can be a worked example's.
      texts.forEach((o, j) => {
        if (j === i) return;
        const po = parseQuestion(o.q);
        const foreign = po.numbers.filter((x) => x.length >= 2 && !p.numbers.includes(x) && x !== p.answerText && nums(t.steps).has(x));
        expect(foreign.length < 2, `card ${i + 1} "${t.q}" carries card ${j + 1}'s numbers ${foreign.join()}`);
      });
    });
    const pictures = await pro.page.locator('#hwExplainBlock [data-inv="picture"]').count();
    expect(pictures <= 1, 'pictures on the page: ' + pictures);
    expect(texts.every((t) => !t.hasPicture) || pictures <= 1, 'a picture inside a card');
    // the same photo's questions again: every one a cache hit
    const again = [];
    for (const c of photo) { const r = await api(pro.page, '/api/explain-please', c.body); again.push(r.headers['x-explain-cache']); }
    expect(again.every((h) => h === 'hit'), 'second ask not all hits: ' + again.join());
    return `8 cards ok; pictures ${pictures}; diagrams ${texts.filter((t) => t.diagram).length}; first-ask cache ${photo.map((c) => c.cache).join()}`;
  }, () => pro && pro.page);

  await e2e.finish();
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'answer-explain-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { failed.forEach((f) => console.log('FAIL', f.id, f.detail)); process.exit(1); }
})();
