// POST /api/explain-please with a stubbed database, model and image service (TUT-19).
//   node --test tests/unit/explain-route.test.js
// No network and no model spend: global fetch answers the Anthropic call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAnswerExplainRoutes, signConceptKey } from '../../server/routes/answer-explain.js';
import { parseQuestion } from '../../server/math-engine.js';

process.env.ANSWER_V2_ENABLED = '1';
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';   // secret-scan:allow (a dummy value for the stubbed model)
process.env.SESSION_SECRET = 'unit-test-secret';       // secret-scan:allow (a dummy value, signs nothing real)
delete process.env.E2E_REPLAY;

const LIVE = ['9 = 3 × __', '100 × 5 = 25 × __', '25 × 0 + 75 =', '6 × 9 = 6 × 3 × __', '9 + 3 = __', '31 × 0 =', '45 − 18 =', '8 ÷ 2 = ?'];

function makeEnv({ cls = 'Class 4', paid = true, wrongFirst = 0, alwaysWrong = false, conceptSlug = 'c4-multiplication' } = {}) {
  const rows = new Map();                       // explain_cache: 'key|language' -> row
  const events = [];
  const state = { cls, paid, modelCalls: 0, pictureCalls: [] };
  const supabase = {
    from(table) {
      const f = {};
      const b = {
        select() { return b; },
        eq(k, v) { f[k] = v; return b; },
        gte() { return b; },
        async maybeSingle() {
          if (table === 'explain_cache') {
            const row = rows.get(f.concept_key + '|' + f.language);
            return { data: row && row.prompt_version === f.prompt_version ? { payload: row.payload } : null };
          }
          if (table === 'students') return { data: { name: 'Asha', class: state.cls, state: 'andhra pradesh', family_id: 1 } };
          if (table === 'family_registrations') return { data: { data: { children: [{ name: 'Asha', curriculum: 'CBSE' }] } } };
          return { data: null };
        },
        async upsert(row, opts) {
          const k = row.concept_key + '|' + row.language;
          if (!(opts && opts.ignoreDuplicates && rows.has(k))) rows.set(k, row);
          return { error: null };
        },
        insert(row) { events.push(row); return Promise.resolve({ error: null }); },
      };
      return b;
    },
  };
  const illustrations = {
    async request(key, scene) { state.pictureCalls.push({ key, scene }); return { status: 'pending' }; },
    async status() { return { status: 'pending' }; },
  };
  const handlers = {};
  const app = { post: (p, ...h) => { handlers['POST ' + p] = h[h.length - 1]; }, get: (p, ...h) => { handlers['GET ' + p] = h[h.length - 1]; } };
  registerAnswerExplainRoutes(app, {
    rateLimit: () => (req, res, next) => next(), supabase,
    getSession: () => ({ familyId: 1 }), requireOwnStudent: async () => true, sendSessionExpired: () => {},
    getPaidStatusForStudents: async (ids) => Object.fromEntries(ids.map((i) => [i, { active: state.paid }])), illustrations,
  });

  // The model: works the question it is given, with the right answer unless told to be wrong.
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    state.modelCalls++;
    const q = body.messages[0].content[0].text.replace(/^Homework question: /, '');
    const hinted = body.messages[0].content.length > 1;
    const p = parseQuestion(q);
    const wrong = alwaysWrong || (state.modelCalls <= wrongFirst && !hinted);
    const ans = p ? (wrong ? String(Number(p.answerText) + 1) : p.answerText) : '';
    const reply = {
      concept_key: conceptSlug, title: 'Multiplication', quick: `Work out ${q}`,
      full: p ? `Take ${p.numbers.join(' and ')} step by step. The answer is ${ans}.` : 'Speed is distance divided by time.',
      tip: 'Count in jumps.', ...(p ? { answer: ans } : {}),
      traps: ['Do not add.', 'Check the zero.', 'Read the sign.'], misconception: 'Bigger numbers mean bigger answers.',
      parent_questions: [{ q: 'What is it?', expected_answer_hint: 'A product.' }, { q: 'Show me.', expected_answer_hint: 'Groups.' }],
      check_question: { q: 'Try 2 × 3.', options: ['5', '6', '8'], correct_index: 1, right_feedback: 'Yes.', wrong_feedback: 'No.' },
      illustration: { scene_prompt: 'A kirana shop with 5 apples. A mother and child near the shop.', labels: [] },
    };
    return { status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }) };
  };

  async function ask(question, over = {}) {
    const req = { body: { studentId: 's1', question, language: 'English', subject: 'Mathematics', qType: 'short', ...over }, get: () => '', headers: {} };
    return await new Promise((resolve) => {
      const res = { headers: {}, locals: {}, headersSent: false, statusCode: 200,
        set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; },
        json(b) { this.headersSent = true; resolve({ status: this.statusCode, headers: this.headers, json: b }); } };
      handlers['POST /api/explain-please'](req, res);
    });
  }
  return { ask, rows, events, state };
}

test('the 8 live questions, asked at once: 8 rows, each card has its own numbers, answer and "checked"', async () => {
  const env = makeEnv();
  const out = await Promise.all(LIVE.map((q) => env.ask(q)));
  assert.equal(env.rows.size, 8, 'eight cache rows');
  out.forEach((r, i) => {
    assert.equal(r.status, 200, LIVE[i]);
    const p = parseQuestion(LIVE[i]);
    assert.equal(r.json.checked, true, LIVE[i]);
    assert.equal(r.json.answer, p.answerText, LIVE[i]);
    for (const n of p.numbers) assert.ok(r.json.full.includes(n), `${LIVE[i]}: card lacks ${n}`);
    for (const other of LIVE.filter((_, j) => j !== i)) {
      const o = parseQuestion(other);
      if (o.numbers.join() !== p.numbers.join()) assert.notEqual(r.json.full, `Take ${o.numbers.join(' and ')} step by step. The answer is ${o.answerText}.`, 'card of another question');
    }
  });
  assert.equal(new Set(out.map((r) => r.json.full)).size >= 7, true, 'cards are not the same text');
});

test('the same question twice: the second is a cache hit with no model call', async () => {
  const env = makeEnv();
  await env.ask('6 × 9 = ?');
  const calls = env.state.modelCalls;
  const again = await env.ask('Q2.  6 x 9 = __');
  assert.equal(again.headers['X-Explain-Cache'], 'hit');
  assert.equal(env.state.modelCalls, calls);
  assert.equal(again.json.checked, true);
});

test('an old concept-only row is never read', async () => {
  const env = makeEnv();
  env.rows.set('c4-multiplication|English', { concept_key: 'c4-multiplication', language: 'English', prompt_version: 'explain-v2.3', payload: { concept_key: 'c4-multiplication', title: 'OLD', quick: 'OLD ROW', full: 'OLD ROW', traps: ['a', 'b', 'c'], parent_questions: [], check_question: { q: '', options: [], correct_index: 0 }, illustration: { scene_prompt: 'x', labels: [] } } });
  const r = await env.ask('7 × 8 = ?', { concept_key: 'c4-multiplication', concept_sig: signConceptKey('c4-multiplication') });
  assert.equal(r.headers['X-Explain-Cache'], 'miss');
  assert.ok(!/OLD ROW/.test(JSON.stringify(r.json)));
});

test('class band and language each get their own row', async () => {
  const env = makeEnv();
  await env.ask('6 × 9 = ?');
  env.state.cls = 'Class 7';
  await env.ask('6 × 9 = ?');
  await env.ask('6 × 9 = ?', { language: 'Telugu' });
  env.state.cls = '';
  await env.ask('6 × 9 = ?');
  assert.equal(env.rows.size, 4, 'class 4 / class 7 / telugu / unknown class');
});

test('a wrong model answer is retried with the right answer in the hint; a second wrong one is never shown or cached', async () => {
  const fixed = makeEnv({ wrongFirst: 1 });
  const ok = await fixed.ask('9 + 3 = __');
  assert.equal(ok.json.checked, true);
  assert.equal(ok.json.answer, '12');
  assert.equal(fixed.state.modelCalls, 2, 'one retry');

  const bad = makeEnv({ alwaysWrong: true });
  const r = await bad.ask('9 + 3 = __');
  assert.equal(r.status, 200);
  assert.equal(r.json.could_not_check, true);
  assert.ok(!('answer' in r.json) && !('full' in r.json) && !('checked' in r.json));
  assert.equal(bad.rows.size, 0, 'a card the engine could not confirm is not cached');
  assert.equal(bad.state.modelCalls, 2);
  assert.ok(bad.events.some((e) => e.event_name === 'explain.mismatch'), 'mismatch is flagged');
  const flag = bad.events.find((e) => e.event_name === 'explain.mismatch').properties;
  assert.ok(!('name' in flag) && !JSON.stringify(flag).includes('Asha'), 'no child name in the flag');
});

test('a word problem is explained, without a "checked" mark, answer line or diagram', async () => {
  const env = makeEnv();
  const r = await env.ask('A car travels 120 km in 2 hours. Find its average speed.');
  assert.equal(r.status, 200);
  assert.ok(!r.json.checked && !r.json.answer && !r.json.diagram);
});

test('free family: the "checked" mark but no answer line, diagram, tip or paid field', async () => {
  const env = makeEnv({ paid: false });
  const r = await env.ask('6 × 9 = ?');
  assert.equal(r.json.checked, true);
  for (const k of ['answer', 'diagram', 'tip', 'full', 'traps', 'check_question']) assert.ok(!(k in r.json), k);
  const pro = makeEnv({ paid: true });
  const p = await pro.ask('6 × 9 = ?');
  assert.equal(p.json.answer, '54');
  assert.match(p.json.diagram, /^<svg/);
  assert.equal((p.json.diagram.match(/<circle /g) || []).length, 54);
  assert.equal(p.json.tip, 'Count in jumps.');
});

test('pictures: Class 4 maths asks for ONE context picture (page slot only); Class 7, unknown class and the other slots ask for none', async () => {
  const c4 = makeEnv();
  const first = await c4.ask('6 × 9 = ?', { picture_slot: 'page' });
  for (const q of LIVE.slice(0, 5)) await c4.ask(q, { picture_slot: 'none' });
  assert.equal(c4.state.pictureCalls.length, 1, 'one image call for the page');
  assert.match(c4.state.pictureCalls[0].key, /-ctx$/);
  assert.equal(first.json.picture_key, c4.state.pictureCalls[0].key);
  assert.ok(!/\d|apple/i.test(c4.state.pictureCalls[0].scene.replace(/Only the setting[^]*$/, '')), 'scene: ' + c4.state.pictureCalls[0].scene);

  for (const cls of ['Class 7', 'Class 10', '']) {
    const e = makeEnv({ cls });
    const r = await e.ask('6 × 9 = ?', { picture_slot: 'page' });
    assert.equal(e.state.pictureCalls.length, 0, 'class "' + cls + '" makes no image call');
    assert.ok(!('illustration' in r.json), 'no picture slot for class "' + cls + '"');
    assert.match(r.json.diagram, /^<svg/, 'the diagram is still there');
  }
});

test('pictures: a non-maths question keeps its concept picture, whatever the class', async () => {
  for (const cls of ['Class 4', 'Class 7', '']) {
    const e = makeEnv({ cls, conceptSlug: 'c4-evs-water-cycle' });
    const r = await e.ask('Explain the water cycle.', { subject: 'EVS', picture_slot: 'none' });
    assert.equal(e.state.pictureCalls.length, 1, cls);
    assert.equal(e.state.pictureCalls[0].key, 'c4-evs-water-cycle');
    assert.ok(r.json.illustration);
  }
});

test('the e2e key suffix does not break the cache key (previews run with their own rows)', async () => {
  const env = makeEnv();
  const a = await env.ask('6 × 9 = ?');
  const b = await env.ask('6 × 8 = ?');
  assert.notEqual(a.json.full, b.json.full);
  assert.equal([...env.rows.keys()].every((k) => k.startsWith('q2:')), true);
});
