// Story image library + visuals v3 e2e (docs/specs/story-image-library.md).
//
//   node tests/e2e/library.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// Signs in as the test mother 9999900001 (code 123456). Every story call is
// answered from hand-written replies (tests/e2e/recordings-handwritten.mjs,
// run it once; no model spend, always replayed whatever the run mode).
//   l0  sign in
//   l1  a library story: the checked picture, numbered pins on the parts, a
//       legend in the story language, the "AI-made illustration" tag, a report
//       button >= 44 px; under scene 3 and before the equations
//   l2  the legend in Telugu: the Telugu term with the English source in brackets
//   l3  "Is this picture wrong?" posts the image id (200) and shows thanks;
//       an unknown image id is 400, no session 401
//   l4  print view: the picture, pins and legend are printed, the report button is not
//   l5  a library id that was not offered is dropped: no picture (never a wrong one)
//   l6  360 px: no sideways scroll, pins inside the picture, report button >= 44 px
//   l7  Venn diagram: two sets, the intersection highlighted, elements in the right region
//   l8  bar model with item icons
//   l9  a chain equation with a blank (6 x 9 = 6 x 3 x ___) gets a picture (3 groups of 18)
//   l10 the image file is served as WebP with a day of caching
// Output: tests/e2e/output/ (FAIL_l*.png, library-*.png). Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TOPICS } from './recordings-handwritten.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/library.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const PHONE = '+919999900001';
const CODE = '123456';
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];

function log(...a) { console.log('[e2e:library]', ...a); }
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
  const HW = /\/api\/homework(\?|$)/;

  async function signIn(viewport = { width: 1280, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    // the hand-written replies are always replayed
    await ctx.route(HW, (route) => route.continue({ headers: { ...route.request().headers(), 'x-e2e-mode': 'replay' } }));
    await ctx.route('**/app/shared/phone-auth.js*', async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      const hook = 'const auth = getAuth(app);';
      if (!body.includes(hook)) throw new Error('phone-auth.js hook not found');
      body = body.replace(hook, hook + ' auth.settings.appVerificationDisabledForTesting = true;');
      await route.fulfill({ response: resp, body });
    });
    const page = await ctx.newPage();
    const net = { stories: [], reports: [] };
    page.on('response', async (r) => {
      if (/\/api\/story-image\/report$/.test(r.url()) && r.request().method() === 'POST') {
        net.reports.push({ status: r.status(), body: await r.json().catch(() => null), sent: JSON.parse(r.request().postData() || '{}') });
      }
      if (!HW.test(r.url()) || r.request().method() !== 'POST') return;
      let feature = '';
      try { feature = JSON.parse(r.request().postData() || '{}').feature; } catch { /* not JSON */ }
      if (feature !== 'storytelling') return;
      const body = await r.json().catch(() => null);
      let story = null;
      try { story = JSON.parse(((body && body.content) || []).find(b => b.type === 'text').text); } catch { /* error reply */ }
      net.stories.push({ status: r.status(), headers: r.headers(), story });
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
    }, { phone: PHONE, code: CODE });
    if (status !== 200) throw new Error(`/api/session returned ${status}`);
    await page.goto(BASE + '/app/mother/');
    await page.waitForFunction(() => typeof window.openStorytellingModal === 'function' && window.tutpChildReady, null, { timeout: 30000 });
    const studentId = await page.evaluate(() => window.tutpChildReady);
    if (!studentId) throw new Error('no child selected');
    return { page, ctx, net, studentId };
  }

  async function tell(page, language, topic) {
    await page.evaluate(() => openStorytellingModal());
    await page.locator('#storyModal .sm-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.selectOption('#storyModalLang', language);
    await page.fill('#storyModalText', topic);
    await page.click('#storyModalSubmitBtn');
    await Promise.race([
      page.locator('#storyModalResults').waitFor({ state: 'visible', timeout: 60000 }),
      page.locator('#storyModalErrBox:not(.sm-hidden)').waitFor({ state: 'visible', timeout: 60000 }).then(async () => {
        throw new Error('modal error: ' + (await page.textContent('#storyModalErrBox')));
      }),
    ]);
  }
  const last = (net) => net.stories[net.stories.length - 1];
  const R = '#storyModalResults';

  let s = null;
  await record('l0', 'sign in as the test mother', async () => {
    s = await signIn();
    return 'child ' + s.studentId;
  }, () => s && s.page);
  if (!s) { await browser.close(); console.log('no session: stopping'); process.exit(1); }
  const { page, net } = s;

  await record('l1', 'library story: picture, pins on the parts, English legend, AI tag, report button', async () => {
    await tell(page, 'English', TOPICS.library);
    const r = last(net);
    expect(r && r.status === 200 && r.story, 'no story reply: ' + (r && r.status));
    expect(r.headers['x-story-visual'] === 'library', 'X-Story-Visual ' + r.headers['x-story-visual']);
    const v = r.story.visual;
    expect(v && v.type === 'library' && v.id === 'chromosome' && v.src === '/imglib/chromosome.webp', 'visual: ' + JSON.stringify(v));
    expect(v.labels.length === 2 && v.labels[0].term === 'Chromatid' && v.labels[1].term === 'Centromere' && !v.labels[0].source, 'labels: ' + JSON.stringify(v.labels));
    await page.waitForFunction((sel) => { const i = document.querySelector(sel + ' .sm-lib-img'); return i && i.complete && i.naturalWidth > 0; }, R, { timeout: 20000 });
    const d = await page.evaluate((sel) => {
      const img = document.querySelector(sel + ' .sm-lib-img'), ib = img.getBoundingClientRect();
      const pins = [...document.querySelectorAll(sel + ' .sm-lib-pin')].map((p) => { const b = p.getBoundingClientRect(); return { n: p.textContent, inside: b.left + b.width / 2 >= ib.left && b.left + b.width / 2 <= ib.right && b.top + b.height / 2 >= ib.top && b.top + b.height / 2 <= ib.bottom, left: p.style.left, top: p.style.top }; });
      const legend = [...document.querySelectorAll(sel + ' .sm-lib-item')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
      const btn = document.querySelector(sel + ' .sm-lib-report'), bb = btn.getBoundingClientRect();
      const fig = document.querySelector(sel + ' .sm-visual'), eqs = document.querySelector(sel + ' .sm-eqs'), li = fig.closest('li');
      return {
        alt: img.alt, w: ib.width, pins, legend, tag: (document.querySelector(sel + ' .sm-lib-tag') || {}).textContent, reportText: btn.textContent, reportH: bb.height,
        figAriaHidden: fig.getAttribute('aria-hidden'), bodyAriaHidden: fig.firstElementChild.getAttribute('aria-hidden'),
        inThird: Array.from(li.parentNode.children).indexOf(li) === 2, before: !eqs || !!(fig.compareDocumentPosition(eqs) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    }, R);
    expect(d.alt.length > 20 && /chromosome/i.test(d.alt), 'alt text: ' + d.alt);
    expect(d.pins.length === 2 && d.pins.every((p) => p.inside), 'pins: ' + JSON.stringify(d.pins));
    expect(d.pins[0].left === '41%' && d.pins[0].top === '30%', 'pin 1 position: ' + d.pins[0].left + ' ' + d.pins[0].top);
    expect(d.legend.join('|') === '1Chromatid|2Centromere' || d.legend.join('|') === '1 Chromatid|2 Centromere', 'legend: ' + d.legend.join('|'));
    expect(d.tag === 'AI-made illustration', 'tag: ' + d.tag);
    expect(d.reportText === 'Is this picture wrong?' && d.reportH >= 43.5, `report button: "${d.reportText}" ${d.reportH}px`);
    expect(d.inThird && d.before, 'picture is not under scene 3 before the equations');
    expect(d.bodyAriaHidden !== 'true', 'the picture is hidden from screen readers');
    await page.locator(R + ' .sm-visual').scrollIntoViewIfNeeded();
    await page.locator(R + ' .sm-visual').screenshot({ path: path.join(OUT, 'library-chromosome-en.png') });
    return `chromosome, ${d.pins.length} pins, ${Math.round(d.w)}px wide, ${d.reportH}px button`;
  }, page);

  await record('l3', '"Is this picture wrong?": 200 with the image id, thanks shown; unknown id 400; no session 401', async () => {
    await page.click(R + ' .sm-lib-report');
    await page.locator(R + ' .sm-lib-thanks:not(.sm-hidden)').waitFor({ timeout: 10000 });
    await page.waitForFunction(() => true);
    const rep = net.reports[net.reports.length - 1];
    expect(rep && rep.status === 200 && rep.body && rep.body.ok === true, 'report reply: ' + JSON.stringify(rep));
    expect(rep.sent.imageId === 'chromosome' && rep.sent.studentId === s.studentId, 'sent: ' + JSON.stringify(rep.sent));
    expect(rep.body.counted === false, 'a test family must not be counted: ' + JSON.stringify(rep.body));
    expect(await page.locator(R + ' .sm-lib-report').isHidden(), 'the button is still there after the report');
    const post = (body) => page.evaluate(async (b) => { const r = await fetch('/api/story-image/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.status; }, body);
    const unknown = await post({ studentId: s.studentId, imageId: 'no-such-image' });
    expect(unknown === 400, 'unknown image id: ' + unknown);
    const noSession = await (await browser.newContext()).request.post(BASE + '/api/story-image/report', { data: { studentId: s.studentId, imageId: 'chromosome' } });
    expect(noSession.status() === 401 || noSession.status() === 403, 'no session: ' + noSession.status());
    return 'ok, unknown 400, no session ' + noSession.status();
  }, page);

  await record('l4', 'print view: picture, pins and legend are printed, the report button is not', async () => {
    await page.evaluate(() => document.getElementById('storyModalResults').classList.add('print-target'));
    await page.emulateMedia({ media: 'print' });
    const r = await page.evaluate((sel) => {
      const shown = (q) => { const e = document.querySelector(sel + ' ' + q); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
      const img = document.querySelector(sel + ' .sm-lib-img').getBoundingClientRect();
      return { img: img.width > 100 && img.height > 100, pins: shown('.sm-lib-pin'), legend: shown('.sm-lib-legend'), tag: shown('.sm-lib-tag'), report: shown('.sm-lib-report'), thanks: shown('.sm-lib-thanks') };
    }, R);
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => document.getElementById('storyModalResults').classList.remove('print-target'));
    expect(r.img && r.pins && r.legend && r.tag, 'not printed: ' + JSON.stringify(r));
    expect(!r.report && !r.thanks, 'the report controls are printed: ' + JSON.stringify(r));
    return 'picture, pins, legend, tag printed; report not';
  }, page);

  await record('l2', 'Telugu legend: the Telugu term with the English source in brackets', async () => {
    await page.evaluate(() => closeStoryModal());
    await tell(page, 'Telugu', TOPICS.library);
    const r = last(net);
    expect(r.status === 200 && r.story && r.story.visual && r.story.visual.type === 'library', 'no library picture: ' + JSON.stringify(r.story && r.story.visual));
    const items = await page.$$eval(R + ' .sm-lib-item', (es) => es.map((e) => ({ term: e.querySelector('.sm-lib-term').textContent, src: (e.querySelector('.sm-lib-src') || {}).textContent || '' })));
    expect(items.length === 2 && items[0].term === 'క్రొమాటిడ్' && items[0].src === '(Chromatid)' && items[1].term === 'సెంట్రోమియర్' && items[1].src === '(Centromere)', 'legend: ' + JSON.stringify(items));
    await page.locator(R + ' .sm-visual').screenshot({ path: path.join(OUT, 'library-chromosome-te.png') });
    await page.evaluate(() => closeStoryModal());
    return 'క్రొమాటిడ్ (Chromatid), సెంట్రోమియర్ (Centromere)';
  }, page);

  await record('l5', 'a library id that was not offered is dropped: no picture', async () => {
    await tell(page, 'English', TOPICS.invented);
    const r = last(net);
    expect(r.status === 200 && r.story, 'no story reply');
    expect(r.story.visual === null, 'the picture was kept: ' + JSON.stringify(r.story.visual));
    expect(r.headers['x-story-visual'] === 'none', 'X-Story-Visual ' + r.headers['x-story-visual']);
    expect(await page.locator(R + ' .sm-visual').count() === 0 && await page.locator(R + ' img').count() === 0, 'a picture is on the page');
    await page.evaluate(() => closeStoryModal());
    return 'dropped, story still shown';
  }, page);

  let small = null;
  await record('l6', '360 px: library picture, no sideways scroll, pins inside, report button >= 44 px', async () => {
    small = await signIn({ width: 360, height: 800 });
    await tell(small.page, 'English', TOPICS.library);
    await small.page.waitForFunction((sel) => { const i = document.querySelector(sel + ' .sm-lib-img'); return i && i.complete && i.naturalWidth > 0; }, R, { timeout: 20000 });
    const m = await small.page.evaluate((sel) => {
      const panel = document.querySelector('#storyModal .sm-panel'), ib = document.querySelector(sel + ' .sm-lib-img').getBoundingClientRect();
      const btn = document.querySelector(sel + ' .sm-lib-report').getBoundingClientRect();
      return { page: document.documentElement.scrollWidth, panel: panel.scrollWidth, panelClient: panel.clientWidth, imgW: ib.width, btnH: btn.height,
        pinsOut: [...document.querySelectorAll(sel + ' .sm-lib-pin')].filter((p) => { const b = p.getBoundingClientRect(); return b.left < ib.left - 1 || b.right > ib.right + 1; }).length };
    }, R);
    expect(m.page <= 360, 'page scrolls sideways: ' + m.page);
    expect(m.panel <= m.panelClient + 1, 'panel scrolls sideways: ' + m.panel + ' > ' + m.panelClient);
    expect(m.btnH >= 43.5 && m.pinsOut === 0, 'button ' + m.btnH + 'px, pins outside ' + m.pinsOut);
    await small.page.locator(R + ' .sm-visual').scrollIntoViewIfNeeded();
    await small.page.locator('#storyModal .sm-panel').screenshot({ path: path.join(OUT, 'library-360.png') });
    return `panel ${m.panelClient}px, picture ${Math.round(m.imgW)}px`;
  }, () => small && small.page);

  await record('l7', 'Venn diagram: two sets, intersection highlighted, elements in their regions', async () => {
    await tell(page, 'English', TOPICS.venn);
    const r = last(net);
    expect(r.status === 200 && r.story && r.story.visual && r.story.visual.type === 'venn', 'no venn: ' + JSON.stringify(r.story && r.story.visual));
    expect(r.headers['x-story-visual'] === 'model', 'X-Story-Visual ' + r.headers['x-story-visual']);
    const d = await page.evaluate((sel) => {
      const col = (c) => [...document.querySelectorAll(sel + ' .sm-venn-col.' + c + ' .sm-venn-item')].map((e) => e.textContent);
      const both = document.querySelector(sel + ' .sm-venn-both');
      const stage = document.querySelector(sel + ' .sm-venn-stage').getBoundingClientRect();
      return {
        labels: [...document.querySelectorAll(sel + ' .sm-venn-label')].map((e) => e.textContent),
        left: col('sm-venn-l'), mid: col('sm-venn-m'), right: col('sm-venn-r'),
        clip: both && both.getAttribute('clip-path'), fill: both && getComputedStyle(both).fill, ellipses: document.querySelectorAll(sel + ' .sm-venn-svg ellipse').length,
        stageH: stage.height, label: document.querySelector(sel + ' .sm-visual').getAttribute('aria-label'),
      };
    }, R);
    expect(d.labels.join('|') === 'tea|milk', 'labels: ' + d.labels.join('|'));
    expect(d.left.join() === 'Asha,Ravi' && d.mid.join() === 'Kiran' && d.right.join() === 'Meena', `regions: ${d.left} / ${d.mid} / ${d.right}`);
    expect(d.ellipses === 3 && /url\(#smVennClip\d+\)/.test(d.clip || ''), 'ellipses/clip: ' + d.ellipses + ' ' + d.clip);
    expect(d.fill !== 'rgb(0, 0, 0)' && d.fill !== 'none', 'intersection fill: ' + d.fill);
    expect(/Venn diagram/.test(d.label) && /Both: Kiran/.test(d.label), 'aria-label: ' + d.label);
    await page.locator(R + ' .sm-visual').scrollIntoViewIfNeeded();
    await page.locator(R + ' .sm-visual').screenshot({ path: path.join(OUT, 'library-venn.png') });
    await page.evaluate(() => closeStoryModal());
    return 'tea / both / milk, intersection ' + d.fill;
  }, page);

  await record('l8', 'bar model with item icons', async () => {
    await tell(page, 'English', TOPICS.bar);
    const r = last(net);
    expect(r.story && r.story.visual && r.story.visual.type === 'barModel' && r.story.visual.icon, 'no icon on the bar model: ' + JSON.stringify(r.story && r.story.visual));
    const rows = await page.$$eval(R + ' .sm-bm-icons', (es) => es.map((e) => [...e.textContent].filter((c) => c.trim()).length));
    expect(rows.join() === '5,7', 'icons per part: ' + rows.join());
    await page.locator(R + ' .sm-visual').screenshot({ path: path.join(OUT, 'library-bar-icons.png') });
    await page.evaluate(() => closeStoryModal());
    return `icon ${r.story.visual.icon}, parts ${rows.join('+')}`;
  }, page);

  await record('l9', 'a chain equation with a blank gets a picture (6 x 9 = 6 x 3 x ___ is 3 groups of 18)', async () => {
    await tell(page, 'English', TOPICS.chain);
    const r = last(net);
    expect(r.status === 200 && r.story, 'no story reply');
    expect(r.headers['x-story-visual'] === 'derived', 'X-Story-Visual ' + r.headers['x-story-visual']);
    const v = r.story.visual;
    expect(v && v.type === 'groups' && v.total === 54 && v.groups.join() === '18,18,18', 'visual: ' + JSON.stringify(v));
    const dots = await page.locator(R + ' .sm-dot, ' + R + ' .sm-icon').count();
    expect(dots === 54, 'items drawn: ' + dots);
    const cap = await page.textContent(R + ' .sm-visual figcaption');
    expect(/3 groups of 18/.test(cap) && !/undefined/.test(cap), 'caption: ' + cap);
    await page.evaluate(() => closeStoryModal());
    return '54 items, ' + cap.trim();
  }, page);

  await record('l10', 'the image is served as WebP with a day of caching', async () => {
    const r = await page.request.get(BASE + '/imglib/chromosome.webp');
    expect(r.status() === 200, 'status ' + r.status());
    expect(/image\/webp/.test(r.headers()['content-type'] || ''), 'content-type ' + r.headers()['content-type']);
    expect(/max-age=86400/.test(r.headers()['cache-control'] || ''), 'cache-control ' + r.headers()['cache-control']);
    const body = await r.body();
    expect(body.length > 2000 && body.length < 300000, 'size ' + body.length);
    return `${body.length} bytes`;
  }, page);

  // l11 (only with --live, one real model call, about 0.01 USD on a preview
  // with E2E_REPLAY=1): the real model picks the offered library picture for a
  // lesson it fits and explains the big idea in its own words.
  if (args.includes('--live')) {
    await record('l11', 'live: the model picks the library picture and writes the big idea in its own words', async () => {
      const LIVE = 'Class 8 science: a chromosome is made of two chromatids joined at a point called the centromere. DNA is wound around histone proteins to fit inside the nucleus.';
      await s.ctx.unroute(HW);
      await s.ctx.route(HW, (route) => route.continue({ headers: { ...route.request().headers(), 'x-e2e-mode': 'live' } }));
      await tell(page, 'English', LIVE);
      const r = last(net);
      expect(r.status === 200 && r.story, 'no story reply: ' + r.status);
      fs.writeFileSync(path.join(OUT, 'story-live-library.txt'), JSON.stringify(r.story, null, 2) + '\n');
      expect(r.headers['x-story-format'] === 'ok', 'X-Story-Format ' + r.headers['x-story-format']);
      expect(r.story.visual && r.story.visual.type === 'library' && r.story.visual.id === 'chromosome', 'visual: ' + JSON.stringify(r.story.visual));
      const big = r.story.scenes.find((x) => x.label === 'mathMoment').text;
      expect(!LIVE.includes(big.slice(0, 40)) && big.length < 420, 'scene 3 looks pasted: ' + big);
      await page.evaluate(() => closeStoryModal());
      return `library ${r.story.visual.id}, $${r.headers['x-model-usd'] || 0}, retry ${r.headers['x-story-retry']}`;
    }, page);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'library-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n[e2e:library] ${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log('  FAIL', f.id, f.name, '-', f.detail);
  process.exit(failed.length ? 1 : 0);
})();
