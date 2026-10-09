// TUT-10 prompt caching + TUT-11 model-health alert (branch cost-health-v1).
//   node --test tests/unit/cost-health.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { promptParts, prepareSystem, systemText, cacheDecision, estimateTokens, MIN_CACHE_TOKENS } from '../../server/prompt-cache.js';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';
import { explainPrompt } from '../../server/prompts/explain-prompts.js';
import { notesPrompt } from '../../server/prompts/notes-prompts.js';
import { classifyFailure, reportModelFailure, initModelAlert, alertEmail } from '../../server/model-alert.js';
import { runModelHealth, modelHealthHandler, anthropicHealthBody, geminiHealthRequest, HEALTH_MAX_TOKENS } from '../../server/model-health.js';
import { logModelCall, initModelCost } from '../../server/model-cost.js';
import { cronAuthorized } from '../../server/cron-auth.js';

const LANGS = ['English', 'Telugu', 'Hindi', 'Tamil'];
const kids = [
  { childContext: 'Zorbaxia Qwerty · Class 3', text: 'first homework 2026-10-09 12:00:01', board: 'cbse', range: null, photos: [] },
  { childContext: 'Mumble Fnord · Class 9', text: 'other homework 31/12/2027 23:59:59', board: 'state', range: { from: 5, to: 8 }, photos: [{ index: 0, width: 800, height: 600 }] },
];
const builders = {
  answer: (lang, k) => buildHomeworkRequest({ feature: 'answer_v2', lang, childContext: k.childContext, text: k.text, attachments: [], photos: k.photos, extra: { board: k.board, range: k.range } }).system,
  story: (lang, k) => buildHomeworkRequest({ feature: 'storytelling', lang, childContext: k.childContext, text: k.text, attachments: [], libraryCandidates: lang === 'Telugu' ? ['animal-cell: about animal cell'] : [] }).system,
  notes: (lang, k) => notesPrompt({ lang, childContext: k.childContext }),
  explain: (lang, k) => explainPrompt({ lang, childContext: k.childContext, subject: k.text, qType: k.board, conceptKey: k.range ? 'c9-x-y' : '', arithmetic: !!k.range }),
};

// RISK 1: dynamic text before the breakpoint means no cache hits
test('risk 1: the static block is the same bytes for different children, languages, boards, ranges and texts', () => {
  for (const [name, build] of Object.entries(builders)) {
    const statics = new Set();
    for (const lang of LANGS) for (const k of kids) {
      const sys = build(lang, k);
      assert.ok(Array.isArray(sys) && sys.length === 2, `${name} is a two-block prompt`);
      statics.add(sys[0].text);
    }
    assert.equal(statics.size, 1, `${name}: static block differs between requests`);
  }
});

test('risk 1: nothing per-request is in the static block; all of it is in the dynamic block', () => {
  for (const [name, build] of Object.entries(builders)) {
    const [st, dyn] = build('Telugu', kids[0]);
    for (const needle of ['Zorbaxia', 'Qwerty', '2026-10-09', 'first homework', 'Class 3']) {
      assert.ok(!st.text.includes(needle), `${name}: static block holds "${needle}"`);
    }
    assert.match(dyn.text, /^THIS REQUEST\n/, name);
    assert.match(dyn.text, /The parent language is Telugu/, name);
    assert.ok(dyn.text.includes('Zorbaxia Qwerty'), `${name}: child missing from the dynamic block`);
    assert.ok(!/\b(19|20)\d\d-\d\d-\d\d\b|\d\d:\d\d:\d\d/.test(st.text), `${name}: static block holds a date or time`);
  }
});

test('risk 1: cache_control goes on the static block only, and a Haiku call gets one plain string', () => {
  const sys = builders.answer('Telugu', kids[0]);
  const sonnet = prepareSystem('claude-sonnet-5', sys);
  assert.equal(sonnet.length, 2);
  assert.deepEqual(sonnet[0].cache_control, { type: 'ephemeral' });
  assert.equal(sonnet[1].cache_control, undefined);
  assert.equal(sonnet[0].text, sys[0].text);
  assert.equal(sonnet[1].text, sys[1].text);
  const haiku = prepareSystem('claude-haiku-4-5', sys);
  assert.equal(typeof haiku, 'string');
  assert.equal(haiku, systemText(sys));
  assert.equal(typeof prepareSystem('claude-sonnet-5', 'plain string'), 'string');
  assert.equal(typeof prepareSystem('claude-future-9', sys), 'string');
});

test('risk 1: answer, explain, notes and story are each above the Sonnet 5 floor; the floor of Haiku 4.5 is not met', () => {
  for (const [name, build] of Object.entries(builders)) {
    const [st] = build('English', kids[0]);
    const d = cacheDecision('claude-sonnet-5', build('English', kids[0]));
    assert.equal(d.cache, true, `${name}: ${d.reason}`);
    assert.ok(estimateTokens(st.text) >= MIN_CACHE_TOKENS['claude-sonnet-5'], name);
    assert.equal(cacheDecision('claude-haiku-4-5', build('English', kids[0])).cache, false, name + ' on haiku');
  }
  assert.equal(cacheDecision('claude-sonnet-5', promptParts('short', 'dyn')).cache, false);
});

// RISK 2: the answer shape must not change because the prompt order did
test('risk 2: every reply key and rule each prompt asked for is still in the static block', () => {
  const need = {
    answer: ['"status"', '"questions"', 'q_text', 'q_type', 'blocks', 'keywords', 'diagram', 'unit_direction_note', 'concept_key', 'scene_prompt', 'compare_table', 'final_answer', 'retake_text', '"mode":"content"', 'photo', 'box'],
    explain: ['concept_key', 'quick', 'full', 'traps', 'misconception', 'parent_questions', 'check_question', 'correct_index', 'illustration', 'tip', '"answer"'],
    notes: ['title', 'key_idea', 'method', 'worked_example', 'key_terms', 'common_mistakes', 'remember', 'quick_check', 'tell_your_child', 'No LaTeX and no HTML'],
    story: ['scenes', 'tryTogether', 'parentPrompt', 'readMinutes', 'gradeSubjectTag', 'mathMoment', 'wrapUp', 'visual', 'equations', 'concept_key', 'scene_prompt', 'Panchpadi'],
  };
  for (const [name, keys] of Object.entries(need)) {
    const [st] = builders[name]('English', kids[0]);
    for (const k of keys.filter(Boolean)) assert.ok(st.text.includes(k), `${name} static lacks ${k}`);
  }
  // the batch scope and the box rule moved to the dynamic block and still arrive
  const dyn = builders.answer('English', kids[1])[1].text;
  assert.match(dyn, /questions 5 to 8/);
  assert.match(dyn, /attachment 0 is 800 x 600 pixels/);
  assert.match(builders.answer('English', kids[0])[1].text, /Answer every question, at most 8/);
});

// RISK 3: alert email storm
function fakeMailer() {
  const sent = [];
  let t = 1_000_000;
  return { sent, now: () => t, advance: (ms) => { t += ms; }, send: async (to, subject, text) => { sent.push({ to, subject, text }); } };
}
const credit = { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } };

test('risk 3: 50 credit errors at once send exactly one email', async () => {
  const m = fakeMailer();
  initModelAlert({ send: m.send, now: m.now, to: 'founder@example.com' });
  const results = await Promise.all(Array.from({ length: 50 }, () => reportModelFailure({ status: 400, data: credit, feature: 'answer_v2' })));
  assert.equal(m.sent.length, 1);
  assert.equal(results.filter((r) => r.sent).length, 1);
  assert.equal(m.sent[0].to, 'founder@example.com');
  assert.equal(m.sent[0].subject, 'Tut-P: Anthropic calls failing — credit balance too low');
});

test('risk 3: 50 errors spread over a minute send one; the next hour sends again; auth is its own reason', async () => {
  const m = fakeMailer();
  initModelAlert({ send: m.send, now: m.now });
  for (let i = 0; i < 50; i++) { await reportModelFailure({ status: 400, data: credit }); m.advance(1000); }
  assert.equal(m.sent.length, 1);
  await reportModelFailure({ status: 401, data: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  assert.equal(m.sent.length, 2);
  assert.match(m.sent[1].subject, /API key refused/);
  m.advance(61 * 60 * 1000);
  await reportModelFailure({ status: 400, data: credit });
  assert.equal(m.sent.length, 3);
});

test('risk 3: errors that are not billing or auth never email; a failed send is retried by the next failure', async () => {
  const m = fakeMailer();
  initModelAlert({ send: m.send, now: m.now });
  for (const status of [429, 500, 529]) await reportModelFailure({ status, data: { error: { type: 'overloaded_error', message: 'Overloaded' } } });
  assert.equal(m.sent.length, 0);
  assert.equal(classifyFailure(400, credit), 'billing');
  assert.equal(classifyFailure(403, 'forbidden'), 'auth');
  let fail = true; const sent = [];
  initModelAlert({ send: async (...a) => { if (fail) throw new Error('smtp down'); sent.push(a); }, now: m.now });
  const origErr = console.error; console.error = () => {};
  try { await reportModelFailure({ status: 400, data: credit }); fail = false; await reportModelFailure({ status: 400, data: credit }); } finally { console.error = origErr; }
  assert.equal(sent.length, 1);
});

test('risk 3: the database record limits the email across instances', async () => {
  const m = fakeMailer();
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: [{ event_name: 'alert.model' }] }) }) }) }) }), insert: async () => ({}) }) };
  initModelAlert({ send: m.send, now: m.now, supabase });
  const r = await reportModelFailure({ status: 400, data: credit });
  assert.equal(m.sent.length, 0);
  assert.equal(r.limited, true);
});

// RISK 4: the health endpoint
function fakeRes() { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; }

test('risk 4: /api/cron/model-health is 401 without the token or with a wrong one, and runs nothing', async () => {
  let ran = 0;
  const h = modelHealthHandler({ authorized: (req) => cronAuthorized(req.headers, 'the-real-token'), run: async () => { ran++; return { ok: true }; } });
  for (const headers of [{}, { 'x-cron-token': '' }, { 'x-cron-token': 'wrong' }]) {
    const res = fakeRes(); await h({ headers }, res);
    assert.equal(res.code, 401);
  }
  assert.equal(ran, 0);
  const ok = fakeRes(); await h({ headers: { 'x-cron-token': 'the-real-token' } }, ok);
  assert.equal(ok.code, 200); assert.equal(ran, 1);
  const bad = fakeRes(); await modelHealthHandler({ authorized: () => true, run: async () => ({ ok: false }) })({ headers: {} }, bad);
  assert.equal(bad.code, 503);
});

// RISK 5: the health check costs next to nothing
test('risk 5: one tiny Anthropic call, one tiny Gemini text call, no image generation', async () => {
  const body = anthropicHealthBody();
  assert.ok(body.max_tokens <= 5 && body.max_tokens === HEALTH_MAX_TOKENS);
  assert.equal(body.model, 'claude-haiku-4-5');
  const g = geminiHealthRequest('k');
  const gb = JSON.parse(g.init.body);
  assert.ok(gb.generationConfig.maxOutputTokens <= 5);
  assert.deepEqual(gb.generationConfig.responseModalities, ['TEXT']);
  assert.ok(!/image/i.test(g.url), 'image model in the Gemini health call');
  assert.ok(!/image/i.test(JSON.stringify(gb)));
  const calls = { claude: [], fetch: [] };
  const status = await runModelHealth({
    call: async (a) => { calls.claude.push(a); return { ok: true }; },
    fetchImpl: async (url, init) => { calls.fetch.push({ url, init }); return { status: 200 }; },
    env: { GEMINI_IMAGE_API_KEY: 'AIzaFAKE' }, send: async () => { throw new Error('must not email'); },
  });
  assert.equal(status.ok, true);
  assert.equal(calls.claude.length, 1);
  assert.equal(calls.claude[0].alert, false);
  assert.ok(calls.claude[0].body.max_tokens <= 5);
  assert.equal(calls.fetch.length, 1);
  assert.equal(status.emailed, false);
});

test('risk 5: emails only on a failure or an error rate above 10%', async () => {
  const sent = [];
  const send = async (to, subject, text) => { sent.push({ to, subject, text }); };
  const okCall = async () => ({ ok: true });
  const ok200 = async () => ({ status: 200 });
  const rows = (n, bad) => ({ from: () => ({ select: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: Array.from({ length: n }, (_, i) => ({ properties: { ok: i >= bad, replay: false } })) }) }) }) }) }) });
  let s = await runModelHealth({ call: okCall, fetchImpl: ok200, supabase: rows(100, 10), send, env: { GEMINI_IMAGE_API_KEY: 'k' } });   // exactly 10%
  assert.equal(s.ok, true); assert.equal(sent.length, 0);
  s = await runModelHealth({ call: okCall, fetchImpl: ok200, supabase: rows(100, 11), send, env: { GEMINI_IMAGE_API_KEY: 'k' } });   // 11%
  assert.equal(s.ok, false); assert.equal(sent.length, 1);
  s = await runModelHealth({ call: async () => ({ ok: false, status: 400 }), fetchImpl: ok200, send, env: {} });
  assert.equal(s.ok, false); assert.equal(sent.length, 2); assert.match(sent[1].text, /Anthropic test call FAILED \(HTTP 400\)/);
  s = await runModelHealth({ call: okCall, fetchImpl: async () => ({ status: 403 }), send, env: { GEMINI_IMAGE_API_KEY: 'k' } });
  assert.equal(s.ok, false); assert.match(sent[2].text, /Gemini test call FAILED \(HTTP 403\)/);
  s = await runModelHealth({ call: okCall, fetchImpl: ok200, supabase: rows(3, 3), send, env: {} });   // 3 of 3 failed but too few to be a rate
  assert.equal(s.ok, true);
});

// RISK 6: no secrets in emails or logs
test('risk 6: no key, token or prompt in the alert email, the health email or the log lines', async () => {
  const SECRETS = ['sk-ant-api03-SECRETKEYVALUE', 'AIzaSyFAKEGEMINIKEY', 'cron-token-value-123', 'PROMPT-TEXT-OF-A-CHILD'];   // fake values, secret-scan:allow
  const logged = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => logged.push(a.map(String).join(' '));
  const m = fakeMailer();
  try {
    initModelAlert({ send: m.send, now: m.now });
    // an upstream error body that echoes secrets back must not reach the email
    await reportModelFailure({ status: 401, data: { error: { type: 'authentication_error', message: `invalid x-api-key ${SECRETS[0]} for ${SECRETS[3]}` } }, feature: 'answer_v2' });
    await reportModelFailure({ status: 400, data: { error: { message: `credit balance is too low ${SECRETS[0]} ${SECRETS[3]}` } }, feature: 'notes' });
    const sent = [];
    await runModelHealth({
      call: async () => ({ ok: false, status: 401 }),
      fetchImpl: async () => { throw new Error(`network ${SECRETS[1]}`); },
      env: { GEMINI_IMAGE_API_KEY: SECRETS[1], CRON_TOKEN: SECRETS[2] },
      send: async (to, subject, text) => { sent.push(subject + '\n' + text); },
    });
    for (const text of [...m.sent.map((e) => e.subject + '\n' + e.text), ...sent, ...logged]) {
      for (const s of SECRETS) assert.ok(!text.includes(s), 'a secret leaked: ' + s.slice(0, 8));
    }
    assert.equal(m.sent.length, 2);
    assert.ok(sent.length === 1);
  } finally { Object.assign(console, orig); }
  assert.ok(!/sk-ant|AIza/.test(alertEmail('billing', { status: 400, feature: 'x', at: 0 }).text));
});

// logging of the cache counts
test('the model.call row keeps cache counts in properties and in the new columns only once the flag is set', () => {
  const inserted = [];
  initModelCost({ from: () => ({ insert: (row) => { inserted.push(row); return Promise.resolve({}); } }) });
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 };
  logModelCall({ feature: 'x', model: 'claude-sonnet-5', usage }, {});
  logModelCall({ feature: 'x', model: 'claude-sonnet-5', usage }, { USAGE_CACHE_COLUMNS: '1' });
  assert.equal(inserted[0].properties.cache_write, 2000);
  assert.ok(!('cache_creation_input_tokens' in inserted[0]), 'column named before the migration ran');
  assert.equal(inserted[1].cache_creation_input_tokens, 2000);
  assert.equal(inserted[1].cache_read_input_tokens, 0);
  const failed = logModelCall({ feature: 'x', model: 'claude-sonnet-5', usage: null, ok: false, status: 400 }, {});
  assert.equal(failed.ok, false); assert.equal(failed.status, 400);
  initModelCost(null);
});

// Found by the live A/B (2026-10-09): with the photo rule moved into the cached block, the model
// dropped "photo" and "box" until the request block restated them.
test('the request block restates photo and box when photos are listed, and only then', () => {
  const withPhoto = systemText(buildHomeworkRequest({ feature: 'answer_v2', lang: 'Telugu', childContext: 'A · Class 7', text: 'x', attachments: [], photos: [{ index: 0, width: 800, height: 600 }], extra: { board: 'state', range: null } }).system);
  const noPhoto = systemText(buildHomeworkRequest({ feature: 'answer_v2', lang: 'Telugu', childContext: 'A · Class 7', text: 'x', attachments: [], photos: [], extra: { board: 'state', range: null } }).system);
  assert.match(withPhoto, /MUST end with "photo":<attachment number>,"box":\[x1,y1,x2,y2\]/);
  assert.match(withPhoto, /attachment 0 is 800 x 600 pixels/);
  assert.doesNotMatch(noPhoto, /MUST end with "photo"/);
});
