// Exam prep notes on a reviewed answer cache (round 4,
// docs/specs/round-4-exam-prep-pilot.md).
//
// A "note" is one mode of one chapter in one language for one board, named
// by its cache key. Each note has versions (answer_cache rows); at most one
// is `approved`, and parents are served only that one. Nothing is written
// on a parent's request: the founder starts every note from the admin page,
// each version goes through the gate. Approved automatically ('ai') only
// when every gate passed and Haiku wrote it; otherwise `needs_review`, and
// only the founder's Approve serves it ('founder'). Both are undoable
// decisions. No approved version -> "coming soon", never an error.
//
// Test notes (is_test) have keys of their own and are served only to test
// families (server/test-families.js); real families never see them.
import crypto from 'crypto';
import { getChapter } from './services/knowledgeGraph.js';
import { verifyMcqSections } from './services/lessonVerifier.js';
import { callClaude } from './anthropic.js';
import { MODELS, modelSettings } from './models.js';
import { checkFractionsIn } from './fraction-check.js';
import { PROMPT_VERSION, MODES, QUESTION_TAGS, BOARD_LABELS, buildGenerateRequest, buildCheckRequest } from './prompts/exam-prep-prompts.js';

export { MODES, BOARD_LABELS };
export const ALL_MODES = [...MODES, 'mind_map']; // mind map: drawn from key_points
export const FREE_MODES = ['revision_notes'];
export const LANGS = ['en', 'te'];
export const BOARDS = ['andhra-pradesh', 'telangana'];
export const PILOT = { grade: 5, subject: 'mathematics', chapter: 'Chapter 13: Fractions', chapterNumber: 13, title: 'Fractions' };
export const STATUSES = ['generating', 'needs_review', 'approved', 'needs_fix', 'rejected', 'superseded', 'failed'];
export const MAX_OPEN_SECONDS = 30 * 60;

// ---------------------------------------------------------------- pilot

export function classNumber(cls) {
  const m = String(cls || '').match(/^\s*(?:class|grade)?\s*(\d{1,2})\s*$/i);
  return m ? Number(m[1]) : null;
}

export function stateSlug(state) {
  const s = String(state || '').trim().toLowerCase().replace(/[\s_]+/g, ' ');
  if (s === 'andhra pradesh' || s === 'andhra-pradesh' || s === 'ap') return 'andhra-pradesh';
  if (s === 'telangana' || s === 'ts') return 'telangana';
  return null;
}

// Is this child in the pilot? cls/state from the students row; curriculum
// from the family's registration (children[].curriculum, may be absent).
// -> { eligible: true, board } | { eligible: false, reason }
export function pilotFor({ cls, state, curriculum }) {
  if (classNumber(cls) !== PILOT.grade) return { eligible: false, reason: 'class' };
  const board = stateSlug(state);
  if (!board) return { eligible: false, reason: 'state' };
  // The knowledge graph maps state textbooks only: CBSE, ICSE and the rest
  // get "coming soon".
  if (curriculum && !/state/i.test(String(curriculum))) return { eligible: false, reason: 'board' };
  return { eligible: true, board };
}

// ---------------------------------------------------------------- keys

// A short hash of the chapter's teaching content (skills, mistakes, key
// terms), so a knowledge graph change starts new notes. Mapping metadata
// (edition, sources) is left out on purpose.
export function kgVersion(chapter) {
  const content = chapter.components.map((c) => ({
    lc: c.learningComponent.id,
    en: c.learningComponent.statement_en,
    te: c.learningComponent.statement_te,
    ken: c.learningComponent.key_terms_en || [],
    kte: c.learningComponent.key_terms_te || [],
    m: c.misconceptions.map((m) => [m.id, m.error_pattern_en, m.teacher_move || '']),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12);
}

export function noteKey({ mode, board, grade, chapter, lang, promptVersion = PROMPT_VERSION, kgVersion: kv, isTest = false }) {
  const parts = [mode, board, grade, chapter, lang, promptVersion, kv];
  if (isTest) parts.push('test');
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// ---------------------------------------------------------------- gate

const str = (v) => typeof v === 'string' && v.trim().length > 0;
const strs = (a, min = 1) => Array.isArray(a) && a.length >= min && a.every(str);

// JSON shape and counts per mode -> { pass, errors, count }
export function checkShape(mode, c) {
  const errors = [];
  let count = null;
  if (!c || typeof c !== 'object') return { pass: false, errors: ['not a JSON object'], count };
  if (mode === 'revision_notes') {
    if (!str(c.title)) errors.push('title missing');
    if (!str(c.intro)) errors.push('intro missing');
    const s = Array.isArray(c.sections) ? c.sections : [];
    count = s.length;
    if (s.length < 2 || s.length > 4) errors.push(`${s.length} sections (2-4 expected)`);
    s.forEach((x, i) => { if (!x || !str(x.heading) || !strs(x.points)) errors.push(`section ${i + 1} incomplete`); });
    if (!strs(c.remember)) errors.push('remember list missing');
  } else if (mode === 'key_points') {
    const p = Array.isArray(c.points) ? c.points : [];
    count = p.length;
    if (p.length < 5 || p.length > 8) errors.push(`${p.length} key points (5-8 expected)`);
    p.forEach((x, i) => { if (!x || !str(x.heading) || !str(x.text)) errors.push(`point ${i + 1} incomplete`); });
    const f = Array.isArray(c.formulas) ? c.formulas : [];
    if (!f.length) errors.push('formula sheet missing');
    f.forEach((x, i) => { if (!x || !str(x.label) || !str(x.rule)) errors.push(`formula ${i + 1} incomplete`); });
  } else if (mode === 'flashcards') {
    const cards = Array.isArray(c.cards) ? c.cards : [];
    count = cards.length;
    if (cards.length < 10 || cards.length > 15) errors.push(`${cards.length} flashcards (10-15 expected)`);
    cards.forEach((x, i) => { if (!x || !str(x.front) || !str(x.back)) errors.push(`card ${i + 1} incomplete`); });
  } else if (mode === 'practice_questions') {
    const q = Array.isArray(c.questions) ? c.questions : [];
    count = q.length;
    if (q.length < 8 || q.length > 12) errors.push(`${q.length} questions (8-12 expected)`);
    q.forEach((x, i) => {
      const n = `question ${i + 1}`;
      if (!x || !str(x.question) || !str(x.answer)) { errors.push(`${n} incomplete`); return; }
      if (!QUESTION_TAGS.includes(x.tag)) errors.push(`${n}: tag "${x.tag}" is not one of ${QUESTION_TAGS.join(', ')}`);
      if (x.type === 'mcq') {
        if (!strs(x.options, 4) || x.options.length !== 4) errors.push(`${n}: needs 4 options`);
        else if (!x.options.includes(x.answer)) errors.push(`${n}: the answer is not one of the options`);
      } else if (x.type !== 'short') errors.push(`${n}: type must be mcq or short`);
    });
  } else {
    errors.push('unknown mode ' + mode);
  }
  return { pass: errors.length === 0, errors, count };
}

function allStrings(v) {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(allStrings);
  return [];
}

// Telugu letters as a share of all Telugu + Latin letters.
export function teluguShare(value) {
  const text = allStrings(value).join(' ');
  const te = (text.match(/[ఀ-౿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return te + latin === 0 ? 0 : te / (te + latin);
}

export function checkScript(lang, content) {
  if (lang !== 'te') return { pass: true, skipped: true };
  const share = Math.round(teluguShare(content) * 100) / 100;
  return { pass: share >= 0.85, share, errors: share >= 0.85 ? [] : [`only ${Math.round(share * 100)}% of the letters are Telugu script`] };
}

const words = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Runs of more than `max` words that also appear in a tier-3 source text.
export function checkCopied(content, tier3Texts, max = 12) {
  const n = max + 1;
  const grams = new Set();
  for (const t of tier3Texts || []) {
    const w = words(t);
    for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(' '));
  }
  const found = [];
  if (grams.size) {
    for (const s of allStrings(content)) {
      const w = words(s);
      for (let i = 0; i + n <= w.length; i++) {
        const g = w.slice(i, i + n).join(' ');
        if (grams.has(g)) { found.push(g); break; }
      }
    }
  }
  return { pass: found.length === 0, errors: found.map((g) => `copied from a restricted source: "${g}"`) };
}

export function checkFractionFacts(content) {
  const r = checkFractionsIn(content);
  return { pass: r.wrong.length === 0, checked: r.checked, errors: r.wrong.map((w) => `${w.reason} ("${w.text}")`) };
}

export function deterministicChecks(mode, lang, content, chapter) {
  return {
    shape: checkShape(mode, content),
    fractions: checkFractionFacts(content),
    script: checkScript(lang, content),
    copied: checkCopied(content, chapter.tier3Texts),
  };
}

export function gatePassed(checks) {
  return Object.values(checks || {}).every((c) => c && c.pass);
}

// First '{' to last '}' of the first text block, parsed; null if not JSON.
export function replyJson(data) {
  const block = ((data && data.content) || []).find((b) => b && b.type === 'text');
  const text = block && typeof block.text === 'string' ? block.text : '';
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

// The MCQs of a practice set in the form lessonVerifier reads.
export function mcqLesson(content) {
  const items = (content.questions || []).filter((q) => q && q.type === 'mcq' && Array.isArray(q.options))
    .map((q) => ({ text: `${q.question} ${q.options.map((o, i) => `(${'ABCD'[i]}) ${o}`).join(' ')} Correct answer: (${'ABCD'[q.options.indexOf(q.answer)] || '?'})` }));
  return { student_sections: [{ items }] };
}

// ---------------------------------------------------------------- writing

// Writes one note: Haiku, then Sonnet 5 once if the gate finds a problem.
// Never rejects and never approves by itself: the result is `needs_review`
// with every check's result (or `failed` when no model reply could be used),
// plus `autoApprove` (true only when every gate passed at Haiku's first
// attempt); saveWritten() acts on it.
//   call: { mode, recordings, cost, isTest } for callClaude (e2e replay,
//         cost total, test notes' calls kept out of the cost card)
//   deps: stand-ins for tests ({ callClaude, verifyMcqSections })
// -> { status, content, model, checks, error }
export async function writeNote({ mode, lang, chapter, fixReason = '', call = {}, deps = {} }) {
  const claude = deps.callClaude || callClaude;
  const verify = deps.verifyMcqSections || verifyMcqSections;
  const cost = call.cost || { usd: 0 };
  const base = { mode: call.mode || 'live', recordings: call.recordings || null, cost, variant: lang, isTest: !!call.isTest };
  const req = buildGenerateRequest({ mode, lang, chapter, fixReason });
  const attempts = [];
  const models = [MODELS.exam_prep_generate, MODELS.exam_prep_retry];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const r = await claude({
      ...base, feature: 'exam_prep_generate', attempt: i + 1,
      body: { model, ...modelSettings(model), max_tokens: 6000, system: req.system, messages: [{ role: 'user', content: req.user }] },
    });
    if (!r.ok) {
      attempts.push({ model, error: `model error ${r.status}` });
      return { status: 'failed', content: null, model, error: `model error ${r.status}: ${String(r.errText).slice(0, 300)}`, checks: { passed: false, attempts } };
    }
    const content = replyJson(r.data);
    const checks = content ? deterministicChecks(mode, lang, content, chapter) : { shape: { pass: false, errors: ['the reply was not valid JSON'] } };
    if (content) {
      checks.model_check = await modelCheck({ mode, lang, chapter, content, claude, base });
      checks.mcq_gates = mode === 'practice_questions' && checks.shape.pass
        ? await mcqGates(content, verify, base)
        : { pass: true, skipped: true };
    }
    attempts.push({ model, content, checks, passed: gatePassed(checks) });
    if (gatePassed(checks)) break;
  }
  const last = [...attempts].reverse().find((a) => a.content);
  if (!last) return { status: 'failed', content: null, model: attempts.at(-1).model, error: 'no usable reply', checks: { passed: false, attempts: attempts.map(({ content, ...a }) => a) } };
  // AI approval: every gate passed AND Haiku (attempt 1) wrote it. Sonnet's
  // retry, any failed check, or a version written for a needs-fix (the
  // founder already called that note wrong) waits for the founder.
  const autoApprove = !fixReason && attempts.length === 1 && last.passed === true && last.model === MODELS.exam_prep_generate;
  return {
    status: 'needs_review',
    autoApprove,
    content: last.content,
    model: last.model,
    checks: { passed: last.passed, final: last.checks, attempts: attempts.map(({ content, ...a }) => a) },
  };
}

async function modelCheck({ mode, lang, chapter, content, claude, base }) {
  const req = buildCheckRequest({ mode, lang, chapter, content });
  const model = MODELS.exam_prep_check;
  const r = await claude({
    ...base, feature: 'exam_prep_check', attempt: 1,
    body: { model, ...modelSettings(model), max_tokens: 2000, system: req.system, messages: [{ role: 'user', content: req.user }] },
  });
  if (!r.ok) return { pass: false, errors: [`check could not run (model error ${r.status})`] };
  const v = replyJson(r.data);
  if (!v || typeof v.correct !== 'boolean') return { pass: false, errors: ['the check reply was not valid JSON'] };
  const issues = Array.isArray(v.issues) ? v.issues.filter(str) : [];
  return {
    pass: v.correct && v.on_syllabus !== false && v.age_appropriate !== false,
    correct: v.correct, on_syllabus: v.on_syllabus, age_appropriate: v.age_appropriate, errors: issues,
  };
}

async function mcqGates(content, verify, base) {
  const lesson = mcqLesson(content);
  if (!lesson.student_sections[0].items.length) return { pass: true, skipped: true };
  try {
    const r = await verify(lesson, { mode: base.mode, recordings: base.recordings, cost: base.cost, variant: base.variant, isTest: base.isTest });
    if (!r.checked) return { pass: true, skipped: true };
    const failed = (r.details || []).filter((d) => !d.gate_a_pass || !d.gate_b_pass);
    return {
      pass: !!r.all_passed && failed.length === 0,
      errors: failed.map((d) => `${[!d.gate_a_pass && 'Gate A', !d.gate_b_pass && 'Gate B'].filter(Boolean).join(' + ')}: ${d.issue || d.item_text}`),
      suggestions: failed.filter((d) => d.corrected_item_text).map((d) => d.corrected_item_text),
    };
  } catch (err) {
    return { pass: false, errors: ['Gates A/B could not run: ' + String(err.message).slice(0, 200)] };
  }
}

// ---------------------------------------------------------------- store

// answer_cache / answer_cache_decisions through the Supabase client. Kept
// behind this small interface so the review rules below can be unit-tested
// with an in-memory store.
export function supabaseStore(supabase) {
  const one = async (q) => { const { data, error } = await q; if (error) throw error; return data; };
  return {
    version: (id) => one(supabase.from('answer_cache').select('*').eq('id', id).maybeSingle()),
    versions: (key) => one(supabase.from('answer_cache').select('*').eq('key', key).order('version', { ascending: false })),
    served: (key) => one(supabase.from('answer_cache').select('*').eq('key', key).eq('status', 'approved').maybeSingle()),
    insertVersion: (row) => one(supabase.from('answer_cache').insert(row).select('*').single()),
    update: (id, fields) => one(supabase.from('answer_cache').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()),
    decisions: (key) => one(supabase.from('answer_cache_decisions').select('*').eq('key', key).order('created_at', { ascending: false })),
    insertDecision: (row) => one(supabase.from('answer_cache_decisions').insert(row).select('*').single()),
    markUndone: (id) => one(supabase.from('answer_cache_decisions').update({ undone_at: new Date().toISOString() }).eq('id', id).select('*').single()),
    openReports: (versionId) => one(supabase.from('answer_cache_reports').select('*').eq('version_id', versionId).is('resolved_at', null)),
    // Null when this child already has an open report on this version.
    insertReport: async (row) => {
      const { data, error } = await supabase.from('answer_cache_reports').insert(row).select('*').single();
      if (error && error.code === '23505') return null;
      if (error) throw error;
      return data;
    },
    closeReports: (versionId, decisionId) => one(supabase.from('answer_cache_reports')
      .update({ resolved_at: new Date().toISOString(), resolved_by_decision: decisionId }).eq('version_id', versionId).is('resolved_at', null)),
    reopenReports: (decisionId) => one(supabase.from('answer_cache_reports')
      .update({ resolved_at: null, resolved_by_decision: null }).eq('resolved_by_decision', decisionId)),
  };
}

export class ReviewError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// A new version row for a key (version = last + 1), status `generating`.
export async function startVersion(store, note, { fixOf = null, fixReason = null } = {}) {
  const versions = await store.versions(note.key);
  const version = (versions[0]?.version || 0) + 1;
  return store.insertVersion({
    key: note.key, mode: note.mode, board: note.board, class: note.grade, chapter: note.chapter,
    language: note.lang, prompt_version: note.promptVersion, kg_version: note.kgVersion,
    version, status: 'generating', is_test: !!note.isTest, fix_of: fixOf, fix_reason: fixReason,
  });
}

// One founder decision on one version (never a list). Returns
// { decision, version, newVersion? }; for needs_fix the caller then writes
// newVersion (writeNote) and saves the result.
export async function decide(store, { versionId, action, reason, hide = false, confirm = false }) {
  if (typeof versionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(versionId)) {
    throw new ReviewError(400, 'one_version_only', 'Send exactly one version id.');
  }
  const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  const v = await store.version(versionId);
  if (!v) throw new ReviewError(404, 'not_found', 'No such version.');
  const base = { key: v.key, version_id: v.id, action, reason: why || null, hide: !!hide, status_before: v.status, is_test: v.is_test };

  if (action === 'approve') {
    if (!['needs_review', 'needs_fix', 'rejected'].includes(v.status)) throw new ReviewError(409, 'bad_status', `A ${v.status} version can't be approved.`);
    if (!v.content) throw new ReviewError(409, 'no_content', 'This version has no content.');
    return approveVersion(store, v, { by: 'founder', base });
  }
  if (action === 'keep') {
    // "This note is fine": closes parents' reports and makes the founder the
    // reviewer of an AI approval. Only on the version being served.
    if (v.status !== 'approved') throw new ReviewError(409, 'bad_status', `A ${v.status} version isn't being served.`);
    const open = await store.openReports(v.id);
    if (!open.length && v.reviewed_by !== 'ai') throw new ReviewError(409, 'nothing_to_keep', 'Nothing to keep: no reports and already reviewed by you.');
    const reviewedBefore = v.reviewed_by || null;
    const version = reviewedBefore === 'founder' ? v : await store.update(v.id, { reviewed_by: 'founder' });
    const decision = await store.insertDecision({ ...base, decided_by: 'founder', reviewed_by_before: reviewedBefore, status_after: 'approved' });
    await store.closeReports(v.id, decision.id);
    return { decision, version };
  }
  if (action === 'needs_fix') {
    if (!why) throw new ReviewError(400, 'reason_required', 'Please write what needs fixing.');
    if (!['approved', 'needs_review'].includes(v.status)) throw new ReviewError(409, 'bad_status', `A ${v.status} version can't be sent for a fix.`);
    // A served note stays served while it is fixed, unless "hide now".
    const after = v.status === 'approved' && !hide ? 'approved' : 'needs_fix';
    const version = after === v.status ? v : await store.update(v.id, { status: after });
    const newVersion = await startVersion(store, {
      key: v.key, mode: v.mode, board: v.board, grade: v.class, chapter: v.chapter, lang: v.language,
      promptVersion: v.prompt_version, kgVersion: v.kg_version, isTest: v.is_test,
    }, { fixOf: v.id, fixReason: why });
    const decision = await store.insertDecision({ ...base, status_after: after,
      other_version_id: newVersion.id, other_status_before: null, other_status_after: 'needs_review' });
    await store.closeReports(v.id, decision.id);
    return { decision, version, newVersion };
  }
  if (action === 'reject') {
    if (!why) throw new ReviewError(400, 'reason_required', 'Please write why it is rejected.');
    if (confirm !== true) throw new ReviewError(400, 'confirm_required', 'Please confirm the reject.');
    if (['rejected', 'superseded', 'generating'].includes(v.status)) throw new ReviewError(409, 'bad_status', `A ${v.status} version can't be rejected.`);
    const version = await store.update(v.id, { status: 'rejected' });
    const decision = await store.insertDecision({ ...base, status_after: 'rejected' });
    await store.closeReports(v.id, decision.id);
    return { decision, version };
  }
  throw new ReviewError(400, 'bad_action', 'Action must be approve, needs_fix, reject or keep.');
}

// Makes one version the served one (the one before it becomes superseded) and
// records who approved it: 'founder' (the review page) or 'ai' (every gate
// passed and Haiku wrote it). Both are ordinary decision rows, so Undo works
// on either.
export async function approveVersion(store, v, { by, base = null }) {
  const statusBefore = v.status;
  const prev = await store.served(v.key);
  if (prev) await store.update(prev.id, { status: 'superseded' });
  const version = await store.update(v.id, { status: 'approved', reviewed_by: by });
  const decision = await store.insertDecision({
    ...(base || { key: v.key, version_id: v.id, action: 'approve', reason: null, hide: false, status_before: statusBefore, is_test: v.is_test }),
    decided_by: by, status_after: 'approved',
    other_version_id: prev?.id || null, other_status_before: prev ? 'approved' : null, other_status_after: prev ? 'superseded' : null,
  });
  return { decision, version };
}

// Saves what writeNote returned on the version row, then approves it on the
// AI's say only when writeNote allows it (`autoApprove`).
export async function saveWritten(store, version, result, extraChecks = {}) {
  const saved = await store.update(version.id, {
    status: result.status, content: result.content, model: result.model, usd: result.usd || 0,
    checks: { ...result.checks, ...extraChecks },
  });
  if (result.status === 'needs_review' && result.autoApprove) {
    const r = await approveVersion(store, saved, { by: 'ai' });
    return { saved: r.version, decision: r.decision, autoApproved: true };
  }
  return { saved, autoApproved: false };
}

// A parent's "Report a mistake". The note keeps being served; the version
// shows in the founder's review list until the reports are closed.
export async function reportMistake(store, { key, studentId, familyId, message, isTest }) {
  const served = await store.served(key);
  if (!served) throw new ReviewError(404, 'not_served', 'No note is being served here.');
  const text = typeof message === 'string' ? message.trim().slice(0, 500) : '';
  const r = await store.insertReport({ version_id: served.id, key, family_id: familyId, student_id: studentId, message: text || null, is_test: !!isTest });
  return { versionId: served.id, duplicate: r === null };
}

// Two random Telugu notes approved by AI, fixed for the week. `candidates`:
// served Telugu versions that have an AI approval. Ranked by a hash of the
// version id and the week, so a refresh (or a Keep) doesn't change the pick.
export function weeklySample(candidates, weekStart, n = 2) {
  const rank = (id) => crypto.createHash('sha256').update(`${weekStart}|${id}`).digest('hex');
  return [...candidates].sort((a, b) => rank(a.id).localeCompare(rank(b.id))).slice(0, n);
}

// Reverts the latest decision on one note (key) that isn't undone yet.
export async function undoLatest(store, key) {
  const latest = (await store.decisions(key)).find((d) => !d.undone_at);
  if (!latest) throw new ReviewError(409, 'nothing_to_undo', 'Nothing to undo on this note.');
  if (latest.action === 'approve') {
    // Founder or AI approval alike: the version goes back to what it was, and
    // the version approved before it is served again.
    await store.update(latest.version_id, { status: latest.status_before, reviewed_by: null });
    if (latest.other_version_id) await store.update(latest.other_version_id, { status: 'approved' });
  } else if (latest.action === 'keep') {
    await store.update(latest.version_id, { reviewed_by: latest.reviewed_by_before });
  } else if (latest.action === 'needs_fix') {
    // The new version is kept, as superseded; nothing is deleted.
    if (latest.other_version_id) await store.update(latest.other_version_id, { status: 'superseded' });
    await store.update(latest.version_id, { status: latest.status_before });
  } else if (latest.action === 'reject') {
    if (latest.status_before === 'approved') {
      const served = await store.served(key);
      if (served && served.id !== latest.version_id) throw new ReviewError(409, 'other_served', 'Another version is served now.');
    }
    await store.update(latest.version_id, { status: latest.status_before });
  }
  await store.reopenReports(latest.id);
  return store.markUndone(latest.id);
}

// ---------------------------------------------------------------- chapter

export async function pilotChapter(board) {
  const ch = await getChapter(board, PILOT.grade, PILOT.subject, PILOT.chapter);
  return ch.sourced ? ch : null;
}

// Page facts for a board: title line, edition note, what the notes cover.
export function chapterInfo(chapter) {
  const mappings = chapter.components.map((c) => c.stateMapping);
  const unchecked = mappings.find((m) => m.edition_year && m.edition_checked_by_hand === false);
  return {
    board: chapter.state,
    boardLabel: BOARD_LABELS[chapter.state],
    title: `${PILOT.chapter} (${chapter.state === 'andhra-pradesh' ? 'AP' : 'TS'} State Board, Class ${PILOT.grade})`,
    editionNote: unchecked ? `Based on the ${unchecked.edition_year} edition` : null,
    covers: chapter.components.map((c) => ({ en: c.learningComponent.statement_en, te: c.learningComponent.statement_te })),
  };
}

export function noteFor({ chapter, mode, lang, isTest }) {
  const kv = kgVersion(chapter);
  return {
    key: noteKey({ mode, board: chapter.state, grade: PILOT.grade, chapter: PILOT.chapter, lang, kgVersion: kv, isTest }),
    mode, board: chapter.state, grade: PILOT.grade, chapter: PILOT.chapter, lang,
    promptVersion: PROMPT_VERSION, kgVersion: kv, isTest: !!isTest,
  };
}

// Minutes in one open: the visible seconds of its latest report, capped.
export function weekTotals(events) {
  const perOpen = new Map();
  const out = { minutes: 0, flashcards: 0, questions: 0, opens: 0 };
  for (const e of events) {
    const p = e.properties || {};
    if (e.event_name === 'exam_prep.opened') out.opens++;
    else if (e.event_name === 'exam_prep.flashcard_answered') out.flashcards++;
    else if (e.event_name === 'exam_prep.question_answered') out.questions++;
    else if (e.event_name === 'exam_prep.closed' && p.open_id) {
      const s = Math.min(MAX_OPEN_SECONDS, Math.max(0, Number(p.seconds) || 0));
      perOpen.set(p.open_id, Math.max(perOpen.get(p.open_id) || 0, s));
    }
  }
  out.minutes = Math.round([...perOpen.values()].reduce((a, b) => a + b, 0) / 60);
  return out;
}
