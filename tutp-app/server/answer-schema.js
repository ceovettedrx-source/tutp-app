// Answer Please: the model's reply is checked in code (docs/specs/answer-explain-v2.md
// section A) before a parent sees it. validateAnswer() returns
//   { ok: true, answer, fixed }   answer is the v2 reply the page renders
//   { ok: false, issues[] }       hard problems: the route asks the model once more, with these
// Hard problems: wrong shape, no questions when status is "ok", a question
// with no text or no usable block, an unknown block type, a steps block with
// no final answer, a compare table that is not 2 columns. Softer things are
// repaired quietly: q_type outside the list becomes "short", marks are
// resolved (printed marks win), keywords the answer does not contain are
// dropped, a bad diagram becomes null, plain arithmetic answers are
// recomputed (server/arith-check.js).
//
// The reply also carries `extracted_questions` (question, answer, reasoning,
// photo, box): the old page code and "Explain on photo" keep working from it,
// which is the rollback-friendly part of the ANSWER_V2_ENABLED flag.
// Unit tests: tests/unit/answer-schema.test.js.
import { Q_TYPES, resolveMarks } from './answer-marks.js';
import { solveArithmetic } from './arith-check.js';
import { buildDiagram } from './services/diagrams.js';
import { scriptOf, fontStack } from './lang-fonts.js';
import { checkBox, MAX_QUESTIONS } from './homework-boxes.js';
import { normalizeConceptKey, cleanScenePrompt } from './explain-schema.js';
import { foreignScriptIn, FOREIGN_SCRIPT_HINT } from './lang-check.js';

export const ANSWER_STATUSES = ['ok', 'unreadable', 'not_homework'];
const MAX_TEXT = 1200;
const MAX_ITEMS = 12;

const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = MAX_ITEMS) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, max) : []);

// Anthropic reply -> the JSON object in its first text block, or null.
export function extractAnswerJson(data) {
  const block = ((data && data.content) || []).find((b) => b && b.type === 'text');
  const text = block && typeof block.text === 'string' ? block.text : '';
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

function normalizeBlock(b, issues, where) {
  if (!b || typeof b !== 'object') { issues.push(`${where}: a block is not an object`); return null; }
  if (b.type === 'text') {
    const t = str(b.text);
    if (!t) { issues.push(`${where}: a text block has no text`); return null; }
    return { type: 'text', text: t };
  }
  if (b.type === 'compare_table') {
    const headers = strList(b.headers, 2);
    const rows = (Array.isArray(b.rows) ? b.rows : []).map((r) => (Array.isArray(r) ? r.map((c) => str(c, 400)) : [])).filter((r) => r.length === 2 && r[0] && r[1]).slice(0, MAX_ITEMS);
    if (headers.length !== 2 || rows.length < 2) { issues.push(`${where}: compare_table needs 2 headers and at least 2 rows of exactly 2 cells`); return null; }
    return { type: 'compare_table', headers, rows };
  }
  if (b.type === 'steps') {
    const final = str(b.final_answer, 400);
    if (!final) { issues.push(`${where}: a steps block has no final_answer`); return null; }
    const formula = (Array.isArray(b.formula) ? b.formula : []).map((f) => (typeof f === 'string'
      ? { text: str(f, 300), why_text: '' }
      : { text: str(f && f.text, 300), why_text: str(f && f.why_text, 500) })).filter((f) => f.text).slice(0, 6);
    return { type: 'steps', given: strList(b.given, 8), find: str(b.find, 300), formula, substitution: strList(b.substitution, 8), final_answer: final };
  }
  issues.push(`${where}: unknown block type ${JSON.stringify(b.type)}`);
  return null;
}

// Everything a parent could read as "the answer", for keyword and number checks.
export function answerText(blocks) {
  return blocks.map((b) => {
    if (b.type === 'text') return b.text;
    if (b.type === 'compare_table') return b.rows.map((r) => r.join(' ')).join(' ');
    return [...b.given, b.find, ...b.formula.map((f) => f.text), ...b.substitution, b.final_answer].join(' ');
  }).join(' ');
}

function lastNumber(s) {
  const m = String(s || '').replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/g);
  return m ? Number(m[m.length - 1]) : null;
}

// The final answer of a plain-arithmetic question, recomputed in code.
function fixArithmetic(qText, blocks) {
  const want = solveArithmetic(qText);
  if (want == null) return { blocks, checked: 0, fixed: 0 };
  const i = blocks.findIndex((b) => b.type === 'steps');
  const j = i >= 0 ? i : blocks.findIndex((b) => b.type === 'text');
  if (j < 0) return { blocks, checked: 0, fixed: 0 };
  const field = blocks[j].type === 'steps' ? 'final_answer' : 'text';
  const cur = blocks[j][field];
  if (lastNumber(cur) === want) return { blocks, checked: 1, fixed: 0 };
  const m = [...String(cur).matchAll(/-?\d+(?:\.\d+)?/g)].pop();
  const next = m ? cur.slice(0, m.index) + want + cur.slice(m.index + m[0].length) : String(want);
  const out = blocks.slice();
  out[j] = { ...blocks[j], [field]: next };
  return { blocks: out, checked: 1, fixed: 1 };
}

// What the old page code reads: one line of answer, one of reasoning.
function compatAnswer(blocks) {
  const steps = blocks.find((b) => b.type === 'steps');
  if (steps) return steps.final_answer;
  const table = blocks.find((b) => b.type === 'compare_table');
  if (table) return table.rows.map((r, i) => `${i + 1}. ${r[0]} | ${r[1]}`).join('\n');
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
}
function compatReasoning(blocks, note) {
  const steps = blocks.find((b) => b.type === 'steps');
  const why = steps && steps.formula.find((f) => f.why_text);
  return (why && why.why_text) || note || '';
}

// A page that teaches but has no questions (textbook text, notebook notes).
// Each main idea becomes a card shaped like a question (q_text = the idea's
// name, one text block = its summary, `context` = what Explain is asked about)
// so the page's cards, Explain buttons and concept signing work unchanged.
// `concept_explanation` carries the page text, which is what Notes please
// builds from; `extracted_questions` stays empty, so notes never fall back to
// the idea names.
const MAX_PAGE_TEXT = 1400;
function validateContent(raw, subject) {
  const pageText = str(raw.page_text, MAX_PAGE_TEXT);
  const list = (Array.isArray(raw.concepts) ? raw.concepts : []).slice(0, 4);
  const questions = [];
  for (const c of list) {
    const title = str(c && c.title, 200), summary = str(c && c.summary, 600);
    if (!title || !summary) continue;
    questions.push({
      q_text: title, q_type: 'short', marks: null,
      blocks: [{ type: 'text', text: summary }], keywords: [], diagram: null, unit_direction_note: '',
      script: scriptOf(title + ' ' + summary), context: (title + ': ' + summary).slice(0, 800),
      concept_key: normalizeConceptKey(c.concept_key),
      scene_prompt: cleanScenePrompt(c.scene_prompt),
    });
  }
  if (!questions.length && !pageText) return { ok: false, issues: ['a content page needs "concepts" (title and summary each) or "page_text"'] };
  if (!questions.length) {
    // Text but no usable idea: one card from the text itself, so Explain still works.
    const t = pageText.slice(0, 200);
    questions.push({
      q_text: subject || t.slice(0, 60), q_type: 'short', marks: null,
      blocks: [{ type: 'text', text: t }], keywords: [], diagram: null, unit_direction_note: '',
      script: scriptOf(pageText), context: pageText.slice(0, 800), concept_key: '',
    });
  }
  return { ok: true, fixed: 0, answer: {
    schema: 2, status: 'ok', mode: 'content', subject, questions, page_text: pageText,
    extracted_questions: [], concept_explanation: pageText || questions.map((q) => q.context).join(' ').slice(0, MAX_PAGE_TEXT),
    aditiApplicable: false, aditiHook: null,
  } };
}

// raw: the parsed model JSON. opts: { board, photos: [{ index, width, height }] }
// allowEmpty: a batch (questions 5-8) may have no questions at all.
export function validateAnswer(raw, { board = 'other', photos = [], allowEmpty = false } = {}) {
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['the reply is not a JSON object'] };
  const status = raw.status === undefined ? 'ok' : raw.status;
  if (!ANSWER_STATUSES.includes(status)) return { ok: false, issues: [`status must be one of ${ANSWER_STATUSES.join(', ')}`] };
  const subject = str(raw.subject, 60);
  if (status !== 'ok') {
    const retake = status === 'unreadable' ? str(raw.retake_text, 300) : '';
    return { ok: true, fixed: 0, answer: { schema: 2, status, mode: 'questions', subject, questions: [], extracted_questions: [], ...(retake ? { retake_text: retake } : {}) } };
  }
  if (raw.mode === 'content') return validateContent(raw, subject);
  const all = Array.isArray(raw.questions) ? raw.questions : null;
  if (all && !all.length && allowEmpty) {
    const more = Number.isInteger(raw.more_questions) && raw.more_questions > 0 && raw.more_questions < 1000 ? { more_questions: raw.more_questions } : {};
    return { ok: true, fixed: 0, answer: { schema: 2, status: 'ok', mode: 'questions', subject, questions: [], extracted_questions: [], ...more } };
  }
  if (!all || !all.length) return { ok: false, issues: ['"questions" must be a non-empty array when status is "ok" (use "unreadable" or "not_homework" otherwise)'] };

  const byPhoto = new Map((photos || []).map((p) => [p.index, p]));
  let fixed = 0;
  const questions = [];
  all.slice(0, MAX_QUESTIONS).forEach((q, i) => {
    const where = `question ${i + 1}`;
    if (!q || typeof q !== 'object') { issues.push(`${where}: not an object`); return; }
    const qText = str(q.q_text, 800);
    if (!qText) { issues.push(`${where}: q_text is empty`); return; }
    const rawBlocks = Array.isArray(q.blocks) ? q.blocks : [];
    let blocks = rawBlocks.map((b) => normalizeBlock(b, issues, where)).filter(Boolean);
    if (!rawBlocks.length) issues.push(`${where}: blocks is empty`);
    if (!blocks.length) return;
    const qType = Q_TYPES.includes(q.q_type) ? q.q_type : 'short';
    const arith = fixArithmetic(qText, blocks);
    blocks = arith.blocks; fixed += arith.fixed;
    const hay = answerText(blocks).toLowerCase();
    const keywords = [...new Set(strList(q.keywords, 8).filter((k) => k.length <= 60 && hay.includes(k.toLowerCase())))];
    const script = scriptOf(qText + ' ' + hay);
    let diagram = null;
    if (q.diagram && typeof q.diagram === 'object') {
      diagram = buildDiagram(q.diagram.template, q.diagram.params, { font: fontStack(script) });
    }
    const note = str(q.unit_direction_note, 300);
    const target = Number.isInteger(q.photo) ? byPhoto.get(q.photo) : null;
    const box = target ? checkBox(q.box, target) : null;
    questions.push({
      q_text: qText, q_type: qType,
      marks: resolveMarks({ questionText: qText, modelMarks: q.marks, qType, board }),
      blocks, keywords, diagram, unit_direction_note: note, script,
      concept_key: normalizeConceptKey(q.concept_key),
      // img1: a theory question gets a small picture; a numerical one keeps its SVG diagram.
      scene_prompt: qType === 'numerical' ? '' : cleanScenePrompt(q.scene_prompt),
      ...(box ? { photo: q.photo, box } : {}),
    });
  });
  if (!issues.length && foreignScriptIn(questions.map((q) => [q.q_text, q.blocks, q.keywords, q.unit_direction_note]))) issues.push(FOREIGN_SCRIPT_HINT);
  if (issues.length) return { ok: false, issues };
  if (!questions.length) return { ok: false, issues: ['no usable question'] };

  const answer = {
    schema: 2, status: 'ok', mode: 'questions', subject, questions,
    ...(all.length > MAX_QUESTIONS ? { more_questions: all.length - MAX_QUESTIONS }
      : Number.isInteger(raw.more_questions) && raw.more_questions > 0 && raw.more_questions < 1000 ? { more_questions: raw.more_questions } : {}),
    extracted_questions: questions.map((q) => ({
      question: q.q_text, answer: compatAnswer(q.blocks), reasoning: compatReasoning(q.blocks, q.unit_direction_note),
      ...(q.photo !== undefined ? { photo: q.photo, box: q.box } : {}),
    })),
    concept_explanation: null, aditiApplicable: false, aditiHook: null,
  };
  return { ok: true, answer, fixed };
}

// The one retry's hint.
export function answerCorrectionHint(issues) {
  return 'Your previous reply failed these checks: ' + issues.slice(0, 8).join('; ') + '. Reply again with the complete JSON in exactly the shape given, fixing them.';
}

// Batches of 4 answered in parallel (latency fallback, founder decision 7):
// the validated answers, in page order, as one. Subject from the first batch
// that has one; a status other than "ok" in the first batch wins.
export function mergeAnswers(list) {
  const first = list[0];
  if (!first || first.status !== 'ok' || first.mode === 'content') return first;
  const questions = list.flatMap((a) => a.questions || []).slice(0, MAX_QUESTIONS);
  const more = list.reduce((n, a) => n + (a.more_questions || 0), 0) + Math.max(0, list.flatMap((a) => a.questions || []).length - MAX_QUESTIONS);
  return {
    ...first, subject: (list.find((a) => a.subject) || first).subject, questions,
    extracted_questions: list.flatMap((a) => a.extracted_questions || []).slice(0, MAX_QUESTIONS),
    ...(more ? { more_questions: more } : {}),
  };
}
