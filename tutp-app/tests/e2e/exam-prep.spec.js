// Exam prep e2e suite (round 4, docs/specs/round-4-exam-prep-pilot.md).
//
//   npm run test:e2e -- <base-url>          (run.js runs every spec)
//   node tests/e2e/exam-prep.spec.js <base-url> [--headless]
//
// Needs E2E_ADMIN_TOKEN in the environment (the admin token, for the admin
// cookie; never printed) and migration 028 applied. Works only on TEST notes
// (is_test, keys of their own, served only to test families): nothing here
// touches a note real parents see. Test notes are kept between runs; a
// missing one is written through the admin API (model calls replayed from
// tests/e2e/recordings on an E2E_REPLAY preview; E2E_MODE=record writes them).
//
// Test data: family 16 (mother 9999900001), child Class 5 Telangana with a
// TEST paid period (migration 028 sets the class and state); family 18
// (mother 9999900004, all free), child "E2E Child B1" Class 5 Telangana,
// and Class 2/3 children (family.spec.js r1).
//
// Tests:
//   s0 setup: TS English notes (4 modes) and the AP English revision notes
//      are served (written when missing; the AI approves a version exactly
//      when every gate passed and Haiku wrote it, else the test approves)
//   x6 the admin API and page refuse a parent; a Telugu note waiting for
//      review shows "coming soon in Telugu" (English offered); Approve makes
//      it visible
//   x1 family 16's paid Class 5 child: Exam prep card, all 5 modes ready in
//      English (mind map SVG), flashcards and a question answered
//   x4 Hand to child: parent controls hidden, Exit brings them back
//   x5 events: the week totals grow by the opens, flashcards and questions;
//      one open's time is capped at 30 minutes; the weekly card shows them
//   x2 family 18's free Class 5 child: revision notes ready, the pack locked
//      with the unlock button
//   x3 a Class 2/3 child: "coming soon" card, 200 coming_soon, no model call
//   x7 one reject (review page: reason + second confirm) -> that mode is
//      coming soon (200) for the parent, every other note's served version
//      unchanged (other modes, Telugu, AP); undo -> served again
//   x8 needs fix without "hide now": the old version stays served, the new
//      one waits for review, nothing else changes; with "hide now": coming
//      soon until approved; undo each; reject without a reason, without the
//      confirm, or with a list of ids -> 400
//   x10 ai review: for every test version, "every gate passed at Haiku's
//      first attempt" <=> an AI approval decision; parents' responses carry
//      no reviewer; the weekly sample is <=2 stable Telugu notes; the
//      teacher queue is the served AI-approved versions
//   x11 report a mistake: button on the note (hidden in child mode); the
//      note stays served; one open report per child; the review page lists
//      it, Keep closes it, Undo re-opens it
//
// Output: tests/e2e/output/exam-prep-results.json, FAIL_<test>.png. Exit 1
// on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2eMode } from './e2e-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/exam-prep.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONES = { mother16: '9999900001', motherB: '9999900004' };
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e exam-prep]', ...a);
const e2e = e2eMode('exam-prep');
const TS = 'telangana', AP = 'andhra-pradesh';
const EN_MODES = ['revision_notes', 'key_points', 'flashcards', 'practice_questions'];

async function record(id, name, fn, page) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    let shot = '';
    if (page) { shot = path.join(OUT, 'FAIL_' + id + '.png'); await page.screenshot({ path: shot, fullPage: true }).catch(() => {}); }
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 600), shot });
    log(id, 'FAIL', err.message, shot);
  }
}

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

async function get(page, url) {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { cache: 'no-store' });
    return { status: r.status, usd: r.headers.get('x-model-usd'), body: await r.json().catch(() => null) };
  }, url);
}
async function post(page, url, body) {
  return page.evaluate(async ({ url, body }) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { url, body });
}

// The Class 5 child of the signed-in family, selected on the dashboard.
async function openDashboardFor(page, dashboard, pick) {
  const me = await get(page, '/api/session/me');
  const child = (me.body.children || []).find(pick);
  if (!child) throw new Error('no matching child in ' + JSON.stringify(me.body.children));
  // The parent-involvement survey overlay (a family that hasn't answered) would
  // cover the page; skipping it for this session is what the parent's Skip does.
  await page.evaluate(({ id }) => { sessionStorage.setItem('tutp_student_id', id); sessionStorage.setItem('tutp_baseline_skipped', '1'); }, { id: child.id });
  await page.goto(BASE + dashboard);
  await page.locator('#examPrepCard[data-eligible]').waitFor({ timeout: 30000 });
  return child;
}

async function noteBody(page, mode) {
  await page.click(`.ep-tab[data-mode="${mode}"]`);
  await page.waitForFunction((m) => {
    const b = document.getElementById('examPrepBody');
    return b && b.getAttribute('data-mode') === m && b.getAttribute('data-status');
  }, mode, { timeout: 20000 });
  return page.evaluate(() => {
    const b = document.getElementById('examPrepBody');
    return { status: b.getAttribute('data-status'), version: b.getAttribute('data-version'), text: b.textContent.slice(0, 200), svg: !!b.querySelector('svg') };
  });
}

(async () => {
  log('base', BASE, 'mode', e2e.mode);
  if (!process.env.E2E_ADMIN_TOKEN) { console.error('E2E_ADMIN_TOKEN is not set'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 30 });
  const newCtx = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
      const resp = await route.fetch();
      const hook = 'const auth = getAuth(app);';
      const body = (await resp.text()).replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
      if (!body.includes('appVerificationDisabledForTesting')) throw new Error('phone-auth.js hook not found');
      await route.fulfill({ response: resp, body });
    });
    await e2e.attach(ctx);
    return ctx;
  };

  // Founder: admin cookie from the token (sent in a POST body, never a URL).
  const aCtx = await newCtx();
  const aPage = await aCtx.newPage();
  await aPage.goto(BASE + '/admin/login');
  const adminLogin = await aPage.evaluate(async (token) => {
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    return r.status;
  }, process.env.E2E_ADMIN_TOKEN);
  if (adminLogin !== 200) { console.error('admin login failed:', adminLogin); process.exit(1); }

  const notes = async () => {
    const r = await get(aPage, '/api/admin/exam-prep?test=1');
    if (r.status !== 200) throw new Error('admin list ' + r.status);
    if (!r.body.test) throw new Error('admin list is not the test notes');
    return r.body.notes;
  };
  const find = (ns, board, mode, lang) => ns.find(n => n.board === board && n.mode === mode && n.lang === lang);
  const decide = (body) => post(aPage, '/api/admin/exam-prep/decide', body);
  const undo = (key) => post(aPage, '/api/admin/exam-prep/undo', { key });
  const servedMap = async () => Object.fromEntries((await notes()).map(n => [`${n.board}|${n.mode}|${n.lang}`, n.servedId]));

  // The AI approves a version only when every gate passed and Haiku (attempt
  // 1) wrote it: the version says so in its own checks.
  const aiRule = (v) => !!(v.checks && v.checks.passed === true && (v.checks.attempts || []).length === 1 && v.model === 'claude-haiku-4-5' && !v.fix_reason);

  // A test note served: approve the waiting version, or write one first
  // (the AI may approve it itself, exactly when the rule above says so).
  async function ensureServed(board, mode, lang) {
    const n = find(await notes(), board, mode, lang);
    if (n.servedId) return 'served';
    let v = n.versions.find(x => x.status === 'needs_review' && x.content);
    let how = 'approved waiting v';
    if (!v) {
      const g = await post(aPage, '/api/admin/exam-prep/generate', { board, mode, lang, test: true });
      if (g.status !== 200) throw new Error(`generate ${board} ${mode} ${lang}: ${g.status} ${JSON.stringify(g.body).slice(0, 200)}`);
      v = g.body.version;
      if (!v.content) throw new Error(`generate ${board} ${mode} ${lang}: ${v.status} ${JSON.stringify(v.checks).slice(0, 300)}`);
      if (v.status === 'approved') {
        if (v.reviewed_by !== 'ai' || !aiRule(v)) throw new Error(`auto-approved but the rule does not hold: ${v.reviewed_by} ${JSON.stringify(v.checks).slice(0, 200)}`);
        return `written and approved by the AI (gate passed, ${v.model}) v${v.version}`;
      }
      if (aiRule(v)) throw new Error('every gate passed at Haiku but the AI did not approve it');
      how = `written (gate ${v.checks.passed ? 'passed' : 'found problems'}, ${v.model}; waits for review) and approved by founder v`;
    }
    const a = await decide({ versionId: v.id, action: 'approve' });
    if (a.status !== 200) throw new Error('approve ' + a.status + ' ' + JSON.stringify(a.body));
    return how + v.version;
  }

  await record('s0', 'test notes served (TS English x4, AP English revision notes)', async () => {
    const out = [];
    for (const mode of EN_MODES) out.push(`TS ${mode}: ${await ensureServed(TS, mode, 'en')}`);
    out.push(`AP revision_notes: ${await ensureServed(AP, 'revision_notes', 'en')}`);
    return out.join('; ');
  }, aPage);

  const pCtx = await newCtx();
  const pPage = await pCtx.newPage();
  const landed = await login(pPage, PHONES.mother16, '/app/mother/');
  if (landed !== '/app/mother/') log('family 16 mother landed on', landed);
  let child16 = null;

  await record('x6', 'admin refuses a parent; Telugu waits for review, then Approve shows it', async () => {
    const out = [];
    const api = await get(pPage, '/api/admin/exam-prep?test=1');
    if (api.status !== 403) throw new Error('parent got admin list ' + api.status);
    const pageResp = await pPage.goto(BASE + '/admin/exam-prep');
    if (!/\/admin\/login/.test(pPage.url())) throw new Error('admin page not redirected: ' + pPage.url() + ' ' + pageResp.status());
    out.push('parent: api 403, page -> /admin/login');
    child16 = (await get(pPage, '/api/session/me')).body.children.find(c => c.class === 'Class 5');
    if (!child16) throw new Error('family 16 has no Class 5 child: run migration 028');
    // A Telugu version waiting for review: undo the last approve, or write one.
    let n = find(await notes(), TS, 'revision_notes', 'te');
    const latest = n.decisions.find(d => !d.undone_at);
    if (n.servedId && latest && latest.action === 'approve' && latest.version_id === n.servedId) {
      if ((await undo(n.key)).status !== 200) throw new Error('undo approve failed');
      out.push('undid the last Telugu approve');
    } else if (n.servedId) {
      throw new Error('Telugu note served but its latest decision is not its approve: ' + JSON.stringify(latest));
    }
    n = find(await notes(), TS, 'revision_notes', 'te');
    let v = n.versions.find(x => x.status === 'needs_review' && x.content);
    if (!v) {
      const g = await post(aPage, '/api/admin/exam-prep/generate', { board: TS, mode: 'revision_notes', lang: 'te', test: true });
      if (g.status !== 200 || !g.body.version.content) throw new Error('Telugu generate ' + g.status + ' ' + JSON.stringify(g.body).slice(0, 300));
      v = g.body.version;
      out.push(`Telugu written (gate ${v.checks.passed ? 'passed' : 'found problems'}, Telugu share ${v.checks.final?.script?.share})`);
      if (v.status === 'approved') {
        // The AI approved it: Undo (works on AI approvals) puts it back in the queue for this test.
        if ((await undo(n.key)).status !== 200) throw new Error('undo of the AI approval failed');
        v = find(await notes(), TS, 'revision_notes', 'te').versions.find(x => x.id === v.id);
        out.push('the AI had approved it; undid that');
      }
    }
    if (v.status !== 'needs_review') throw new Error('new Telugu version is ' + v.status);
    const before = await get(pPage, `/api/exam-prep/${child16.id}/revision_notes?lang=te`);
    if (before.status !== 200 || before.body.status !== 'coming_soon' || before.body.reason !== 'telugu_pending' || !before.body.englishReady) {
      throw new Error('before approve: ' + before.status + ' ' + JSON.stringify(before.body));
    }
    out.push('parent: coming soon in Telugu, English offered');
    const a = await decide({ versionId: v.id, action: 'approve' });
    if (a.status !== 200) throw new Error('approve ' + a.status);
    const after = await get(pPage, `/api/exam-prep/${child16.id}/revision_notes?lang=te`);
    if (after.body.status !== 'ready' || after.body.versionId !== v.id) throw new Error('after approve: ' + JSON.stringify(after.body).slice(0, 200));
    out.push('approved -> Telugu served');
    return out.join('; ');
  }, pPage);

  let weekBefore = null;
  await record('x1', "family 16's paid Class 5 child sees all 5 modes", async () => {
    weekBefore = (await get(pPage, '/api/exam-prep/week/16')).body.children.find(c => c.studentId === child16.id);
    await openDashboardFor(pPage, '/app/mother/', c => c.id === child16.id);
    if (await pPage.getAttribute('#examPrepCard', 'data-eligible') !== 'true') throw new Error('card not eligible');
    await pPage.click('#examPrepOpen');
    await pPage.locator('#examPrepOverlay:not([hidden])').waitFor({ timeout: 10000 });
    const title = await pPage.textContent('#examPrepTitle');
    if (!/Chapter 13: Fractions \(TS State Board, Class 5\)/.test(title)) throw new Error('title ' + title);
    if (await pPage.locator('.ep-lang button[data-lang="te"][aria-pressed="true"]').count()) await pPage.click('.ep-lang button[data-lang="en"]');
    const out = [];
    for (const mode of ['revision_notes', 'key_points', 'flashcards', 'practice_questions', 'mind_map']) {
      const b = await noteBody(pPage, mode);
      if (b.status !== 'ready') throw new Error(`${mode}: ${b.status} ${b.text}`);
      if (mode === 'mind_map' && !b.svg) throw new Error('mind map has no svg');
      out.push(mode);
    }
    if (!/cover 2 skills/.test(await pPage.textContent('#examPrepCoverage'))) throw new Error('coverage note missing');
    // Answer 2 flashcards and 1 question (x5 counts them).
    await noteBody(pPage, 'flashcards');
    for (let i = 0; i < 2; i++) { await pPage.click('.ep-card'); await pPage.click('#examPrepBody .dc-btn--blue'); }
    await noteBody(pPage, 'practice_questions');
    await pPage.locator('#examPrepBody .ep-opt').first().click();
    await pPage.locator('#examPrepBody .ep-expl').first().waitFor({ timeout: 5000 });
    return 'ready: ' + out.join(', ') + '; 2 flashcards + 1 question answered';
  }, pPage);

  await record('x4', 'Hand to child: parent controls hidden, Exit brings them back', async () => {
    await pPage.click('#examPrepHandToChild');
    await pPage.waitForFunction(() => document.getElementById('examPrepOverlay').classList.contains('ep-child'));
    if (await pPage.isVisible('#examPrepClose')) throw new Error('close button visible in child mode');
    if (await pPage.isVisible('#examPrepHandToChild')) throw new Error('hand-to-child visible in child mode');
    if (!(await pPage.isVisible('#examPrepChildExit'))) throw new Error('no exit in child mode');
    const size = await pPage.evaluate(() => parseFloat(getComputedStyle(document.getElementById('examPrepBody')).fontSize));
    await pPage.click('#examPrepChildExit');
    await pPage.waitForFunction(() => !document.getElementById('examPrepOverlay').classList.contains('ep-child'));
    if (!(await pPage.isVisible('#examPrepClose'))) throw new Error('close button not back');
    await pPage.click('#examPrepClose');
    return `child mode font ${size}px, exit ok`;
  }, pPage);

  await record('x5', 'events -> exam prep this week', async () => {
    const openId = 'e2e' + Date.now().toString(36) + 'cap';
    for (const b of [{ type: 'opened' }, { type: 'closed', seconds: 120 }, { type: 'closed', seconds: 99999 }]) {
      const r = await post(pPage, '/api/exam-prep/event', { studentId: child16.id, openId, mode: 'flashcards', ...b });
      if (r.status !== 200) throw new Error('event ' + r.status);
    }
    if ((await post(pPage, '/api/exam-prep/event', { studentId: child16.id, openId, type: 'hacked' })).status !== 400) throw new Error('bad type accepted');
    await pPage.waitForTimeout(1500);
    const after = (await get(pPage, '/api/exam-prep/week/16')).body.children.find(c => c.studentId === child16.id);
    const b = weekBefore || { minutes: 0, flashcards: 0, questions: 0, opens: 0 };
    const d = { minutes: after.minutes - b.minutes, flashcards: after.flashcards - b.flashcards, questions: after.questions - b.questions, opens: after.opens - b.opens };
    if (d.flashcards !== 2 || d.questions !== 1 || d.opens !== 2) throw new Error('deltas ' + JSON.stringify(d));
    if (d.minutes < 30 || d.minutes > 33) throw new Error('minutes delta ' + d.minutes + ' (30-minute cap per open)');
    await pPage.reload();
    await pPage.locator(`#examPrepWeekList li[data-student="${child16.id}"]`).waitFor({ timeout: 20000 });
    const line = await pPage.textContent(`#examPrepWeekList li[data-student="${child16.id}"]`);
    if (!line.includes(after.flashcards + ' flashcards')) throw new Error('card line ' + line);
    return `delta ${JSON.stringify(d)}; card: ${line.trim()}`;
  }, pPage);

  const bCtx = await newCtx();
  const bPage = await bCtx.newPage();
  await login(bPage, PHONES.motherB, '/app/mother/');

  await record('x2', "family 18's free Class 5 child: revision notes, pack locked", async () => {
    const child = await openDashboardFor(bPage, '/app/mother/', c => c.class === 'Class 5');
    await bPage.click('#examPrepOpen');
    if (await bPage.locator('.ep-lang button[data-lang="te"][aria-pressed="true"]').count()) await bPage.click('.ep-lang button[data-lang="en"]');
    const rn = await noteBody(bPage, 'revision_notes');
    if (rn.status !== 'ready') throw new Error('revision notes ' + rn.status);
    const kp = await noteBody(bPage, 'key_points');
    if (kp.status !== 'locked') throw new Error('key points ' + kp.status);
    if (!(await bPage.isVisible('#examPrepUnlock'))) throw new Error('no unlock button');
    const api = await get(bPage, `/api/exam-prep/${child.id}/flashcards`);
    if (api.status !== 200 || api.body.status !== 'locked') throw new Error('api ' + JSON.stringify(api));
    return 'revision notes ready; key points + flashcards locked; unlock button shown';
  }, bPage);

  await record('x3', 'a non-pilot child: coming soon, no model call', async () => {
    const me = (await get(bPage, '/api/session/me')).body;
    const other = me.children.find(c => c.class && c.class !== 'Class 5');
    if (!other) throw new Error('family 18 has no non-Class-5 child (family.spec.js r1 adds them)');
    const t0 = Date.now();
    const o = await get(bPage, `/api/exam-prep/${other.id}`);
    const m = await get(bPage, `/api/exam-prep/${other.id}/revision_notes`);
    const ms = Date.now() - t0;
    if (o.status !== 200 || o.body.eligible !== false || o.body.status !== 'coming_soon') throw new Error('overview ' + JSON.stringify(o));
    if (m.status !== 200 || m.body.status !== 'coming_soon' || m.usd) throw new Error('mode ' + JSON.stringify(m));
    await openDashboardFor(bPage, '/app/mother/', c => c.id === other.id);
    if (await bPage.getAttribute('#examPrepCard', 'data-eligible') !== 'false') throw new Error('card eligible for ' + other.class);
    if (!(await bPage.isVisible('#examPrepCard .dc-badge-soon'))) throw new Error('no coming soon badge');
    return `${other.class}: 200 coming_soon (${o.body.reason}), card coming soon, ${ms} ms, no model call`;
  }, bPage);

  await record('x7', 'one reject leaves every other note served; undo serves it again', async () => {
    const out = [];
    const before = await servedMap();
    const target = `${TS}|flashcards|en`;
    const note = find(await notes(), TS, 'flashcards', 'en');
    const parentIds = async () => {
      const ids = {};
      for (const mode of ['revision_notes', 'key_points', 'flashcards', 'practice_questions']) ids[mode] = (await get(pPage, `/api/exam-prep/${child16.id}/${mode}`)).body;
      ids.te = (await get(pPage, `/api/exam-prep/${child16.id}/revision_notes?lang=te`)).body;
      return ids;
    };
    const p0 = await parentIds();
    // The review page: Reject, a reason, then the second confirm.
    await aPage.goto(BASE + '/admin/exam-prep?test=1');
    const details = aPage.locator(`details[data-note="${target}"]`);
    await details.locator('summary').click();
    const card = details.locator(`.version[data-version="${note.servedId}"]`);
    await card.locator('button[data-action="reject"]').click();
    await card.locator('textarea[data-field="reject-reason"]').fill('e2e: one reject touches one note');
    let dialogText = '';
    aPage.once('dialog', (d) => { dialogText = d.message(); d.accept(); });
    await card.locator('button[data-action="reject_send"]').click();
    await aPage.waitForFunction(() => /Reject v\d+: done/.test(document.getElementById('msg').textContent), null, { timeout: 20000 });
    if (!/Reject this one note\? Parents will see coming soon for it\./.test(dialogText)) throw new Error('confirm text: ' + dialogText);
    out.push('rejected on the page after the confirm');
    const after = await servedMap();
    if (after[target] !== null) throw new Error('rejected note still served');
    const changed = Object.keys(before).filter(k => k !== target && before[k] !== after[k]);
    if (changed.length) throw new Error('other notes changed: ' + changed.join(', '));
    const p1 = await parentIds();
    if (p1.flashcards.status !== 'coming_soon') throw new Error('parent flashcards ' + JSON.stringify(p1.flashcards));
    for (const k of ['revision_notes', 'key_points', 'practice_questions', 'te']) {
      if (p1[k].versionId !== p0[k].versionId) throw new Error(`parent ${k} changed`);
    }
    out.push(`parent: flashcards coming soon (200); ${Object.keys(before).length - 1} other notes unchanged (incl. Telugu, AP)`);
    // Undo on the page.
    await aPage.locator(`details[data-note="${target}"] summary`).click();
    await aPage.locator(`details[data-note="${target}"] button[data-action="undo"]`).click();
    await aPage.waitForFunction(() => /Undo: done/.test(document.getElementById('msg').textContent), null, { timeout: 20000 });
    const p2 = await parentIds();
    if (p2.flashcards.versionId !== p0.flashcards.versionId) throw new Error('undo did not serve it again');
    if (JSON.stringify(await servedMap()) !== JSON.stringify(before)) throw new Error('served map differs after undo');
    out.push('undo -> served again, everything as before');
    return out.join('; ');
  }, aPage);

  await record('x8', 'needs fix: only that note gets a new version; hide now; bad requests 400', async () => {
    const out = [];
    const before = await servedMap();
    const kp = find(await notes(), TS, 'key_points', 'en');
    const served = kp.servedId;
    // Bad requests first: nothing may change.
    const bad = [
      await decide({ versionId: served, action: 'reject', confirm: true }),
      await decide({ versionId: served, action: 'reject', reason: 'x' }),
      await decide({ versionId: [served, served], action: 'reject', reason: 'x', confirm: true }),
      await decide({ versionIds: [served], action: 'reject', reason: 'x', confirm: true }),
      await decide({ versionId: served, action: 'needs_fix', reason: '' }),
    ].map(r => r.status);
    if (bad.some(s => s !== 400)) throw new Error('bad requests ' + bad.join('/'));
    out.push('reject w/o reason, w/o confirm, list, versionIds, fix w/o reason -> 400');
    const reason = 'e2e: make the first key point shorter';
    const fix = await decide({ versionId: served, action: 'needs_fix', reason });
    if (fix.status !== 200) throw new Error('needs_fix ' + fix.status + ' ' + JSON.stringify(fix.body).slice(0, 200));
    const nv = fix.body.newVersion;
    if (!['needs_review', 'failed'].includes(nv.status) || nv.fix_reason !== reason) throw new Error('new version ' + nv.status);
    if (nv.status === 'approved' || nv.reviewed_by) throw new Error('fixed version went straight to parents');
    const mid = await servedMap();
    if (JSON.stringify(mid) !== JSON.stringify(before)) throw new Error('served notes changed on needs fix');
    const parentKp = (await get(pPage, `/api/exam-prep/${child16.id}/key_points`)).body;
    if (parentKp.versionId !== served) throw new Error('parent lost the served key points');
    out.push(`new v${nv.version} ${nv.status}; old version still served; all other notes unchanged`);
    if ((await undo(kp.key)).status !== 200) throw new Error('undo fix');
    // Hide now: coming soon (and the mind map) until the new version is approved.
    const hid = await decide({ versionId: served, action: 'needs_fix', reason, hide: true });
    if (hid.status !== 200) throw new Error('hide fix ' + hid.status);
    const hidden = await get(pPage, `/api/exam-prep/${child16.id}/key_points`);
    const map = await get(pPage, `/api/exam-prep/${child16.id}/mind_map`);
    if (hidden.body.status !== 'coming_soon' || map.body.status !== 'coming_soon') throw new Error('hide: ' + hidden.body.status + '/' + map.body.status);
    const others = await servedMap();
    const changed = Object.keys(before).filter(k => k !== `${TS}|key_points|en` && before[k] !== others[k]);
    if (changed.length) throw new Error('hide changed ' + changed.join(', '));
    out.push('hide now -> key points + mind map coming soon, others unchanged');
    if ((await undo(kp.key)).status !== 200) throw new Error('undo hide');
    const back = find(await notes(), TS, 'key_points', 'en');
    if (back.servedId !== served) throw new Error('undo did not restore the served key points');
    // Only the versions this run made (a run that stopped half way leaves its own behind).
    const mine = [nv.id, hid.body.newVersion && hid.body.newVersion.id].filter(Boolean);
    if (mine.length !== 2) throw new Error('hide now returned no new version');
    if (back.versions.filter(v => mine.includes(v.id) && v.status !== 'superseded').length) throw new Error('fix versions not superseded after undo');
    out.push('undo -> served again; new versions kept as superseded');
    return out.join('; ');
  }, aPage);

  await record('x10', 'ai review: the rule holds, reviewed_by hidden from parents, sample and teacher queue', async () => {
    const out = [];
    // A Telugu AP note gives the weekly sample something to draw from.
    const apTe = find(await notes(), AP, 'revision_notes', 'te');
    if (!apTe.versions.some(v => ['approved', 'needs_review', 'needs_fix', 'generating'].includes(v.status))) {
      const g = await post(aPage, '/api/admin/exam-prep/generate', { board: AP, mode: 'revision_notes', lang: 'te', test: true });
      if (g.status !== 200) throw new Error('AP Telugu generate ' + g.status + ' ' + JSON.stringify(g.body).slice(0, 200));
      out.push(`AP Telugu written: ${g.body.version.status}`);
    }
    const list = (await get(aPage, '/api/admin/exam-prep?test=1')).body;
    // The rule, both ways, for every test version: written at Haiku's first
    // attempt with every gate passed <=> the AI approved it (Undo may have
    // moved it since; the decision row stays).
    let checked = 0;
    for (const n of list.notes) {
      for (const v of n.versions.filter(x => x.content)) {
        const aiDecision = n.decisions.some(d => d.version_id === v.id && d.action === 'approve' && d.decided_by === 'ai');
        if (aiRule(v) !== aiDecision) throw new Error(`v${v.version} of ${n.board}|${n.mode}|${n.lang}: rule says ${aiRule(v)}, AI decision ${aiDecision}`);
        if (v.reviewed_by === 'ai' && !aiDecision) throw new Error('reviewed_by ai without an AI decision');
        checked++;
      }
    }
    out.push(`rule holds on ${checked} versions`);
    // Parents never see reviewed_by or who approved.
    for (const mode of ['revision_notes', 'key_points', 'flashcards', 'practice_questions', 'mind_map']) {
      const r = await get(pPage, `/api/exam-prep/${child16.id}/${mode}`);
      if (/reviewed_by|decided_by|teacher_reviewed/.test(JSON.stringify(r.body))) throw new Error(`${mode} response shows the reviewer`);
    }
    if (/reviewed_by/.test(JSON.stringify((await get(pPage, `/api/exam-prep/${child16.id}`)).body))) throw new Error('overview shows the reviewer');
    out.push('parent responses carry no reviewer');
    // Weekly sample: at most 2 Telugu notes, all AI-approved, the same on a second look.
    const samp = list.sample.map(id => list.notes.flatMap(n => n.versions.map(v => ({ n, v }))).find(x => x.v.id === id));
    if (samp.length > 2 || samp.some(x => !x || x.n.lang !== 'te' || x.v.status !== 'approved')) throw new Error('sample ' + JSON.stringify(list.sample));
    if (JSON.stringify((await get(aPage, '/api/admin/exam-prep?test=1')).body.sample) !== JSON.stringify(list.sample)) throw new Error('sample changed between two looks');
    out.push(`sample: ${samp.length} Telugu note(s), stable`);
    // Teacher queue: exactly the served versions the AI approved and nobody reviewed.
    const ai = list.notes.flatMap(n => n.versions).filter(v => v.status === 'approved' && v.reviewed_by === 'ai' && !v.teacher_reviewed_at).map(v => v.id).sort();
    if (typeof list.teacher.accountExists !== 'boolean' || JSON.stringify([...list.teacher.queue].sort()) !== JSON.stringify(ai)) throw new Error('teacher queue ' + JSON.stringify(list.teacher));
    out.push(`teacher queue: ${ai.length} (teacher account ${list.teacher.accountExists ? 'exists' : 'not yet'})`);
    return out.join('; ');
  }, aPage);

  await record('x11', 'report a mistake: still served, on the review list; Keep, Undo; one report per child', async () => {
    const out = [];
    const note = () => find(list0, TS, 'revision_notes', 'en');
    let list0 = await notes();
    const served = note().servedId;
    if (!served) throw new Error('TS English revision notes not served');
    const before = note().versions.find(v => v.id === served);
    await openDashboardFor(pPage, '/app/mother/', c => c.id === child16.id);
    await pPage.click('#examPrepOpen');
    await pPage.locator('#examPrepOverlay:not([hidden])').waitFor({ timeout: 10000 });
    if (await pPage.locator('.ep-lang button[data-lang="te"][aria-pressed="true"]').count()) await pPage.click('.ep-lang button[data-lang="en"]');
    const rn = await noteBody(pPage, 'revision_notes');
    if (rn.status !== 'ready') throw new Error('revision notes ' + rn.status);
    // Child mode hides the button; the parent sees it.
    await pPage.click('#examPrepHandToChild');
    await pPage.waitForFunction(() => document.getElementById('examPrepOverlay').classList.contains('ep-child'));
    if (await pPage.isVisible('#examPrepReport')) throw new Error('report button visible in child mode');
    await pPage.click('#examPrepChildExit');
    await pPage.click('#examPrepReport');
    await pPage.fill('#examPrepReportText', 'e2e: the second sentence looks wrong');
    await pPage.click('#examPrepReportSend');
    await pPage.waitForFunction(() => /Thank you/.test(document.getElementById('examPrepReportMsg').textContent), null, { timeout: 10000 });
    out.push('parent reported it from the note page');
    // Still served, same version, for the parent.
    const still = await get(pPage, `/api/exam-prep/${child16.id}/revision_notes`);
    if (still.body.status !== 'ready' || still.body.versionId !== served) throw new Error('report changed what is served: ' + JSON.stringify(still.body).slice(0, 160));
    // The same child reporting again does not add a second open report.
    const again = await post(pPage, '/api/exam-prep/report', { studentId: child16.id, mode: 'revision_notes', lang: 'en', message: 'again' });
    if (again.status !== 200 || again.body.duplicate !== true) throw new Error('second report ' + JSON.stringify(again));
    list0 = await notes();
    const rep = note().versions.find(v => v.id === served).reports;
    if (rep.length !== 1 || rep[0].message !== 'e2e: the second sentence looks wrong') throw new Error('reports ' + JSON.stringify(rep));
    out.push('served unchanged; one open report (the second one was a duplicate)');
    // Bad requests.
    if ((await post(pPage, '/api/exam-prep/report', { studentId: child16.id, mode: 'hacked', lang: 'en' })).status !== 400) throw new Error('bad mode accepted');
    if ((await post(pPage, '/api/exam-prep/report', { studentId: child16.id, mode: 'revision_notes', lang: 'xx' })).status !== 400) throw new Error('bad lang accepted');
    // The review page lists it (marked as reported) and Keep closes it.
    await aPage.goto(BASE + '/admin/exam-prep?test=1');
    const card = aPage.locator(`#reviewList .note[data-key="${note().key}"] .version[data-version="${served}"]`);
    await card.locator('.report').waitFor({ timeout: 20000 });
    await card.locator('button[data-action="keep"]').click();
    await aPage.waitForFunction(() => /Keep v\d+: done/.test(document.getElementById('msg').textContent), null, { timeout: 20000 });
    list0 = await notes();
    const kept = note().versions.find(v => v.id === served);
    if (kept.reports.length || kept.reviewed_by !== 'founder' || note().servedId !== served) throw new Error('after Keep ' + JSON.stringify({ r: kept.reports.length, by: kept.reviewed_by }));
    out.push('review page: listed as reported; Keep closed it, reviewed_by founder, still served');
    // Undo puts the reports and the reviewer back.
    if ((await undo(note().key)).status !== 200) throw new Error('undo keep');
    list0 = await notes();
    const back = note().versions.find(v => v.id === served);
    if (back.reports.length !== 1 || back.reviewed_by !== before.reviewed_by) throw new Error('undo Keep ' + JSON.stringify({ r: back.reports.length, by: back.reviewed_by, was: before.reviewed_by }));
    out.push(`undo Keep: report back, reviewed_by ${back.reviewed_by}`);
    // Leave it closed for the next run.
    const k2 = await decide({ versionId: served, action: 'keep' });
    if (k2.status !== 200) throw new Error('final keep ' + k2.status);
    return out.join('; ');
  }, pPage);

  await e2e.finish();
  await Promise.all([aCtx.close(), pCtx.close(), bCtx.close()]);
  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'exam-prep-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e exam-prep] fatal', e); process.exit(1); });
