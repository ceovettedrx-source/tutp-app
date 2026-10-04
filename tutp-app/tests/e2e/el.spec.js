// Experiential Learning v2 (Guided Discovery + shared video service) e2e,
// docs/specs/experiential-learning-v2.md.
//
//   node tests/e2e/el.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// Signs in as the test mother 9999900001 (code 123456; see login.spec.js).
// Model calls (Telugu translation, teach-back question) are replayed from
// tests/e2e/recordings; record them once with E2E_MODE=record. YouTube is
// answered from tests/e2e/recordings/yt-fixture.json (hand-written; the project
// has no YouTube key yet), for test families on a preview with E2E_REPLAY=1.
//   e1  four pages load the module and style sheet; no hardcoded "isn't available" video line
//   e2  12 concepts x 2 boards: lessons load; NCERT chapter sourced, Telangana placeholder has no chapter
//   e3  predict: three options, the guess locks, correctness is not shown yet
//   e4  hint ladder: a wrong pick shows hint 1, 2, 3 in order; the answer button only after 3 hints
//   e5  a right pick goes straight to "Name it" (term shown)
//   e6  sim-only lesson (circuit): iframe on PhET's html5 URL, attribution, sim_opened event
//   e7  videos API: every concept returns >= 3 embeddable, >= 1 validated segment, no rejected video
//   e8  video cards: nocookie embed, no autoplay, >= 200 px, YouTube title link, Key part / Watch full video
//   e9  "Watch full video" starts at 0 with no end; a video with no segment shows no toggle
//   e10 a quota error: 200 with an empty list, UI skips the step, no "not available" text anywhere
//   e11 teach-back: one follow-up question, haiku, max_tokens 300, teach_back_done event saved
//   e12 events: bad name 400, good name 204; revisits endpoint answers
//   e13 a non-pilot topic runs the old notes flow (stubbed reply), guided panel stays hidden
//   e14 Telugu: translated lesson keeps the right answer index and misconception ids (needs recordings)
//   e15 no session -> 401; another family's child -> 403
//   e16 360 px: no sideways scroll, chips/options/buttons >= 44 px tall
//
// Output: tests/e2e/output/ (FAIL_e*.png, el-results.json). Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';
import { CONCEPTS } from '../../server/el/concepts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e2e = e2eMode('el');
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) { console.error('Usage: node tests/e2e/el.spec.js <base-url> [--headless]'); process.exit(2); }
const HEADLESS = args.includes('--headless');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const TELUGU = /[ఀ-౿]/;
const log = (...a) => console.log('[e2e:el]', ...a);
const expect = (c, m) => { if (!c) throw new Error(m); };
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

(async () => {
  log('base', BASE, 'mode', e2e.mode);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  async function newCtx(viewport = { width: 1280, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    await e2e.attach(ctx);
    await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      const hook = 'const auth = getAuth(app);';
      if (!body.includes(hook)) throw new Error('phone-auth.js hook not found');
      await route.fulfill({ response: resp, body: body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;') });
    });
    return ctx;
  }
  async function signIn(viewport) {
    const ctx = await newCtx(viewport);
    const page = await ctx.newPage();
    const calls = [];
    page.on('response', (r) => { if (/\/api\/el\/event/.test(r.url())) { let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch { /* */ } calls.push({ name: b.name, status: r.status() }); } });
    await page.goto(BASE + '/app/login/');
    await page.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
    const status = await page.evaluate(async () => {
      await window.tutpSendOTP('+919999900001');
      const idToken = await window.tutpVerifyOTP('123456');
      const status = (await window.tutpEstablishSession(idToken)).status;
      if (status !== 200) return status;
      const me = await (await fetch('/api/session/me')).json();
      sessionStorage.setItem('tutp_family_id', me.familyId);
      sessionStorage.setItem('tutp_roles', JSON.stringify(me.roleMatches || []));
      return status;
    });
    if (status !== 200) throw new Error('/api/session returned ' + status);
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openExperientialModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const studentId = await page.evaluate(() => window.tutpChildReady);
    if (!studentId) throw new Error('no child selected');
    return { ctx, page, studentId, events: calls };
  }
  const hdr = { 'x-e2e-mode': e2e.mode };
  const api = (page, p, extra = {}) => page.request.get(BASE + p, { headers: { ...hdr, ...extra } });
  const post = (page, p, data) => page.request.post(BASE + p, { headers: hdr, data });

  let s = null;
  await record('e0', 'sign in as the test mother', async () => { s = await signIn(); return 'child ' + s.studentId; }, () => s && s.page);
  if (!s) { await browser.close(); console.log('no session: stopping'); process.exit(1); }
  const { page, studentId } = s;

  const openModal = async () => {
    await page.evaluate(() => openExperientialModal());
    await page.locator('#experientialModal').waitFor({ state: 'visible' });
    await page.locator('#elChips .el-chip').first().waitFor({ state: 'visible', timeout: 15000 });
  };
  const closeModal = () => page.evaluate(() => closeExperientialModal());
  const startChip = async (id) => { await openModal(); await page.click(`#elChips .el-chip[data-concept="${id}"]`); await page.locator('#elGuidedBody .el-step').waitFor({ state: 'visible', timeout: 20000 }); };
  const nextBtn = (label) => page.locator('#elGuidedBody .el-btn', { hasText: label });

  await record('e1', 'four pages: module + style sheet, no hardcoded video notice', async () => {
    for (const p of ['mother', 'father', 'family-member', 'child']) {
      const html = await (await page.request.get(`${BASE}/app/${p}/`)).text();
      expect(/\/app\/shared\/el-guided\.js/.test(html), p + ': el-guided.js not loaded');
      expect(/\/css\/el-guided\.css/.test(html), p + ': el-guided.css not loaded');
      expect(!/isn't available yet|isn&#39;t available yet|Video matching for this lesson/i.test(html), p + ': hardcoded video notice is back');
      expect(/id="experientialModalVideos"/.test(html), p + ': no video slot');
    }
    const js = await (await page.request.get(`${BASE}/app/shared/el-guided.js`)).text();
    expect(!/not available|isn't available/i.test(js), 'el-guided.js contains a "not available" notice');
    expect(!/autoplay/i.test(js), 'el-guided.js mentions autoplay');
    return '4 pages';
  }, page);

  let conceptIds = [];
  await record('e2', '12 concepts x 2 boards load; NCERT sourced, Telangana placeholder has no chapter', async () => {
    const list = (await (await api(page, '/api/el/concepts')).json()).concepts;
    conceptIds = list.map((c) => c.id);
    expect(conceptIds.length >= 10, 'only ' + conceptIds.length + ' concepts served');
    let n = 0;
    for (const board of ['cbse-ncert', 'telangana']) {
      for (const id of conceptIds) {
        const r = await api(page, `/api/el/lesson/${id}?studentId=${studentId}&language=English&board=${board}`);
        expect(r.status() === 200, `${id}/${board}: ${r.status()}`);
        const l = await r.json();
        expect(l.predict.options.length === 3 && l.hints.length === 3 && l.revisits.length === 2, id + ': shape');
        expect(!l.safety, id + ': safety block leaked to the page');
        if (board === 'cbse-ncert') expect(l.mapping.verification_status === 'sourced' && /^Chapter \d+: /.test(l.mapping.chapter), id + ': NCERT mapping');
        else expect(l.mapping.verification_status === 'placeholder' && l.mapping.chapter === null, id + ': Telangana must be a placeholder with no chapter');
        if (l.experiment) for (const bad of [/flame|candle|match(es)?\b|knife|scissors|socket|mains/i]) expect(!bad.test(JSON.stringify(l.experiment)), id + ': unsafe word in the experiment');
        n++;
      }
    }
    return `${conceptIds.length} concepts x 2 boards = ${n} lessons; ${CONCEPTS.length - conceptIds.length} excluded`;
  }, page);

  const pickConcept = conceptIds.includes('magnets') ? 'magnets' : conceptIds[0];
  let lesson = null;
  await record('e3', 'predict: three options, the guess locks, no right/wrong shown yet', async () => {
    await startChip(pickConcept);
    lesson = await (await api(page, `/api/el/lesson/${pickConcept}?studentId=${studentId}&language=English&board=cbse-ncert`)).json();
    expect(await page.locator('#elGuidedBody .el-opt').count() === 3, 'three options');
    expect((await page.textContent('#elGuidedBody .el-step')).includes(lesson.predict.question), 'question text');
    const wrong = [0, 1, 2].find((i) => i !== lesson.predict.correctIndex);
    await page.locator('#elGuidedBody .el-opt').nth(wrong).click();
    expect(await page.locator('#elGuidedBody .el-opt:disabled').count() === 3, 'options still enabled after the guess');
    expect(await page.locator('#elGuidedBody .el-opt.right, #elGuidedBody .el-opt.wrong').count() === 0, 'correctness shown before the experiment');
    expect(await page.locator('#elGuidedBody .el-locked').isVisible(), 'locked message');
    // a second tap changes nothing
    await page.locator('#elGuidedBody .el-opt').nth(lesson.predict.correctIndex).click({ force: true }).catch(() => {});
    expect(await page.locator('#elGuidedBody .el-opt.locked').count() === 1, 'the lock moved');
    return 'locked on option ' + wrong;
  }, page);

  await record('e4', 'hint ladder: hints 1, 2, 3 in order; the answer button only after 3', async () => {
    await nextBtn('Next: try it').click();
    if (lesson.experiment) {
      expect(await page.locator('#elGuidedBody .el-parent').isVisible(), 'parent role card');
      expect(await page.locator('#elGuidedBody .el-ol li').count() >= 2, 'experiment steps');
    }
    await page.locator('#elGuidedBody .el-btn.primary').click();             // We did it / I played
    await page.locator('#elGuidedBody .el-text').waitFor();                   // notice
    await nextBtn('Next').click();
    await page.locator('#elGuidedBody .el-opt').first().waitFor();
    const wrongs = [0, 1, 2].filter((i) => i !== lesson.predict.correctIndex);
    await page.locator('#elGuidedBody .el-opt').nth(wrongs[0]).click();
    expect(await page.locator('#elGuidedBody .el-hint').count() === 1, 'hint 1');
    expect(await page.locator('#elGuidedBody .el-show').count() === 0, 'answer button too early');
    await page.locator('#elGuidedBody .el-opt').nth(wrongs[1]).click();
    expect(await page.locator('#elGuidedBody .el-hint').count() === 2, 'hint 2');
    expect(await page.locator('#elGuidedBody .el-show').count() === 0, 'answer button after 2 hints');
    expect(/Hint 1: /.test(await page.textContent('#elGuidedBody .el-hint')), 'hint 1 label');
    // both wrong options are used up: the third hint comes from the "show" path
    await page.evaluate(() => { document.querySelectorAll('#elGuidedBody .el-opt').forEach((b) => { b.disabled = false; b.classList.remove('wrong'); }); });
    await page.locator('#elGuidedBody .el-opt').nth(wrongs[0]).click();
    expect(await page.locator('#elGuidedBody .el-hint').count() === 3, 'hint 3');
    await page.locator('#elGuidedBody .el-show').waitFor({ timeout: 3000 });
    expect(await page.locator('#elGuidedBody .el-reveal').count() === 0, 'revealed before the button');
    await page.locator('#elGuidedBody .el-show').click();
    await page.locator('#elGuidedBody .el-reveal').waitFor();
    return '3 hints then reveal';
  }, page);

  await record('e5', 'a right pick goes straight to Name it, with the science term', async () => {
    await closeModal();
    await startChip(pickConcept);
    await page.locator('#elGuidedBody .el-opt').first().click();
    await nextBtn('Next: try it').click();
    await page.locator('#elGuidedBody .el-btn.primary').click();
    await nextBtn('Next').click();
    await page.locator('#elGuidedBody .el-opt').nth(lesson.predict.correctIndex).click();
    await page.locator('#elGuidedBody .el-reveal').waitFor();
    expect((await page.textContent('#elGuidedBody .el-term')).includes(lesson.reveal.term), 'term');
    expect(await page.locator('#elGuidedBody .el-hint').count() === 0, 'a hint showed on a right first pick');
    return lesson.reveal.term;
  }, page);

  await record('e6', 'sim-only lesson: PhET html5 iframe, attribution, sim_opened saved', async () => {
    await closeModal();
    const id = conceptIds.includes('circuit') ? 'circuit' : conceptIds.find((c) => CONCEPTS.find((x) => x.id === c).phet.length);
    await startChip(id);
    await page.locator('#elGuidedBody .el-opt').first().click();
    await nextBtn('Next: try it').click();
    await page.locator('#elGuidedBody .el-sim .el-btn').first().click();
    const src = await page.getAttribute('#elGuidedBody iframe.el-iframe', 'src');
    expect(/^https:\/\/phet\.colorado\.edu\/sims\/html\/[a-z0-9-]+\/latest\/[a-z0-9-]+_all\.html$/.test(src), 'sim url: ' + src);
    expect(/PhET Interactive Simulations, University of Colorado Boulder, CC-BY 4\.0/.test(await page.textContent('#elGuidedBody .el-attr')), 'attribution');
    const box = await page.locator('#elGuidedBody iframe.el-iframe').boundingBox();
    expect(box.width >= 200 && box.height >= 200, 'sim size');
    await page.waitForTimeout(500);
    expect(s.events.some((e) => e.name === 'sim_opened' && e.status === 204), 'sim_opened not saved');
    return src;
  }, page);

  await record('e7', 'videos API: every concept >= 3 embeddable, >= 1 validated segment, none rejected', async () => {
    let min = 99, segs = 0;
    for (const id of conceptIds) {
      const d = await (await api(page, `/api/el/videos?concept=${id}&language=Telugu`)).json();
      const v = d.videos;
      expect(v.length >= 3, `${id}: ${v.length} videos`);
      expect(v.length <= 5, `${id}: more than 5 videos`);
      expect(v.every((x) => x.source === 'youtube' && x.id && x.title), id + ': shape');
      expect(!v.some((x) => /REJECT/.test(x.title)), id + ': a rejected video got through');
      expect(v.filter((x) => x.slot === 'user').length === 2 && v.filter((x) => x.slot === 'english').length === 2 && v.filter((x) => x.slot === 'best').length === 1, id + ': not 2+2+1');
      const withSeg = v.filter((x) => x.segment);
      expect(withSeg.length >= 1, id + ': no validated segment');
      for (const x of withSeg) expect(x.segment.start < x.segment.end && x.segment.end <= x.duration && x.segment.end - x.segment.start >= 60 && x.segment.end - x.segment.start <= 480, id + ': bad segment');
      min = Math.min(min, v.length); segs += withSeg.length;
    }
    return `${conceptIds.length} concepts, min ${min} videos, ${segs} segments`;
  }, page);

  async function toVideos(id) {
    await closeModal();
    await startChip(id);
    await page.locator('#elGuidedBody .el-opt').first().click();
    await nextBtn('Next: try it').click();
    await page.locator('#elGuidedBody .el-btn.primary').click();
    await nextBtn('Next').click();
    const l = await (await api(page, `/api/el/lesson/${id}?studentId=${studentId}&language=English&board=cbse-ncert`)).json();
    await page.locator('#elGuidedBody .el-opt').nth(l.predict.correctIndex).click();
    await nextBtn('Next').click();                                          // Name it -> Videos
    await page.locator('#elGuidedBody .el-video').first().waitFor({ timeout: 15000 });
  }
  await record('e8', 'video cards: nocookie embed, no autoplay, >= 200 px, title link, Key part / Watch full video', async () => {
    await toVideos(pickConcept);
    const n = await page.locator('#elGuidedBody .el-video').count();
    expect(n >= 3, 'cards: ' + n);
    for (let i = 0; i < n; i++) {
      const c = page.locator('#elGuidedBody .el-video').nth(i);
      const src = await c.locator('iframe').getAttribute('src');
      expect(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+\?/.test(src), 'embed host: ' + src);
      expect(!/autoplay/i.test(src), 'autoplay in ' + src);
      const box = await c.locator('iframe').boundingBox();
      expect(box.width >= 200 && box.height >= 200, 'player size ' + JSON.stringify(box));
      expect(await c.locator('.el-yt-link a[href^="https://www.youtube.com/watch?v="]').isVisible(), 'YouTube title link');
      expect(await c.locator('.el-yt-link').innerText().then((t) => /on YouTube/.test(t)), 'YouTube name next to the link');
    }
    expect(!/ad-free|ad free|no ads/i.test(await page.textContent('#elGuidedBody')), 'the page calls videos ad-free');
    const kids = await page.locator('#elGuidedBody .el-video *').evaluateAll((els) => els.filter((e) => getComputedStyle(e).position === 'absolute' || getComputedStyle(e).position === 'fixed').length);
    expect(kids === 0, 'something is positioned over a video');
    return n + ' cards';
  }, page);

  await record('e9', '"Watch full video" starts at 0 with no end; no segment -> no toggle', async () => {
    const withSeg = page.locator('#elGuidedBody .el-video:has(.el-seg)').first();
    const before = await withSeg.locator('iframe').getAttribute('src');
    expect(/[?&]start=\d+/.test(before) && /[?&]end=\d+/.test(before), 'key part has start and end: ' + before);
    expect(await withSeg.locator('.el-seg[data-mode="key"]').getAttribute('aria-pressed') === 'true', 'Key part is the default');
    await withSeg.locator('.el-seg[data-mode="full"]').click();
    const full = await withSeg.locator('iframe').getAttribute('src');
    expect(/[?&]start=0(&|$)/.test(full) && !/[?&]end=/.test(full), 'full video src: ' + full);
    await withSeg.locator('.el-seg[data-mode="key"]').click();
    expect(/[?&]end=\d+/.test(await withSeg.locator('iframe').getAttribute('src')), 'back to key part');
    const bare = page.locator('#elGuidedBody .el-video:not(:has(.el-seg))').first();
    expect(await bare.count() === 1, 'no video without a segment in the fixtures');
    const bsrc = await bare.locator('iframe').getAttribute('src');
    expect(!/[?&](start|end)=/.test(bsrc), 'a video with no segment starts bare: ' + bsrc);
    expect(await bare.locator('.el-seg').count() === 0, 'toggle on a video with no segment');
    return 'full: ' + full;
  }, page);

  await record('e10', 'quota error: empty list, step skipped, no "not available" anywhere', async () => {
    const q = await page.request.get(`${BASE}/api/el/videos?concept=${pickConcept}&language=English`, { headers: { ...hdr, 'x-e2e-yt': 'quota' } });
    expect(q.status() === 200, 'status ' + q.status());
    expect((await q.json()).videos.length === 0, 'videos on a quota error');
    await page.route(/\/api\/el\/videos/, (route) => route.continue({ headers: { ...route.request().headers(), 'x-e2e-yt': 'quota' } }));
    await closeModal();
    await startChip(pickConcept);
    await page.locator('#elGuidedBody .el-opt').first().click();
    await nextBtn('Next: try it').click();
    await page.locator('#elGuidedBody .el-btn.primary').click();
    await nextBtn('Next').click();
    await page.locator('#elGuidedBody .el-opt').nth(lesson.predict.correctIndex).click();
    await nextBtn('Next').click();
    await page.locator('#elGuidedBody textarea#elTeachText').waitFor({ timeout: 15000 });   // went on to teach-back
    const text = await page.textContent('#experientialModal');
    expect(!/not available|isn't available|unavailable|couldn't find/i.test(text), 'a "not available" notice is on the page');
    await page.unroute(/\/api\/el\/videos/);
    return 'step skipped silently';
  }, page);

  await record('e11', 'teach-back: one follow-up question, haiku, max_tokens 300, event saved', async () => {
    await page.fill('#elTeachText', 'When the surfaces rub, a force slows things down, so rough ones slow more.');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => /\/api\/el\/teachback/.test(r.url())),
      page.click('#elGuidedBody .el-btn.primary'),
    ]);
    expect(resp.status() === 200, 'status ' + resp.status());
    expect(resp.headers()['x-el-model'] === 'claude-haiku-4-5', 'model ' + resp.headers()['x-el-model']);
    expect(resp.headers()['x-el-max-tokens'] === '300', 'max tokens');
    await page.locator('#elGuidedBody .el-follow').waitFor();
    const q = await page.textContent('#elGuidedBody .el-follow');
    expect((q.match(/\?/g) || []).length === 1 && q.trim().endsWith('?'), 'not exactly one question: ' + q);
    await page.waitForTimeout(600);
    expect(s.events.some((e) => e.name === 'teach_back_done' && e.status === 204), 'teach_back_done not saved');
    return q.slice(0, 80);
  }, page);

  await record('e12', 'events: bad name 400, good 204; revisits answers', async () => {
    const bad = await post(page, '/api/el/event', { name: 'drop_table', studentId, conceptId: pickConcept });
    expect(bad.status() === 400, 'bad name ' + bad.status());
    const badC = await post(page, '/api/el/event', { name: 'sim_opened', studentId, conceptId: 'nope' });
    expect(badC.status() === 400, 'bad concept ' + badC.status());
    const ok = await post(page, '/api/el/event', { name: 'hints_used', studentId, conceptId: pickConcept, hints: 2 });
    expect(ok.status() === 204, 'good event ' + ok.status());
    const rv = await api(page, `/api/el/revisits?studentId=${studentId}`);
    expect(rv.status() === 200 && Array.isArray((await rv.json()).revisits), 'revisits');
    return '400 / 400 / 204 / 200';
  }, page);

  await record('e13', 'a non-pilot topic runs the old notes flow; the guided panel stays hidden', async () => {
    await closeModal();
    await page.route(/\/api\/homework(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ subject: 'Science', aditiApplicable: true, aditiHook: 'Have you seen leaves turn brown?', notes: ['Plants make food in leaves.', 'They need sunlight and water.'] }) }] }),
    }));
    await page.evaluate(() => openExperientialModal());
    await page.fill('#experientialModalText', 'Photosynthesis in green leaves');
    await page.click('#experientialModalSubmitBtn');
    await page.locator('#experientialModalResults').waitFor({ state: 'visible', timeout: 20000 });
    expect(await page.locator('#experientialModalNotes li').count() === 2, 'notes flow did not render');
    expect(await page.locator('#elGuidedBody').isHidden(), 'guided panel is showing');
    expect(await page.locator('#experientialModalNotes').isVisible(), 'notes list hidden');
    await page.waitForTimeout(1500);
    expect(!/not available|isn't available/i.test(await page.textContent('#experientialModalResults')), 'notice in the notes flow');
    await page.unroute(/\/api\/homework(\?|$)/);
    return '2 notes, no guided panel';
  }, page);

  await record('e14', 'Telugu: right answer index and misconception ids survive translation', async () => {
    const en = await (await api(page, `/api/el/lesson/${pickConcept}?studentId=${studentId}&language=English&board=cbse-ncert`)).json();
    const r = await api(page, `/api/el/lesson/${pickConcept}?studentId=${studentId}&language=Telugu&board=cbse-ncert`);
    expect(r.status() === 200, 'status ' + r.status());
    const te = await r.json();
    expect(te.translated === true, 'not translated (missing recording? run E2E_MODE=record once)');
    expect(TELUGU.test(te.predict.question), 'question is not Telugu');
    expect(te.predict.correctIndex === en.predict.correctIndex, 'correct index changed');
    expect(JSON.stringify(te.predict.options.map((o) => o.misconceptionId)) === JSON.stringify(en.predict.options.map((o) => o.misconceptionId)), 'misconception ids changed');
    expect(JSON.stringify(te.experiment && te.experiment.adultSteps) === JSON.stringify(en.experiment && en.experiment.adultSteps), 'adult steps changed');
    expect(te.hints.map((h) => h.level).join() === '1,2,3', 'hint order');
    return 'translated, structure intact';
  }, page);

  await record('e15', 'no session -> 401; another family\'s child -> 403', async () => {
    const anon = await browser.newContext();
    const r = await anon.request.get(`${BASE}/api/el/lesson/${pickConcept}?studentId=${studentId}`);
    const v = await anon.request.get(`${BASE}/api/el/videos?concept=${pickConcept}`);
    await anon.close();
    expect(r.status() === 401 && v.status() === 401, `anon: ${r.status()} / ${v.status()}`);
    const other = await api(page, `/api/el/lesson/${pickConcept}?studentId=00000000-0000-4000-8000-000000000000`);
    expect(other.status() === 403, 'foreign child: ' + other.status());
    const ev = await post(page, '/api/el/event', { name: 'sim_opened', studentId: '00000000-0000-4000-8000-000000000000', conceptId: pickConcept });
    expect(ev.status() === 403, 'foreign child event: ' + ev.status());
    return '401, 403, 403';
  }, page);

  await record('e16', '360 px: no sideways scroll, controls >= 44 px', async () => {
    const small = await signIn({ width: 360, height: 740 });
    const p = small.page;
    await p.evaluate(() => openExperientialModal());
    await p.locator('#elChips .el-chip').first().waitFor({ timeout: 15000 });
    const tall = await p.$$eval('#elChips .el-chip', (b) => b.map((x) => x.getBoundingClientRect().height));
    expect(tall.every((h) => h >= 44), 'chip height ' + Math.min(...tall));
    await p.click(`#elChips .el-chip[data-concept="${pickConcept}"]`);
    await p.locator('#elGuidedBody .el-opt').first().waitFor({ timeout: 20000 });
    const opts = await p.$$eval('#elGuidedBody .el-opt', (b) => b.map((x) => x.getBoundingClientRect().height));
    expect(opts.every((h) => h >= 44), 'option height');
    await p.locator('#elGuidedBody .el-opt').first().click();
    const nb = await p.locator('#elGuidedBody .el-btn.primary').boundingBox();
    expect(nb.height >= 44, 'next button height ' + nb.height);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over <= 1, 'sideways scroll ' + over + 'px');
    await p.screenshot({ path: path.join(OUT, 'el-360.png'), fullPage: false });
    await small.ctx.close();
    return 'ok';
  }, page);

  await e2e.finish();
  await browser.close();
  console.log('\nRESULTS (el)');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'el-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => { console.error('[e2e:el] fatal', e); process.exit(1); });
