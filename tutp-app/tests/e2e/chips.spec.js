// Search box mode chips e2e (search-box-v2, 2026-10-01).
//
//   node tests/e2e/chips.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// Signs in as the test mother 9999900001 and father 9999900002 (code 123456;
// see login.spec.js). Model calls are replayed from tests/e2e/recordings
// (see homework.spec.js); the first run, or a new typed text, is recorded
// with E2E_MODE=record (about 5 small typed calls).
//   c1  Homework Help modal: 3 chips (no Exam prep), page order: attach chooser
//       -> input -> chip row -> submit button
//   c2  select / deselect is single-select; a tap never fills the input and
//       never calls /api/homework
//   c3  result in the selected mode: Explain opens the "Why?" details, Answer
//       closes them, and neither makes a request
//   c4  Notes: one /api/homework-notes call and no /api/homework call; tap
//       again shows the cards; the notes are cached (no second call)
//   c5  a typed instruction overrides the selected chip
//   c6  Notes selected before submit: the homework call, then the notes call
//   c7  chip logging: impressions and taps reach /api/chip-events, never the
//       typed text; the server answers 204
//   c8  360 px: the chip row fits, tap targets >= 40 px, no sideways scroll
//       (screenshots tests/e2e/output/chips-360-*.png)
//   c9  Quiz mode has no chips; accessibility basics (group label, names,
//       aria-pressed)
//   c10 father: the modal shows the chips; the family-member and child pages
//       carry the same markup and script
//   c11 GET /api/search-chips; /api/homework-notes refuses no session (401),
//       another family's child (403) and an empty body (400)
//
// Output: tests/e2e/output/ (FAIL_c*.png, chips-results.json). Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e2e = e2eMode('chips');
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/chips.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONES = { mother: '+919999900001', father: '+919999900002', member: '+919999900003' };   // 03: member of family 16 (family.spec.js)
const DASH = { mother: '/app/mother/', father: '/app/father/', member: '/app/family-member/' };
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const TYPED = '24 + 13 = ?';

function log(...a) { console.log('[e2e:chips]', ...a); }

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
  const newCtx = async (viewport = { width: 1280, height: 900 }) => {
    const ctx = await browser.newContext({ viewport });
    await e2e.attach(ctx);
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

  async function signIn(role, viewport) {
    const ctx = await newCtx(viewport);
    const page = await ctx.newPage();
    // Every request the page makes to the routes under test.
    const net = { homework: [], notes: [], events: [], eventStatus: [], notesUsd: [] };
    page.on('request', (r) => {
      if (r.method() !== 'POST') return;
      const u = r.url();
      if (/\/api\/homework(\?|$)/.test(u)) net.homework.push(r.postData() || '');
      else if (/\/api\/homework-notes(\?|$)/.test(u)) net.notes.push(r.postData() || '');
      else if (/\/api\/chip-events(\?|$)/.test(u)) net.events.push(r.postData() || '');
    });
    page.on('response', (r) => {
      if (/\/api\/chip-events(\?|$)/.test(r.url())) net.eventStatus.push(r.status());
      // What each notes call cost (X-Model-Usd, test families only; 0 when replayed or cached).
      if (/\/api\/homework-notes(\?|$)/.test(r.url()) && r.request().method() === 'POST') net.notesUsd.push(Number(r.headers()['x-model-usd'] || 0));
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
      return status;
    }, { phone: PHONES[role], code: CODE });
    if (status !== 200) throw new Error(`${role}: /api/session returned ${status}`);
    await page.goto(BASE + DASH[role]);
    await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const studentId = await page.evaluate(() => window.tutpChildReady);
    if (!studentId && role !== 'member') throw new Error(`${role}: no child selected`);
    return { page, studentId, net };
  }

  const chipTexts = (page) => page.$$eval('#hwChips button', (bs) => bs.map((b) => b.textContent.trim()));
  const pressed = (page) => page.$$eval('#hwChips button', (bs) => bs.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.chip));
  const chip = (page, id) => page.locator(`#hwChips button[data-chip="${id}"]`);
  async function openModal(page, mode = 'homework') {
    await page.evaluate((m) => openHomeworkModal(m), mode);
    await page.locator('#homeworkExplainModal').waitFor({ state: 'visible', timeout: 10000 });
    if (mode === 'homework') await page.locator('#hwChips button').first().waitFor({ state: 'visible', timeout: 10000 });
  }
  async function submitAndWait(page, text) {
    if (text) await page.fill('#hwModalText', text);
    await page.click('#hwModalSubmitBtn');
    await Promise.race([
      page.locator('#hwModalResults').waitFor({ state: 'visible', timeout: 180000 }),
      page.locator('#hwModalErrBox:not(.hidden)').waitFor({ state: 'visible', timeout: 180000 }).then(async () => {
        throw new Error('modal error: ' + (await page.textContent('#hwModalErrBox')));
      }),
    ]);
  }
  // What the structured notes card shows (notes-design-v2).
  const structure = (page) => page.evaluate(() => {
    const q = (s) => document.querySelector('#hwNotesBlock ' + s);
    return {
      title: !!(q('.nd-title') && q('.nd-title').textContent.trim()),
      idea: !!(q('.nd-idea') && q('.nd-idea').textContent.trim()),
      steps: document.querySelectorAll('#hwNotesBlock .nd-steps li').length,
      quick: document.querySelectorAll('#hwNotesBlock .nd-quick details').length,
      say: !!q('.nd-say'),
      remember: !!q('.nd-rem'),
      words: (q('.nd') ? q('.nd').innerText : '').split(/\s+/).filter(Boolean).length,
    };
  });
  const detailsOpen = (page) => page.$$eval('#hwModalQuestionsArea details', (ds) => ds.map((d) => d.open));
  const resetModal = (page) => page.evaluate(() => resetHomeworkModal());

  let mother = null;
  await record('c0', 'sign in as the test mother', async () => {
    mother = await signIn('mother');
    return 'child ' + mother.studentId;
  }, () => mother && mother.page);

  if (mother) {
    const { page, net } = mother;

    await record('c1', 'modal: 3 chips (no Exam prep), chooser -> input -> chips -> submit', async () => {
      await openModal(page);
      const texts = await chipTexts(page);
      expect(JSON.stringify(texts) === JSON.stringify(['Answer please', 'Explain please', 'Notes please']), 'chips: ' + texts.join(' | '));
      const order = await page.evaluate(() => {
        const pos = (id) => document.getElementById(id);
        const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return {
          chooserFirst: before(pos('searchAttachChooser'), pos('hwModalText')),
          inputThenChips: before(pos('hwModalText'), pos('hwChipRow')),
          chipsThenSubmit: before(pos('hwChipRow'), pos('hwModalSubmitBtn')),
          separateRow: !pos('hwModalText').parentNode.contains(pos('hwChipRow')) || pos('hwChipRow').parentNode === pos('hwModalForm'),
        };
      });
      expect(Object.values(order).every(Boolean), 'order ' + JSON.stringify(order));
      return texts.join(' | ');
    }, page);

    await record('c2', 'select / deselect, single select, never fills the input or calls the API', async () => {
      await openModal(page);
      const before = net.homework.length + net.notes.length;
      await chip(page, 'answer').click();
      expect(JSON.stringify(await pressed(page)) === '["answer"]', 'answer not selected');
      await chip(page, 'explain').click();
      expect(JSON.stringify(await pressed(page)) === '["explain"]', 'explain should replace answer');
      await chip(page, 'explain').click();
      expect((await pressed(page)).length === 0, 'second tap should clear');
      expect((await page.inputValue('#hwModalText')) === '', 'a chip filled the input');
      expect(await page.locator('#hwModalResults').isHidden(), 'a chip showed a result');
      expect(net.homework.length + net.notes.length === before, 'a chip made a request');
      return 'select, replace, clear; no request';
    }, page);

    await record('c3', 'result in the selected mode: Explain opens "Why?", Answer closes it, no request', async () => {
      await resetModal(page);
      await openModal(page);
      await chip(page, 'explain').click();
      const homeworkBefore = net.homework.length;
      await submitAndWait(page, TYPED);
      expect(net.homework.length === homeworkBefore + 1, 'one homework call expected');
      const body = JSON.parse(net.homework[net.homework.length - 1]);
      expect(body.chip === 'explain', 'chip sent: ' + body.chip);
      const open1 = await detailsOpen(page);
      expect(open1.length && open1.every(Boolean), 'Explain should open every "Why?": ' + open1);
      const calls = net.homework.length + net.notes.length;
      await chip(page, 'answer').click();
      const open2 = await detailsOpen(page);
      expect(open2.every((o) => !o), 'Answer should close "Why?": ' + open2);
      await chip(page, 'explain').click();
      expect((await detailsOpen(page)).every(Boolean), 'Explain again should open');
      expect(net.homework.length + net.notes.length === calls, 'toggling made a request');
      const inResults = await page.evaluate(() => document.getElementById('hwModalResults').contains(document.getElementById('hwChipRow')));
      expect(inResults, 'chip row should be at the top of the result');
      return 'explain open, answer closed, 0 requests';
    }, page);

    await record('c4', 'Notes on a result: one notes call, no homework call, cached', async () => {
      const hw = net.homework.length, nt = net.notes.length;
      await chip(page, 'notes').click();
      await page.locator('#hwNotesBlock .nd').first().waitFor({ state: 'visible', timeout: 120000 });
      const s = await structure(page);
      expect(s.title && s.idea && s.steps >= 2 && s.quick === 2 && s.say, 'notes structure: ' + JSON.stringify(s));
      const items = s.steps;
      expect(net.notes.length === nt + 1, 'one notes call expected, got ' + (net.notes.length - nt));
      expect(net.homework.length === hw, 'notes made a homework call');
      const sent = JSON.parse(net.notes[net.notes.length - 1]);
      expect(Array.isArray(sent.questions) && sent.questions.length >= 1, 'notes got no question text');
      expect(!JSON.stringify(sent).includes('base64'), 'notes call carried an image');
      expect(await page.locator('#hwModalHomeworkResultBlock').isHidden(), 'cards should be hidden in notes mode');
      await chip(page, 'answer').click();
      expect(await page.locator('#hwModalHomeworkResultBlock').isVisible(), 'cards should come back');
      await chip(page, 'notes').click();
      await page.locator('#hwNotesBlock .nd').first().waitFor({ state: 'visible', timeout: 10000 });
      expect(net.notes.length === nt + 1, 'cached notes should not call again');
      return `${items} method steps; 1 call; cached; first notes call cost $${(net.notesUsd[0] || 0).toFixed(5)} (${e2e.mode})`;
    }, page);

    await record('c5', 'a typed instruction overrides the selected chip', async () => {
      await resetModal(page);
      await openModal(page);
      await chip(page, 'answer').click();
      await submitAndWait(page, 'explain please ' + TYPED);
      const p = await pressed(page);
      expect(JSON.stringify(p) === '["explain"]', 'expected explain selected, got ' + p);
      expect((await detailsOpen(page)).every(Boolean), 'Why? should be open');
      const body = JSON.parse(net.homework[net.homework.length - 1]);
      expect(body.chip === 'answer', 'the chip sent should be what was selected: ' + body.chip);
      return 'answer chip + "explain please" -> explain';
    }, page);

    await record('c6', 'Notes selected before submit: homework call, then notes call', async () => {
      await resetModal(page);
      await openModal(page);
      await chip(page, 'notes').click();
      expect(await page.locator('#hwModalResults').isHidden(), 'the chip alone must not submit');
      const hw = net.homework.length, nt = net.notes.length;
      await page.fill('#hwModalText', TYPED);
      await page.click('#hwModalSubmitBtn');
      await page.locator('#hwNotesBlock .nd').first().waitFor({ state: 'visible', timeout: 180000 });
      expect(net.homework.length === hw + 1, 'one homework call expected');
      expect(net.notes.length === nt + 1, 'one notes call expected');
      return '1 homework + 1 notes';
    }, page);

    await record('c12', 'notes card: quick-check answers behind a tap, model text is never markup, print view', async () => {
      // c6 left the structured notes on screen.
      const closed = await page.$$eval('#hwNotesBlock .nd-quick details', (ds) => ds.map((d) => d.open));
      expect(closed.length === 2 && closed.every((o) => !o), 'quick-check answers should start hidden: ' + closed);
      await page.locator('#hwNotesBlock .nd-quick summary').first().click();
      const after = await page.$$eval('#hwNotesBlock .nd-quick details', (ds) => ds.map((d) => d.open));
      expect(after[0] && !after[1], 'tap should open only the first answer: ' + after);
      expect(await page.locator('#hwNotesBlock .nd-quick .nd-a').first().isVisible(), 'answer not visible after the tap');
      const html = await page.$eval('#hwNotesBlock', (b) => b.innerHTML);
      expect(!/<script|<img|onerror=|<iframe/i.test(html), 'markup from model text in the card');
      expect(await page.$eval('#hwNotesBlock .nd', (n) => n.getAttribute('lang') === 'en'), 'card lang should be en');
      // Print view: what "Save as PDF / Print" shows.
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.evaluate(() => {
        window.dispatchEvent(new Event('beforeprint'));
        document.getElementById('hwModalResults').classList.add('print-target');
      });
      await page.emulateMedia({ media: 'print' });
      const print = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'; };
        const card = document.querySelector('#hwNotesBlock .nd');
        return {
          chipRow: vis(document.getElementById('hwChipRow')),
          buttons: [...document.querySelectorAll('#hwNotesBlock button')].filter(vis).length,
          answers: [...document.querySelectorAll('#hwNotesBlock .nd-a')].every(vis),
          white: getComputedStyle(card).backgroundColor === 'rgb(255, 255, 255)',
          width: Math.round(card.getBoundingClientRect().width),
          // The topic title and the "Notes" label must be on the page (not above its top edge).
          titleTop: Math.round(card.querySelector('.nd-title').getBoundingClientRect().top + window.scrollY),
          kickerVisible: vis(card.querySelector('.nd-kicker')),
          hintShown: [...card.querySelectorAll('.nd-hint')].some(vis),
          cardTop: Math.round(card.getBoundingClientRect().top + window.scrollY),
        };
      });
      await page.screenshot({ path: path.join(OUT, 'notes-print.png'), fullPage: true });
      await page.evaluate(() => {
        window.dispatchEvent(new Event('afterprint'));
        document.getElementById('hwModalResults').classList.remove('print-target');
      });
      await page.emulateMedia({ media: 'screen' });
      await page.setViewportSize({ width: 1280, height: 900 });
      expect(!print.chipRow && print.buttons === 0 && print.answers && print.white && print.titleTop >= 0 && print.kickerVisible && !print.hintShown, 'print view: ' + JSON.stringify(print));
      return `answers open, no markup; print: chips hidden, 0 buttons, answers visible, white (${print.width}px)`;
    }, page);

    // Other subjects (typed text, English): the structure is there every time.
    for (const [id, name, typed] of [['c13a', 'science', 'Photosynthesis in plants: sunlight, water and air.'], ['c13b', 'language', 'Write the plural of: box, child, leaf.']]) {
      await record(id, `notes card for ${name}: structure present, not a wall of text`, async () => {
        await resetModal(page);
        await openModal(page);
        await chip(page, 'notes').click();
        await page.fill('#hwModalText', typed);
        await page.click('#hwModalSubmitBtn');
        await page.locator('#hwNotesBlock .nd').first().waitFor({ state: 'visible', timeout: 180000 });
        const s = await structure(page);
        expect(s.title && s.idea && s.steps >= 2 && s.quick === 2 && s.say, 'structure: ' + JSON.stringify(s));
        expect(s.words <= 420, 'too long: ' + s.words + ' words');
        await page.setViewportSize({ width: 1280, height: 2600 });
        await page.locator('#hwNotesBlock').screenshot({ path: path.join(OUT, `notes-after-${name}.png`) });
        await page.setViewportSize({ width: 1280, height: 900 });
        return `${s.words} words, ${s.steps} steps, remember ${s.remember}`;
      }, page);
    }

    await record('c14', 'notes fallback: no structure -> the plain list; a failed call -> message + Try again', async () => {
      await page.route('**/api/homework-notes', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plain: ['first point', 'second point'], subject: 'Math' }) }));
      await resetModal(page);
      await openModal(page);
      await chip(page, 'notes').click();
      await page.fill('#hwModalText', TYPED);
      await page.click('#hwModalSubmitBtn');
      await page.locator('#hwNotesBlock li').first().waitFor({ state: 'visible', timeout: 180000 });
      expect((await page.locator('#hwNotesBlock li').count()) === 2 && (await page.locator('#hwNotesBlock .nd').count()) === 0, 'plain fallback not shown');
      await page.unroute('**/api/homework-notes');
      await page.route('**/api/homework-notes', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"x"}' }));
      await resetModal(page);
      await openModal(page);
      await chip(page, 'notes').click();
      await page.fill('#hwModalText', TYPED);
      await page.click('#hwModalSubmitBtn');
      await page.locator('#hwNotesBlock [data-role="notes-retry"]').waitFor({ state: 'visible', timeout: 180000 });
      await page.unroute('**/api/homework-notes');
      return 'plain list; error + Try again';
    }, page);

    await record('c7', 'chip logging: impressions and taps, no typed text, server says 204', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const events = net.events.flatMap((b) => JSON.parse(b).events);
      const kinds = new Set(events.map((e) => e.kind));
      expect(kinds.has('impression') && kinds.has('tap'), 'kinds: ' + [...kinds]);
      const imp = new Set(events.filter((e) => e.kind === 'impression').map((e) => e.chip));
      expect(['answer', 'explain', 'notes'].every((c) => imp.has(c)), 'impressions for: ' + [...imp]);
      expect(events.every((e) => !('text' in e)), 'an event carried text');
      expect(!net.events.some((b) => b.includes('24 + 13') || b.includes('explain please')), 'typed text reached the log');
      expect(net.eventStatus.length && net.eventStatus.every((s) => s === 204), 'statuses ' + net.eventStatus);
      return `${events.length} events; all 204`;
    }, page);

    await record('c9', 'Quiz mode has no chips; accessibility basics', async () => {
      await resetModal(page);
      await openModal(page, 'quiz');
      expect(await page.locator('#hwChipRow').isHidden(), 'chips shown in Quiz mode');
      await openModal(page, 'homework');
      const a11y = await page.evaluate(() => {
        const row = document.getElementById('hwChipRow');
        const label = document.getElementById(row.getAttribute('aria-labelledby'));
        const btns = [...document.querySelectorAll('#hwChips button')];
        return {
          group: row.getAttribute('role') === 'group' && !!label && label.textContent.trim().length > 0,
          buttons: btns.every((b) => b.tagName === 'BUTTON' && b.type === 'button' && b.textContent.trim() && b.hasAttribute('aria-pressed')),
          attachChooserUntouched: !!document.querySelector('#searchAttachChooser button[onclick*="routeSearchAttachTo"]'),
        };
      });
      expect(a11y.group && a11y.buttons && a11y.attachChooserUntouched, JSON.stringify(a11y));
      await page.keyboard.press('Tab');
      await chip(page, 'answer').focus();
      await page.keyboard.press('Enter');
      expect(JSON.stringify(await pressed(page)) === '["answer"]', 'keyboard Enter should select');
      return 'group label, button names, aria-pressed, keyboard';
    }, page);

    await record('c11', 'routes: chip list, no session 401, other child 403, empty 400', async () => {
      const list = await page.evaluate(async () => (await fetch('/api/search-chips')).json());
      expect(JSON.stringify(list.chips.map((c) => c.id)) === '["answer","explain","notes"]', 'chips ' + JSON.stringify(list.chips));
      expect(list.chips.every((c) => c.id && c.intent && c.i18nKey), 'chip fields');
      const r = await page.evaluate(async (sid) => {
        const post = async (b) => (await fetch('/api/homework-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status;
        return {
          empty: await post({ studentId: sid, questions: [] }),
          other: await post({ studentId: '00000000-0000-4000-8000-000000000000', questions: ['1 + 1'], language: 'English' }),
          events: (await fetch('/api/chip-events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ kind: 'submit', chip: 'answer', intent: 'answer' }, { kind: 'tap', chip: 'hack' }] }) })).status,
        };
      }, mother.studentId);
      expect(r.empty === 400, 'empty body -> ' + r.empty);
      expect(r.other === 403, 'other family child -> ' + r.other);
      expect(r.events === 204, 'events -> ' + r.events);
      const anon = await (await newCtx()).request.post(BASE + '/api/homework-notes', { data: { studentId: mother.studentId, questions: ['1 + 1'] } });
      expect(anon.status() === 401, 'no session -> ' + anon.status());
      const anonEvents = await (await newCtx()).request.post(BASE + '/api/chip-events', { data: { events: [] } });
      expect(anonEvents.status() === 401, 'events no session -> ' + anonEvents.status());
      return 'list, 400, 403, 204, 401';
    }, page);
  }

  // 360 px: a phone-width window, its own sign-in.
  let phone = null;
  const measure360 = (page) => page.evaluate(() => {
      const row = document.getElementById('hwChipRow');
      const panel = row.closest('.overflow-y-auto') || document.body;
      const btns = [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      const rowRect = row.getBoundingClientRect();
      const rows = new Set(btns.map((r) => Math.round(r.top))).size;
      return {
        docScroll: document.documentElement.scrollWidth <= window.innerWidth,
        panelScroll: panel.scrollWidth <= panel.clientWidth + 1,
        minH: Math.min(...btns.map((r) => r.height)),
        rows,
        rowH: rowRect.height,
        inside: btns.every((r) => r.left >= 0 && r.right <= window.innerWidth),
        submitVisible: document.getElementById('hwModalSubmitBtn').getBoundingClientRect().bottom <= window.innerHeight,
        // Anything inside the modal past the right edge (the page's own dashboard behind the
        // modal has cards wider than 360 px, which is not this change's to fix).
        modalOverflow: [...document.querySelectorAll('#homeworkExplainModal *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && e.getBoundingClientRect().width > 0).length,
        // Elements reaching past the right edge (to tell the chips from the page).
        offenders: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && e.getBoundingClientRect().width > 0)
          .slice(0, 6).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)} inChips=${!!e.closest('#hwChipRow')} inModal=${!!e.closest('#homeworkExplainModal')}`),
      };
  });
  // The four pages that carry the modal, each at 360 px, one screenshot each
  // (chips-360-<page>.png). family-member and child are opened with the test
  // mother's session; if a page sends her away, that is a failure here.
  await record('c8', '360 px, all four pages: chip row fits, targets >= 40 px, no sideways scroll', async () => {
    phone = await signIn('mother', { width: 360, height: 740 });
    const phoneFather = await signIn('father', { width: 360, height: 740 });
    const phoneMember = await signIn('member', { width: 360, height: 740 });
    const out = [];
    for (const [name, who, url] of [['mother', phone, '/app/mother/'], ['father', phoneFather, '/app/father/'], ['family-member', phoneMember, '/app/family-member/'], ['child', phone, '/app/child/']]) {
      const page = who.page;
      if (!page.url().includes(url)) {
        await page.goto(BASE + url);
        await page.waitForFunction(() => typeof window.openHomeworkModal === 'function', null, { timeout: 30000 });
        expect(page.url().includes(url), `${name}: sent away to ${page.url()}`);
      }
      await resetModal(page).catch(() => {});
      await openModal(page);
      const m = await measure360(page);
      await page.screenshot({ path: path.join(OUT, `chips-360-${name}.png`) });
      expect(m.modalOverflow === 0 && m.panelScroll && m.inside, `${name}: overflow ` + JSON.stringify(m));
      expect(m.minH >= 40, `${name}: chip height ` + m.minH);
      expect(m.rows <= 2, `${name}: chips use ${m.rows} rows`);
      out.push(`${name} rows ${m.rows}, chip ${Math.round(m.minH)} px, submit on screen ${m.submitVisible}`);
    }
    const { page } = phone;
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    await openModal(page);
    await submitAndWait(page, TYPED);
    await page.screenshot({ path: path.join(OUT, 'chips-360-mother-result.png') });
    return out.join(' | ');
  }, () => phone && phone.page);

  // The structured notes card at 360 px in English, Telugu and Hindi: the same
  // typed question each time (notes-after-<lang>.png; notes-before-<lang>.png
  // came from the previous version).
  await record('c15', 'notes card at 360 px (en, te, hi): headings in the notes language, no sideways scroll, readable line height', async () => {
    const { page } = phone;
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const out = [];
    for (const [tag, lang, kicker] of [['en', 'English', 'Notes'], ['te', 'Telugu', 'నోట్స్'], ['hi', 'Hindi', 'नोट्स']]) {
      await resetModal(page).catch(() => {});
      await openModal(page);
      await page.selectOption('#hwModalLang', lang);
      await chip(page, 'notes').click();
      await page.fill('#hwModalText', 'Add 3/4 and 1/8. Show the steps.');
      await page.click('#hwModalSubmitBtn');
      await page.locator('#hwNotesBlock .nd').first().waitFor({ state: 'visible', timeout: 180000 });
      const m = await page.evaluate(() => {
        const block = document.getElementById('hwNotesBlock');
        const card = block.querySelector('.nd');
        const cs = getComputedStyle(card);
        const over = [...card.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && e.getBoundingClientRect().width > 0).length;
        return {
          lang: card.getAttribute('lang'),
          kicker: card.querySelector('.nd-kicker').textContent.trim(),
          lineRatio: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
          blockFits: block.scrollWidth <= block.clientWidth + 1,
          over,
          docFits: document.documentElement.scrollWidth <= window.innerWidth,
          // The script of the model's own text (key idea + title), not the headings.
          script: (() => {
            const t = (card.querySelector('.nd-idea mark') || card).innerText + ' ' + ((card.querySelector('.nd-title') || {}).innerText || '');
            return /[ఀ-౿]/.test(t) ? 'telugu' : (/[ऀ-ॿ]/.test(t) ? 'devanagari' : 'latin');
          })(),
        };
      });
      expect(m.lang === tag && m.kicker.includes(kicker), `${tag}: lang/kicker ${m.lang} ${m.kicker}`);
      expect(m.blockFits && m.over === 0, `${tag}: overflow ` + JSON.stringify(m));
      expect(tag === 'en' || m.lineRatio >= 1.7, `${tag}: line height ${m.lineRatio}`);
      expect(m.script === { en: 'latin', te: 'telugu', hi: 'devanagari' }[tag], `${tag}: the notes are in ${m.script}`);
      // A tall 360 px window so the whole card is in one picture (the modal scrolls inside).
      await page.setViewportSize({ width: 360, height: 2600 });
      await page.locator('#hwNotesBlock').screenshot({ path: path.join(OUT, `notes-after-${tag}.png`) });
      await page.setViewportSize({ width: 360, height: 740 });
      out.push(`${tag} ${m.script} lh ${m.lineRatio.toFixed(2)}`);
    }
    return out.join(' | ');
  }, () => phone && phone.page);

  let father = null;
  await record('c10', 'father: chips in the modal; family-member and child pages carry the markup', async () => {
    father = await signIn('father');
    await openModal(father.page);
    const texts = await chipTexts(father.page);
    expect(texts.length === 3, 'father chips: ' + texts.join(' | '));
    const out = [];
    for (const p of ['mother', 'father', 'family-member', 'child']) {
      const html = await (await father.page.request.get(`${BASE}/app/${p}/`)).text();
      expect(/id="hwChipRow"/.test(html) && /search-chips\.js/.test(html) && /id="searchAttachChooser"/.test(html), p + ' page is missing the chip row or script');
      out.push(p);
    }
    return 'father modal ok; markup on ' + out.join(', ');
  }, () => father && father.page);

  await e2e.finish();
  await browser.close();
  console.log('\nRESULTS (chips)');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'chips-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e:chips] fatal', e); process.exit(1); });
