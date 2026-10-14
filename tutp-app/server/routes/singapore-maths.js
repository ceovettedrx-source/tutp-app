// Singapore Maths Method (TUT-43, docs/specs/TUT-43-singapore-maths.md).
//   GET  /api/sgmath/languages                enabled languages (rows of sgmath_languages)
//   GET  /api/sgmath/strings?lang=            one language's strings, English per missing key
//   GET  /api/sgmath/card?studentId=          the dashboard card's state for a child
//   GET  /api/sgmath/preview?studentId=&lang= Free tier: one static picture + question, no answer
//   POST /api/sgmath/session/start            { studentId, language } -> a session (or the open one)
//   GET  /api/sgmath/session/:id              resume a session
//   POST /api/sgmath/session/:id/concrete     { action: 'done' | 'skipped' }
//   POST /api/sgmath/session/:id/pictorial    the Pictorial step starts (a free session is used here)
//   POST /api/sgmath/session/:id/attempt      { index, step, built | equation + answer, ms }
//   POST /api/sgmath/session/:id/finish
//   GET  /api/sgmath/progress?studentId=      mastery map + weekly growth for the parent view
//   POST /api/sgmath/upgrade-click            { studentId, source }
//   POST /api/sgmath/e2e/reset                { studentId }: e2e only (E2E_REPLAY=1, test family)
//   GET  /api/admin/singapore-maths           founder figures, test families left out
//
// Everything that decides access or correctness is server-side: the tier comes from the
// payments table (tierForStudent), the week from the server clock, the problems from
// the server, and the answers never leave the server before the child is done.
// No model call anywhere in this release: hints are stored, problems are built in code.
import {
  gradeOf, gradeSupported, typesForGrade, problemById, problemText, barNames, concreteText, hintText, hintIsSafe,
  problemSvg, masteryByType, masteryLabel, chooseFocus, nextDifficulty, pickProblems, diagnosticProblems,
  weekStartIst, gateFor, weeklyGrowth, storyNumbers, MODEL_TYPES,
} from '../sgmath/core.js';
import { compareBuilt, LIMITS } from '../../public/app/shared/diagram/bar-model.js';
import { ENGLISH } from '../sgmath/strings-seed.js';
import { isTestFamily, testFamilyIds } from '../test-families.js';
import { PAID_PLANS, planBuyable } from '../billing-plans.js';
import { EVENTS } from '../../tracking/events.js';

const FEATURE = 'singapore_maths';
const DAY_MS = 24 * 60 * 60 * 1000;
const RESUME_MS = DAY_MS;
const MAX_TRIES = 3;
const PREVIEW_IDS = { low: 'part_whole-g2-d1-0', mid: 'comparison-g4-d1-0', high: 'fraction-g5-d1-0' };
const TIERS = ['free', 'pro', 'ultrapro', 'max'];

// The e2e suite can pick a child's tier, only on a preview with E2E_REPLAY=1 and only
// for a test family (production never has E2E_REPLAY, so the header is ignored there).
export async function e2eTier(req, familyId, env = process.env) {
  if (env.E2E_REPLAY !== '1' || !req || typeof req.get !== 'function') return null;
  const t = String(req.get('x-e2e-tier') || '').toLowerCase();
  if (!TIERS.includes(t)) return null;
  return (await isTestFamily(familyId)) ? t : null;
}

// What a child's build may contain (anything else is dropped before judging).
export function cleanBuilt(raw, spec) {
  if (!raw || !Array.isArray(raw.bars) || raw.bars.length !== spec.bars.length) return null;
  const bars = raw.bars.slice(0, LIMITS.maxBars).map((b) => {
    const segments = (Array.isArray(b && b.segments) ? b.segments : []).slice(0, LIMITS.maxSegments).map((g) => ({
      units: Math.round(Number(g && g.units)),
      ...(g && g.shaded ? { shaded: true } : {}),
      ...(g && g.label !== undefined && g.label !== null ? { label: String(g.label).slice(0, 12) } : {}),
    }));
    return { segments, ...(b && b.label !== undefined && b.label !== null ? { label: String(b.label).slice(0, 12) } : {}) };
  });
  return { bars };
}

export function registerSingaporeMathsRoutes(app, { rateLimit, supabase, getSession, requireOwnStudent, sendSessionExpired, sendForbidden, requireAdmin, tierForStudent, trackSessionStarted, trackSessionCompleted, trackSgmathEvent, now = () => Date.now() }) {
  const familyKey = (req) => 'family:' + String((getSession(req) || {}).familyId);
  const limiter = (max) => rateLimit({ windowMs: 10 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, keyGenerator: familyKey, message: { error: 'Too many requests, please wait a few minutes.' } });
  const readLimiter = limiter(600);
  const startLimiter = limiter(40);
  const writeLimiter = limiter(900);

  const needSession = (req, res) => {
    const s = getSession(req);
    if (!s) { sendSessionExpired(res); return null; }
    if (!s.familyId) { sendForbidden(res); return null; }
    return s;
  };

  // ---- readiness (migration 033) -------------------------------------------
  let ready = false;
  async function isReady() {
    if (ready || !supabase) return ready;
    const { error } = await supabase.from('sgmath_strings').select('key').limit(1);
    ready = !error;
    return ready;
  }
  const notReady = (res) => res.status(503).json({ error: 'not_ready', message: ENGLISH['page.not_ready'] });

  // ---- strings, cached 5 minutes per language ----------------------------------
  const cache = new Map();
  async function languages() {
    const hit = cache.get('__langs');
    if (hit && now() - hit.at < 300000) return hit.v;
    const { data, error } = await supabase.from('sgmath_languages').select('code, label, script, sort').eq('enabled', true).order('sort');
    if (error) throw error;
    cache.set('__langs', { v: data || [], at: now() });
    return data || [];
  }
  async function stringsFor(lang) {
    const hit = cache.get(lang);
    if (hit && now() - hit.at < 300000) return hit.v;
    const { data, error } = await supabase.from('sgmath_strings').select('lang, key, text').in('lang', [...new Set(['en', lang])]);
    if (error) throw error;
    const merged = { ...ENGLISH };
    for (const r of data || []) if (r.lang === 'en') merged[r.key] = r.text;
    for (const r of data || []) if (r.lang === lang && r.text) merged[r.key] = r.text;
    cache.set(lang, { v: merged, at: now() });
    return merged;
  }
  async function langOrEnglish(raw) {
    const code = String(raw || 'en').toLowerCase().slice(0, 3);
    const list = await languages();
    return list.some((l) => l.code === code) ? code : 'en';
  }

  async function studentGrade(studentId) {
    const { data, error } = await supabase.from('students').select('class').eq('id', studentId).maybeSingle();
    if (error) throw error;
    return gradeOf(data && data.class);
  }
  async function tierOf(req, session, studentId) {
    return (await e2eTier(req, session.familyId)) || (await tierForStudent(studentId, now()));
  }
  async function freeUsedThisWeek(studentId) {
    const { data, error } = await supabase.from('sgmath_sessions').select('id').eq('student_id', studentId)
      .eq('gate', 'free_weekly').eq('week_start', weekStartIst(now())).limit(1);
    if (error) throw error;
    return !!(data && data.length);
  }
  async function attemptsOf(studentId) {
    const { data, error } = await supabase.from('sgmath_attempts').select('problem_id, model_type, step, correct, done, difficulty, created_at')
      .eq('student_id', studentId).eq('done', true).order('created_at', { ascending: true }).limit(5000);
    if (error) throw error;
    return data || [];
  }
  const maxBuyable = () => planBuyable(PAID_PLANS.max_monthly);

  async function loadOwnSession(req, res) {
    const session = needSession(req, res); if (!session) return null;
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: 'bad_id' }); return null; }
    const { data, error } = await supabase.from('sgmath_sessions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'not_found' }); return null; }
    if (Number(data.family_id) !== Number(session.familyId)) { sendForbidden(res); return null; }
    return { session, row: data };
  }

  // What the page gets for a session: words, bar names, builder settings, choices.
  // Never the answer or the spec of a problem the child has not finished.
  async function sessionView(row) {
    const strings = await stringsFor(row.language);
    const { data: att, error } = await supabase.from('sgmath_attempts').select('problem_index, step, correct, done, tries').eq('session_id', row.id);
    if (error) throw error;
    const problems = (row.problems || []).map((pid, index) => {
      const p = problemById(pid);
      if (!p) return null;
      const pic = (att || []).find((a) => a.problem_index === index && a.step === 'pictorial');
      const abs = (att || []).find((a) => a.problem_index === index && a.step === 'abstract');
      const labelOptions = p.spec.kind === 'parts' || p.spec.kind === 'lengths'
        ? [...new Set([...storyNumbers(p).filter((n) => !(p.type === 'fraction' || p.type === 'ratio')), '?'].map(String))]
        : [];
      return {
        index, type: p.type, kind: p.spec.kind, difficulty: p.difficulty,
        question: problemText(p, strings),
        bars: barNames(p, strings),
        unit: p.spec.unit,
        maxUnits: LIMITS.maxUnitsPerBar,
        labelOptions,
        equationOptions: row.diagnostic ? [] : p.equationOptions,
        unitLabel: p.unitKey === 'rupees' ? strings.unit_rupees : strings['item.' + p.vars.item],
        pictorial: pic ? { done: pic.done, correct: pic.correct, tries: pic.tries } : null,
        abstract: abs ? { done: abs.done, correct: abs.correct, tries: abs.tries } : null,
        reveal: pic && pic.done ? problemSvg(p, strings, { reveal: true }) : null,
      };
    }).filter(Boolean);
    const first = problemById((row.problems || [])[0]);
    return {
      id: row.id, status: row.status, diagnostic: row.diagnostic, gate: row.gate, language: row.language,
      focus: row.focus_model_type, concrete: row.concrete, pictorialStarted: !!row.pictorial_started_at,
      concreteText: !row.diagnostic && first ? concreteText(first, strings) : null,
      problems,
    };
  }

  // ---- routes -------------------------------------------------------------------
  app.get('/api/sgmath/languages', readLimiter, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      res.set('Cache-Control', 'private, max-age=300');
      res.json({ languages: await languages() });
    } catch (err) { console.error('sgmath languages:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.get('/api/sgmath/strings', readLimiter, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      const lang = await langOrEnglish(req.query.lang);
      const all = await stringsFor(lang);
      const strings = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('tpl.') && !k.startsWith('hint.')));
      res.set('Cache-Control', 'private, max-age=300');
      res.json({ lang, strings });
    } catch (err) { console.error('sgmath strings:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.get('/api/sgmath/card', readLimiter, async (req, res) => {
    try {
      const studentId = String(req.query.studentId || '');
      const session = await requireOwnStudent(req, res, studentId); if (!session) return;
      if (!(await isReady())) return notReady(res);
      const tier = await tierOf(req, session, studentId);
      const gate = gateFor(tier);
      const grade = await studentGrade(studentId);
      let state = gate === 'locked' ? 'locked' : 'start';
      if (gate === 'free_weekly') state = (await freeUsedThisWeek(studentId)) ? 'free_used' : 'free_left';
      if (gate !== 'locked' && !gradeSupported(grade)) state = 'grade';
      const { count, error } = await supabase.from('sgmath_sessions').select('id', { count: 'exact', head: true }).eq('student_id', studentId).eq('status', 'completed');
      if (error) throw error;
      res.set('Cache-Control', 'no-store');
      res.json({ tier, gate, state, grade, hasProgress: (count || 0) > 0, maxBuyable: maxBuyable() });
    } catch (err) { console.error('sgmath card:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  // Free tier: one fixed picture per grade band. Picture and question only.
  app.get('/api/sgmath/preview', readLimiter, async (req, res) => {
    try {
      const studentId = String(req.query.studentId || '');
      const session = await requireOwnStudent(req, res, studentId); if (!session) return;
      if (!(await isReady())) return notReady(res);
      const grade = (await studentGrade(studentId)) || 1;
      const p = problemById(grade <= 2 ? PREVIEW_IDS.low : grade <= 4 ? PREVIEW_IDS.mid : PREVIEW_IDS.high);
      const strings = await stringsFor(await langOrEnglish(req.query.lang));
      res.set('Cache-Control', 'private, max-age=300');
      res.json({ title: strings['page.preview_title'], question: problemText(p, strings), svg: problemSvg(p, strings, { reveal: false }) });
    } catch (err) { console.error('sgmath preview:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/sgmath/session/start', startLimiter, async (req, res) => {
    try {
      const studentId = String((req.body || {}).studentId || '');
      const session = await requireOwnStudent(req, res, studentId); if (!session) return;
      if (!(await isReady())) return notReady(res);
      const language = await langOrEnglish((req.body || {}).language);
      const grade = await studentGrade(studentId);
      const gate = gateFor(await tierOf(req, session, studentId));
      if (gate === 'locked') return res.status(402).json({ error: 'locked' });
      if (!gradeSupported(grade)) return res.status(422).json({ error: 'grade_not_supported', grade });

      // An open session from the last 24 hours is resumed; it does not use another free one.
      const since = new Date(now() - RESUME_MS).toISOString();
      const { data: open, error: oErr } = await supabase.from('sgmath_sessions').select('*').eq('student_id', studentId)
        .eq('status', 'open').gte('started_at', since).order('started_at', { ascending: false }).limit(1);
      if (oErr) throw oErr;
      if (open && open.length && open[0].gate === gate) {
        const view = await sessionView({ ...open[0], language });
        if (open[0].language !== language) await supabase.from('sgmath_sessions').update({ language }).eq('id', open[0].id);
        return res.json({ session: view, resumed: true });
      }
      if (gate === 'free_weekly' && (await freeUsedThisWeek(studentId))) {
        return res.status(409).json({ error: 'free_used', maxBuyable: maxBuyable() });
      }

      const attempts = await attemptsOf(studentId);
      const focus = chooseFocus(grade, attempts);
      const seed = studentId + '|' + new Date(now()).toISOString().slice(0, 10);
      let problems;
      if (focus.diagnostic) problems = diagnosticProblems(grade, seed);
      else {
        const recent = {};
        for (const a of attempts) recent[a.problem_id] = Math.max(recent[a.problem_id] || 0, Date.parse(a.created_at));
        problems = pickProblems({ type: focus.type, grade, difficulty: nextDifficulty(attempts, focus.type), recent, seed, now: now() });
      }
      const { data: row, error } = await supabase.from('sgmath_sessions').insert({
        family_id: session.familyId, student_id: studentId, focus_model_type: focus.diagnostic ? 'diagnostic' : focus.type,
        diagnostic: !!focus.diagnostic, gate, language, problems,
      }).select('*').single();
      if (error) throw error;
      trackSessionStarted(session.familyId, studentId, { feature: FEATURE, language });
      res.json({ session: await sessionView(row), resumed: false });
    } catch (err) { console.error('sgmath start:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.get('/api/sgmath/session/:id', readLimiter, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      const own = await loadOwnSession(req, res); if (!own) return;
      res.set('Cache-Control', 'no-store');
      res.json({ session: await sessionView(own.row) });
    } catch (err) { console.error('sgmath session:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  // "We did it" is the parent's signal (TUT-20 reads it). It is recorded with the
  // signed-in viewer key from the session cookie; without one it is not participation.
  app.post('/api/sgmath/session/:id/concrete', writeLimiter, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      const own = await loadOwnSession(req, res); if (!own) return;
      const action = (req.body || {}).action === 'done' ? 'done' : 'skipped';
      if (own.row.diagnostic) return res.status(400).json({ error: 'no_concrete_step' });
      if (own.row.concrete) return res.json({ ok: true, concrete: own.row.concrete });
      const viewerKey = own.session.viewerKey || null;
      const { error } = await supabase.from('sgmath_sessions').update({ concrete: action, concrete_viewer_key: viewerKey }).eq('id', own.row.id).is('concrete', null);
      if (error) throw error;
      trackSgmathEvent(EVENTS.SGMATH_CONCRETE_DONE, own.session.familyId, own.row.student_id, { viewer_key: viewerKey, skipped: action === 'skipped', participation: action === 'done' && !!viewerKey });
      res.json({ ok: true, concrete: action });
    } catch (err) { console.error('sgmath concrete:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  // The Pictorial step starts: for a free session, this is where the week's free
  // session is used. The partial unique index makes a second one fail (409).
  app.post('/api/sgmath/session/:id/pictorial', writeLimiter, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      const own = await loadOwnSession(req, res); if (!own) return;
      const row = own.row;
      if (row.status !== 'open') return res.status(409).json({ error: 'not_open' });
      if (row.pictorial_started_at) return res.json({ ok: true });
      const patch = { pictorial_started_at: new Date(now()).toISOString() };
      if (row.gate === 'free_weekly') patch.week_start = weekStartIst(now());
      const { data, error } = await supabase.from('sgmath_sessions').update(patch).eq('id', row.id).is('pictorial_started_at', null).select('id');
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'free_used', maxBuyable: maxBuyable() });
        throw error;
      }
      if (row.gate === 'free_weekly' && data && data.length) trackSgmathEvent(EVENTS.SGMATH_FREE_USED, own.session.familyId, row.student_id, { week_start: patch.week_start });
      res.json({ ok: true });
    } catch (err) { console.error('sgmath pictorial:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/sgmath/session/:id/attempt', writeLimiter, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      const own = await loadOwnSession(req, res); if (!own) return;
      const row = own.row;
      const body = req.body || {};
      const index = Number(body.index);
      const step = body.step === 'abstract' ? 'abstract' : body.step === 'pictorial' ? 'pictorial' : null;
      if (row.status !== 'open') return res.status(409).json({ error: 'not_open' });
      if (!row.pictorial_started_at) return res.status(409).json({ error: 'pictorial_not_started' });
      if (!step || !Number.isInteger(index) || index < 0 || index >= (row.problems || []).length) return res.status(400).json({ error: 'bad_request' });
      if (step === 'abstract' && row.diagnostic) return res.status(400).json({ error: 'no_abstract_step' });
      const p = problemById(row.problems[index]);
      if (!p) return res.status(400).json({ error: 'bad_problem' });

      const { data: rows, error: rErr } = await supabase.from('sgmath_attempts').select('*').eq('session_id', row.id).eq('problem_index', index);
      if (rErr) throw rErr;
      const prev = (rows || []).find((a) => a.step === step);
      const pic = (rows || []).find((a) => a.step === 'pictorial');
      if (step === 'abstract' && !(pic && pic.done)) return res.status(409).json({ error: 'pictorial_first' });
      if (prev && prev.done) return res.json({ correct: prev.correct, done: true, tries: prev.tries, repeat: true });

      let correct = false, reasons = null, reason = null, built = null;
      if (step === 'pictorial') {
        built = cleanBuilt(body.built, p.spec);
        const verdict = built ? compareBuilt(built, p.spec) : { correct: false, bars: p.spec.bars.map(() => ({ ok: false, reason: 'shape' })) };
        correct = verdict.correct;
        reasons = verdict.bars.map((b) => b.reason);
      } else {
        const eqOk = String(body.equation || '') === p.equation;
        const ansOk = Number(String(body.answer ?? '').replace(/[^\d.-]/g, '')) === p.answer && String(body.answer ?? '').trim() !== '';
        correct = eqOk && ansOk;
        reason = !eqOk ? 'equation' : !ansOk ? 'answer' : null;
      }
      const tries = (prev ? prev.tries : 0) + 1;
      const done = correct || tries >= MAX_TRIES;
      const record = {
        session_id: row.id, student_id: row.student_id, problem_id: p.id, problem_index: index, model_type: p.type, difficulty: p.difficulty,
        step, correct, done, tries, hint_used: tries > 1 || (!correct && done), built_spec: built, ms: Math.max(0, Math.min(3600000, Math.round(Number(body.ms) || 0))),
        updated_at: new Date(now()).toISOString(),
      };
      const { error: wErr } = await supabase.from('sgmath_attempts').upsert(record, { onConflict: 'session_id,problem_index,step' });
      if (wErr) throw wErr;

      const strings = await stringsFor(row.language);
      const out = { correct, done, tries };
      if (step === 'pictorial') out.reasons = reasons;
      else out.reason = reason;
      if (!correct && !done) {
        const h = hintText(p.type, tries, strings);
        if (h && hintIsSafe(h, p.answer)) out.hint = h;
      }
      if (done && step === 'pictorial') out.reveal = problemSvg(p, strings, { reveal: true });
      if (done && step === 'abstract') { out.answer = p.answer; out.equation = p.equation; }
      res.json(out);
    } catch (err) { console.error('sgmath attempt:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/sgmath/session/:id/finish', writeLimiter, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      const own = await loadOwnSession(req, res); if (!own) return;
      const row = own.row;
      const strings = await stringsFor(row.language);
      const { data: att, error } = await supabase.from('sgmath_attempts').select('step, correct, done, tries').eq('session_id', row.id);
      if (error) throw error;
      if (row.status === 'open') {
        const { error: uErr } = await supabase.from('sgmath_sessions').update({ status: 'completed', completed_at: new Date(now()).toISOString() }).eq('id', row.id).eq('status', 'open');
        if (uErr) throw uErr;
        const secs = Math.round((now() - Date.parse(row.started_at)) / 1000);
        trackSessionCompleted(own.session.familyId, row.student_id, { feature: FEATURE, durationSeconds: secs, extra: { diagnostic: row.diagnostic, model_type: row.focus_model_type } });
      }
      const minutes = Math.max(1, Math.round(((row.completed_at ? Date.parse(row.completed_at) : now()) - Date.parse(row.started_at)) / 60000));
      const all = (att || []).filter((a) => a.done);
      const strong = all.length > 0 && all.every((a) => a.correct && a.tries === 1);
      const first = problemById((row.problems || [])[0]);
      const model = row.diagnostic ? (typesForGrade(first ? first.grade : 1).map((t) => strings['model.' + t]).join(', ')) : strings['model.' + row.focus_model_type];
      res.json({
        minutes, model,
        replay: first ? problemSvg(first, strings, { reveal: true }) : null,
        next: strings[strong ? 'finish.next.strong' : 'finish.next.practice'],
      });
    } catch (err) { console.error('sgmath finish:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  // Parent view. A family member whose "activities" are hidden by the parents gets 403.
  app.get('/api/sgmath/progress', readLimiter, async (req, res) => {
    try {
      const studentId = String(req.query.studentId || '');
      const session = await requireOwnStudent(req, res, studentId); if (!session) return;
      if (!(await isReady())) return notReady(res);
      if (Array.isArray(session.mids) && session.mids.length) {
        const { data: rules, error: vErr } = await supabase.from('member_visibility_rules').select('is_visible')
          .eq('family_id', session.familyId).in('family_member_id', session.mids).eq('feature_name', 'activities');
        if (vErr) throw vErr;
        if ((rules || []).some((r) => r.is_visible === false)) return sendForbidden(res);
      }
      const attempts = await attemptsOf(studentId);
      const grade = await studentGrade(studentId);
      const m = masteryByType(attempts);
      const types = gradeSupported(grade) ? typesForGrade(grade) : MODEL_TYPES;
      res.set('Cache-Control', 'no-store');
      res.json({
        hasProgress: attempts.length > 0,
        rows: types.map((t) => ({ type: t, score: m[t].score === null ? null : Math.round(m[t].score * 100), attempts: m[t].attempts, label: masteryLabel(m[t]) })),
        weekly: weeklyGrowth(attempts, now()),
      });
    } catch (err) { console.error('sgmath progress:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/sgmath/upgrade-click', writeLimiter, async (req, res) => {
    try {
      const studentId = String((req.body || {}).studentId || '');
      const session = await requireOwnStudent(req, res, studentId); if (!session) return;
      const source = ['free_preview', 'free_used', 'card'].includes((req.body || {}).source) ? req.body.source : 'card';
      trackSgmathEvent(EVENTS.SGMATH_UPGRADE_CLICKED, session.familyId, studentId, { source });
      res.json({ ok: true });
    } catch (err) { console.error('sgmath upgrade:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/sgmath/e2e/reset', writeLimiter, async (req, res) => {
    try {
      if (process.env.E2E_REPLAY !== '1') return res.status(404).json({ error: 'not_found' });
      const studentId = String((req.body || {}).studentId || '');
      const session = await requireOwnStudent(req, res, studentId); if (!session) return;
      if (!(await isTestFamily(session.familyId))) return sendForbidden(res);
      if (!(await isReady())) return notReady(res);
      const { error } = await supabase.from('sgmath_sessions').delete().eq('student_id', studentId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { console.error('sgmath reset:', err.message); res.status(500).json({ error: 'failed' }); }
  });

  // Founder figures (14 days). Test families are left out of every number.
  app.get('/api/admin/singapore-maths', requireAdmin, async (req, res) => {
    try {
      if (!(await isReady())) return notReady(res);
      const since = new Date(now() - 14 * DAY_MS).toISOString();
      const testIds = await testFamilyIds();
      const { data: sessions, error } = await supabase.from('sgmath_sessions').select('family_id, student_id, status, gate, started_at, ai_hints_used').gte('started_at', since).limit(20000);
      if (error) throw error;
      const real = (sessions || []).filter((s) => !testIds.has(Number(s.family_id)));
      const { data: events, error: eErr } = await supabase.from('usage_events').select('event_name, family_id, student_id, properties, created_at')
        .in('event_name', [EVENTS.SGMATH_UPGRADE_CLICKED, EVENTS.SGMATH_FREE_USED]).gte('created_at', since).limit(20000);
      if (eErr) throw eErr;
      const realEvents = (events || []).filter((e) => !testIds.has(Number(e.family_id)));
      const { count: maxPayments, error: pErr } = await supabase.from('payments').select('id', { count: 'exact', head: true }).eq('tier', 'max').eq('status', 'captured');
      if (pErr) throw pErr;
      const children = new Set(real.map((s) => s.student_id));
      const freeUsers = new Set(realEvents.filter((e) => e.event_name === EVENTS.SGMATH_FREE_USED).map((e) => e.student_id));
      let freeToMax = 'n/a, Max not on sale';
      if ((maxPayments || 0) > 0 && freeUsers.size) {
        const { data: maxRows, error: mErr } = await supabase.from('payments').select('student_id, captured_at').eq('tier', 'max').eq('status', 'captured').in('student_id', [...freeUsers]);
        if (mErr) throw mErr;
        freeToMax = Math.round((new Set((maxRows || []).map((r) => r.student_id)).size / freeUsers.size) * 100) + '%';
      }
      res.json({
        started: real.length,
        completed: real.filter((s) => s.status === 'completed').length,
        weeklyPerActiveChild: children.size ? Math.round((real.length / children.size / 2) * 10) / 10 : 0,
        freeUsed: freeUsers.size,
        upgradeClicks: realEvents.filter((e) => e.event_name === EVENTS.SGMATH_UPGRADE_CLICKED).length,
        freeToMax,
        aiHintsPerSession: 0,
      });
    } catch (err) { console.error('sgmath admin:', err.message); res.status(500).json({ error: 'failed' }); }
  });
}
