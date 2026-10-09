// Feature inventory (TUT-19): every required element of every surface, in every language the
// app offers, or the release is blocked.
//
//   node tests/e2e/inventory.spec.js <base-url> [--headless]
//   (npm run test:e2e -- <base-url> runs it with the other specs)
//
// The list of elements is tests/e2e/inventory.json; each element is a data-inv="..." attribute in
// the page code (public/app/shared/explain-panel.js, notes-card.js). The list of languages is read
// from the app code (HOMEWORK_LANGUAGES), never typed here: a language without a sample below, or a
// surface without an entry, fails the run. No model call, no login, $0: the real page scripts of the
// preview run on canned server replies (one blank page, 360 px wide).
//   i1..i9   one test per language: Explain page (2 cards) and Notes card, each element present,
//            visible, not empty; text elements in the language's own script; the chrome labels in
//            that language (not the English fallback); no sideways scroll at 360 px; the context
//            picture once, on top, above the cards; print keeps each card whole; Arabic reads right to left
//   i10      the inventory file names every surface and each one's elements
//
// Output: tests/e2e/output/inventory-results.json. Exit 1 on any failure.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HOMEWORK_LANGUAGES } from '../../server/prompts/homework-prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/inventory.spec.js <base-url> [--headless]');
  process.exit(2);
}
const HEADLESS = args.includes('--headless');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const INVENTORY = JSON.parse(fs.readFileSync(path.join(__dirname, 'inventory.json'), 'utf8'));
const results = [];
const log = (...a) => console.log('[e2e:inventory]', ...a);

const LATIN = /[A-Za-zÀ-ÿ]/;
const SAMPLES = {
  English: { code: 'en', script: LATIN, steps: 'Take 9 and 3 step by step. The answer is 12.', tip: 'Count in jumps.' },
  Hindi: { code: 'hi', script: /[ऀ-ॿ]/, steps: 'पहले 9 लें और उसमें 3 जोड़ें। उत्तर 12 है।', tip: 'छलांग लगाकर गिनें।' },
  Telugu: { code: 'te', script: /[ఀ-౿]/, steps: 'ముందు 9 తీసుకుని దానికి 3 కలపండి. సమాధానం 12.', tip: 'దూకుతూ లెక్కించండి.' },
  Tamil: { code: 'ta', script: /[஀-௿]/, steps: '9 உடன் 3 ஐச் சேர்க்கவும். விடை 12.', tip: 'தாவிக் கணக்கிடுங்கள்.' },
  Marathi: { code: 'mr', script: /[ऀ-ॿ]/, steps: '9 मध्ये 3 मिळवा. उत्तर 12 आहे.', tip: 'उड्या मारत मोजा.' },
  Spanish: { code: 'es', script: LATIN, steps: 'Suma 9 y 3 paso a paso. La respuesta es 12.', tip: 'Cuenta en saltos.' },
  French: { code: 'fr', script: LATIN, steps: 'Additionne 9 et 3 pas à pas. La réponse est 12.', tip: 'Compte par bonds.' },
  German: { code: 'de', script: LATIN, steps: 'Addiere 9 und 3 Schritt für Schritt. Die Antwort ist 12.', tip: 'Zähle in Sprüngen.' },
  Arabic: { code: 'ar', script: /[؀-ۿ]/, steps: 'اجمع 9 و 3 خطوة بخطوة. الإجابة 12.', tip: 'عُدّ بالقفزات.' },
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" role="img" aria-label="diagram"><circle cx="50" cy="50" r="5" fill="#005bbf"/><text x="150" y="60" text-anchor="middle">9 + 3</text></svg>';
const QUESTIONS = ['9 + 3 = __', '6 × 9 = ?'];

function viewFor(sample, body) {
  const none = body.picture_slot === 'none';
  return {
    concept_key: 'c4-addition', ...(none ? {} : { picture_key: 'c4-addition-ctx' }), tier: 'pro', locked: false, checked: true, answer: '12',
    title: sample.tip, quick: sample.steps, full: sample.steps, tip: sample.tip, diagram: SVG,
    traps: [sample.tip, sample.tip, sample.tip], misconception: { text: sample.tip, source: 'model' },
    parent_questions: [{ q: sample.tip, expected_answer_hint: sample.tip }, { q: sample.tip, expected_answer_hint: sample.tip }],
    check_question: { q: sample.tip, options: ['1', '2', '3'], correct_index: 1, right_feedback: sample.tip, wrong_feedback: sample.tip },
    ...(none ? {} : { illustration: { status: 'pending', labels: [] } }),
  };
}

async function record(id, name, fn) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    log(id, 'PASS', detail || '');
  } catch (err) {
    results.push({ id, name, status: 'FAIL', detail: String(err.message || err).slice(0, 1500) });
    log(id, 'FAIL', err.message);
  }
}

// present, visible, not empty (a picture or diagram holds an element, the rest hold text)
async function checkElements(page, scope, names, problems, where) {
  for (const name of names) {
    const loc = page.locator(`${scope} [data-inv="${name}"], ${scope}[data-inv="${name}"]`);
    const n = await loc.count();
    if (!n) { problems.push(`${where}: missing ${name}`); continue; }
    const first = loc.first();
    if (!(await first.isVisible())) { problems.push(`${where}: ${name} is not visible`); continue; }
    const filled = await first.evaluate((e) => (e.innerText || '').trim().length > 0 || e.querySelector('svg,img,canvas,.tp-pic,button') !== null);
    if (!filled) problems.push(`${where}: ${name} is empty`);
  }
}

(async () => {
  log('base', BASE, 'languages from the app code:', HOMEWORK_LANGUAGES.join(', '));
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  let sample = SAMPLES.English;
  await page.route(BASE + '/__inventory', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0 8px"><div id="root"></div></body></html>' }));
  await page.route('**/api/illustration/**', (route) => route.fulfill({ contentType: 'application/json', body: '{"status":"pending"}' }));
  await page.route('**/api/answer-events', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/explain-please', (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* keep {} */ }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(viewFor(sample, body)) });
  });
  await page.goto(BASE + '/__inventory');
  for (const f of ['answer-cards', 'concept-picture', 'tts-listen', 'explain-panel', 'notes-card']) {
    await page.addScriptTag({ url: `${BASE}/app/shared/${f}.js` });
  }
  await page.waitForFunction(() => window.TutpExplain && window.TutpAnswer && window.TutpNotesCard && window.TutpListen && window.TutpPicture, null, { timeout: 20000 });

  const inv = INVENTORY.surfaces;
  for (const [i, lang] of HOMEWORK_LANGUAGES.entries()) {
    await record(`i${i + 1}`, `${lang}: every required element of Explain and Notes`, async () => {
      const s = SAMPLES[lang];
      if (!s) throw new Error(`no inventory sample for the language "${lang}" (add it to tests/e2e/inventory.spec.js and its headings to the pages)`);
      sample = s;
      const problems = [];

      // ---- Explain page: 2 cards, one context picture on top
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(({ questions, language }) => {
        const root = document.getElementById('root');
        root.innerHTML = '';
        const area = document.createElement('div');
        root.appendChild(area);
        window.TutpExplain.explainAll(area, { mode: 'questions', subject: 'Mathematics', questions: questions.map((q) => ({ q_text: q, q_type: 'short', script: 'latin' })) }, { studentId: 's1', language });
      }, { questions: QUESTIONS, language: lang });
      await page.locator('[data-inv="card.tip"]').nth(1).waitFor({ timeout: 15000 }).catch(() => {});
      const cards = await page.locator('[data-inv="card"]').count();
      if (cards !== QUESTIONS.length) problems.push(`explain: ${cards} cards for ${QUESTIONS.length} questions`);
      for (let c = 0; c < cards; c++) {
        await checkElements(page, `.ae-explain-card:nth-of-type(${c + 1})`, inv.explain.required.filter((n) => n !== 'picture'), problems, `explain card ${c + 1}`);
      }
      const pics = await page.locator('[data-inv="picture"]').count();
      if (pics !== 1) problems.push(`explain: ${pics} pictures on the page, expected exactly 1`);
      const order = await page.evaluate(() => {
        const pic = document.querySelector('.ae-page-picture [data-inv="picture"]');
        const first = document.querySelector('.ae-explain-card');
        return { inHost: !!pic, before: !!(pic && first && (pic.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)), inCard: !!document.querySelector('.ae-explain-card [data-inv="picture"]') };
      });
      if (!order.inHost || !order.before || order.inCard) problems.push(`explain: the picture is not on top once (${JSON.stringify(order)})`);
      for (const name of inv.explain.scriptText) {
        const txt = await page.locator(`.ae-explain-card [data-inv="${name}"]`).first().innerText().catch(() => '');
        if (!s.script.test(txt)) problems.push(`explain: ${name} is not in ${lang}'s script: "${txt.slice(0, 40)}"`);
      }
      const chrome = await page.evaluate(() => window.TUTP_EXPLAIN_MESSAGES);
      const markText = await page.locator('[data-inv="card.checked"]').first().innerText().catch(() => '');
      if (!chrome[s.code] || !markText.includes(chrome[s.code].checked)) problems.push(`explain: the checked mark is not in ${lang}: "${markText}"`);
      if (s.code !== 'en' && markText.includes(chrome.en.checked)) problems.push(`explain: the checked mark fell back to English in ${lang}`);
      if (s.code === 'ar') {
        const dirs = await page.$$eval('.ae-explain-card', (e) => e.map((x) => x.dir));
        if (!dirs.every((d) => d === 'rtl')) problems.push('explain: Arabic cards are not right to left');
      }
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (wide > 1) problems.push(`explain: sideways scroll of ${wide}px at 360 px`);
      await page.emulateMedia({ media: 'print' });
      const keep = await page.$$eval('.ae-explain-card', (e) => e.map((x) => getComputedStyle(x).breakInside));
      if (!keep.length || !keep.every((k) => k === 'avoid')) problems.push(`explain: print does not keep each card whole (${keep.join()})`);
      await page.emulateMedia({ media: 'screen' });

      // ---- Notes card
      await page.evaluate(({ language, code, steps, tip }) => {
        const root = document.getElementById('root');
        root.innerHTML = '';
        const data = { title: tip, key_idea: steps, method: [steps, steps], worked_example: { problem: '9 + 3 = __', steps: [steps], answer: '12' }, remember: tip, picture: { concept_key: 'c4-addition', status: 'pending' } };
        root.appendChild(window.TutpNotesCard.render(data, { lang: code }));
      }, { language: lang, code: s.code, steps: s.steps, tip: s.tip });
      await checkElements(page, '', inv.notes.required, problems, 'notes');
      for (const name of inv.notes.scriptText) {
        const txt = await page.locator(`[data-inv="${name}"]`).first().innerText().catch(() => '');
        if (!s.script.test(txt)) problems.push(`notes: ${name} is not in ${lang}'s script`);
      }
      const heads = await page.evaluate(() => window.TUTP_NOTES_MESSAGES);
      // the heading's own words: no icon ligature, and the page's upper-casing (CSS) ignored
      const stepsHead = (await page.locator('[data-inv="notes.steps"] h4').first().evaluate((h) => {
        const c = h.cloneNode(true);
        c.querySelectorAll('.material-symbols-outlined').forEach((x) => x.remove());
        return c.textContent;
      }).catch(() => '')).trim().toLowerCase();
      if (!stepsHead.includes(heads[s.code]['nd.method'].toLowerCase())) problems.push(`notes: the "How to do it" heading is not in ${lang}: "${stepsHead}"`);
      if (s.code !== 'en' && stepsHead.includes(heads.en['nd.method'].toLowerCase())) problems.push(`notes: the heading fell back to English in ${lang}`);
      const nwide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (nwide > 1) problems.push(`notes: sideways scroll of ${nwide}px at 360 px`);
      if (s.code === 'ar' && (await page.locator('.nd').first().getAttribute('dir')) !== 'rtl') problems.push('notes: Arabic is not right to left');

      // ---- Answer please card built by the math engine (TUT-28): answer line, checked mark, "Working" label
      await page.evaluate(({ language }) => {
        const root = document.getElementById('root');
        root.innerHTML = '';
        const area = document.createElement('div');
        root.appendChild(area);
        const q = { q_text: '24 + 29 + ____ = 10 + 14 + 29', q_type: 'short', marks: null, checked: true, keywords: [], script: 'latin', concept_key: 'c3-maths-sums',
          blocks: [{ type: 'steps', given: [], find: '', formula: [], substitution: ['24 + 29 + 0 = 10 + 14 + 29'], final_answer: '0' }] };
        window.TutpAnswer.render({ status: 'ok', mode: 'questions', subject: 'Mathematics', questions: [q] }, { area, language, studentId: 's1', childName: 'Asha' });
      }, { language: lang });
      await checkElements(page, '', inv.answer.required, problems, 'answer');
      const labels = await page.evaluate(() => window.TUTP_ANSWER_LABELS);
      const aMark = await page.locator('[data-inv="answer.card.checked"]').first().innerText().catch(() => '');
      const aLine = await page.locator('[data-inv="answer.card.answer"]').first().innerText().catch(() => '');
      if (!labels[s.code] || !aMark.includes(labels[s.code].checked)) problems.push(`answer: the checked mark is not in ${lang}: "${aMark}"`);
      if (!labels[s.code] || !aLine.includes(labels[s.code].answer)) problems.push(`answer: the Answer label is not in ${lang}: "${aLine}"`);
      if (s.code !== 'en' && (aMark.includes(labels.en.checked) || aLine.includes(labels.en.answer))) problems.push(`answer: a label fell back to English in ${lang}`);
      if (!/\b0\b/.test(aLine)) problems.push(`answer: the answer value 0 is missing: "${aLine}"`);
      const awide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (awide > 1) problems.push(`answer: sideways scroll of ${awide}px at 360 px`);

      if (problems.length) throw new Error(problems.join('; '));
      return `${cards} cards, ${inv.explain.required.length} explain + ${inv.notes.required.length} notes + ${inv.answer.required.length} answer elements ok`;
    });
  }

  await record(`i${HOMEWORK_LANGUAGES.length + 1}`, 'the inventory names every surface with its elements', async () => {
    for (const surface of ['answer', 'explain', 'notes', 'story', 'el']) {
      const e = inv[surface];
      if (!e || !Array.isArray(e.required) || !e.required.length) throw new Error('inventory has no elements for ' + surface);
    }
    const covered = Object.entries(inv).filter(([, v]) => v.coveredBy).map(([k, v]) => `${k}: ${v.coveredBy.join(' + ')}`);
    return 'asserted here: explain, notes, answer; also asserted by existing specs: ' + covered.join('; ');
  });

  console.log('[e2e:inventory] mode replay; model calls 0; model spend $0.0000');
  await browser.close();
  console.log('\nRESULTS (inventory)');
  for (const r of results) console.log(`${r.id}\t${r.status}\t${r.name}\t${r.detail}`);
  fs.writeFileSync(path.join(OUT, 'inventory-results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, 'spend-inventory.json'), JSON.stringify({ spec: 'inventory', mode: 'replay', calls: 0, usd: 0 }) + '\n');
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`[e2e:inventory] ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('[e2e:inventory] fatal', e); process.exit(1); });
