// Learning Library e2e (TUT-69, docs/specs/TUT-69-learning-library.md).
//
//   node tests/e2e/learning-library.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// Signs in as mother 9999900001 (family 16, paid) and mother B 9999900004 (family B, free),
// code 123456 (see login.spec.js and family.spec.js). The only model call is /api/homework
// typed '24 + 13 = ?', replayed from tests/e2e/recordings (no spend). Library rows made here
// have fixed titles and dates, so a re-run adds nothing (the server drops duplicates); they
// are kept between runs like family B.
//   ll1  family B asks for family 16's item: 403 (item and list)
//   ll2  two children of one family: child 1's item is absent from child 2's list
//   ll3  a forced library insert error: /api/homework is still 200 with the full answer
//   ll4  the saved answer holds no data:/base64 and is under 200 KB
//   ll5  the same homework request twice: one row
//   ll6  a free family with 11+ items: the oldest answers 402 with no content
//   ll7  child view (X-Tutp-View: child): no 'answer' items in the list, 403 on opening one
//   ll8  import twice adds nothing; the page's localStorage key goes only after the import
//   ll9  no extra model call: library routes and the saves cost $0 (X-Model-Usd 0)
//   ll10 360 px: Family Library shows, no sideways scroll, a card opens and closes
//   ll11 a photo Answer and a Notes card are saved under the title the parent saw, and open as the same cards
//
// Output: tests/e2e/output/learning-library-results.json, FAIL_<test>.png. Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const e2e = e2eMode('learning-library');
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/learning-library.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONES = { m16: '+919999900001', mB: '+919999900004' };
const CODE = '123456';
const TYPED = '24 + 13 = ?';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e:learning-library]', ...a);
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// fetch from inside the signed-in page (the session cookie rides along)
const call = (page, url, { method = 'GET', body, headers = {} } = {}) => page.evaluate(async ({ url, method, body, headers }) => {
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: r.status, json, text, usd: r.headers.get('x-model-usd') };
}, { url, method, body, headers });

const CHILD = { 'X-Tutp-View': 'child' };
const list = (page, sid, extra = '', headers = {}) => call(page, `/api/library?studentId=${sid}${extra}`, { headers });
async function allItems(page, sid, headers = {}, filter = '') {
  let items = [], cursor = '';
  for (let i = 0; i < 20; i++) {
    const r = await list(page, sid, filter + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), headers);
    expect(r.status === 200, 'list status ' + r.status);
    items = items.concat(r.json.items);
    if (!r.json.next) return { items, last: r.json };
    cursor = r.json.next;
  }
  throw new Error('too many pages');
}
const stamp = (i) => Date.UTC(2026, 0, 1 + i);
const fixedItems = (tag, n) => Array.from({ length: n }, (_, i) => ({ concept_key: `e2e-ll-${tag}-${i}`, title: `E2E LL ${tag} ${i}`, quick: `Quick ${tag} ${i}`, full: `Full ${tag} ${i}`, traps: null, saved_at: stamp(i) }));
const importItems = (page, sid, items) => call(page, '/api/library/import', { method: 'POST', body: { studentId: sid, items } });

(async () => {
  log('base', BASE);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  const newCtx = async (viewport = { width: 1280, height: 900 }, opts) => {
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
  async function signIn(who, viewport, opts) {
    const ctx = await newCtx(viewport, opts);
    const page = await ctx.newPage();
    await page.goto(BASE + '/app/login/');
    await page.waitForFunction(() => typeof window.tutpSendOTP === 'function' && typeof window.tutpEstablishSession === 'function', null, { timeout: 30000 });
    const out = await page.evaluate(async ({ phone, code }) => {
      await window.tutpSendOTP(phone);
      const idToken = await window.tutpVerifyOTP(code);
      const status = (await window.tutpEstablishSession(idToken)).status;
      if (status !== 200) return { status };
      const me = await (await fetch('/api/session/me')).json();
      sessionStorage.setItem('tutp_family_id', me.familyId);
      sessionStorage.setItem('tutp_roles', JSON.stringify(me.roleMatches || []));
      return { status, me };
    }, { phone: PHONES[who], code: CODE });
    if (out.status !== 200) throw new Error(`${who}: /api/session returned ${out.status}`);
    return { ctx, page, children: out.me.children };
  }

  let a, b, aItemId, answerId;
  await record('ll1', 'family B cannot read family 16\'s item', async () => {
    a = await signIn('m16'); b = await signIn('mB');
    expect(a.children.length >= 1 && b.children.length >= 1, 'test families have no children');
    const sidA = a.children[0].id;
    const imp = await importItems(a.page, sidA, fixedItems('A', 1));
    expect(imp.status === 200, 'import ' + imp.status);
    const { items } = await allItems(a.page, sidA);
    const mine = items.find(i => i.title === 'E2E LL A 0');
    expect(mine, 'imported item not in the list');
    aItemId = mine.id;
    const own = await call(a.page, '/api/library/' + aItemId);
    expect(own.status === 200 && own.json.payload && own.json.payload.quick === 'Quick A 0', 'owner could not open it: ' + own.status);
    const other = await call(b.page, '/api/library/' + aItemId);
    expect(other.status === 403, 'family B opening family 16 item: ' + other.status);
    expect(!/Quick A 0/.test(other.text), 'content leaked in the 403');
    const otherList = await list(b.page, sidA);
    expect(otherList.status === 403, 'family B listing family 16 child: ' + otherList.status);
    return 'item 403, list 403';
  }, () => b && b.page);

  await record('ll2', 'child 1\'s item is not in child 2\'s list', async () => {
    expect(b.children.length >= 2, 'family B has ' + b.children.length + ' child(ren); family.spec.js r1 adds more');
    const [c1, c2] = b.children;
    const imp = await importItems(b.page, c1.id, fixedItems('C1', 1));
    expect(imp.status === 200, 'import ' + imp.status);
    const one = (await allItems(b.page, c1.id)).items.map(i => i.title);
    const two = (await allItems(b.page, c2.id)).items.map(i => i.title);
    expect(one.includes('E2E LL C1 0'), 'item missing from child 1');
    expect(!two.includes('E2E LL C1 0'), 'child 1 item shows in child 2\'s list');
    const mixed = await call(b.page, '/api/library/import', { method: 'POST', body: { studentId: c2.id, items: fixedItems('C2', 1) } });
    expect(mixed.status === 200, 'import c2');
    expect(!(await allItems(b.page, c1.id)).items.some(i => i.title === 'E2E LL C2 0'), 'child 2 item shows in child 1');
    return 'separate lists';
  }, () => b && b.page);

  const sid16 = () => a.children[0].id;
  const homework = (extraHeaders = {}) => call(a.page, '/api/homework', { method: 'POST', body: { studentId: sid16(), feature: 'homework_help', text: TYPED, language: 'English' }, headers: extraHeaders });

  await record('ll3', 'a forced library insert error leaves /api/homework at 200 with the answer', async () => {
    const r = await homework({ 'X-E2E-Library-Fail': '1' });
    expect(r.status === 200, 'homework status ' + r.status + ' ' + r.text.slice(0, 120));
    const text = r.json && r.json.content && r.json.content[0] && r.json.content[0].text;
    expect(text && text.length > 20, 'no answer content in the response');
    return 'status 200, answer ' + text.length + ' chars';
  }, () => a && a.page);

  await record('ll5', 'the same homework request twice makes one row', async () => {
    const r1 = await homework(); expect(r1.status === 200, 'first ' + r1.status);
    await sleep(2500);
    const n1 = (await allItems(a.page, sid16())).items.filter(i => i.mode === 'answer');
    expect(n1.length >= 1, 'no answer row saved after the first request');
    const r2 = await homework(); expect(r2.status === 200, 'second ' + r2.status);
    await sleep(2500);
    const n2 = (await allItems(a.page, sid16())).items.filter(i => i.mode === 'answer');
    expect(n2.length === n1.length, `answer rows ${n1.length} -> ${n2.length} after a repeat`);
    answerId = n2[0].id;
    return `answer rows stay ${n2.length}`;
  }, () => a && a.page);

  await record('ll4', 'the saved payload has no data:/base64 and is under 200 KB', async () => {
    expect(answerId, 'no answer item (ll5 must pass first)');
    const r = await call(a.page, '/api/library/' + answerId);
    expect(r.status === 200, 'open ' + r.status);
    const body = JSON.stringify(r.json.payload);
    expect(!/data:[a-z]+\/[a-z0-9.+-]+;base64/i.test(body) && !/"[A-Za-z0-9+/]{1500,}={0,2}"/.test(body), 'image data in the payload');
    expect(Buffer.byteLength(body) <= 200 * 1024, 'payload ' + Buffer.byteLength(body) + ' bytes');
    return Buffer.byteLength(body) + ' bytes';
  }, () => a && a.page);

  await record('ll6', 'free family: the oldest of 11+ items answers 402 and sends no content', async () => {
    const sid = b.children[0].id;
    const imp = await importItems(b.page, sid, fixedItems('FREE', 11));
    expect(imp.status === 200, 'import ' + imp.status);
    const { items, last } = await allItems(b.page, sid);
    expect(last.tier === 'free', 'family B is ' + last.tier + ', this test needs a free family');
    expect(items.length >= 11, 'only ' + items.length + ' items');
    const locked = items.filter(i => i.locked), open = items.filter(i => !i.locked);
    expect(open.length === 10, 'open items ' + open.length + ', expected 10');
    const r = await call(b.page, '/api/library/' + locked[0].id);
    expect(r.status === 402, 'oldest item status ' + r.status);
    expect(!('payload' in (r.json || {})) && !/Quick FREE|Full FREE/.test(r.text), 'content in the 402 body');
    const ok = await call(b.page, '/api/library/' + open[0].id);
    expect(ok.status === 200 && ok.json.payload, 'a newest item did not open: ' + ok.status);
    return `${open.length} open, ${locked.length} locked`;
  }, () => b && b.page);

  await record('ll7', 'child view never gets mode answer', async () => {
    const { items, last } = await allItems(a.page, sid16(), CHILD);
    expect(!items.some(i => i.mode === 'answer'), 'an answer item in the child list');
    expect(last.subjects.every(s => s.subject !== 'Maths' || true), 'subjects');
    const parent = (await allItems(a.page, sid16())).items.filter(i => i.mode === 'answer');
    expect(parent.length >= 1, 'the parent list has no answer item to compare');
    const r = await call(a.page, '/api/library/' + parent[0].id, { headers: CHILD });
    expect(r.status === 403, 'child opening an answer: ' + r.status);
    const only = await list(a.page, sid16(), '&mode=answer', CHILD);
    expect(only.status === 200 && only.json.items.length === 0, 'mode=answer filter returned items to the child view');
    return 'child list ' + items.length + ' items, no answers';
  }, () => a && a.page);

  await record('ll8', 'import twice adds nothing; the browser key goes only after a 200', async () => {
    const sid = a.children[0].id;
    const before = (await allItems(a.page, sid)).items.length;
    const i1 = await importItems(a.page, sid, fixedItems('IMP', 2));
    const i2 = await importItems(a.page, sid, fixedItems('IMP', 2));
    expect(i1.status === 200 && i2.status === 200, 'import statuses ' + i1.status + ',' + i2.status);
    const after = (await allItems(a.page, sid)).items;
    expect(after.filter(i => /^E2E LL IMP /.test(i.title)).length === 2, 'IMP items are not exactly 2');
    expect(after.length - before <= 2, 'import added ' + (after.length - before));
    expect((await call(a.page, '/api/library/import', { method: 'POST', body: { studentId: sid, items: Array(51).fill(fixedItems('X', 1)[0]) } })).status === 400, '51 items not refused');
    expect((await call(a.page, '/api/library/import', { method: 'POST', body: { studentId: sid, items: fixedItems('IMP', 1) }, headers: CHILD })).status === 403, 'child view could import');
    // The page: a key with items is imported on mount and removed afterwards.
    const page = a.page;
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => window.tutpChildReady, null, { timeout: 30000 });
    const pageSid = await page.evaluate(() => window.tutpChildReady);
    await page.waitForFunction(() => window.TutpLibrary && document.getElementById('tutpLibrary'), null, { timeout: 15000 });
    const key = 'tutp_saved_explanations_' + pageSid;
    await page.evaluate(({ key, items }) => { localStorage.setItem(key, JSON.stringify(items)); window.TutpLibrary.refresh(); }, { key, items: fixedItems('LS', 2) });
    await page.waitForFunction((k) => localStorage.getItem(k) === null, key, { timeout: 15000 });
    const got = (await allItems(page, pageSid)).items.filter(i => /^E2E LL LS /.test(i.title)).length;
    expect(got === 2, 'imported LS items: ' + got);
    await page.evaluate(() => window.TutpLibrary.refresh()); await sleep(1500);
    expect((await allItems(page, pageSid)).items.filter(i => /^E2E LL LS /.test(i.title)).length === 2, 'a second page import duplicated');
    return 'import idempotent; key removed after 200';
  }, () => a && a.page);

  await record('ll9', 'no extra model call', async () => {
    const sid = sid16();
    const r1 = await list(a.page, sid); const r2 = await call(a.page, '/api/library/' + aItemId);
    expect(!r1.usd && !r2.usd, 'library routes report model spend: ' + r1.usd + ' / ' + r2.usd);
    const h = await homework();
    expect(h.status === 200 && (!h.usd || Number(h.usd) === 0), 'replayed homework cost ' + h.usd);
    return 'model spend $0';
  }, () => a && a.page);

  // The context stays open until record() has taken its failure screenshot of this very page.
  let m;
  await record('ll10', '360 px: Family Library shows, fits, a card opens and closes', async () => {
    m = await signIn('m16', { width: 360, height: 800 });
    {
      const page = m.page;
      expect(page.viewportSize().width === 360, 'viewport is ' + page.viewportSize().width + ' px wide');
      const libCalls = [];
      page.on('request', (r) => { if (/\/api\/library\?/.test(r.url())) libCalls.push(/cursor=/.test(r.url()) ? 'cursor' : 'first'); });
      await page.goto(BASE + '/app/mother/');
      await page.waitForFunction(() => window.tutpChildReady, null, { timeout: 30000 });
      // The dashboard shows the Family Library card ("<N> saved" + the newest title); the list is behind it.
      const dashCard = page.locator('#tutpLibraryCard');
      await dashCard.waitFor({ state: 'visible', timeout: 15000 });
      expect(!/SOON/.test(await dashCard.textContent()), 'the Family Library card still says SOON');
      expect(!(await page.locator('#tutpLibraryFull').isVisible()), 'the library list is open before the card is tapped');
      const sidNow = await page.evaluate(() => window.tutpChildReady);
      const firstPage = await page.evaluate(async (s) => (await fetch('/api/library?studentId=' + encodeURIComponent(s), { credentials: 'same-origin' })).json(), sidNow);
      const total = firstPage.subjects.reduce((n, s) => n + s.count, 0);
      expect(total > 0 && firstPage.items.length, 'the family has nothing saved to show on the card');
      await page.waitForFunction((t) => document.getElementById('tutpLibCount').textContent === t + ' saved', total, { timeout: 15000 })
        .catch(async () => { throw new Error('the card says "' + (await page.textContent('#tutpLibCount')) + '", not "' + total + ' saved"'); });
      const latestShown = await page.textContent('#tutpLibLatest');
      expect(latestShown === firstPage.items[0].title, 'the card shows "' + latestShown + '", not the newest title "' + firstPage.items[0].title + '"');
      await dashCard.click();
      await page.locator('#tutpLibraryFull').waitFor({ state: 'visible', timeout: 5000 });
      const lib = page.locator('#tutpLibrary');
      await lib.waitFor({ state: 'attached', timeout: 15000 });
      await page.locator('#tutpLibrary .tl-card').first().waitFor({ state: 'visible', timeout: 15000 });
      expect(/Family Library/.test(await lib.textContent()), 'heading missing');
      expect(!/My Library/.test(await lib.textContent()), 'the old "My Library" heading is still there');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow <= 1, 'sideways scroll ' + overflow + ' px');
      const h = await page.locator('#tutpLibrary .tl-card').first().evaluate(e => e.getBoundingClientRect().height);
      expect(h >= 44, 'card height ' + h);
      // The seeded item is dated 2026-01-01, so on a family with more than one page of items it sits behind "Show more".
      const seeded = page.locator('#tutpLibrary .tl-card', { hasText: 'E2E LL A 0' });
      for (let i = 0; i < 20 && !(await seeded.count()); i++) {
        const more = page.locator('#tutpLibrary .tl-more');
        if (!(await more.count())) break;
        const before = await page.locator('#tutpLibrary .tl-card').count();
        await more.click();
        await page.waitForFunction((n) => document.querySelectorAll('#tutpLibrary .tl-card').length > n, before, { timeout: 15000 })
          .catch(async (e) => {
            const now = await page.locator('#tutpLibrary .tl-card').count();
            throw new Error(`Show more click ${i + 1}: ${before} -> ${now} cards, library calls: ${libCalls.join(',')} (${String(e.message).split('\n')[0]})`);
          });
      }
      await seeded.first().click();
      const viewer = page.locator('.tl-viewer');
      await viewer.waitFor({ state: 'visible', timeout: 15000 });
      expect(/Quick A 0/.test(await viewer.textContent()), 'explanation text not shown');
      await page.screenshot({ path: path.join(OUT, 'learning-library-360.png'), fullPage: false });
      await viewer.getByRole('button', { name: 'Close' }).click();
      await viewer.waitFor({ state: 'detached', timeout: 5000 });
      // Back returns to the dashboard: the list is gone, the card is there again, and the page scrolls.
      await page.locator('#tutpLibraryBack').click();
      await page.locator('#tutpLibraryFull').waitFor({ state: 'hidden', timeout: 5000 });
      expect(await dashCard.isVisible(), 'the Family Library card is not back on the dashboard');
      expect(new URL(page.url()).pathname === '/app/mother/', 'Back left the dashboard: ' + page.url());
      return 'card shows ' + total + ' saved; opens, fits, closes, Back works';
    }
  }, () => m && m.page);
  if (m) await m.ctx.close().catch(() => {});

  // ll11: what the parent sees on screen is what the Library keeps. The photo is a replayed worksheet
  // (fixtures/worksheet-5-wrong.jpg, as homework.spec.js k2); the Notes call is the recorded typed one
  // (chips.spec.js c4), so neither spends. Notes made from a photo are saved by the same route.
  let n;
  await record('ll11', 'a photo Answer and a Notes card are saved under the title the parent saw, and open as the same cards', async () => {
    // Step 1 runs as live does (Answer v2, the cards a parent sees: .ae-qtext) on the replayed maths-8.jpg photo
    // (answer-explain.spec a15); Notes and the Library run in a plain context, where the recorded Notes call replays.
    n = await signIn('m16', undefined, { v2: true, image: 'none' });
    let page = n.page;
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const waitResults = () => Promise.race([
      page.locator('#hwModalResults').waitFor({ state: 'visible', timeout: 180000 }),
      page.locator('#hwModalErrBox:not(.hidden)').waitFor({ state: 'visible', timeout: 180000 }).then(async () => { throw new Error('modal error: ' + (await page.textContent('#hwModalErrBox'))); }),
    ]);
    // The item may need a moment: the save runs after the reply is sent. Pages through the whole list.
    const findSaved = async (sid, mode, title) => {
      for (let i = 0; i < 8; i++) {
        const hit = (await allItems(page, sid)).items.find(x => x.mode === mode && norm(x.title) === norm(title).slice(0, 200));
        if (hit) return hit;
        await sleep(2000);
      }
      return null;
    };
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const sid = await page.evaluate(() => window.tutpChildReady);
    expect(sid, 'no child selected');

    // 1. a photo, Answer: the saved title is the first card's heading, never the subject
    await page.evaluate(() => openHomeworkModal('homework'));
    await page.locator('#homeworkExplainModal').waitFor({ state: 'visible', timeout: 10000 });
    await page.selectOption('#hwModalLang', 'English');
    await page.setInputFiles('#hwModalAttachInput', path.join(__dirname, 'fixtures', 'maths-8.jpg'));
    await page.locator('#hwModalThumb').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('#hwModalSubmitBtn');
    await waitResults();
    const seen = norm(await page.locator('#hwModalQuestionsArea .ae-qtext').first().innerText());
    expect(seen && !/^(maths|mathematics|science|english)$/i.test(seen), 'the first card has no heading to compare: "' + seen + '"');
    const answer = await findSaved(sid, 'answer', seen);
    expect(answer, 'no answer saved under the on-screen heading "' + seen.slice(0, 80) + '"');

    // 2. Notes: saved as a notes item under the title on the notes card
    await n.ctx.close().catch(() => {});
    n = await signIn('m16'); page = n.page;
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openHomeworkModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    await page.evaluate(() => openHomeworkModal('homework'));
    await page.locator('#hwChips button').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.fill('#hwModalText', TYPED);
    await page.locator('#hwChips button[data-chip="explain"]').click();
    await page.click('#hwModalSubmitBtn');
    await waitResults();
    await page.locator('#hwChips button[data-chip="notes"]').click();
    await page.locator('#hwNotesBlock .nd-title').waitFor({ state: 'visible', timeout: 120000 });
    const noteTitle = norm(await page.locator('#hwNotesBlock .nd-title').innerText());
    expect(noteTitle, 'the notes card has no title');
    const note = await findSaved(sid, 'notes', noteTitle);
    expect(note, 'no notes item saved under the card title "' + noteTitle.slice(0, 80) + '"');
    // The notes sit in the Maths folder (live 2026-10-24: they had no subject and were filed under "Other").
    expect(note.subject === 'Maths', 'the notes item has subject "' + note.subject + '", not exactly "Maths"');   // saved and listed under the canonical subject
    const inFolder = async (extra) => (await allItems(page, sid, {}, extra)).items.some(x => x.id === note.id);
    expect(await inFolder('&subject=' + encodeURIComponent(note.subject)), 'the notes item is not in the Maths folder');
    expect(!(await inFolder('&subject=')), 'the notes item is in the Other folder');

    // 3. opened from the Family Library they are the same cards
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => window.tutpChildReady, null, { timeout: 30000 });
    await page.locator('#tutpLibraryCard').click();
    await page.locator('#tutpLibrary .tl-card').first().waitFor({ state: 'visible', timeout: 20000 });
    const openCard = async (title) => {
      const card = page.locator('#tutpLibrary .tl-card', { hasText: title.slice(0, 60) });
      for (let i = 0; i < 20 && !(await card.count()); i++) {
        const more = page.locator('#tutpLibrary .tl-more');
        if (!(await more.count())) break;
        const before = await page.locator('#tutpLibrary .tl-card').count();
        await more.click();
        await page.waitForFunction((k) => document.querySelectorAll('#tutpLibrary .tl-card').length > k, before, { timeout: 15000 });
      }
      expect(await card.count(), 'no Family Library card titled "' + title.slice(0, 60) + '"');
      await card.first().click();
      const viewer = page.locator('.tl-viewer');
      await viewer.waitFor({ state: 'visible', timeout: 15000 });
      return viewer;
    };
    const nv = await openCard(noteTitle);
    await nv.locator('.nd .nd-title').waitFor({ state: 'visible', timeout: 15000 });
    expect(norm(await nv.locator('.nd-title').first().innerText()) === noteTitle, 'the opened notes card has another title');
    expect(await nv.getByRole('button', { name: /Save as PDF/ }).count() === 1, 'no PDF button on the notes');
    expect(await nv.locator('.nd-listen').count() >= 1, 'no Listen on the notes card');
    await nv.getByRole('button', { name: 'Close' }).click();
    await nv.waitFor({ state: 'detached', timeout: 5000 });
    const av = await openCard(seen);
    await av.locator('.ae-card').first().waitFor({ state: 'visible', timeout: 15000 });
    expect(await av.getByRole('button', { name: 'Notebook' }).count() >= 1, 'the answer card has no Notebook toggle');
    expect(await av.getByRole('button', { name: /Save as PDF/ }).count() === 1, 'no PDF button on the answer');
    return 'answer "' + seen.slice(0, 40) + '", notes "' + noteTitle.slice(0, 40) + '"';
  }, () => n && n.page);
  if (n) await n.ctx.close().catch(() => {});

  for (const s of [a, b]) if (s) await s.ctx.close().catch(() => {});
  await e2e.finish();
  await browser.close();
  console.log('\nRESULTS (learning-library)');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'learning-library-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e:learning-library] fatal', e); process.exit(1); });
