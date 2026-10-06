// Offline check of the Answer/Explain v2 page code (public/app/shared/answer-cards.js,
// explain-panel.js, public/css/answer-explain.css) with the golden-set replies
// and the REAL server-side explainView(), no server and no model spend:
//   node tests/golden/ui-harness.js [--headed]
// The network is faked on a made-up host; screenshots go to tests/e2e/output/.
// The e2e suite (tests/e2e/answer-explain.spec.js) repeats this against a real preview.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CASES } from './cases.js';
import { runCase } from './golden.js';
import { explainView } from '../../server/tier-gate.js';
import { mockProvider } from '../../server/services/image-provider.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tests', 'e2e', 'output');
fs.mkdirSync(OUT, { recursive: true });
const HOST = 'http://tutp.test';
const results = [];
const check = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); };

const g7 = await runCase(CASES.find((c) => c.id.startsWith('g7')));
const g9 = await runCase(CASES.find((c) => c.id.startsWith('g9')));
const png = (await mockProvider({}).generate('x')).buffer;

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
const events = [];
let explainBody = null, imgStatus = 'pending', polls = 0;
await page.route(HOST + '/**', async (route) => {
  const u = new URL(route.request().url());
  const file = { '/answer-explain.css': 'public/css/answer-explain.css', '/answer-cards.js': 'public/app/shared/answer-cards.js', '/explain-panel.js': 'public/app/shared/explain-panel.js' }[u.pathname];
  if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#F4F6FA;margin:0;padding:16px"><div id="area" class="ae-root"></div></body>' });
  if (file) return route.fulfill({ contentType: file.endsWith('css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(ROOT, file)) });
  if (u.pathname === '/api/explain-please') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(explainBody) });
  if (u.pathname === '/api/answer-events') { events.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 204 }); }
  if (u.pathname.startsWith('/api/illustration/')) { polls++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(imgStatus === 'ready' ? { status: 'ready', url: HOST + '/pic.png' } : { status: imgStatus }) }); }
  if (u.pathname === '/pic.png') return route.fulfill({ contentType: 'image/png', body: png });
  return route.fulfill({ status: 404, body: '' });
});
await page.goto(HOST + '/');
await page.addStyleTag({ url: HOST + '/answer-explain.css' });
await page.addScriptTag({ url: HOST + '/answer-cards.js' });
await page.addScriptTag({ url: HOST + '/explain-panel.js' });

const render = (parsed, extra = {}) => page.evaluate(({ parsed, extra }) => {
  window.printed = [];
  window.printResult = (id) => window.printed.push(id);
  window.TutpAnswer.render(parsed, { area: document.getElementById('area'), language: 'English', studentId: 's1', childName: 'Asha', ...extra });
}, { parsed, extra });

// ---- English physics: steps card + difference card
await render(g7.ans.answer);
check('h1 two cards, marks chips', (await page.locator('.ae-card').count()) === 2 && (await page.locator('.ae-marks').allTextContents()).join() === '4 marks,3 marks');
check('h2 compare table: 2 columns, numbered rows', (await page.locator('.ae-table th').count()) === 3 && (await page.locator('.ae-table td.ae-n').first().textContent()) === '1');
check('h3 keywords highlighted in the text and listed as chips', (await page.locator('mark.ae-kw').count()) >= 1 && (await page.locator('.ae-chip').count()) >= 2);
const why = page.locator('.ae-why').first();
check('h4 "why" toggle', (await why.getAttribute('aria-expanded')) === 'false' && !(await page.locator('.ae-whytext').first().isVisible()));
await why.click();
check('h4b why opens', (await why.getAttribute('aria-expanded')) === 'true' && (await page.locator('.ae-whytext').first().isVisible()));
const card2 = page.locator('.ae-card').nth(1);
const nb = card2.locator('button', { hasText: 'Notebook' });
await nb.click();
check('h5 notebook toggle: pressed, ruled lines on the body', (await nb.getAttribute('aria-pressed')) === 'true' && /repeating-linear-gradient/.test(await card2.locator('.ae-body').evaluate((e) => getComputedStyle(e).backgroundImage)));
check('h6 CTA names the child', (await page.locator('.ae-cta span').first().textContent()) === 'Did Asha understand?');
check('h7 "coming soon" check card', await page.locator('.ae-soon').isVisible());
await page.locator('.ae-soon button').click();
check('h7b interest logged', events.some((e) => e.event === 'answer_check_interest' && e.studentId === 's1'));
const targets = await page.$$eval('.ae-btn, .ae-tab', (els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
check('h8 touch targets >= 44px', targets.every((h) => h >= 44), 'min ' + Math.min(...targets));
const bodyFont = await page.locator('.ae-root').evaluate((e) => getComputedStyle(e).fontFamily);
check('h9 Plus Jakarta Sans', /Plus Jakarta Sans/.test(bodyFont));
await page.screenshot({ path: path.join(OUT, 'ui-harness-answer-en.png'), fullPage: true });

// ---- Explain, pro, picture pending then ready
explainBody = explainView(g7.explain, { paid: true, illustration: { status: 'pending' } });
await page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
await page.locator('.ae-explain h3').first().waitFor({ timeout: 5000 });
check('h10 tabs 30 sec / Full / Exam traps', (await page.locator('.ae-explain [role=tab]').allTextContents()).join() === '30 sec,Full,Exam traps');
await page.locator('.ae-explain [role=tab]', { hasText: 'Exam traps' }).click();
check('h11 tab switch shows 3 traps', (await page.locator('.ae-explain [role=tabpanel]:visible li').count()) === 3);
check('h12 misconception box, model source: no "Knowledge Graph" label', (await page.locator('.ae-miscon').isVisible()) && !(await page.locator('.ae-explain').textContent()).includes('Knowledge Graph'));
check('h13 tonight card with 2 questions and "I asked"', (await page.locator('.ae-tonight li').count()) === 2 && await page.locator('.ae-tonight button', { hasText: 'I asked' }).isVisible());
check('h14 hero labels are HTML chips over the picture', (await page.locator('.ae-hero .ae-hero-label').count()) >= 1);
check('h15 shimmer while the picture is pending, diagram svg underneath', (await page.locator('.ae-hero .ae-shimmer').count()) === 1, (await page.locator('.ae-hero').innerHTML()).slice(0, 200) + ' polls=' + polls + ' body=' + JSON.stringify(explainBody.illustration));
imgStatus = 'ready';
await page.locator('.ae-hero img').waitFor({ state: 'attached', timeout: 8000 });
await page.waitForFunction(() => document.querySelector('.ae-hero').dataset.ready === '1', null, { timeout: 5000 });
check('h16 picture arrives by polling, shimmer gone', polls >= 1 && (await page.locator('.ae-hero .ae-shimmer').count()) === 0);
await page.locator('.ae-tonight button', { hasText: 'I asked' }).click();
check('h17 "I asked" logged as parent_asked', events.some((e) => e.event === 'parent_asked' && e.concept_key === g7.explain.concept_key));
const cq = g7.explain.check_question;
const wrong = (cq.correct_index + 1) % 3;
await page.locator('.ae-check .ae-opt').nth(wrong).click();
check('h18 wrong option: wrong feedback, right one marked, all locked', (await page.locator('.ae-feedback').textContent()) === cq.wrong_feedback && (await page.locator('.ae-opt[data-state=right]').count()) === 1 && (await page.locator('.ae-opt:enabled').count()) === 0);
check('h19 explain_check logged with correct=false', events.some((e) => e.event === 'explain_check' && e.correct === false));
await page.locator('button', { hasText: 'Save to notes' }).click();
check('h20 save to notes keeps it on the device', await page.evaluate(() => JSON.parse(localStorage.getItem('tutp_saved_explanations_s1') || '[]').length === 1));
await page.locator('.ae-explain button', { hasText: 'PDF / Print' }).click();
check('h21 explain print goes through printResult on the panel', await page.evaluate(() => window.printed.length === 1 && /^ae-explain-/.test(window.printed[0])));
await page.screenshot({ path: path.join(OUT, 'ui-harness-explain-pro.png'), fullPage: true });

// ---- print view: controls hidden, ruled lines kept, svg shown when the picture is not ready
await page.emulateMedia({ media: 'print' });
check('h22 print hides tools and buttons', (await page.locator('.ae-tools:visible').count()) === 0 && (await page.locator('.ae-cta:visible').count()) === 0);
check('h22b print keeps the notebook rules', /repeating-linear-gradient/.test(await card2.locator('.ae-body').evaluate((e) => getComputedStyle(e).backgroundImage)));
await page.screenshot({ path: path.join(OUT, 'ui-harness-print.png'), fullPage: true });
await page.emulateMedia({ media: 'screen' });

// ---- Telugu physics, free explain, fallback picture
await render(g9.ans.answer);
check('h23 Telugu: Noto Sans Telugu stack and a font link', /Noto Sans Telugu/.test(await page.locator('.ae-qtext').evaluate((e) => getComputedStyle(e).fontFamily)) && (await page.$$eval('link[href*="fonts.googleapis"]', (l) => l.map((x) => x.href).join(' '))).includes('Noto+Sans+Telugu'));
explainBody = explainView(g9.explain, { paid: false });
await page.locator('.ae-cta button', { hasText: 'Explain' }).first().click();
await page.locator('.ae-explain h3').waitFor({ timeout: 5000 });
check('h24 free: only the 30 sec tab, upsell card with the Pro price, no tonight card, no picture', (await page.locator('.ae-explain [role=tab]').count()) === 1 && (await page.locator('.ae-upsell').textContent()).includes('Pro ₹500/month') && (await page.locator('.ae-tonight, .ae-hero, .ae-check').count()) === 0);
await page.screenshot({ path: path.join(OUT, 'ui-harness-explain-free-te.png'), fullPage: true });

// ---- states
await render({ schema: 2, status: 'unreadable', questions: [] });
check('h25 unreadable photo: asks for a clearer photo, no cards', /another photo/.test(await page.locator('.ae-msg').textContent()) && (await page.locator('.ae-card').count()) === 0);
await render({ schema: 2, status: 'not_homework', questions: [] });
check('h26 non-academic photo: says so, no cards', /does not look like/.test(await page.locator('.ae-msg').textContent()) && (await page.locator('.ae-card').count()) === 0);
await render({ schema: 2, status: 'unreadable', questions: [], retake_text: 'Please retake the photo closer, flat and sharp.' });
check('h28 unreadable shows the retake request the model wrote', /retake the photo closer/.test(await page.locator('.ae-msg').textContent()) && (await page.locator('.ae-card').count()) === 0);
await render({
  schema: 2, status: 'ok', mode: 'content', subject: 'Science', page_text: 'Green plants make food by photosynthesis.',
  questions: [{ q_text: 'Photosynthesis', q_type: 'short', marks: null, blocks: [{ type: 'text', text: 'Plants make food from sunlight, water and carbon dioxide.' }], keywords: [], diagram: null, unit_direction_note: '', script: 'latin', context: 'Photosynthesis: Plants make food.', concept_key: 'c7-science-photosynthesis', concept_sig: 'x' }],
  extracted_questions: [], concept_explanation: 'Green plants make food by photosynthesis.',
});
check('h29 content page: an idea card with no marks, no "check the answer" box', (await page.locator('.ae-card').count()) === 1 && /Idea 1/.test(await page.locator('.ae-qno').textContent()) && (await page.locator('.ae-marks').count()) === 0 && (await page.locator('.ae-soon').count()) === 0);
check('h30 content page: the Explain button is there', (await page.locator('.ae-cta button', { hasText: 'Explain' }).count()) === 1);
const xss = JSON.parse(JSON.stringify(g7.ans.answer));
xss.questions[0].q_text = '<img src=x onerror="window.pwned=1"> question';
xss.questions[0].diagram = { template: 'flow_steps', svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="window.pwned=2"><script>window.pwned=3</script></svg>' };
await render(xss);
check('h27 model text and a hostile svg never run', !(await page.evaluate(() => window.pwned)) && (await page.locator('.ae-qtext img').count()) === 0 && (await page.locator('.ae-diagram script').count()) === 0);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
