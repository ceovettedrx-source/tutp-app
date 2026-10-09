// Golden-set runner core (docs/specs/answer-explain-v2.md section 7). For each
// case it asks the model exactly the way the server does (same prompt
// builders, same request bodies, same validators and retry), then checks:
//   schema valid          server/answer-schema.js and explain-schema.js accept it
//   numerical correct     the worked-out value (and unit) is in the final answer
//   question types        difference -> compare_table, numerical -> steps block
//   keywords present      every answer that is not a one-word fill has at least one
//   scene prompt          no text instruction in it, the no-text suffix is always last
//   explain language      the parent commentary is written in the question's script
// mode 'replay' reads tests/e2e/recordings (no model spend); 'record' calls the
// model and saves the replies there (about $0.03 a case).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';
import { explainPrompt, explainUserText } from '../../server/prompts/explain-prompts.js';
import { runAnswer, answerRequestBody } from '../../server/answer-run.js';
import { explainRequestBody } from '../../server/routes/answer-explain.js';
import { validateExplain, IMAGE_SUFFIX, cleanScenePrompt } from '../../server/explain-schema.js';
import { extractAnswerJson } from '../../server/answer-schema.js';
import { callClaude } from '../../server/anthropic.js';
import { callWithJsonRetry } from '../../server/homework-reply.js';
import { scriptOf } from '../../server/lang-fonts.js';
import { notesModel, modelSettings } from '../../server/models.js';
import { normalizeNotes } from '../../server/notes-schema.js';
import { checkNotes as groundNotes, correctionHint } from '../../server/notes-ground.js';
import { answerText } from '../../server/answer-schema.js';

export const RECORDINGS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'recordings');
const TEXT_WORDS = /\b(text|texts|word|words|letter|letters|number|numbers|digit|digits|label|labels|caption|sign|signs|write|written|writing|alphabet)\b/i;

// Telugu and Devanagari digits -> 0-9, so a numeral style never fails a value check.
export function asciiDigits(s) {
  return String(s).replace(/[౦-౯]/g, (d) => d.charCodeAt(0) - 0x0C66).replace(/[०-९]/g, (d) => d.charCodeAt(0) - 0x0966);
}

function save(recs) {
  for (const rec of recs) {
    if (rec.status !== 200) continue;
    const f = path.join(RECORDINGS, `${rec.key}${rec.attempt > 1 ? '.' + rec.attempt : ''}.json`);
    fs.mkdirSync(RECORDINGS, { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ status: rec.status, data: rec.data }) + '\n');
  }
}

export async function runCase(c, { mode = 'replay' } = {}) {
  const cost = { usd: 0 };
  const recordings = [];
  const childContext = `Asha · ${c.cls}`;
  const { system, content } = buildHomeworkRequest({ feature: 'answer_v2', lang: c.lang, childContext, text: c.text, attachments: [], photos: [], extra: { board: c.board, range: null } });
  const callModel = async ({ range, hint, attempt }) => {
    const r = await callClaude({ feature: 'answer_v2', variant: c.lang + (range ? ':' + range.from + '-' + range.to : ''), attempt, mode, recordings, cost,
      body: answerRequestBody({ system, userContent: content, hint, range }) });
    return r.ok ? { ok: true, data: r.data } : { ok: false, status: r.status, errText: r.errText };
  };
  const ans = await runAnswer({ callModel, board: c.board, photos: [], batch: false });

  let explain = null, explainIssues = [];
  if (ans.kind === 'ok' && ans.answer.questions.length) {
    const q = ans.answer.questions[0];
    const exSystem = explainPrompt({ lang: c.lang, childContext, board: c.board, subject: c.subject, qType: q.q_type, conceptKey: q.concept_key });
    const baseContent = [{ type: 'text', text: explainUserText(q.context || q.q_text) }];
    let attempts = 0;
    const callEx = async (hint) => {
      const r = await callClaude({ feature: 'explain_v2', variant: c.lang, attempt: ++attempts, mode, recordings, cost, body: explainRequestBody({ system: exSystem, content: baseContent, hint }) });
      return r.ok ? { ok: true, data: r.data } : { ok: false, status: r.status, errText: r.errText };
    };
    const first = await callWithJsonRetry(() => callEx(null));
    if (first.kind === 'ok') {
      let v = validateExplain(extractAnswerJson(first.data));
      if (!v.ok) {
        const again = await callEx('Your previous reply failed these checks: ' + v.issues.join('; ') + '. Reply again with the complete JSON.');
        if (again.ok) v = validateExplain(extractAnswerJson(again.data));
      }
      if (v.ok) explain = v.explain; else explainIssues = v.issues;
    } else explainIssues = ['explain call failed: ' + first.kind];
  }
  // img1: "Notes please" for the cases that ask for it (c.notes), the same call as /api/homework-notes.
  let notes = null;
  if (c.notes && ans.kind === 'ok' && ans.answer.status === 'ok') {
    const text = ans.answer.mode === 'content' ? ans.answer.concept_explanation : ans.answer.extracted_questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
    const { system: nSystem, content: nContent } = buildHomeworkRequest({ feature: 'notes', lang: c.lang, childContext, text, attachments: [] });
    const model = notesModel(c.lang);
    const parse = (r) => {
      const block = r.ok ? (r.data.content || []).find((b) => b && b.type === 'text') : null;
      const t = block ? block.text : '';
      try { return normalizeNotes(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))); } catch { return null; }
    };
    const call = (attempt, userContent) => callClaude({ feature: 'notes', variant: c.lang, attempt, mode, recordings, cost,
      body: { model, ...modelSettings(model), max_tokens: 2500, system: nSystem, messages: [{ role: 'user', content: userContent }] } });
    notes = parse(await call(1, nContent));
    // the route's one retry (server/routes/chips.js), with the quality check's hint
    const first = notes ? groundNotes(notes, text) : null;
    if (first && !first.ok) {
      const again = parse(await call(1, [...nContent, { type: 'text', text: correctionHint(first.reasons, text) }]));
      if (again && groundNotes(again, text).reasons.length < first.reasons.length) notes = again;
    }
  }
  if (mode === 'record') save(recordings);
  return { ans, explain, explainIssues, notes, usd: cost.usd };
}

// The Latin-script term in brackets after a Telugu (or other) word: the bilingual key-term rule.
const BRACKET_TERM = /\([A-Za-z][A-Za-z -]{2,}\)/;

// -> { failures: [string], notes: [string] }
export function checkCase(c, run) {
  const failures = [];
  const { ans, explain } = run;
  if (ans.kind !== 'ok') return { failures: [`answer: ${ans.kind} ${ans.issues ? ans.issues.join('; ') : ''}`] };
  const a = ans.answer;
  if (a.status !== 'ok') return { failures: [`answer status ${a.status}`] };
  const qs = a.questions;
  if (!qs.length) failures.push('no questions');
  if (c.content) {
    // A page with no questions: idea cards and page text, nothing marked or keyworded.
    if (a.mode !== 'content') failures.push(`mode ${a.mode}, expected content`);
    if (!a.concept_explanation) failures.push('no page text for the notes');
    if (a.extracted_questions.length) failures.push('content page has extracted questions');
    if (c.about && !c.about.test(JSON.stringify(qs))) failures.push('cards do not mention the page');
    qs.forEach((q, i) => { const s = scriptOf(q.q_text + ' ' + q.context); if (s !== c.script) failures.push(`idea ${i + 1}: script ${s}, expected ${c.script}`); });
    if (!explain) failures.push('explain: ' + (run.explainIssues.join('; ') || 'none'));
    else if (c.pageScript && c.pageScript !== c.script) {
      // img1: a page in another language than the parent's: the parent text is bilingual.
      if (!BRACKET_TERM.test(qs.map((q) => q.q_text + ' ' + q.blocks.map((b) => b.text).join(' ')).join(' ') + ' ' + explain.quick + ' ' + explain.full)) failures.push('key terms are not bilingual (no bracketed term)');
    }
    if (c.notes) failures.push(...checkNotes(c, run));
    return { failures };
  }
  for (const e of c.expect) {
    const q = qs[e.q - 1];
    if (!q) { failures.push(`q${e.q}: missing`); continue; }
    const steps = q.blocks.find((b) => b.type === 'steps');
    const fin = asciiDigits(steps ? steps.final_answer : answerText(q.blocks));
    const nums = (fin.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (e.frac) { if (!fin.replace(/\s/g, '').includes(e.frac)) failures.push(`q${e.q}: expected ${e.frac}, got "${fin}"`); }
    else if (!nums.includes(e.value)) failures.push(`q${e.q}: expected ${e.value}, got "${fin}"`);
    if (e.unit && !e.unit.test(fin)) failures.push(`q${e.q}: unit missing in "${fin}"`);
  }
  for (const [n, t] of Object.entries(c.types || {})) {
    const q = qs[Number(n) - 1];
    if (!q) { failures.push(`q${n}: missing`); continue; }
    if (q.q_type !== t) failures.push(`q${n}: q_type ${q.q_type}, expected ${t}`);
    if (t === 'difference' && !q.blocks.some((b) => b.type === 'compare_table')) failures.push(`q${n}: difference without a compare_table`);
    if (t === 'numerical' && !q.blocks.some((b) => b.type === 'steps')) failures.push(`q${n}: numerical without steps`);
  }
  qs.forEach((q, i) => {
    // TUT-28: a card the math engine built (q.checked) has no exam keywords by design
    if (!['fill', 'mcq'].includes(q.q_type) && !q.checked && !q.keywords.length) failures.push(`q${i + 1}: no keywords`);
    if (!q.marks) failures.push(`q${i + 1}: no marks`);
    const inScript = scriptOf(q.q_text);
    const pageScript = c.pageScript || c.script;
    if (inScript !== pageScript) failures.push(`q${i + 1}: question script ${inScript}, expected ${pageScript}`);
  });
  if (!explain) failures.push('explain: ' + (run.explainIssues.join('; ') || 'none'));
  else {
    const sp = explain.illustration.scene_prompt;
    if (!sp.endsWith(IMAGE_SUFFIX)) failures.push('scene_prompt: no-text suffix missing');
    const body = sp.replace(IMAGE_SUFFIX, '');
    if (TEXT_WORDS.test(body) || /\d/.test(body)) failures.push('scene_prompt: still asks for text: ' + body);
    if (cleanScenePrompt(body) !== cleanScenePrompt(cleanScenePrompt(body))) failures.push('scene_prompt: not stable');
    const commentary = scriptOf(explain.quick + ' ' + explain.full);
    if (commentary !== c.script) failures.push(`explain: commentary script ${commentary}, expected ${c.script}`);
    for (const l of explain.illustration.labels) {
      if (scriptOf(l.text) !== c.script) failures.push(`explain: label "${l.text}" is not in the question's script (${c.script})`);
      if (c.script === 'latin' && /\b(ghar|dukaan|doori|visthapan)\b/i.test(l.text)) failures.push(`explain: label "${l.text}" is transliterated`);
    }
    if (new Set(explain.check_question.options).size !== 3) failures.push('explain: check options repeat');
    if (c.pageScript && c.pageScript !== c.script && !BRACKET_TERM.test(explain.quick + ' ' + explain.full)) failures.push('explain: key terms are not bilingual (no bracketed term)');
  }
  if (c.notes) failures.push(...checkNotes(c, run));
  return { failures };
}

// Notes please for a golden case: structured, in the parent's script, key terms bilingual
// when the page is in another language, and a picture concept.
function checkNotes(c, run) {
  const failures = [];
  const n = run.notes;
  if (!n) return ['notes: no usable structured notes'];
  const sc = scriptOf([n.title, n.key_idea, ...(n.method || [])].join(' '));
  if (sc !== c.script) failures.push(`notes: script ${sc}, expected ${c.script}`);
  if (c.pageScript && c.pageScript !== c.script && n.key_terms && !n.key_terms.some((t) => BRACKET_TERM.test(t.term))) failures.push('notes: key terms are not bilingual');
  if (!n.concept_key || !n.scene_prompt) failures.push('notes: no picture concept');
  return failures;
}
