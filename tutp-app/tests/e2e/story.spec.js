// Storytelling Method modal e2e (storytelling redesign, docs/specs/storytelling-redesign.md).
//
//   node tests/e2e/story.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// Signs in as the test mother 9999900001 and father 9999900002 (code 123456;
// see login.spec.js). Model calls are replayed from tests/e2e/recordings (see
// homework.spec.js); a new topic or prompt is recorded with E2E_MODE=record
// (3 story calls: Telugu maths, Hindi language, English science).
//   s1  the four dashboard pages load the shared module and style sheet, carry
//       no copy of the old markup, and say nothing about "a verified curriculum record"
//   s2  Telugu maths through the modal: numbered scenes, equation chips, the
//       picture drawn in code (dots = total, at most 60), the new reply shape
//       reached the page, server checks passed (X-Story-Format ok)
//   s3  look: Noto Sans Telugu stack, 17 px body, line height 1.9, brand blue,
//       amber "Ask your child" card, no green block, the Panchpadi footnote
//   s4  "Show answer" hides and reveals the answer (aria-expanded)
//   s5  print view: the answer is printed at the bottom even when it was not
//       revealed; reveal button and the on-screen answer are not printed
//       (screenshot output/story-print-te.png)
//   s6  360 px: no sideways scroll, buttons >= 44 px (output/story-360-te.png)
//   s7  Hindi language lesson: Devanagari stack and line height 1.9
//   s8  English science: keyboard (Tab reaches "Show answer", Escape closes, focus
//       returns to the opener)
//   s9  no voice -> a "Read aloud together" hint and no play button, never a
//       "No <language> voice" error; a voice -> play or stop button, no hint
//   s10 an older { story, abhyasaPrompt } reply still renders, as scenes
//   s11 a failed request shows the page's error box (the modal stays usable)
//   s12 feedback is inline at the end of the story (no fixed popup) and posts a
//       storytelling row with the joined scene texts; s12b the same at 360 px
//   s13 Tamil: Tamil script, Noto Sans Tamil first, sonnet-5
//   (s2/s7/s13 also check: non-English -> claude-sonnet-5, s8 English -> haiku, one
//   word (visual.itemNoun) for the counted things; the stories are written to
//   output/story-*.txt and what each call cost to output/story-cost.json)
//
// Output: tests/e2e/output/ (FAIL_s*.png, story-results.json). Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';
import { nounStem } from '../../server/story-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e2e = e2eMode('story');
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/story.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONES = { mother: '+919999900001', father: '+919999900002' };
const DASH = { mother: '/app/mother/', father: '/app/father/' };
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const TELUGU = /[ఀ-౿]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const MATHS_TOPIC = 'Multiplication as equal groups: 4 plates with 6 laddus on each plate, 4 x 6 = 24';
const HINDI_TOPIC = 'संज्ञा: व्यक्ति, स्थान और वस्तु के नाम';
const SCIENCE_TOPIC = 'Why leaves are green';
const TAMIL_TOPIC = 'பெருக்கல்: சம குழுக்கள், 3 தட்டுகளில் தலா 5 இனிப்புகள், 3 x 5 = 15';
const INVERSE_TOPIC = 'Class 9 గణితం: విలోమ ప్రక్రియలు. కూడిక మరియు తీసివేత ఒకదానికొకటి వ్యతిరేకం. 7 + 5 = 12 అయితే 12 − 5 = 7';
// s17: its two model replies are written by hand (recordings), the first with a wrong sum.
const RETRY_TOPIC = 'Inverse operations: 8 + 6 = 14 and 14 - 6 = 8 (e2e wrong-sum retry check)';
const TAMIL = /[஀-௿]/;
// What each story call used and cost (X-Story-Model, X-Model-Usd), for the report.
const calls = [];
function noteCall(label, language, r) {
  calls.push({
    label, language, model: r.headers['x-story-model'] || '', usd: Number(r.headers['x-model-usd'] || 0),
    retry: Number(r.headers['x-story-retry'] || 0), format: r.headers['x-story-format'] || '', fixed: Number(r.headers['x-story-fixed'] || 0),
  });
}

function log(...a) { console.log('[e2e:story]', ...a); }
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
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  log('base', BASE);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  const newCtx = async (viewport = { width: 1280, height: 900 }, init) => {
    const ctx = await browser.newContext({ viewport });
    await e2e.attach(ctx);
    if (init) await ctx.addInitScript(init);
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

  // The story calls this page made: status, headers, and the story the page was sent.
  const watch = (page) => {
    const net = { stories: [] };
    page.on('response', async (r) => {
      if (!/\/api\/homework(\?|$)/.test(r.url()) || r.request().method() !== 'POST') return;
      let feature = '';
      try { feature = JSON.parse(r.request().postData() || '{}').feature; } catch { /* not JSON */ }
      if (feature !== 'storytelling') return;
      const body = await r.json().catch(() => null);
      let story = null;
      try { story = JSON.parse(((body && body.content) || []).find(b => b.type === 'text').text); } catch { /* error reply */ }
      net.stories.push({ status: r.status(), headers: r.headers(), story });
    });
    return net;
  };

  async function signIn(role, viewport, init) {
    const ctx = await newCtx(viewport, init);
    const page = await ctx.newPage();
    const net = watch(page);
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
      return status;
    }, { phone: PHONES[role], code: CODE });
    if (status !== 200) throw new Error(`${role}: /api/session returned ${status}`);
    await page.goto(BASE + DASH[role]);
    await page.waitForFunction(() => typeof window.openStorytellingModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const studentId = await page.evaluate(() => window.tutpChildReady);
    if (!studentId) throw new Error(`${role}: no child selected`);
    return { page, net, studentId };
  }

  async function tell(page, language, topic) {
    await page.evaluate(() => openStorytellingModal());
    await page.locator('#storyModal .sm-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.selectOption('#storyModalLang', language);
    await page.fill('#storyModalText', topic);
    await page.click('#storyModalSubmitBtn');
    await Promise.race([
      page.locator('#storyModalResults').waitFor({ state: 'visible', timeout: 180000 }),
      page.locator('#storyModalErrBox:not(.sm-hidden)').waitFor({ state: 'visible', timeout: 180000 }).then(async () => {
        throw new Error('modal error: ' + (await page.textContent('#storyModalErrBox')));
      }),
    ]);
  }
  const lastStory = (net) => net.stories[net.stories.length - 1];
  const style = (page, sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop);

  // ---- sign in, then s1 on the four pages
  let mother = null;
  await record('s0', 'sign in as the test mother', async () => {
    mother = await signIn('mother');
    return 'child ' + mother.studentId;
  }, () => mother && mother.page);
  if (!mother) { await browser.close(); console.log('no session: stopping'); process.exit(1); }
  const { page, net } = mother;

  await record('s1', 'four pages: shared module + style sheet, no old markup, no "verified curriculum record"', async () => {
    const out = [];
    for (const p of ['mother', 'father', 'family-member', 'child']) {
      const html = await (await page.request.get(`${BASE}/app/${p}/`)).text();
      expect(/\/app\/shared\/story-modal\.js/.test(html), p + ': story-modal.js not loaded');
      expect(/\/css\/story-modal\.css/.test(html), p + ': story-modal.css not loaded');
      expect(!/id="storyModalStoryText"|id="storyModalAbhyasaBlock"|function setupStoryTts/.test(html), p + ': still carries the old story markup or script');
      out.push(p);
    }
    const js = await (await page.request.get(`${BASE}/app/shared/story-modal.js`)).text();
    expect(!/verified curriculum record/i.test(js), 'story-modal.js still says "not a verified curriculum record"');
    expect(/Built on NCF-SE 2023 Panchpadi/.test(js), 'footnote text missing');
    expect(!/No \$\{?lang\}? voice|voice is available on this device/i.test(js), 'the "No ... voice" error text is still in the module');
    return out.join(', ');
  }, page);

  // ---- s2..s6 on Telugu maths
  await record('s2', 'Telugu maths: numbered scenes, equation chips, picture from code, new reply shape', async () => {
    await tell(page, 'Telugu', MATHS_TOPIC);
    const r = lastStory(net);
    expect(r && r.status === 200 && r.story, 'no story reply');
    expect(r.headers['x-story-format'] === 'ok', 'server checks: X-Story-Format ' + r.headers['x-story-format']);
    const s = r.story;
    expect(s.title && s.scenes.length >= 3 && s.tryTogether && s.parentPrompt, 'reply shape');
    noteCall('te-maths', 'Telugu', r);
    expect(r.headers['x-story-model'] === 'claude-sonnet-5', 'Telugu story model: ' + r.headers['x-story-model']);
    // The story as the parent reads it, for the founder to judge the wording.
    fs.writeFileSync(path.join(OUT, 'story-te-maths.txt'), [
      s.title, s.gradeSubjectTag + ' · ' + s.readMinutes + ' min',
      ...s.scenes.map((x, i) => `${i + 1}. [${x.label}] ${x.text}`),
      s.visual ? `picture: ${s.visual.total} ${s.visual.itemNoun} = ${s.visual.groups.join(' + ')}` : 'picture: none',
      'equations: ' + s.equations.join(' | '),
      'try together: ' + s.tryTogether.question + '  -> ' + s.tryTogether.answer,
      'ask your child: ' + s.parentPrompt,
    ].join('\n') + '\n');
    if (s.visual) {
      const stem = nounStem(s.visual.itemNoun);
      const n = s.scenes.filter((x) => x.text.normalize('NFC').toLowerCase().includes(stem)).length;
      expect(n >= 2 && s.tryTogether.question.normalize('NFC').toLowerCase().includes(stem), `itemNoun "${s.visual.itemNoun}" is not used consistently (${n} scenes)`);
    }
    const nums = await page.$$eval('#storyModalResults .sm-num', (es) => es.map((e) => e.textContent.trim()));
    expect(nums.join(',') === s.scenes.map((_, i) => String(i + 1)).join(','), 'scene numbers: ' + nums.join(','));
    const text = await page.$$eval('#storyModalResults .sm-scene-text', (es) => es.map((e) => e.textContent).join(' '));
    expect(TELUGU.test(text), 'no Telugu script in the scenes');
    expect(await page.locator('#storyModalResults .sm-eq').count() >= 1, 'no equation chips');
    expect(!!s.visual, 'the model gave no picture for a groups lesson');
    const dots = await page.locator('#storyModalResults .sm-icon, #storyModalResults .sm-dot').count();
    expect(dots === Math.min(s.visual.total, 60), `dots ${dots} vs total ${s.visual.total}`);
    expect(s.visual.groups.reduce((a, b) => a + b, 0) === s.visual.total, 'groups do not add up');
    return `${s.scenes.length} scenes, ${await page.locator('#storyModalResults .sm-eq').count()} equations, ${dots} dots, retry ${r.headers['x-story-retry']}, fixed ${r.headers['x-story-fixed']}, $${r.headers['x-model-usd'] || 0}`;
  }, page);

  await record('s15', 'a groups story draws real item icons (emoji), not dots, between scene 3 and the equations', async () => {
    const s = lastStory(net).story;
    expect(s.visual && s.visual.type === 'groups', 'not a groups story: ' + JSON.stringify(s.visual));
    expect(typeof s.visual.icon === 'string' && s.visual.icon.length > 0, 'the server sent no icon for "' + s.visual.itemNoun + '"');
    const R = '#storyModalResults';
    const icons = await page.$$eval(R + ' .sm-icon', (es) => es.map((e) => e.textContent));
    expect(icons.length === Math.min(s.visual.total, 60), `icons ${icons.length} vs total ${s.visual.total}`);
    expect(icons.every((t) => t === s.visual.icon), 'icons differ: ' + [...new Set(icons)].join(' '));
    expect(await page.locator(R + ' .sm-dot').count() === 0, 'dots are still drawn next to the icons');
    const order = await page.evaluate((sel) => {
      const fig = document.querySelector(sel + ' .sm-visual'), eqs = document.querySelector(sel + ' .sm-eqs');
      const li = fig && fig.closest('li');
      return { inThird: !!li && Array.from(li.parentNode.children).indexOf(li) === 2, before: !!(fig && eqs && (fig.compareDocumentPosition(eqs) & Node.DOCUMENT_POSITION_FOLLOWING)) };
    }, R);
    expect(order.inThird && order.before, 'the picture is not under scene 3 before the equations: ' + JSON.stringify(order));
    return `${icons.length} ${s.visual.icon} icons, picture sits under scene 3`;
  }, page);

  await record('s3', 'look: Telugu font stack, 17 px, line height 1.9, brand blue, amber card, no green, footnote', async () => {
    const R = '#storyModalResults';
    const fam = await style(page, R + ' .sm-scene-text', 'fontFamily');
    expect(fam.replace(/["']/g, '').startsWith('Noto Sans Telugu'), 'font stack does not start with Noto Sans Telugu: ' + fam);
    const size = parseFloat(await style(page, R + ' .sm-scene-text', 'fontSize'));
    const lh = parseFloat(await style(page, R + ' .sm-scene-text', 'lineHeight'));
    expect(Math.abs(size - 17) < 0.5, 'body size ' + size);
    expect(Math.abs(lh / size - 1.9) < 0.02, 'line height ratio ' + (lh / size));
    expect(await page.locator('link[href*="Noto+Sans+Telugu"][href*="display=swap"]').count() === 1, 'Telugu font link missing or without display=swap');
    expect(await style(page, R + ' .sm-num', 'backgroundColor') === 'rgb(0, 91, 191)', 'scene badge is not #005bbf');
    expect(await style(page, '#storyModalSubmitBtn', 'backgroundColor') !== 'rgb(0, 0, 0)', 'submit button');
    expect(await style(page, R + ' .sm-ask', 'backgroundColor') === 'rgb(255, 244, 214)', 'Ask your child card is not amber');
    expect(/Ask your child/.test(await page.textContent(R + ' .sm-ask')), 'Ask your child title');
    const greens = await page.$$eval('#storyModal *', (els) => els.map((e) => getComputedStyle(e).backgroundColor).filter((c) => {
      const m = c.match(/rgba?\((\d+), (\d+), (\d+)/);
      return m && +m[2] > +m[1] + 20 && +m[2] > +m[3] + 20;
    }));
    expect(!greens.length, 'green background found: ' + greens.join(' '));
    expect(/Built on NCF-SE 2023 Panchpadi/.test(await page.textContent(R)), 'footnote');
    expect(!/verified curriculum record/i.test(await page.textContent('#storyModal')), 'old disclaimer is on screen');
    return `${fam.split(',')[0]}, ${size}px, line height ${(lh / size).toFixed(2)}`;
  }, page);

  await record('s4', 'Show answer reveals and hides the answer (aria-expanded)', async () => {
    const btn = page.locator('#storyModalRevealBtn');
    const ans = page.locator('#storyModalAnswer');
    expect(await ans.isHidden(), 'the answer is visible before the tap');
    expect(await btn.getAttribute('aria-expanded') === 'false', 'aria-expanded before');
    await btn.click();
    expect(await ans.isVisible(), 'answer not shown after the tap');
    expect(await btn.getAttribute('aria-expanded') === 'true', 'aria-expanded after');
    await btn.click();
    expect(await ans.isHidden(), 'answer not hidden again');
    return 'reveal, hide';
  }, page);

  await record('s5', 'print view: the answer is printed at the bottom, unrevealed', async () => {
    const answer = lastStory(net).story.tryTogether.answer;
    await page.evaluate(() => document.getElementById('storyModalResults').classList.add('print-target'));
    await page.emulateMedia({ media: 'print' });
    const r = await page.evaluate(() => {
      const box = document.getElementById('storyModalResults');
      const vis = (sel) => { const e = box.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
      const pa = box.querySelector('.sm-print-only');
      const lastScene = box.querySelector('.sm-scenes');
      return {
        printAnswer: vis('.sm-print-only'), printText: pa ? pa.textContent : '',
        screenAnswer: vis('.sm-answer'), reveal: vis('.sm-reveal'), bar: vis('.sm-bar'), audio: vis('.sm-audio'), again: vis('.sm-again'),
        below: !!(lastScene && pa && (lastScene.compareDocumentPosition(pa) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    });
    expect(r.printAnswer && r.printText.includes(answer), 'the answer is not in the print view: ' + JSON.stringify(r));
    expect(!r.screenAnswer && !r.reveal && !r.bar && !r.audio && !r.again, 'on-screen controls are printed: ' + JSON.stringify(r));
    expect(r.below, 'the answer is not below the scenes');
    await page.screenshot({ path: path.join(OUT, 'story-print-te.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => document.getElementById('storyModalResults').classList.remove('print-target'));
    return 'answer "' + answer + '" printed below the scenes';
  }, page);

  let small = null;
  await record('s6', '360 px: no sideways scroll, buttons >= 44 px, Telugu story screenshot', async () => {
    small = await signIn('mother', { width: 360, height: 800 });
    // The dashboard itself first: the "Not enough data yet" label used to push
    // it to 370 px at 360 (dashboard-cards.css, .dc-stat-row__value).
    await small.page.waitForFunction(() => { const v = document.getElementById('completionTileValue'); return v && !v.querySelector('.animate-pulse'); }, null, { timeout: 30000 });
    const before = await small.page.evaluate(() => document.documentElement.scrollWidth);
    expect(before <= 360, 'the dashboard scrolls sideways at 360: ' + before + ' px');
    await tell(small.page, 'Telugu', MATHS_TOPIC);
    const m = await small.page.evaluate(() => {
      const panel = document.querySelector('#storyModal .sm-panel');
      const btns = [...document.querySelectorAll('#storyModal .sm-btn, #storyModal .sm-icon-btn')].filter((b) => b.offsetParent !== null);
      return {
        page: document.documentElement.scrollWidth, panel: panel.scrollWidth, panelClient: panel.clientWidth,
        small: btns.filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.trim() || b.getAttribute('aria-label')),
      };
    });
    expect(m.page <= 360, 'page scrolls sideways with the story open: ' + m.page);
    expect(m.panel <= m.panelClient + 1, 'panel scrolls sideways: ' + m.panel + ' > ' + m.panelClient);
    expect(!m.small.length, 'buttons under 44 px: ' + m.small.join(' | '));
    await small.page.locator('#storyModal .sm-panel').screenshot({ path: path.join(OUT, 'story-360-te.png') });
    return `panel ${m.panelClient}px, no overflow`;
  }, () => small && small.page);

  await record('s6b', '360 px: mother, father and family-member dashboards do not scroll sideways', async () => {
    const out = [];
    for (const role of ['mother', 'father', 'member']) {
      const ctx = await newCtx({ width: 360, height: 800 });
      const p = await ctx.newPage();
      await p.goto(BASE + '/app/login/');
      await p.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
      const status = await p.evaluate(async ({ phone, code }) => {
        await window.tutpSendOTP(phone);
        const idToken = await window.tutpVerifyOTP(code);
        const status = (await window.tutpEstablishSession(idToken)).status;
        if (status !== 200) return status;
        const me = await (await fetch('/api/session/me')).json();
        sessionStorage.setItem('tutp_family_id', me.familyId);
        sessionStorage.setItem('tutp_roles', JSON.stringify(me.roleMatches || []));
        return status;
      }, { phone: role === 'member' ? '+919999900003' : PHONES[role], code: CODE });
      if (status !== 200) throw new Error(`${role}: /api/session returned ${status}`);
      await p.goto(BASE + (role === 'member' ? '/app/family-member/' : DASH[role]));
      await p.waitForFunction(() => typeof window.openStorytellingModal === 'function', null, { timeout: 30000 });
      await p.waitForFunction(() => { const v = document.getElementById('completionTileValue'); return !v || !v.querySelector('.animate-pulse'); }, null, { timeout: 30000 });
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      await ctx.close();
      expect(w <= 360, `${role} dashboard is ${w} px wide at 360`);
      out.push(`${role} ${w}`);
    }
    return out.join(', ');
  }, page);

  // ---- s7 Hindi language lesson
  await record('s7', 'Hindi language lesson: Devanagari font stack, line height 1.9', async () => {
    await tell(page, 'Hindi', HINDI_TOPIC);
    const r = lastStory(net);
    expect(r.status === 200 && r.story, 'no story reply');
    const R = '#storyModalResults';
    const text = await page.$$eval(R + ' .sm-scene-text', (es) => es.map((e) => e.textContent).join(' '));
    expect(DEVANAGARI.test(text), 'no Devanagari in the scenes');
    noteCall('hi-lang', 'Hindi', r);
    expect(r.headers['x-story-model'] === 'claude-sonnet-5', 'Hindi story model: ' + r.headers['x-story-model']);
    fs.writeFileSync(path.join(OUT, 'story-hi-lang.txt'), [r.story.title, ...r.story.scenes.map((x, i) => `${i + 1}. [${x.label}] ${x.text}`), 'try together: ' + r.story.tryTogether.question + '  -> ' + r.story.tryTogether.answer].join('\n') + '\n');
    const fam = await style(page, R + ' .sm-scene-text', 'fontFamily');
    expect(/Noto Sans Devanagari/.test(fam), 'font stack: ' + fam);
    const size = parseFloat(await style(page, R + ' .sm-scene-text', 'fontSize'));
    const lh = parseFloat(await style(page, R + ' .sm-scene-text', 'lineHeight'));
    expect(Math.abs(lh / size - 1.9) < 0.02, 'line height ratio ' + (lh / size));
    expect(await page.locator('link[href*="Noto+Sans+Devanagari"]').count() === 1, 'Devanagari font link');
    return `format ${r.headers['x-story-format']}, retry ${r.headers['x-story-retry']}, $${r.headers['x-model-usd'] || 0}`;
  }, page);

  // ---- s8 English science, keyboard
  await record('s8', 'English science: keyboard (Tab reaches Show answer, Escape closes, focus returns)', async () => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await page.focus('body');
    await page.evaluate(() => { window.__opener = document.createElement('button'); window.__opener.id = 'e2eOpener'; document.body.appendChild(window.__opener); window.__opener.focus(); });
    await tell(page, 'English', SCIENCE_TOPIC);
    const r = lastStory(net);
    expect(r.status === 200 && r.story, 'no story reply');
    expect(r.story.tryTogether && r.story.tryTogether.question, 'no try-together question');
    noteCall('en-science', 'English', r);
    expect(r.headers['x-story-model'] === 'claude-haiku-4-5', 'English story model: ' + r.headers['x-story-model']);
    expect(!r.story.visual || r.story.visual.total >= 1, 'visual');
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'storyModalRevealBtn');
    }
    expect(reached, 'Tab never reached "Show answer"');
    await page.keyboard.press('Enter');
    expect(await page.locator('#storyModalAnswer').isVisible(), 'Enter did not reveal the answer');
    await page.keyboard.press('Escape');
    expect(await page.locator('#storyModal').isHidden(), 'Escape did not close the modal');
    const back = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(back === 'e2eOpener', 'focus did not return to the opener: ' + back);
    const labels = await page.evaluate(() => ({
      dialog: document.querySelector('#storyModal .sm-panel').getAttribute('role') + '/' + document.querySelector('#storyModal .sm-panel').getAttribute('aria-modal'),
      close: document.querySelector('#storyModal .sm-icon-btn').getAttribute('aria-label'),
    }));
    expect(labels.dialog === 'dialog/true' && /Close/.test(labels.close), 'aria: ' + JSON.stringify(labels));
    return `reveal by Enter, Escape closes, focus back; retry ${r.headers['x-story-retry']}, $${r.headers['x-model-usd'] || 0}`;
  }, page);

  await record('s12', 'feedback: inline at the end of the story (no fixed popup); /api/feedback takes a storytelling row with the story text', async () => {
    const fixedBefore = await page.locator('body > div #fbSentimentStep').count();
    await tell(page, 'English', SCIENCE_TOPIC);
    const story = lastStory(net).story;
    const joined = story.scenes.map((s) => s.text).join(' ');
    expect(joined.length > 40, 'story text is empty');
    expect(await page.locator('body > div #fbSentimentStep').count() === fixedBefore, 'the fixed feedback box appeared for a story');
    const fb = page.locator('#storyModalResults #storyModalFeedback');
    expect(await fb.count() === 1, 'no inline feedback in the results');
    const last = await page.evaluate(() => {
      const kids = [...document.getElementById('storyModalResults').children].filter((e) => !e.classList.contains('sm-foot') && !e.classList.contains('sm-again'));
      return kids[kids.length - 1].id;
    });
    expect(last === 'storyModalFeedback', 'feedback is not the last block of the results: ' + last);
    await fb.locator('[data-sentiment="positive"]').click();
    const reqP = page.waitForRequest((r) => /\/api\/feedback(\?|$)/.test(r.url()) && r.method() === 'POST', { timeout: 15000 });
    const resP = page.waitForResponse((r) => /\/api\/feedback(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 });
    await fb.locator('[data-clear="true"]').click();
    const body = JSON.parse((await reqP).postData() || '{}');
    const res = await resP;
    expect(body.feature === 'storytelling' && body.sentiment === 'positive' && body.explanationClear === true, 'feedback body: ' + JSON.stringify({ ...body, originalExplanation: '…' }));
    expect(typeof body.originalExplanation === 'string' && body.originalExplanation.length > 40, 'originalExplanation is empty');
    expect(body.originalExplanation === joined, 'originalExplanation is not the joined scene texts');
    expect(res.status() === 200 && (await res.json()).ok === true, 'feedback status ' + res.status());
    expect(/Thank you/.test(await fb.textContent()), 'no thank-you after sending');
    // The page's share prompt after a positive answer is its own box; remove it so later tests start clean.
    await page.evaluate(() => { document.querySelectorAll('#fbShareLink').forEach((a) => a.closest('div').remove()); closeStoryModal(); });
    return `inline, feature storytelling, ${body.originalExplanation.length} chars of story text, 200 ok`;
  }, page);

  await record('s12b', '360 px: the feedback sits inside the story panel, buttons >= 44 px, nothing fixed on top of the story', async () => {
    if (!small) throw new Error('no 360 px session (s6 failed)');
    await tell(small.page, 'Telugu', MATHS_TOPIC);
    const m = await small.page.evaluate(() => {
      const panel = document.querySelector('#storyModal .sm-panel').getBoundingClientRect();
      const fb = document.getElementById('storyModalFeedback');
      fb.scrollIntoView({ block: 'center' });
      const r = fb.getBoundingClientRect();
      const btns = [...fb.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => Math.round(b.getBoundingClientRect().height));
      const fixedBoxes = [...document.querySelectorAll('body > div')].filter((d) => getComputedStyle(d).position === 'fixed' && d.id !== 'storyModal' && d.querySelector('#fbSentimentStep'));
      return { inside: r.left >= panel.left - 1 && r.right <= panel.right + 1, btns, fixed: fixedBoxes.length };
    });
    expect(m.inside, 'the feedback block is outside the panel');
    expect(m.btns.length && m.btns.every((h) => h >= 44), 'feedback buttons under 44 px: ' + m.btns.join(','));
    expect(m.fixed === 0, 'a fixed feedback box is on screen');
    await small.page.locator('#storyModal .sm-panel').screenshot({ path: path.join(OUT, 'story-360-te-feedback.png') });
    await small.page.evaluate(() => closeStoryModal());
    return `buttons ${m.btns.join('/')} px, inline, no fixed box`;
  }, () => small && small.page);

  await record('s13', 'Tamil lesson: Tamil script, Noto Sans Tamil first, sonnet-5, one noun for the counted things', async () => {
    await tell(page, 'Tamil', TAMIL_TOPIC);
    const r = lastStory(net);
    expect(r.status === 200 && r.story, 'no story reply');
    noteCall('ta-maths', 'Tamil', r);
    expect(r.headers['x-story-model'] === 'claude-sonnet-5', 'Tamil story model: ' + r.headers['x-story-model']);
    const text = await page.$$eval('#storyModalResults .sm-scene-text', (es) => es.map((e) => e.textContent).join(' '));
    expect(TAMIL.test(text), 'no Tamil script in the scenes');
    const fam = await style(page, '#storyModalResults .sm-scene-text', 'fontFamily');
    expect(fam.replace(/["']/g, '').startsWith('Noto Sans Tamil'), 'font stack: ' + fam);
    const s = r.story;
    fs.writeFileSync(path.join(OUT, 'story-ta-maths.txt'), [s.title, ...s.scenes.map((x, i) => `${i + 1}. [${x.label}] ${x.text}`), 'try together: ' + s.tryTogether.question + '  -> ' + s.tryTogether.answer].join('\n') + '\n');
    if (s.visual) {
      const stem = nounStem(s.visual.itemNoun);
      const n = s.scenes.filter((x) => x.text.normalize('NFC').toLowerCase().includes(stem)).length;
      expect(n >= 2, `itemNoun "${s.visual.itemNoun}" used in ${n} scenes`);
    }
    await page.evaluate(() => closeStoryModal());
    return `format ${r.headers['x-story-format']}, retry ${r.headers['x-story-retry']}, $${r.headers['x-model-usd'] || 0}`;
  }, page);

  // ---- s9 voices
  await record('s16', 'Telugu inverse operations: a fact-family picture with the equations\' numbers, a new try-together problem, in print too', async () => {
    await tell(page, 'Telugu', INVERSE_TOPIC);
    const r = lastStory(net);
    expect(r.status === 200 && r.story, 'no story reply');
    noteCall('te-inverse', 'Telugu', r);
    const s = r.story;
    expect(s.visual && s.visual.type === 'factFamily', 'picture is not a factFamily: ' + JSON.stringify(s.visual));
    expect(['model', 'derived'].includes(r.headers['x-story-visual']), 'X-Story-Visual ' + r.headers['x-story-visual']);
    const R = '#storyModalResults';
    const v = s.visual;
    // the picture's numbers are those of a listed equation
    const eqNums = s.equations.map((e) => (e.match(/\d+/g) || []).map(Number).sort((x, y) => x - y).join(','));
    const mine = [v.a, v.b, v.total].sort((x, y) => x - y).join(',');
    expect(eqNums.includes(mine), `fact family ${mine} is not one of the equations: ${s.equations.join(' | ')}`);
    const circles = await page.$$eval(R + ' .sm-fact .sm-ff-n', (es) => es.map((e) => e.textContent.trim()));
    expect(circles.join(',') === [v.total, v.a, v.b].join(','), 'triangle numbers: ' + circles.join(','));
    const lines = await page.$$eval(R + ' .sm-fact-list li', (es) => es.map((e) => e.textContent.trim()));
    expect(lines.length >= 3, 'inverse sentences: ' + lines.join(' | '));
    const sign = v.op === 'add' ? ['+', '−'] : ['×', '÷'];
    expect(lines.some((t) => t.includes(sign[1])), 'no inverse sentence: ' + lines.join(' | '));
    // the try-together question is a NEW problem
    const nums = (s.tryTogether.question.match(/\d+/g) || []).map(Number);
    expect(!(nums.includes(v.a) && nums.includes(v.b)), 'try-together reuses the picture\'s numbers: ' + s.tryTogether.question);
    // between scene 3 and the equations
    const order = await page.evaluate((sel) => {
      const fig = document.querySelector(sel + ' .sm-visual'), eqs = document.querySelector(sel + ' .sm-eqs');
      return !!(fig && eqs && (fig.compareDocumentPosition(eqs) & Node.DOCUMENT_POSITION_FOLLOWING));
    }, R);
    expect(order, 'picture is not before the equations');
    await page.locator('#storyModal .sm-visual').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'story-te-inverse.png'), fullPage: false });
    await page.locator(R).screenshot({ path: path.join(OUT, 'story-te-inverse-full.png') });
    fs.writeFileSync(path.join(OUT, 'story-te-inverse.txt'), [s.title, ...s.scenes.map((x, i) => `${i + 1}. [${x.label}] ${x.text}`), 'picture: ' + JSON.stringify(v) + ' (' + r.headers['x-story-visual'] + ')', 'equations: ' + s.equations.join(' | '), 'try together: ' + s.tryTogether.question + '  -> ' + s.tryTogether.answer].join('\n') + '\n');
    // print view keeps the picture
    await page.evaluate(() => document.getElementById('storyModalResults').classList.add('print-target'));
    await page.emulateMedia({ media: 'print' });
    const inPrint = await page.$eval(R + ' .sm-visual', (e) => { const b = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && b.width > 40 && b.height > 40; });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => document.getElementById('storyModalResults').classList.remove('print-target'));
    expect(inPrint, 'the picture is not in the print view');
    await page.evaluate(() => closeStoryModal());
    return `${v.type} ${v.a} ${sign[0]} ${v.b} = ${v.total} (${r.headers['x-story-visual']}), ${lines.length} sentences, retry ${r.headers['x-story-retry']}, screenshot output/story-te-inverse.png`;
  }, page);

  await record('s17', 'a wrong sum written in a scene is sent back once (retry 1) and the corrected story is shown', async () => {
    // always replayed, even in record mode: the two replies are hand-written
    const force = (route) => route.continue({ headers: { ...route.request().headers(), 'x-e2e-mode': 'replay' } });
    const HW = /\/api\/homework(\?|$)/;
    await page.route(HW, force);
    try { await tell(page, 'English', RETRY_TOPIC); } finally { await page.unroute(HW, force); }
    const r = lastStory(net);
    expect(r.status === 200 && r.story, 'no story reply: status ' + r.status);
    noteCall('en-retry', 'English', r);
    expect(r.headers['x-story-retry'] === '1', 'X-Story-Retry ' + r.headers['x-story-retry'] + ' (the wrong sum did not trigger the retry)');
    expect(r.headers['x-story-format'] === 'ok', 'X-Story-Format ' + r.headers['x-story-format']);
    const text = await page.$$eval('#storyModalResults .sm-scene-text', (es) => es.map((e) => e.textContent).join(' '));
    expect(text.includes('8 + 6 = 14') && !text.includes('8 + 6 = 15'), 'the wrong sum is still on the page: ' + text);
    await page.evaluate(() => closeStoryModal());
    return 'retry 1, the shown scenes say 8 + 6 = 14';
  }, page);

  await record('s9', 'no voice: "Read aloud together" hint, no play button, no error text; a voice: play/stop, no hint', async () => {
    const ctxA = await newCtx({ width: 1280, height: 900 }, () => {
      Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [], cancel() {}, speak() {}, onvoiceschanged: null }, configurable: true });
    });
    const a = await ctxA.newPage();
    // reuse the session: copy cookies from the signed-in context
    await ctxA.addCookies(await page.context().cookies());
    await a.goto(BASE + DASH.mother);
    await a.waitForFunction(() => typeof window.openStorytellingModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    await tell(a, 'Telugu', MATHS_TOPIC);
    await a.waitForTimeout(2200); // the voice list wait is 1.5 s
    const noVoice = await a.evaluate(() => ({
      hint: !document.getElementById('storyModalTtsNote').classList.contains('sm-hidden'),
      hintText: document.getElementById('storyModalTtsNote').textContent,
      play: !document.getElementById('storyModalPlayBtn').classList.contains('sm-hidden'),
      all: document.getElementById('storyModal').textContent,
    }));
    expect(noVoice.hint && /Read aloud together/.test(noVoice.hintText), 'no coach hint: ' + noVoice.hintText);
    expect(!noVoice.play, 'the play button is shown with no voice');
    expect(!/No Telugu voice|can't read stories aloud/i.test(noVoice.all), 'the old voice error is on screen');
    await ctxA.close();

    const ctxB = await newCtx({ width: 1280, height: 900 }, () => {
      Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [{ lang: 'te-IN', name: 'Test voice' }], cancel() {}, speak() {}, onvoiceschanged: null }, configurable: true });
    });
    const b = await ctxB.newPage();
    await ctxB.addCookies(await page.context().cookies());
    await b.goto(BASE + DASH.mother);
    await b.waitForFunction(() => typeof window.openStorytellingModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    await tell(b, 'Telugu', MATHS_TOPIC);
    await b.waitForTimeout(500);
    const withVoice = await b.evaluate(() => ({
      hint: !document.getElementById('storyModalTtsNote').classList.contains('sm-hidden'),
      play: !document.getElementById('storyModalPlayBtn').classList.contains('sm-hidden'),
      stop: !document.getElementById('storyModalStopBtn').classList.contains('sm-hidden'),
    }));
    expect(!withVoice.hint && (withVoice.play || withVoice.stop), 'with a voice: ' + JSON.stringify(withVoice));
    await ctxB.close();
    return 'hint without a voice, play/stop with one';
  }, page);

  // ---- s10 old shape, s11 error
  await record('s10', 'an older { story, abhyasaPrompt } reply still renders, as scenes', async () => {
    await page.route(/\/api\/homework(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        subject: 'Maths', story: 'Meena had 4 plates. She put 6 laddus on each. How many laddus were there? There were 24. Amma smiled and thanked her.',
        abhyasaApplicable: true, abhyasaPrompt: 'Count the spoons on the table together.',
      }) }] }),
    }));
    await tell(page, 'English', 'old shape');
    const n = await page.locator('#storyModalResults .sm-scene').count();
    expect(n >= 2 && n <= 4, 'scenes from the old story: ' + n);
    expect(/spoons/.test(await page.textContent('#storyModalResults .sm-ask')), 'the old Abhyasa line is not in the amber card');
    expect(await page.locator('#storyModalResults .sm-try').count() === 0, 'a try-together card from nothing');
    await page.unroute(/\/api\/homework(\?|$)/);
    return n + ' scenes + amber card';
  }, page);

  await record('s11', 'a failed request shows the error box and the modal stays usable', async () => {
    await page.route(/\/api\/homework(\?|$)/, (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'The answer came back incomplete. Please try again.' }) }));
    await page.evaluate(() => openStorytellingModal());
    await page.fill('#storyModalText', 'x');
    await page.click('#storyModalSubmitBtn');
    await page.locator('#storyModalErrBox:not(.sm-hidden)').waitFor({ state: 'visible', timeout: 15000 });
    expect(/incomplete/.test(await page.textContent('#storyModalErrBox')), 'error text');
    expect(await page.locator('#storyModalSubmitBtn').isEnabled(), 'submit stays disabled');
    await page.unroute(/\/api\/homework(\?|$)/);
    await page.evaluate(() => closeStoryModal());
    return 'error box shown, submit enabled';
  }, page);

  await e2e.finish();
  await browser.close();
  console.log('\nRESULTS (story)');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'story-results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, 'story-cost.json'), JSON.stringify(calls, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e:story] fatal', e); process.exit(1); });
