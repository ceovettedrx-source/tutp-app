// img1 phone review run (founder's "done" check, docs/specs/img1.md): three photos go through the
// REAL model and the REAL picture provider on the release revision (no replay, no mock), at phone
// size (390 px wide), and every surface is photographed for the review page:
//   answer, explain, notes (from the same photo) and story (typed topic of the same lesson).
//
//   node tests/e2e/review-photos.spec.js <base-url> [--headless]
//
// Photos: relative-motion-page.jpg (English textbook page, no questions), worksheet-4.jpg (numeric
// worksheet), telugu-textbook-page.jpg (Telugu textbook page). Parent language: Telugu for all three.
// Family 16 (Pro, test family 9999900001, code 123456). It spends model money (about $1.50) and
// makes real pictures (about 12 x 0.04 USD), so it is NOT part of run.js.
//
// Output: tests/e2e/output/review/<photo>-<surface>.jpg and review.json (what each surface showed).
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) { console.error('Usage: node tests/e2e/review-photos.spec.js <base-url> [--headless]'); process.exit(2); }
const HEADLESS = args.includes('--headless');
const OUT = path.join(__dirname, 'output', 'review');
fs.mkdirSync(OUT, { recursive: true });
const CODE = '123456';
const log = (...a) => console.log('[review]', ...a);

const PHOTOS = [
  { id: 'relative-motion', file: 'relative-motion-page.jpg', label: 'Relative-motion textbook page (English page, Telugu parent)', topic: 'Relative motion, distance and displacement' },
  { id: 'numeric-worksheet', file: 'worksheet-4.jpg', label: 'Numeric worksheet (Telugu parent)', topic: 'Addition and subtraction of 2-digit numbers' },
  { id: 'telugu-textbook', file: 'telugu-textbook-page.jpg', label: 'Telugu textbook page (Telugu parent)', topic: 'ధ్వని ఎలా ఉత్పన్నమవుతుంది' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
  const resp = await route.fetch();
  let body = await resp.text();
  const hook = 'const auth = getAuth(app);';
  if (!body.includes(hook)) throw new Error('phone-auth.js hook not found');
  body = body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
  await route.fulfill({ response: resp, body });
});
const page = await ctx.newPage();
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
}, { phone: '+919999900001', code: CODE });
if (status !== 200) throw new Error('sign-in ' + status);
await page.goto(BASE + '/app/mother/');
await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });

const shot = async (loc, name) => {
  const file = path.join(OUT, name + '.jpg');
  await loc.screenshot({ path: file, type: 'jpeg', quality: 72 });
  return name + '.jpg';
};
// every picture figure inside `sel` has left the loading state (ready, blurred, or fallback)
const picturesSettled = (sel) => page.waitForFunction((s) => {
  const f = [...document.querySelectorAll(s + ' .tp-pic')];
  return f.every((x) => x.dataset.state !== 'loading');
}, sel, { timeout: 150000 }).catch(() => {});
const states = (sel) => page.$$eval(sel + ' .tp-pic', (f) => f.map((x) => x.dataset.state));

const report = [];
for (const ph of PHOTOS) {
  const r = { id: ph.id, label: ph.label, shots: {}, notes: [] };
  log('photo', ph.id);
  await page.evaluate(() => openHomeworkModal('homework'));
  await page.locator('#homeworkExplainModal').waitFor({ state: 'visible', timeout: 10000 });
  await page.selectOption('#hwModalLang', 'Telugu');
  await page.setInputFiles('#hwModalAttachInput', path.join(__dirname, 'fixtures', ph.file));
  await page.locator('#hwModalThumb').waitFor({ state: 'visible', timeout: 10000 });
  const t0 = Date.now();
  const resp = page.waitForResponse((x) => /\/api\/homework$/.test(x.url()) && x.request().method() === 'POST', { timeout: 300000 });
  await page.click('#hwModalSubmitBtn');
  const hr = await resp;
  r.answerStatus = hr.status();
  r.answerMs = Date.now() - t0;
  await page.locator('#hwModalQuestionsArea .ae-card, #hwModalQuestionsArea .ae-msg').first().waitFor({ state: 'visible', timeout: 300000 });
  const parsed = JSON.parse((await hr.json()).content[0].text);
  r.mode = parsed.mode; r.cards = (parsed.questions || []).length;
  await picturesSettled('#hwModalQuestionsArea');
  r.answerPictures = await states('#hwModalQuestionsArea');
  r.shots.answer = await shot(page.locator('#hwModalQuestionsArea'), ph.id + '-answer');

  await page.click('#hwChips button[data-chip="explain"]');
  const n = r.cards;
  const t1 = Date.now();
  await page.waitForFunction((k) => document.querySelectorAll('#hwExplainBlock .ae-explain h3').length >= k, n, { timeout: 300000 });
  r.explainMs = Date.now() - t1;
  await picturesSettled('#hwExplainBlock');
  r.explainPictures = await states('#hwExplainBlock');
  r.shots.explain = await shot(page.locator('#hwExplainBlock'), ph.id + '-explain');

  await page.click('#hwChips button[data-chip="notes"]');
  await page.locator('#hwNotesBlock .nd').waitFor({ timeout: 240000 });
  await picturesSettled('#hwNotesBlock');
  r.notesPictures = await states('#hwNotesBlock');
  r.shots.notes = await shot(page.locator('#hwNotesBlock'), ph.id + '-notes');

  // close Homework Help, open Storytelling with the same lesson typed in
  await page.evaluate(() => { if (typeof closeHomeworkModal === 'function') closeHomeworkModal(); });
  await page.locator('#homeworkExplainModal').waitFor({ state: 'hidden', timeout: 10000 });
  await page.evaluate(() => openStorytellingModal());
  await page.locator('#storyModal .sm-panel').waitFor({ state: 'visible', timeout: 10000 });
  await page.selectOption('#storyModalLang', 'Telugu');
  await page.fill('#storyModalText', ph.topic);
  const sresp = page.waitForResponse((x) => /\/api\/homework$/.test(x.url()) && x.request().method() === 'POST', { timeout: 300000 });
  const t2 = Date.now();
  await page.click('#storyModalSubmitBtn');
  const sr = await sresp;
  r.storyStatus = sr.status(); r.storyMs = Date.now() - t2;
  await page.locator('#storyModalResults').waitFor({ state: 'visible', timeout: 300000 });
  const story = JSON.parse((await sr.json()).content[0].text);
  r.storyVisual = story.visual ? story.visual.type : 'none';
  await picturesSettled('#storyModalResults');
  r.storyPictures = await states('#storyModalResults');
  r.shots.story = await shot(page.locator('#storyModalResults'), ph.id + '-story');
  await page.evaluate(() => document.querySelector('#storyModal [data-sm="close"]').click());
  await page.locator('#storyModal .sm-panel').waitFor({ state: 'hidden', timeout: 10000 });
  report.push(r);
  log(JSON.stringify({ ...r, shots: undefined }));
}
fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(report, null, 2));
await browser.close();
log('done');
