// Singapore Maths Method page (TUT-43, docs/specs/TUT-43-singapore-maths.md section 2).
// Every word comes from GET /api/sgmath/strings (rows per language); no `if lang ===`
// anywhere, so a new language is rows only. Problems, judging and the free-week gate
// are all server-side; this page only draws and sends what the child did.
import { createBuilder } from '/app/singapore-maths/builder.js';

const qs = new URLSearchParams(location.search);
const ROLE = ['mother', 'father', 'family-member'].includes(qs.get('from')) ? qs.get('from') : 'mother';
const LANG_KEY = 'tutp_sgmath_lang';
const $ = (id) => document.getElementById(id);
const view = $('sgView');
let S = {};            // strings
let lang = 'en';
let studentId = '';

const t = (k, vars) => {
  let s = S[k] !== undefined ? S[k] : k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(String(b));
  return s;
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const button = (text, cls, onClick) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
// SVGs come from our server, built from numbers with every label escaped.
const svgBox = (svg) => { const d = el('div', 'sg-svg'); d.innerHTML = svg; return d; };

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* empty body */ }
  if (r.status === 401) { location.href = '/app/login/'; throw new Error('session'); }
  return { status: r.status, body: j || {} };
}

function show(...nodes) { view.replaceChildren(...nodes); window.scrollTo(0, 0); }
function message(text, extra = []) { show(el('p', 'sg-msg', text), ...extra); }
function backButton() { return button(t('page.back'), 'sg-btn sg-btn--ghost', () => { location.href = '/app/' + ROLE + '/'; }); }

async function loadStrings(code) {
  const r = await api('GET', '/api/sgmath/strings?lang=' + encodeURIComponent(code));
  if (r.status === 503) return false;
  S = r.body.strings || {};
  lang = r.body.lang || 'en';
  document.documentElement.lang = lang;
  $('sgTitle').textContent = t('page.title');
  $('sgSubtitle').textContent = t('page.subtitle');
  $('sgLangLabel').textContent = t('page.language');
  $('sgBack').textContent = t('page.back');
  document.title = t('page.title') + ' · Tut-P';
  return true;
}

async function loadLanguages() {
  const r = await api('GET', '/api/sgmath/languages');
  const sel = $('sgLang');
  sel.replaceChildren();
  for (const l of (r.body.languages || [])) { const o = el('option', '', l.label); o.value = l.code; sel.appendChild(o); }
  sel.value = lang;
  sel.onchange = () => { try { sessionStorage.setItem(LANG_KEY, sel.value); } catch (e) { /* private mode */ } location.reload(); };
}

// ---- entry ------------------------------------------------------------------
async function init() {
  $('sgBack').href = '/app/' + ROLE + '/';
  studentId = qs.get('studentId') || '';
  try { if (!studentId) studentId = sessionStorage.getItem('tutp_student_id') || ''; } catch (e) { /* private mode */ }
  let want = qs.get('lang') || '';
  try { want = want || sessionStorage.getItem(LANG_KEY) || 'en'; } catch (e) { want = want || 'en'; }
  if (!(await loadStrings(want))) { message('Singapore Maths is being set up. Please check again soon.'); return; }
  await loadLanguages();
  if (!studentId) { message(t('page.error'), [backButton()]); return; }
  const card = await api('GET', '/api/sgmath/card?studentId=' + encodeURIComponent(studentId));
  if (card.status !== 200) { message(t('page.error'), [backButton()]); return; }
  const c = card.body;
  if (c.state === 'locked') return showLocked();
  if (c.state === 'grade') return message(t('page.grade_not_supported'), [backButton()]);
  if (c.state === 'free_used') return showFreeUsed(c.maxBuyable);
  const start = button(c.state === 'free_left' ? t('card.free_left') : t('page.start'), 'sg-btn', startSession);
  start.id = 'sgStart';
  show(el('p', 'sg-lead', t('card.subtitle')), start);
}

function upgrade(source) {
  api('POST', '/api/sgmath/upgrade-click', { studentId, source }).catch(() => {});
  if (window.TutpBilling && window.TutpBilling.canPay) window.TutpBilling.choosePlan(studentId);
  else location.href = '/app/' + ROLE + '/';
}

async function showLocked() {
  const r = await api('GET', '/api/sgmath/preview?studentId=' + encodeURIComponent(studentId) + '&lang=' + lang);
  const box = el('section', 'sg-card');
  box.id = 'sgPreview';
  box.append(el('h2', 'sg-h2', r.body.title || t('page.preview_title')), el('p', 'sg-question', r.body.question || ''));
  if (r.body.svg) box.appendChild(svgBox(r.body.svg));
  const unlock = button(t('page.unlock_pro'), 'sg-btn', () => upgrade('free_preview'));
  unlock.id = 'sgUnlock';
  show(el('p', 'sg-msg', t('page.locked')), box, unlock, backButton());
}

function showFreeUsed(maxBuyable) {
  const parts = [el('p', 'sg-msg', t('page.free_used')), el('p', 'sg-lead', t('page.max_daily'))];
  if (maxBuyable) parts.push(button(t('page.get_max'), 'sg-btn', () => upgrade('free_used')));
  else parts.push(el('p', 'sg-note', t('page.max_coming')));
  parts.push(backButton());
  const wrap = el('div'); wrap.id = 'sgFreeUsed'; wrap.append(...parts);
  show(wrap);
}

// ---- session -------------------------------------------------------------------
let session = null;
let stepStarted = 0;

async function startSession() {
  const r = await api('POST', '/api/sgmath/session/start', { studentId, language: lang });
  if (r.status === 402) return showLocked();
  if (r.status === 409) return showFreeUsed(r.body.maxBuyable);
  if (r.status === 422) return message(t('page.grade_not_supported'), [backButton()]);
  if (r.status !== 200) return message(t('page.error'), [backButton()]);
  session = r.body.session;
  if (session.diagnostic && !session.pictorialStarted) {
    const begin = button(t('page.start'), 'sg-btn', beginPictorial);
    begin.id = 'sgBegin';
    return show(el('p', 'sg-lead', t('page.diagnostic')), begin);
  }
  if (!session.diagnostic && !session.concrete && !session.pictorialStarted) return showConcrete();
  return beginPictorial();
}

function stepBar(active) {
  const steps = session.diagnostic ? ['pictorial'] : ['concrete', 'pictorial', 'abstract'];
  const ol = el('ol', 'sg-steps');
  for (const s of steps) { const li = el('li', s === active ? 'is-on' : '', t('step.' + s)); ol.appendChild(li); }
  return ol;
}

function showConcrete() {
  const card = el('section', 'sg-card');
  card.id = 'sgConcrete';
  card.append(el('p', 'sg-question', session.concreteText || ''), el('p', 'sg-parent', t('concrete.parent')));
  const send = async (action) => { await api('POST', `/api/sgmath/session/${session.id}/concrete`, { action }); beginPictorial(); };
  const done = button(t('concrete.done'), 'sg-btn', () => send('done')); done.id = 'sgWeDidIt';
  const skip = button(t('concrete.skip'), 'sg-btn sg-btn--ghost', () => send('skipped')); skip.id = 'sgSkipConcrete';
  show(stepBar('concrete'), card, done, skip);
}

async function beginPictorial() {
  const r = await api('POST', `/api/sgmath/session/${session.id}/pictorial`);
  if (r.status === 409 && r.body.error === 'free_used') return showFreeUsed(r.body.maxBuyable);
  if (r.status !== 200) return message(t('page.error'), [backButton()]);
  const fresh = await api('GET', `/api/sgmath/session/${session.id}`);
  if (fresh.status === 200) session = fresh.body.session;
  nextOpenProblem();
}

function nextOpenProblem() {
  const i = session.problems.findIndex((p) => !(p.pictorial && p.pictorial.done) || (!session.diagnostic && !(p.abstract && p.abstract.done)));
  if (i < 0) return finish();
  const p = session.problems[i];
  if (p.pictorial && p.pictorial.done) return showAbstract(i, p.reveal);
  showPictorial(i);
}

function problemHead(i) {
  const p = session.problems[i];
  const head = el('div', 'sg-head');
  head.append(el('p', 'sg-count', t('page.problem_of', { i: i + 1, n: session.problems.length })), el('p', 'sg-question', p.question));
  head.querySelector('.sg-question').id = 'sgQuestion';
  return head;
}

function showPictorial(i) {
  const p = session.problems[i];
  const host = el('div', 'sg-builder'); host.id = 'sgBuilder';
  const feedback = el('div', 'sg-feedback'); feedback.id = 'sgFeedback'; feedback.setAttribute('aria-live', 'polite');
  const builder = createBuilder(host, { kind: p.kind, bars: p.bars, unit: p.unit, maxUnits: p.maxUnits, labelOptions: p.labelOptions, t });
  const check = button(t('build.check'), 'sg-btn', async () => {
    check.disabled = true;
    const r = await api('POST', `/api/sgmath/session/${session.id}/attempt`, { index: i, step: 'pictorial', built: builder.getBuilt(), ms: Date.now() - stepStarted });
    check.disabled = false;
    if (r.status !== 200) { feedback.replaceChildren(el('p', 'sg-bad', t('page.error'))); return; }
    const res = r.body;
    if (!res.done) {
      const list = el('ul', 'sg-reasons');
      for (const reason of [...new Set((res.reasons || []).filter(Boolean))]) list.appendChild(el('li', '', t('reason.' + reason)));
      feedback.replaceChildren(el('p', 'sg-bad', t('judge.try_again')), list);
      if (res.hint) feedback.appendChild(el('p', 'sg-hint', t('page.hint') + ': ' + res.hint));
      return;
    }
    p.pictorial = { done: true, correct: res.correct };
    p.reveal = res.reveal;
    const next = session.diagnostic
      ? button(i + 1 < session.problems.length ? t('page.next_problem') : t('page.finish'), 'sg-btn', () => nextOpenProblem())
      : button(t('abs.next'), 'sg-btn', () => showAbstract(i, res.reveal));
    next.id = 'sgNext';
    check.remove();
    feedback.replaceChildren(el('p', res.correct ? 'sg-good' : 'sg-bad', res.correct ? t('judge.correct') : t('judge.reveal')), svgBox(res.reveal), next);
  });
  check.id = 'sgCheck';
  stepStarted = Date.now();
  show(stepBar('pictorial'), problemHead(i), el('h2', 'sg-h2', t('build.title')), host, check, feedback);
}

function showAbstract(i, revealSvg) {
  const p = session.problems[i];
  const form = el('fieldset', 'sg-eqs'); form.id = 'sgEquations';
  form.appendChild(el('legend', 'sg-h2', t('abs.equation')));
  let chosen = '';
  p.equationOptions.forEach((e, k) => {
    const lab = el('label', 'sg-eq');
    const r = el('input'); r.type = 'radio'; r.name = 'eq'; r.value = e; r.id = 'sgEq' + k;
    r.addEventListener('change', () => { chosen = e; });
    lab.append(r, el('span', '', e));
    form.appendChild(lab);
  });
  const row = el('div', 'sg-answer');
  const lab = el('label', '', t('abs.answer')); lab.htmlFor = 'sgAnswer';
  const input = el('input'); input.id = 'sgAnswer'; input.inputMode = 'numeric'; input.autocomplete = 'off';
  row.append(lab, input, el('span', 'sg-unit', p.unitLabel || ''));
  const feedback = el('div', 'sg-feedback'); feedback.setAttribute('aria-live', 'polite'); feedback.id = 'sgAbsFeedback';
  const check = button(t('abs.check'), 'sg-btn', async () => {
    check.disabled = true;
    const r = await api('POST', `/api/sgmath/session/${session.id}/attempt`, { index: i, step: 'abstract', equation: chosen, answer: input.value, ms: Date.now() - stepStarted });
    check.disabled = false;
    if (r.status !== 200) { feedback.replaceChildren(el('p', 'sg-bad', t('page.error'))); return; }
    const res = r.body;
    if (!res.done) { feedback.replaceChildren(el('p', 'sg-bad', res.reason === 'equation' ? t('abs.wrong_equation') : t('abs.wrong_answer'))); return; }
    p.abstract = { done: true, correct: res.correct };
    check.remove();
    const last = i + 1 >= session.problems.length;
    const next = button(last ? t('page.finish') : t('page.next_problem'), 'sg-btn', () => nextOpenProblem());
    next.id = 'sgNext';
    feedback.replaceChildren(el('p', res.correct ? 'sg-good' : 'sg-bad', res.correct ? t('abs.correct') : t('abs.reveal', { answer: res.answer })), next);
  });
  check.id = 'sgAbsCheck';
  stepStarted = Date.now();
  show(stepBar('abstract'), problemHead(i), revealSvg ? svgBox(revealSvg) : el('div'), form, row, check, feedback);
}

async function finish() {
  const r = await api('POST', `/api/sgmath/session/${session.id}/finish`);
  if (r.status !== 200) return message(t('page.error'), [backButton()]);
  const f = r.body;
  const box = el('section', 'sg-card'); box.id = 'sgFinish';
  box.append(el('h2', 'sg-h2', t('finish.title')), el('p', '', t('finish.minutes', { m: f.minutes })), el('p', '', t('finish.model', { model: f.model })));
  if (f.replay) box.appendChild(svgBox(f.replay));
  box.appendChild(el('p', 'sg-lead', f.next || ''));
  show(box, button(t('finish.done'), 'sg-btn', () => { location.href = '/app/' + ROLE + '/'; }));
}

init().catch((e) => { if (e && e.message !== 'session') message('Something went wrong. Please try again.'); });
