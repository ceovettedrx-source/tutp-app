// img1 e2e (docs/specs/img1.md): Explain please explains every question in full and in
// parallel, the language rule, one shared picture per concept on every explaining
// surface, and the free tier (one generated picture a day, the rest blurred).
//
//   node tests/e2e/img1.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// Needs a preview with E2E_REPLAY=1, the mock image provider (the browser sends
// X-E2E-Image: mock and a per-run X-E2E-Key-Suffix, honoured on a preview only) and migration
// 031. Model calls are replayed from tests/e2e/recordings; a new case is recorded with
// E2E_MODE=record. Test families: mother 9999900001 (family 16, Pro) and mother B 9999900004
// (family 18, free), code 123456 (see login.spec.js, family.spec.js).
//   i0  sign in (Pro mother and free mother B)
//   i1  Answer please vs Explain please: two questions; Answer shows answers only and asks nothing;
//       the Explain chip shows, for BOTH questions at once, picture, the three layers, the
//       misconception, the "tonight" card and the check question, with one explain call per
//       question started together; the answers are hidden; Answer again shows them untouched
//   i2  each explanation is shown as it arrives: one question's reply is held back 3.5 s and the
//       other card is complete while it still says "Preparing"
//   i3  language rule, Telugu parent and an English page: the notebook answer and the question stay
//       English, the explanation and the notes are Telugu with the key term bilingual
//   i4  one shared picture per concept: Answer card (theory), Explain and Notes show the picture of the
//       same concept key; a numerical question gets no generated picture
//   i5  free tier: one picture in full, the other blurred with "See every picture in Pro"; the blurred
//       reply carries no link to the real file; picture_upsell_view is logged
//   i6  a picture request is only accepted with the server's signature, for the family's own child
//   i7  Storytelling: the story reply carries a signed picture and the modal shows it
//   i8  Experiential Learning: the lesson carries a signed picture and the guided panel shows it once
//       across the steps
//   i9  picture events: picture_upsell_view and picture_upsell_click are accepted and logged
//
// Output: tests/e2e/output/ (FAIL_i*.png, img1-results.json, img1-*.png). Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e2e = e2eMode('img1');
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/img1.spec.js <base-url> [--headless]');
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
const TWO_Q = '1. ' + SPEED_Q + '   2. ' + DIFF_Q;
const THEORY_2 = '1. ' + DIFF_Q + '   2. What is photosynthesis? (2 marks)';
const TELUGU = /[ఀ-౿]/;
const BRACKET_TERM = /\([A-Za-z][A-Za-z -]{2,}\)/;

function log(...a) { console.log('[e2e:img1]', ...a); }
async function record(id, name, fn, page) {
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // Each family gets its own run suffix: its own cache rows, pictures and free-picture count.
  async function signIn(who, suffix, viewport) {
    const ctx = await newCtx({ v2: true, image: 'mock', keySuffix: RUN + suffix }, viewport);
    const page = await ctx.newPage();
    const seen = { requests: [], events: [], pictures: [], illustrationGets: [], consoleErrors: [] };
    page.on('request', (r) => { if (/\/api\//.test(r.url())) seen.requests.push({ m: r.method(), p: new URL(r.url()).pathname + new URL(r.url()).search, t: Date.now() }); });
    page.on('console', (m) => { if (m.type() === 'error') seen.consoleErrors.push(m.text()); });
    page.on('response', async (r) => {
      const u = new URL(r.url());
      if (/\/api\/answer-events$/.test(u.pathname)) {
        let body = {};
        try { body = JSON.parse(r.request().postData() || '{}'); } catch { /* not JSON */ }
        seen.events.push({ ...body, status: r.status() });
      } else if (/^\/api\/illustration\/[a-z0-9-]+$/.test(u.pathname) && r.request().method() === 'GET') {
        let text = ''; try { text = await r.text(); } catch { /* gone */ }
        seen.illustrationGets.push({ key: u.pathname.split('/').pop(), status: r.status(), text });
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
      sessionStorage.setItem('tutp_baseline_skipped', '1');
      return status;
    }, { phone: PHONES[who], code: CODE });
    if (status !== 200) throw new Error(`${who}: /api/session returned ${status}`);
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const studentId = await page.evaluate(() => window.tutpChildReady);
    if (!studentId) throw new Error(`${who}: no child selected`);
    return { page, studentId, seen, key: (k) => (k.slice(0, 50).replace(/-+$/, '') + '-' + RUN + suffix) };
  }

  // Opens Homework Help, asks, waits for cards or a message. Returns the parsed reply.
  async function ask(who, { text = '', language = 'English' }) {
    const { page } = who;
    await page.evaluate(() => openHomeworkModal('homework'));
    await page.locator('#homeworkExplainModal').waitFor({ state: 'visible', timeout: 10000 });
    await page.selectOption('#hwModalLang', language);
    await page.fill('#hwModalText', text);
    const resp = page.waitForResponse((r) => /\/api\/homework$/.test(r.url()) && r.request().method() === 'POST', { timeout: 240000 });
    await page.click('#hwModalSubmitBtn');
    const r = await resp;
    await page.locator('#hwModalQuestionsArea .ae-card, #hwModalQuestionsArea .ae-msg').first().waitFor({ state: 'visible', timeout: 240000 });
    const parsed = JSON.parse((await r.json()).content[0].text);
    return { status: r.status(), headers: r.headers(), parsed };
  }
  const chip = async (page, id) => { await page.click(`#hwChips button[data-chip="${id}"]`); };
  const api = (page, url, body, method = 'POST') => page.evaluate(async ({ url, body, method }) => {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, headers: Object.fromEntries(r.headers.entries()), text, json };
  }, { url, body, method });
  // The events a page sent (and the server's answers), waiting a few seconds for the first one.
  async function waitEvents(who, name, timeoutMs = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const found = who.seen.events.filter((e) => e.event === name);
      if (found.length) return found;
      await sleep(200);
    }
    return [];
  }
  const explainReqs = (who, from) => who.seen.requests.slice(from).filter((x) => x.m === 'POST' && x.p === '/api/explain-please');

  let pro = null, free = null;
  await record('i0', 'sign in as the Pro mother (family 16) and the free mother B', async () => {
    pro = await signIn('mother', 'p');
    free = await signIn('motherB', 'f');
    return `pro child ${pro.studentId}, free child ${free.studentId}`;
  }, () => pro && pro.page);
  if (!pro || !free) { await browser.close(); console.log('no session: stopping'); process.exit(1); }
  const page = pro.page;

  // ---- i1: Answer please vs Explain please
  await record('i1', 'Answer please shows answers only; Explain please explains every question in full, in parallel', async () => {
    const from = pro.seen.requests.length;
    const a = await ask(pro, { text: TWO_Q });
    expect(a.status === 200 && a.parsed.questions.length === 2, 'two questions expected: ' + a.parsed.questions.length);
    // Answer please: answers and idea cards only, nothing asked for an explanation
    expect(await page.locator('#hwModalQuestionsArea .ae-card').count() === 2, 'answer cards');
    expect(await page.locator('#hwModalQuestionsArea .ae-final').count() >= 1, 'no final answer in Answer please');
    expect(await page.locator('#hwExplainBlock .ae-explain').count() === 0, 'explanations on screen in Answer please');
    expect(explainReqs(pro, from).length === 0, 'Answer please asked for an explanation');
    await page.screenshot({ path: path.join(OUT, 'img1-answer-please.png'), fullPage: true });
    // Explain please
    await chip(page, 'explain');
    await page.locator('#hwExplainBlock .ae-explain h3').nth(1).waitFor({ timeout: 240000 });
    expect(await page.locator('#hwExplainBlock').isVisible(), 'Explain block hidden');
    expect(!(await page.locator('#hwModalHomeworkResultBlock').isVisible()), 'the answers are still shown next to the explanations');
    expect(await page.locator('#hwExplainBlock .ae-explain-card').count() === 2, 'not one explanation card per question');
    expect(await page.locator('#hwExplainBlock .ae-layer').count() === 6, 'three layers per question expected');
    expect(await page.locator('#hwExplainBlock .ae-miscon').count() === 2, 'misconception box per question');
    expect(await page.locator('#hwExplainBlock .ae-tonight').count() === 2, '"tonight" card per question');
    expect(await page.locator('#hwExplainBlock .ae-check').count() === 2, 'check question per question');
    expect(await page.locator('#hwExplainBlock .ae-final, #hwExplainBlock .ae-table').count() === 0, 'answers leaked into Explain please');
    const reqs = explainReqs(pro, from);
    expect(reqs.length === 2, 'explain calls: ' + reqs.length);
    expect(reqs[reqs.length - 1].t - reqs[0].t < 400, 'the explain calls were not started together (' + (reqs[reqs.length - 1].t - reqs[0].t) + ' ms apart)');
    await page.screenshot({ path: path.join(OUT, 'img1-explain-please.png'), fullPage: true });
    // back to Answer please: answers again, no new calls
    const n = explainReqs(pro, from).length;
    await chip(page, 'answer');
    expect(await page.locator('#hwModalQuestionsArea .ae-card').first().isVisible(), 'answers not shown again');
    expect(!(await page.locator('#hwExplainBlock').isVisible()), 'Explain block still shown in Answer please');
    expect(explainReqs(pro, from).length === n, 'switching back asked again');
    // and forward again: no new calls either (kept)
    await chip(page, 'explain');
    expect(explainReqs(pro, from).length === n, 'switching to Explain again asked again');
    return '2 cards, ' + (reqs[reqs.length - 1].t - reqs[0].t) + ' ms between the two explain calls';
  }, page);

  // ---- i2: shown as each arrives
  await record('i2', 'each explanation appears as soon as it arrives', async () => {
    let n = 0;
    await page.route('**/api/explain-please', async (route) => { n++; if (n === 2) await sleep(3500); await route.fallback(); });
    try {
      await ask(pro, { text: TWO_Q });
      await chip(page, 'explain');
      await page.locator('#hwExplainBlock .ae-explain h3').first().waitFor({ timeout: 240000 });
      const loading = await page.locator('#hwExplainBlock .ae-loading').count();
      const done = await page.locator('#hwExplainBlock .ae-explain h3').count();
      expect(done === 1 && loading === 1, `expected one finished card and one still preparing, got ${done} and ${loading}`);
      await page.locator('#hwExplainBlock .ae-explain h3').nth(1).waitFor({ timeout: 60000 });
    } finally { await page.unroute('**/api/explain-please'); }
  }, page);

  // ---- i3: the language rule (Telugu parent, English page)
  await record('i3', 'language rule: English page, Telugu parent: notebook answer English, explanation and notes Telugu with the term bilingual', async () => {
    const a = await ask(pro, { text: DIFF_Q, language: 'Telugu' });
    expect(a.status === 200, 'status ' + a.status);
    const q = a.parsed.questions[0];
    expect(!TELUGU.test(q.q_text), 'the question text was translated: ' + q.q_text);
    const cells = JSON.stringify(q.blocks);
    expect(!TELUGU.test(cells), 'the notebook answer was written in Telugu: ' + cells.slice(0, 120));
    expect(await page.locator('#hwModalQuestionsArea .ae-qtext').first().getAttribute('data-script') === 'latin', 'question script');
    await chip(page, 'explain');
    await page.locator('#hwExplainBlock .ae-explain h3').first().waitFor({ timeout: 240000 });
    const ex = await page.locator('#hwExplainBlock').innerText();
    expect(TELUGU.test(await page.locator('#hwExplainBlock .ae-layer').first().innerText()), 'the explanation is not in Telugu');
    expect(BRACKET_TERM.test(ex), 'no bilingual key term (Telugu word (English term)) in the explanation: ' + ex.slice(0, 300));
    await chip(page, 'notes');
    await page.locator('#hwNotesBlock .nd').waitFor({ timeout: 240000 });
    const notes = await page.locator('#hwNotesBlock').innerText();
    expect(TELUGU.test(notes), 'notes are not in Telugu');
    expect(BRACKET_TERM.test(notes), 'no bilingual key term in the notes');
    await page.screenshot({ path: path.join(OUT, 'img1-language-te-notes.png'), fullPage: true });
  }, page);

  // ---- i4: one shared picture per concept
  await record('i4', 'Answer card, Explain and Notes show the picture of one shared concept key; numerical gets none', async () => {
    const from = pro.seen.illustrationGets.length;
    const a = await ask(pro, { text: DIFF_Q });
    const q = a.parsed.questions[0];
    expect(q.picture && q.picture.concept_key && q.picture.sig && q.picture.scene_prompt, 'the theory question carries no signed picture: ' + JSON.stringify(q.picture));
    expect(!JSON.stringify(a.parsed).includes('"scene_prompt":""'), 'an empty scene_prompt leaked');
    await page.locator('#hwModalQuestionsArea .tp-pic[data-state=ready]').first().waitFor({ timeout: 60000 });
    expect(await page.locator('#hwModalQuestionsArea .tp-pic img').first().evaluate((i) => i.naturalWidth > 0), 'answer-card picture did not load');
    await chip(page, 'explain');
    await page.locator('#hwExplainBlock .tp-pic[data-state=ready]').first().waitFor({ timeout: 240000 });
    await chip(page, 'notes');
    await page.locator('#hwNotesBlock .tp-pic[data-state=ready]').first().waitFor({ timeout: 240000 });
    const keys = [...new Set(pro.seen.illustrationGets.slice(from).map((g) => g.key))];
    expect(keys.length === 1, 'the surfaces polled different pictures: ' + keys.join());
    expect(keys[0] === pro.key(q.concept_key), `the shared key is ${keys[0]}, expected ${pro.key(q.concept_key)}`);
    await page.screenshot({ path: path.join(OUT, 'img1-shared-picture-notes.png'), fullPage: true });
    // a numerical question: SVG diagram territory, no generated picture
    const b = await ask(pro, { text: SPEED_Q });
    expect(!b.parsed.questions[0].picture, 'a numerical question got a picture');
    expect(await page.locator('#hwModalQuestionsArea .tp-pic').count() === 0, 'a numerical card shows a picture');
    return 'one key: ' + keys[0];
  }, page);

  // ---- i5: free tier
  await record('i5', 'free family: one picture in full, the other blurred with the upsell; no link to the real file', async () => {
    // The free family's own /api/homework would use up its free sessions, so the Pro family asks and
    // the free page is handed that reply (the signed pictures and concept keys do not belong to a family).
    const real = await api(pro.page, '/api/homework', { feature: 'homework_help', text: THEORY_2, language: 'English', studentId: pro.studentId, attachments: [] });
    expect(real.status === 200, 'pro answer ' + real.status);
    await free.page.route('**/api/homework', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: real.text }));
    const a = await ask(free, { text: THEORY_2 });
    await free.page.unroute('**/api/homework');
    expect(a.parsed.questions.length === 2 && a.parsed.questions.every((q) => q.picture), 'two theory questions with pictures expected');
    await free.page.waitForFunction(() => {
      const f = [...document.querySelectorAll('#hwModalQuestionsArea .tp-pic')];
      return f.length === 2 && f.every((x) => x.dataset.state === 'ready' || x.dataset.state === 'blurred');
    }, null, { timeout: 90000 });
    const states = await free.page.$$eval('#hwModalQuestionsArea .tp-pic', (f) => f.map((x) => x.dataset.state).sort());
    expect(states.join() === 'blurred,ready', 'states ' + states.join());
    const blurred = free.page.locator('#hwModalQuestionsArea .tp-pic[data-state=blurred]');
    expect((await blurred.locator('.tp-pic-upsell').innerText()).includes('See every picture in Pro'), 'no upsell text on the blurred picture');
    const src = await blurred.locator('img').getAttribute('src');
    expect(src && src.startsWith('data:image/png;base64,'), 'the blurred picture is not the tiny preview: ' + String(src).slice(0, 60));
    expect(src.length < 4000, 'the blurred preview is too big to be a preview (' + src.length + ')');
    const full = free.page.locator('#hwModalQuestionsArea .tp-pic[data-state=ready] img');
    expect(/\/object\/sign\/illustrations\//.test(await full.getAttribute('src')), 'the full picture is not a signed URL');
    const blurredGet = free.seen.illustrationGets.find((g) => g.text.includes('"blurred":true'));
    expect(blurredGet, 'no blurred reply from the server');
    expect(!/token=|\/object\/sign|https?:\/\//.test(blurredGet.text.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/, '')), 'the blurred reply carries a link: ' + blurredGet.text.slice(0, 200));
    const ev = await waitEvents(free, 'picture_upsell_view');
    expect(ev.length >= 1 && ev[0].status === 204 && ev[0].surface === 'answer', 'picture_upsell_view not logged: ' + JSON.stringify(ev));
    // Explain please for the same two concepts: the same picture states, still one full picture
    await chip(free.page, 'explain');
    await free.page.locator('#hwExplainBlock .ae-explain h3').nth(1).waitFor({ timeout: 240000 });
    await free.page.waitForFunction(() => document.querySelectorAll('#hwExplainBlock .tp-pic[data-state=ready], #hwExplainBlock .tp-pic[data-state=blurred]').length === 2, null, { timeout: 90000 });
    const s2 = await free.page.$$eval('#hwExplainBlock .tp-pic', (f) => f.map((x) => x.dataset.state).sort());
    expect(s2.join() === 'blurred,ready', 'Explain please states ' + s2.join());
    expect(await free.page.locator('#hwExplainBlock [data-role=explain-upsell]').count() === 1, 'one Pro upsell card expected under the explanations');
    await free.page.screenshot({ path: path.join(OUT, 'img1-free-blurred.png'), fullPage: true });
    // the Pro family sees every picture in full
    const b = await ask(pro, { text: THEORY_2 });
    expect(b.parsed.questions.every((q) => q.picture), 'pro pictures');
    await page.waitForFunction(() => document.querySelectorAll('#hwModalQuestionsArea .tp-pic[data-state=ready]').length === 2, null, { timeout: 90000 });
    expect(await page.locator('#hwModalQuestionsArea .tp-pic[data-state=blurred]').count() === 0, 'a blurred picture for a Pro family');
    return 'free ' + states.join('+') + ', pro 2 ready';
  }, () => free && free.page);

  // ---- i6: signed requests only
  await record('i6', 'a picture request needs the server signature and the family\'s own child', async () => {
    const a = await ask(pro, { text: DIFF_Q });
    const pic = a.parsed.questions[0].picture;
    const base = { studentId: pro.studentId };
    const noSig = await api(page, '/api/illustration/request', { ...base, picture: { concept_key: pic.concept_key, scene_prompt: pic.scene_prompt } });
    expect(noSig.status === 400, 'no signature: ' + noSig.status);
    const wrong = await api(page, '/api/illustration/request', { ...base, picture: { ...pic, sig: '0'.repeat(16) } });
    expect(wrong.status === 400, 'wrong signature: ' + wrong.status);
    const edited = await api(page, '/api/illustration/request', { ...base, picture: { ...pic, scene_prompt: pic.scene_prompt + ' Draw something else.' } });
    expect(edited.status === 400, 'edited scene: ' + edited.status);
    const other = await api(page, '/api/illustration/request', { studentId: free.studentId, picture: pic });
    expect(other.status === 403, "another family's child: " + other.status);
    const ok = await api(page, '/api/illustration/request', { ...base, picture: pic });
    expect(ok.status === 200 && ok.json.concept_key === pro.key(pic.concept_key), 'valid request: ' + ok.status + ' ' + ok.text.slice(0, 120));
    const bad = await api(page, '/api/illustration/not_a_key!', null, 'GET');
    expect(bad.status === 400 || bad.status === 404, 'bad key: ' + bad.status);
  }, page);

  // ---- i7: Storytelling
  await record('i7', 'Storytelling: the story carries a signed picture and the modal shows it', async () => {
    await page.evaluate(() => openStorytellingModal());
    await page.locator('#storyModal .sm-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.selectOption('#storyModalLang', 'English');
    await page.fill('#storyModalText', 'Magnets and their poles');
    const resp = page.waitForResponse((r) => /\/api\/homework$/.test(r.url()) && r.request().method() === 'POST', { timeout: 240000 });
    await page.click('#storyModalSubmitBtn');
    const r = await resp;
    expect(r.status() === 200, 'story status ' + r.status());
    const story = JSON.parse((await r.json()).content[0].text);
    await page.locator('#storyModalResults').waitFor({ state: 'visible', timeout: 180000 });
    if (story.visual && story.visual.type === 'library') { await page.keyboard.press('Escape'); return 'library picture, no generated one (by design)'; }
    expect(story.picture && story.picture.sig && story.picture.concept_key, 'the story has no signed picture');
    expect(!('scene_prompt' in story) && !('concept_key' in story), 'raw picture fields left on the story');
    await page.locator('#storyModalResults .tp-pic[data-state=ready]').waitFor({ timeout: 90000 });
    expect(await page.locator('#storyModalResults .tp-pic img').first().evaluate((i) => i.naturalWidth > 0), 'story picture did not load');
    await page.screenshot({ path: path.join(OUT, 'img1-story-picture.png'), fullPage: true });
    await page.keyboard.press('Escape');   // close the modal so the next test can use the page
    await page.locator('#storyModal .sm-panel').waitFor({ state: 'hidden', timeout: 10000 });
    return 'picture ' + story.picture.concept_key;
  }, page);

  // ---- i8: Experiential Learning
  await record('i8', 'Experiential Learning: the lesson carries a signed picture, shown once across the steps', async () => {
    const lesson = await api(page, `/api/el/lesson/friction?studentId=${pro.studentId}&language=English&board=cbse-ncert`, null, 'GET');
    expect(lesson.status === 200 && lesson.json.picture && lesson.json.picture.concept_key === 'el-friction' && lesson.json.picture.sig, 'lesson picture: ' + lesson.text.slice(0, 160));
    expect(!JSON.stringify(lesson.json).includes('"safety"'), 'safety leaked');
    await page.evaluate(() => openExperientialModal());
    await page.locator('#elChips .el-chip').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.click('#elChips .el-chip[data-concept="friction"]');
    await page.locator('#elGuidedBody .el-picture .tp-pic[data-state=ready]').waitFor({ timeout: 60000 });
    const polls = pro.seen.illustrationGets.filter((g) => g.key === pro.key('el-friction')).length;
    await page.locator('#elGuidedBody .el-opt').nth(0).click();
    await page.locator('#elGuidedBody .el-btn', { hasText: 'Next' }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    expect(await page.locator('#elGuidedBody .el-picture .tp-pic').count() === 1, 'the picture is not kept across steps');
    expect(pro.seen.illustrationGets.filter((g) => g.key === pro.key('el-friction')).length === polls, 'the picture was fetched again on the next step');
    await page.screenshot({ path: path.join(OUT, 'img1-el-picture.png'), fullPage: true });
  }, page);

  // ---- i9: events
  await record('i9', 'picture_upsell_view and picture_upsell_click are accepted', async () => {
    for (const event of ['picture_upsell_view', 'picture_upsell_click']) {
      const r = await api(free.page, '/api/answer-events', { event, studentId: free.studentId, surface: 'story' });
      expect(r.status === 204, event + ' answered ' + r.status);
    }
    const bad = await api(free.page, '/api/answer-events', { event: 'picture_upsell_view', studentId: pro.studentId, surface: 'story' });
    expect(bad.status === 403 || bad.status === 404, "an event for another family's child: " + bad.status);
    const unknown = await api(free.page, '/api/answer-events', { event: 'picture_upsell_nope', studentId: free.studentId });
    expect(unknown.status === 400, 'unknown event ' + unknown.status);
  }, () => free && free.page);

  await e2e.finish();
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'img1-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { failed.forEach((f) => console.log('FAIL', f.id, f.detail)); process.exit(1); }
})();
