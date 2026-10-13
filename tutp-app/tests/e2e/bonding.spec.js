// Bonding Report card e2e suite (TUT-31, docs/specs/bonding-card-fix-and-icon.md):
// the new icon, the score for a seeded family, the stale-tab fix, the two error
// copies and a dark colour scheme. No model calls, so no spend.
//
//   npm run test:e2e -- <base-url>          (run.js runs every spec)
//   node tests/e2e/bonding.spec.js <base-url> [--headless]
//
// Test data (login.spec.js): family 16, mother 9999900001, father 9999900002,
// member 9999900003, code 123456. The score is seeded through the product's own
// endpoint (POST /api/bonding-score, each viewer's own key); the daily cron may
// overwrite it later, which is harmless.
//
// Tests:
//   a  the card header and the sidebar link show bonding-small.svg (loaded,
//      22 px in the card, alt="") on mother, father and family-member
//   b  a seeded score of 72 renders "72%" on all three dashboards
//   c0 reproduction: with the guard script switched off and another family's
//      id in the tab, the card shows the sign-in-mismatch copy (the 403 of TUT-31)
//   c  the same stale tab with the guard on is synced to family 16 and the
//      card renders "72%", with no 403 on the page's own calls afterwards
//   d  forced 500 and forced 403 on the score call -> the two copies, no apology
//   e  dark colour scheme: the icon chip is light and the card text has contrast >= 4.5
//
// TUT-56 (docs/specs/TUT-56-bonding-card.md), the calm card:
//   h  the survey chips are absent on the card (it holds icon+title, score, one line,
//      one link) and present in the full report, all three dashboards
//   i  empty state line in en, te, hi with no "%"; the report opens once, Escape and
//      the backdrop close it
//   j  N/A report: the reason and "N more sessions needed" for 1, 2 and 3 sessions;
//      a 500 on the sessions call leaves the report open with a reload line
//   k  390 px viewport: card and report inside the screen, no sideways scroll
//
// Output: tests/e2e/output/bonding-results.json, FAIL_<test>.png. Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/bonding.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const CODE = '123456';
const ROLES = [
  { name: 'mother', phone: '9999900001', want: '/app/mother/' },
  { name: 'father', phone: '9999900002', want: '/app/father/' },
  { name: 'family-member', phone: '9999900003', want: '/app/family-member/' },
];
const SEEDED = 72;
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log('[e2e bonding]', ...a);

async function record(id, name, fn, page) {
  try {
    // Every test is bounded: a hang becomes a FAIL with this message.
    let timer;
    const detail = await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('test timed out after 90 s')), 90000); }),
    ]).finally(() => clearTimeout(timer));
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    let shot = '';
    if (page) { shot = path.join(OUT, 'FAIL_' + id + '.png'); await page.screenshot({ path: shot, fullPage: true }).catch(() => {}); }
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 400), shot });
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

// The card's value and note text once the first load has finished.
async function cardText(page) {
  await page.waitForFunction(() => {
    const v = document.getElementById('bondingScoreValue');
    return v && v.textContent.trim() && !v.querySelector('.animate-pulse');
  }, null, { timeout: 25000 });
  return page.evaluate(() => ({
    value: document.getElementById('bondingScoreValue').textContent.trim(),
    note: document.getElementById('bondingGapText').textContent.trim(),
  }));
}

async function seed(page, role) {
  return page.evaluate(async ({ score, role }) => {
    const me = await (await fetch('/api/session/me', { cache: 'no-store' })).json();
    const viewer = role === 'family-member' ? sessionStorage.getItem('tutp_family_member_id') : role;
    const r = await fetch('/api/bonding-score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family_id: me.familyId, viewer_key: viewer, score }),
    });
    return { status: r.status, familyId: me.familyId };
  }, { score: SEEDED, role });
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

(async () => {
  log('base', BASE);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 30 });
  const newCtx = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
    ctx.setDefaultTimeout(30000);
    ctx.setDefaultNavigationTimeout(30000);
    await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
      const resp = await route.fetch();
      const hook = 'const auth = getAuth(app);';
      const body = (await resp.text()).replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
      if (!body.includes('appVerificationDisabledForTesting')) throw new Error('phone-auth.js hook not found');
      await route.fulfill({ response: resp, body });
    });
    return ctx;
  };

  // One signed-in context per role, each left on its own dashboard.
  const live = {};
  for (const r of ROLES) {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    const landed = await login(page, r.phone, r.want);
    if (landed !== r.want) throw new Error(`${r.name} landed on ${landed}`);
    live[r.name] = { ctx, page, seeded: await seed(page, r.name) };
    log(r.name, 'signed in, seed', live[r.name].seeded.status);
  }

  await record('a', 'icon on the card header and the sidebar link, all three dashboards', async () => {
    const out = [];
    for (const r of ROLES) {
      const { page } = live[r.name];
      await page.goto(BASE + r.want);
      await page.waitForLoadState('networkidle').catch(() => {});
      const info = await page.evaluate(() => {
        const pick = (sel) => { const el = document.querySelector(sel); return el ? { w: el.naturalWidth, rw: el.getAttribute('width'), alt: el.getAttribute('alt') } : null; };
        return { card: pick('#bondingReportSection img[src$="/bonding-small.svg"]'), side: pick('a[href="#bondingReportSection"] img[src$="/bonding-small.svg"]'), heart: document.querySelectorAll('#bondingReportSection h3 .material-symbols-outlined').length };
      });
      if (!info.card || !(info.card.w > 0) || info.card.rw !== '22' || info.card.alt !== '') throw new Error(`${r.name} card icon ${JSON.stringify(info)}`);
      if (!info.side || !(info.side.w > 0) || info.side.alt !== '') throw new Error(`${r.name} sidebar icon ${JSON.stringify(info)}`);
      if (info.heart) throw new Error(`${r.name}: Material heart still in the card header`);
      out.push(r.name + ' ok');
    }
    return out.join(', ');
  }, live.mother.page);

  await record('b', 'seeded score renders as a number with %', async () => {
    const out = [];
    for (const r of ROLES) {
      const { page } = live[r.name];
      if (live[r.name].seeded.status !== 200) throw new Error(`${r.name} seed ${live[r.name].seeded.status}`);
      await page.goto(BASE + r.want);
      const t = await cardText(page);
      if (t.value !== SEEDED + '%') throw new Error(`${r.name} shows "${t.value}" / "${t.note}"`);
      out.push(`${r.name} ${t.value}`);
    }
    return out.join(', ');
  }, live.father.page);

  // c0 / c: a tab that still holds another family's id while the cookie is family 16.
  const staleCtx = live.father.ctx;
  await record('c0', 'reproduction: stale tab with the guard off shows the sign-in-mismatch copy', async () => {
    const page = await staleCtx.newPage();
    try {
      await page.route('**/app/shared/session-guard.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: '/* guard off for the reproduction */' }));
      await page.goto(BASE + '/assets/icons/bonding.svg');
      await page.evaluate(() => { sessionStorage.setItem('tutp_family_id', '999999'); sessionStorage.setItem('tutp_roles', JSON.stringify([{ role: 'father' }])); });
      await page.goto(BASE + '/app/father/');
      const t = await cardText(page);
      if (t.value !== '—' || !/sign-in does not match/i.test(t.note)) throw new Error(`"${t.value}" / "${t.note}"`);
      return `"${t.value}" / "${t.note}"`;
    } finally { await page.close(); }
  });

  await record('c', 'stale tab with the guard on is synced to the cookie\'s family', async () => {
    const page = await staleCtx.newPage();
    const t0 = Date.now();
    const trace = [];
    const rawPush = trace.push.bind(trace);
    trace.push = (s) => rawPush(`${s}@${Date.now() - t0}`);
    page.on('response', (r) => { if (r.url().includes('/api/session/me')) trace.push('me ' + r.status()); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) trace.push('nav ' + new URL(f.url()).pathname); });
    const dump = setTimeout(() => console.log('[e2e bonding] c trace at 40 s:', trace.join(' > ').slice(0, 1500)), 40000);
    try {
      // A static same-origin page: sessionStorage can be set without the login page's redirects.
      await page.goto(BASE + '/assets/icons/bonding.svg');
      await page.evaluate(() => { sessionStorage.setItem('tutp_family_id', '999999'); sessionStorage.setItem('tutp_student_id', 'stale'); sessionStorage.setItem('tutp_roles', JSON.stringify([{ role: 'father' }])); });
      await page.goto(BASE + '/app/father/');
      // Settled = the family id is the cookie's AND the reloaded page has cleared
      // tutp_guard_synced (the guard sets the id, then the flag, then reloads; the
      // reloaded page clears the flag once the ids match). Reading in the same call
      // avoids racing the reload.
      const settled = await page.waitForFunction(() => {
        const fam = sessionStorage.getItem('tutp_family_id');
        if (!fam || fam === '999999' || sessionStorage.getItem('tutp_guard_synced')) return false;
        return { fam, stu: sessionStorage.getItem('tutp_student_id') };
      }, null, { timeout: 25000 })
        .catch((e) => { throw new Error(`no sync: ${e.message.split('\n')[0]}`); });
      const synced = await settled.jsonValue();
      trace.push('synced ' + synced.fam);
      if (synced.stu === 'stale') throw new Error('old student id kept: ' + JSON.stringify(synced));
      const t = await cardText(page);
      trace.push('card ' + t.value);
      if (t.value !== SEEDED + '%') throw new Error(`"${t.value}" / "${t.note}"`);
      const noticeText = await page.locator('#tutpGuardNotice').innerText({ timeout: 5000 })
        .catch(() => { throw new Error('no resync notice after the sync'); });
      if (!/You are now viewing/.test(noticeText) || !/Not yours\? Sign out/.test(noticeText)) throw new Error('notice text: ' + noticeText);
      if (!(await page.locator('#tutpGuardSignOut').isVisible())) throw new Error('no Sign out link');
      await page.locator('#tutpGuardNoticeClose').click();
      if (await page.locator('#tutpGuardNotice').count()) throw new Error('notice not dismissed');
      trace.push('notice ok');
      const bad = [];
      page.on('response', (r) => { if (r.status() === 403 && r.url().includes('/api/')) bad.push(r.url().replace(BASE, '')); });
      await page.reload();
      trace.push('reloaded');
      await cardText(page);
      trace.push('card2');
      await page.waitForLoadState('networkidle').catch(() => {});
      if (bad.length) throw new Error('403 after sync: ' + bad.join(', '));
      if (await page.locator('#tutpGuardNotice').count()) throw new Error('notice shown again after a plain reload');
      const flag = await page.evaluate(() => sessionStorage.getItem('tutp_guard_synced'));
      if (flag) throw new Error('tutp_guard_synced not cleared');
      return `family ${synced.fam}, ${t.value}, no 403 after the sync`;
    } catch (e) { throw new Error(`${String(e.message).split('\n')[0]}; trace ${trace.join(' > ')}`); }
    finally { clearTimeout(dump); await page.close(); }
  });

  await record('d', 'forced 500 and 403 give the two plain copies', async () => {
    const page = live.mother.page;
    const out = [];
    for (const [code, re] of [[500, /did not load\. Reload the page in a minute\./], [403, /sign-in does not match this family\. Sign in again/]]) {
      await page.route('**/api/bonding-score/**', (route) => route.fulfill({ status: code, contentType: 'application/json', body: '{"error":"x"}' }));
      await page.goto(BASE + '/app/mother/');
      const t = await cardText(page);
      await page.unroute('**/api/bonding-score/**');
      if (!re.test(t.note) || /sorry/i.test(t.note)) throw new Error(`${code}: "${t.note}"`);
      if (code === 403 && !(await page.locator('#bondingGapText a[href="/app/login/"]').count())) throw new Error('403 copy has no sign-in link');
      out.push(`${code} -> "${t.note}"`);
    }
    return out.join('; ');
  }, live.mother.page);

  await record('e', 'dark colour scheme: light chip, readable text', async () => {
    const page = live.mother.page;
    await page.emulateMedia({ colorScheme: 'dark' });
    try {
      await page.goto(BASE + '/app/mother/');
      await cardText(page);
      const m = await page.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c.slice(0, 3); } return [255, 255, 255]; };
        const chip = document.querySelector('#bondingReportSection h3 span');
        const note = document.getElementById('bondingGapText');
        const val = document.getElementById('bondingScoreValue');
        return { chip: bgOf(chip), noteFg: rgb(getComputedStyle(note).color).slice(0, 3), noteBg: bgOf(note), valFg: rgb(getComputedStyle(val).color).slice(0, 3), valBg: bgOf(val) };
      });
      const chipLum = luminance(m.chip);
      const cNote = contrast(m.noteFg, m.noteBg);
      const cVal = contrast(m.valFg, m.valBg);
      if (chipLum < 0.7) throw new Error('chip is dark: ' + JSON.stringify(m.chip));
      if (cNote < 4.5 || cVal < 4.5) throw new Error(`contrast note ${cNote.toFixed(1)} value ${cVal.toFixed(1)}`);
      return `chip luminance ${chipLum.toFixed(2)}, contrast note ${cNote.toFixed(1)} value ${cVal.toFixed(1)}`;
    } finally { await page.emulateMedia({ colorScheme: 'light' }); }
  }, live.mother.page);

  // ---- TUT-56: the calm card, the detail in the full report ----------------
  // The survey answers (the chips) for each role, saved through the product's own endpoint.
  const BASELINE = { homework_days: 4, support_style: 'guides_questions', activities: ['meals', 'story_time'], meal_frequency: 'most_days', trip_days_bucket: '6_15' };
  const seedBaseline = (page, role) => page.evaluate(async ({ b, role }) => {
    const viewer = role === 'family-member' ? sessionStorage.getItem('tutp_family_member_id') : role;
    const r = await fetch('/api/parent-involvement-baseline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(Object.assign({ viewer }, b)),
    });
    return r.status;
  }, { b: BASELINE, role });
  const EMPTY = {
    en: 'Sit with your child for 3 homework sessions this week to see your score.',
    te: 'ఈ వారం మీ బిడ్డతో 3 హోంవర్క్ సెషన్లు కూర్చుంటే మీ స్కోర్ కనిపిస్తుంది.',
    hi: 'इस हफ़्ते अपने बच्चे के साथ 3 होमवर्क सेशन में बैठें, तब आपका स्कोर दिखेगा.',
  };
  const NA_SCORE = { hasData: false, score: null, leaderScore: null, isLeader: false };
  const openReport = async (page) => {
    await page.locator('#bondingViewFull').click();
    await page.locator('#bondingReportDialog').waitFor({ state: 'visible', timeout: 10000 });
  };

  await record('h', 'chips are absent on the card and present in the full report, all three dashboards', async () => {
    const out = [];
    for (const r of ROLES) {
      const { page } = live[r.name];
      const st = await seedBaseline(page, r.name);
      if (st !== 200 && st !== 201) throw new Error(`${r.name} baseline seed ${st}`);
      await page.goto(BASE + r.want);
      await cardText(page);
      await page.waitForLoadState('networkidle').catch(() => {});
      const card = await page.evaluate(() => {
        const s = document.getElementById('bondingReportSection');
        return {
          chipsInCard: s.querySelectorAll('.pib-strip, #pibStrip, .pib-strip-item').length,
          chipsOnPage: document.querySelectorAll('#pibStrip').length,
          kids: [...s.children].map((c) => c.tagName.toLowerCase()),
          text: s.innerText,
        };
      });
      if (card.chipsInCard || card.chipsOnPage) throw new Error(`${r.name}: chips on the card/page before the report is opened (${JSON.stringify(card)})`);
      if (card.kids.join(',') !== 'h3,div,button') throw new Error(`${r.name}: card parts ${card.kids.join(',')}`);
      if (/Parent Engagement/i.test(card.text) || /days\/week|days\/year|most days/i.test(card.text)) throw new Error(`${r.name}: card text has report detail: ${card.text.replace(/\s+/g, ' ')}`);
      await openReport(page);
      await page.locator('#bondingReportDialog #pibStrip .pib-strip-item').first().waitFor({ state: 'visible', timeout: 10000 });
      const rep = await page.evaluate(() => {
        const d = document.getElementById('bondingReportDialog');
        return { items: d.querySelectorAll('#pibStrip .pib-strip-item').length, text: d.innerText, heading: !document.getElementById('pibStripHead').hidden };
      });
      if (rep.items < 3 || !/4 days\/week/.test(rep.text) || !/6.15 days\/year/.test(rep.text) || !/Most days/.test(rep.text) || !rep.heading) throw new Error(`${r.name}: report chips ${JSON.stringify(rep)}`);
      out.push(`${r.name} card 0 chips, report ${rep.items}`);
      await page.keyboard.press('Escape');
    }
    return out.join(', ');
  }, live.mother.page);

  await record('i', 'empty state in en/te/hi, no result claim; report opens once and closes', async () => {
    const page = live.mother.page;
    await page.route('**/api/bonding-score/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(NA_SCORE) }));
    try {
      const out = [];
      for (const lang of ['en', 'te', 'hi']) {
        await page.goto(BASE + '/assets/icons/bonding.svg');
        await page.evaluate((l) => localStorage.setItem('tutp_ui_lang', l), lang);
        await page.goto(BASE + '/app/mother/');
        await page.waitForFunction(() => document.getElementById('bondingScoreValue') && document.getElementById('bondingScoreValue').textContent.trim() === 'N/A', null, { timeout: 25000 });
        const t = await cardText(page);
        const sectionText = await page.locator('#bondingReportSection').innerText();
        if (t.note !== EMPTY[lang]) throw new Error(`${lang}: "${t.note}"`);
        if (/%/.test(sectionText)) throw new Error(`${lang}: a result claim on the empty card: ${sectionText}`);
        out.push(lang + ' ok');
      }
      await page.evaluate(() => localStorage.setItem('tutp_ui_lang', 'en'));
      await page.goto(BASE + '/app/mother/');
      await cardText(page);
      await openReport(page);
      await page.evaluate(() => document.getElementById('bondingViewFull').click());
      if ((await page.locator('#bondingReportDialog').count()) !== 1) throw new Error('more than one report dialog');
      await page.keyboard.press('Escape');
      if (await page.locator('#bondingReportDialog').count()) throw new Error('Escape did not close the report');
      await openReport(page);
      await page.mouse.click(5, 5);
      if (await page.locator('#bondingReportDialog').count()) throw new Error('the backdrop did not close the report');
      return out.join(', ') + ', one dialog, Escape and backdrop close';
    } finally {
      await page.unroute('**/api/bonding-score/**');
      await page.evaluate(() => localStorage.removeItem('tutp_ui_lang')).catch(() => {});
    }
  }, live.mother.page);

  await record('j', 'N/A report says why and how many more sessions; failures do not break it', async () => {
    const page = live.mother.page;
    await page.route('**/api/bonding-score/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(NA_SCORE) }));
    try {
      const out = [];
      const cases = [
        { count: 1, want: /Sessions this week: 1 of 3\.\s*2 more sessions needed\./ },
        { count: 2, want: /Sessions this week: 2 of 3\.\s*1 more session needed\./ },
        { count: 3, want: /You have done 3 sessions this week\. The score is worked out once a day/, not: /0 more/ },
      ];
      for (const c of cases) {
        await page.route('**/api/weekly-sessions/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ count: c.count, target: 5 }) }));
        await page.goto(BASE + '/app/mother/');
        await page.waitForFunction(() => document.getElementById('bondingScoreValue').textContent.trim() === 'N/A', null, { timeout: 25000 });
        await openReport(page);
        await page.waitForFunction(() => /session/.test((document.getElementById('bcReportSessions') || {}).textContent || ''), null, { timeout: 10000 });
        const txt = await page.locator('#bondingReportDialog').innerText();
        if (!/appears after you sit with your child for 3 homework sessions in a week/.test(txt)) throw new Error('no reason for N/A: ' + txt.slice(0, 300));
        if (!c.want.test(txt) || (c.not && c.not.test(txt))) throw new Error(`count ${c.count}: ${txt.slice(0, 400)}`);
        out.push(`count ${c.count} ok`);
        await page.keyboard.press('Escape');
        await page.unroute('**/api/weekly-sessions/**');
      }
      await page.route('**/api/weekly-sessions/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
      await page.goto(BASE + '/app/mother/');
      await page.waitForFunction(() => document.getElementById('bondingScoreValue').textContent.trim() === 'N/A', null, { timeout: 25000 });
      await openReport(page);
      await page.waitForFunction(() => /did not load/.test((document.getElementById('bcReportSessions') || {}).textContent || ''), null, { timeout: 10000 });
      out.push('500 -> reload line');
      await page.keyboard.press('Escape');
      await page.unroute('**/api/weekly-sessions/**');
      return out.join(', ');
    } finally {
      await page.unroute('**/api/bonding-score/**').catch(() => {});
      await page.unroute('**/api/weekly-sessions/**').catch(() => {});
    }
  }, live.mother.page);

  await record('k', '390 px phone: card and report fit, no sideways scroll, all three dashboards', async () => {
    const out = [];
    for (const r of ROLES) {
      const { page } = live[r.name];
      await page.setViewportSize({ width: 390, height: 844 });
      try {
        await page.goto(BASE + r.want);
        await cardText(page);
        await page.waitForLoadState('networkidle').catch(() => {});
        const m = await page.evaluate(() => {
          const b = document.getElementById('bondingReportSection').getBoundingClientRect();
          return { left: b.left, right: b.right, scrollW: document.documentElement.scrollWidth, vw: window.innerWidth };
        });
        if (m.left < 0 || m.right > m.vw + 0.5) throw new Error(`${r.name} card outside the viewport: ${JSON.stringify(m)}`);
        if (m.scrollW > m.vw) throw new Error(`${r.name} page scrolls sideways: ${JSON.stringify(m)}`);
        await openReport(page);
        const d = await page.evaluate(() => {
          const box = document.querySelector('#bondingReportDialog .bc-box').getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, vw: window.innerWidth, vh: window.innerHeight };
        });
        if (d.left < 0 || d.right > d.vw + 0.5 || d.top < 0 || d.bottom > d.vh + 0.5) throw new Error(`${r.name} report outside the viewport: ${JSON.stringify(d)}`);
        const closeVisible = await page.locator('#bondingReportDialog .bc-x').isVisible();
        if (!closeVisible) throw new Error(`${r.name}: no close button in view`);
        out.push(`${r.name} ok (${Math.round(m.right - m.left)} px card)`);
        await page.keyboard.press('Escape');
      } finally { await page.setViewportSize({ width: 1280, height: 900 }); }
    }
    return out.join(', ');
  }, live.mother.page);

  for (const r of ROLES) await live[r.name].ctx.close();
  await browser.close();
  console.log('\nRESULTS');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}${r.shot ? '\t' + r.shot : ''}`);
  fs.writeFileSync(path.join(OUT, 'bonding-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})().catch(e => { console.error('[e2e bonding] fatal', e); process.exit(1); });
