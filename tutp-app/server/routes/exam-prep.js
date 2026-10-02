// Exam prep routes (round 4, docs/specs/round-4-exam-prep-pilot.md).
//
// Parents (family session; a member session reads the same, by the child's
// plan):
//   GET  /api/exam-prep/week/:familyId      "Exam prep this week" per child
//   GET  /api/exam-prep/:studentId          chapter + what is ready per mode
//   GET  /api/exam-prep/:studentId/:mode    one note (?lang=en|te)
//   POST /api/exam-prep/event               opened / closed / answered
//   POST /api/exam-prep/report              "Report a mistake" on a note
// Every "not available" answer is 200 with status coming_soon or locked,
// never an error, and no route here ever calls a model.
//
// Founder (admin cookie only; ?token= is not accepted here):
//   GET  /admin/exam-prep                   review page
//   GET  /api/admin/exam-prep               every note, versions, history
//   POST /api/admin/exam-prep/generate      write a missing note
//   POST /api/admin/exam-prep/decide        approve / needs_fix / reject / keep, one version
//   POST /api/admin/exam-prep/undo          revert the latest decision on one note
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MODES, ALL_MODES, FREE_MODES, LANGS, BOARDS, pilotFor, pilotChapter, chapterInfo, noteFor, kgVersion,
  supabaseStore, decide, undoLatest, startVersion, writeNote, saveWritten, reportMistake, weeklySample,
  ReviewError, weekTotals, MAX_OPEN_SECONDS,
} from '../exam-prep.js';
import { PROMPT_VERSION } from '../prompts/exam-prep-prompts.js';
import { mindMapSvg } from '../mind-map-svg.js';
import { replayMode } from '../model-replay.js';

const ADMIN_PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'admin', 'exam-prep.html');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPES = ['opened', 'closed', 'flashcard_answered', 'question_answered'];
const LIVE_STATUSES = ['generating', 'needs_review', 'approved', 'needs_fix'];

export function mountExamPrep(app, deps) {
  const {
    supabase, getSession, sendSessionExpired, sendForbidden, studentBelongsToSession, requireOwnFamily,
    getPaidStatusForStudents, isTestFamily, isAdminCookie, startOfWeekIST,
  } = deps;
  const store = () => supabaseStore(supabase);
  const noSupabase = (res) => res.status(500).json({ error: 'Server is missing Supabase configuration' });

  // The child, whether they're in the pilot, and the chapter for their board.
  async function loadChild(req, res, studentId) {
    const session = getSession(req);
    if (!session) { sendSessionExpired(res); return null; }
    if (!UUID.test(String(studentId || '')) || !(await studentBelongsToSession(session, studentId))) { sendForbidden(res); return null; }
    const [{ data: student, error }, { data: family, error: famErr }] = await Promise.all([
      supabase.from('students').select('id, name, class, state, family_id').eq('id', studentId).maybeSingle(),
      supabase.from('family_registrations').select('data').eq('id', session.familyId).maybeSingle(),
    ]);
    if (error) throw error;
    if (famErr) throw famErr;
    const children = Array.isArray(family?.data?.children) ? family.data.children : [];
    const entry = children.find((c) => c && String(c.name || '').trim().toLowerCase() === String(student.name || '').trim().toLowerCase());
    const pilot = pilotFor({ cls: student.class, state: student.state, curriculum: entry?.curriculum });
    const chapter = pilot.eligible ? await pilotChapter(pilot.board) : null;
    const shown = pilot.eligible && !chapter ? { eligible: false, reason: 'not_sourced' } : pilot;
    return { session, student, pilot: shown, chapter, isTest: await isTestFamily(session.familyId) };
  }

  async function servedKeys(keys) {
    const { data, error } = await supabase.from('answer_cache').select('key').in('key', keys).eq('status', 'approved');
    if (error) throw error;
    return new Set((data || []).map((r) => r.key));
  }

  // ------------------------------------------------------------ parents

  app.get('/api/exam-prep/week/:familyId', async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const familyId = parseInt(req.params.familyId, 10);
      if (!requireOwnFamily(req, res, familyId)) return;
      const weekStart = startOfWeekIST();
      const [{ data: events, error }, { data: students, error: sErr }] = await Promise.all([
        supabase.from('usage_events').select('event_name, student_id, properties')
          .eq('family_id', familyId).like('event_name', 'exam_prep.%').gte('created_at', weekStart.toISOString()).limit(5000),
        supabase.from('students').select('id, name').eq('family_id', familyId).order('created_at', { ascending: true }),
      ]);
      if (error) throw error;
      if (sErr) throw sErr;
      res.set('Cache-Control', 'no-store');
      res.json({
        weekStart: weekStart.toISOString(),
        children: (students || []).map((s) => ({ studentId: s.id, name: s.name, ...weekTotals((events || []).filter((e) => e.student_id === s.id)) })),
      });
    } catch (err) {
      console.error('exam prep week error:', err);
      res.status(500).json({ error: 'Could not load exam prep this week' });
    }
  });

  app.get('/api/exam-prep/:studentId', async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const c = await loadChild(req, res, req.params.studentId);
      if (!c) return;
      res.set('Cache-Control', 'no-store');
      if (!c.pilot.eligible) return res.json({ eligible: false, status: 'coming_soon', reason: c.pilot.reason });
      const paid = (await getPaidStatusForStudents([c.student.id]))[c.student.id].active;
      const notes = {};
      for (const mode of MODES) for (const lang of LANGS) notes[mode + '|' + lang] = noteFor({ chapter: c.chapter, mode, lang, isTest: c.isTest });
      const served = await servedKeys(Object.values(notes).map((n) => n.key));
      const ready = (mode, lang) => served.has(notes[(mode === 'mind_map' ? 'key_points' : mode) + '|' + lang].key) ? 'ready' : 'coming_soon';
      res.json({
        eligible: true,
        chapter: chapterInfo(c.chapter),
        paid,
        modes: ALL_MODES.map((mode) => ({
          mode, free: FREE_MODES.includes(mode), locked: !FREE_MODES.includes(mode) && !paid,
          en: ready(mode, 'en'), te: ready(mode, 'te'),
        })),
      });
    } catch (err) {
      console.error('exam prep overview error:', err);
      res.status(500).json({ error: 'Could not load exam prep' });
    }
  });

  app.get('/api/exam-prep/:studentId/:mode', async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const mode = req.params.mode;
      if (!ALL_MODES.includes(mode)) return res.status(400).json({ error: 'unknown_mode' });
      const lang = LANGS.includes(req.query.lang) ? req.query.lang : 'en';
      const c = await loadChild(req, res, req.params.studentId);
      if (!c) return;
      res.set('Cache-Control', 'no-store');
      if (!c.pilot.eligible) return res.json({ status: 'coming_soon', reason: c.pilot.reason });
      if (!FREE_MODES.includes(mode)) {
        const paid = (await getPaidStatusForStudents([c.student.id]))[c.student.id].active;
        if (!paid) return res.json({ status: 'locked', mode });
      }
      const baseMode = mode === 'mind_map' ? 'key_points' : mode;
      const note = noteFor({ chapter: c.chapter, mode: baseMode, lang, isTest: c.isTest });
      const version = await store().served(note.key);
      if (!version) {
        const out = { status: 'coming_soon', mode, lang, reason: lang === 'te' ? 'telugu_pending' : 'not_ready' };
        if (lang === 'te') out.englishReady = !!(await store().served(noteFor({ chapter: c.chapter, mode: baseMode, lang: 'en', isTest: c.isTest }).key));
        return res.json(out);
      }
      supabase.from('usage_events').insert({
        event_name: 'exam_prep.hit', family_id: c.session.familyId, student_id: c.student.id,
        properties: { key: note.key, version_id: version.id, mode, lang, usd_saved: Number(version.usd) || 0 },
      }).then(({ error }) => { if (error) console.error('exam_prep.hit log failed:', error.message); }, () => {});
      const out = { status: 'ready', mode, lang, versionId: version.id, chapter: chapterInfo(c.chapter) };
      if (mode === 'mind_map') out.svg = mindMapSvg({ title: c.chapter.chapter.replace(/^Chapter \d+:\s*/, ''), points: version.content.points });
      else out.content = version.content;
      res.json(out);
    } catch (err) {
      console.error('exam prep note error:', err);
      res.status(500).json({ error: 'Could not load this note' });
    }
  });

  app.post('/api/exam-prep/event', async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const { studentId, type, openId, seconds, mode } = req.body || {};
      if (!EVENT_TYPES.includes(type)) return res.status(400).json({ error: 'bad_type' });
      if (!/^[A-Za-z0-9-]{8,40}$/.test(String(openId || ''))) return res.status(400).json({ error: 'bad_open_id' });
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      if (!UUID.test(String(studentId || '')) || !(await studentBelongsToSession(session, studentId))) return sendForbidden(res);
      const properties = { open_id: openId, mode: ALL_MODES.includes(mode) ? mode : null };
      if (type === 'closed') properties.seconds = Math.min(MAX_OPEN_SECONDS, Math.max(0, Math.round(Number(seconds) || 0)));
      const { error } = await supabase.from('usage_events').insert({ event_name: 'exam_prep.' + type, family_id: session.familyId, student_id: studentId, properties });
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      console.error('exam prep event error:', err);
      res.status(500).json({ error: 'Could not save' });
    }
  });

  // "Report a mistake": the note keeps being served, the founder's list
  // gets it. One open report per child per version. Never calls a model.
  app.post('/api/exam-prep/report', async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const { studentId, mode, lang, message } = req.body || {};
      if (!ALL_MODES.includes(mode)) return res.status(400).json({ error: 'unknown_mode' });
      if (!LANGS.includes(lang)) return res.status(400).json({ error: 'bad_lang' });
      const c = await loadChild(req, res, studentId);
      if (!c) return;
      if (!c.pilot.eligible) return res.status(409).json({ error: 'coming_soon' });
      const note = noteFor({ chapter: c.chapter, mode: mode === 'mind_map' ? 'key_points' : mode, lang, isTest: c.isTest });
      const r = await reportMistake(store(), { key: note.key, studentId: c.student.id, familyId: c.session.familyId, message, isTest: c.isTest });
      console.log('exam prep: mistake reported', { key: note.key.slice(0, 12), version_id: r.versionId, duplicate: r.duplicate, test: c.isTest });
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, duplicate: r.duplicate });
    } catch (err) {
      if (err instanceof ReviewError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error('exam prep report error:', err);
      res.status(500).json({ error: 'Could not send the report' });
    }
  });

  // ------------------------------------------------------------ founder

  function adminOnly(req, res, next) {
    if (isAdminCookie(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
    return res.redirect(302, '/admin/login');
  }

  app.get('/admin/exam-prep', adminOnly, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(ADMIN_PAGE);
  });

  // Every note of the pilot (2 boards x 4 modes x 2 languages), newest
  // version first, with its decision history. ?test=1: the e2e test notes.
  app.get('/api/admin/exam-prep', adminOnly, async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const isTest = req.query.test === '1';
      const notes = [];
      for (const board of BOARDS) {
        const chapter = await pilotChapter(board);
        if (!chapter) continue;
        for (const mode of MODES) for (const lang of LANGS) notes.push({ ...noteFor({ chapter, mode, lang, isTest }), info: chapterInfo(chapter) });
      }
      const keys = notes.map((n) => n.key);
      const [{ data: rows, error }, { data: decisions, error: dErr }, { data: reports, error: rErr }, { count: teachers, error: tErr }] = await Promise.all([
        supabase.from('answer_cache').select('*').in('key', keys).order('version', { ascending: false }),
        supabase.from('answer_cache_decisions').select('*').in('key', keys).order('created_at', { ascending: false }),
        supabase.from('answer_cache_reports').select('id, version_id, key, message, created_at').in('key', keys).is('resolved_at', null).order('created_at', { ascending: true }),
        supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('is_approved', true),
      ]);
      if (error) throw error;
      if (dErr) throw dErr;
      if (rErr) throw rErr;
      if (tErr) throw tErr;
      // Weekly spot check: 2 Telugu notes the AI approved, fixed for the week.
      const weekStart = startOfWeekIST().toISOString();
      const aiApproved = new Set((decisions || []).filter((d) => d.action === 'approve' && d.decided_by === 'ai' && !d.undone_at).map((d) => d.version_id));
      const sample = weeklySample((rows || []).filter((v) => v.status === 'approved' && v.language === 'te' && aiApproved.has(v.id)), weekStart).map((v) => v.id);
      // Teacher queue: every note the AI approved that no person has reviewed yet.
      const teacherQueue = (rows || []).filter((v) => v.status === 'approved' && v.reviewed_by === 'ai' && !v.teacher_reviewed_at).map((v) => v.id);
      res.set('Cache-Control', 'no-store');
      res.json({
        test: isTest,
        promptVersion: PROMPT_VERSION,
        weekStart,
        sample,
        teacher: { accountExists: (teachers || 0) > 0, queue: teacherQueue },
        notes: notes.map((n) => {
          const versions = (rows || []).filter((r) => r.key === n.key).map((v) => ({ ...v, reports: (reports || []).filter((x) => x.version_id === v.id) }));
          return {
            key: n.key, board: n.board, mode: n.mode, lang: n.lang, kgVersion: n.kgVersion, boardLabel: n.info.boardLabel, title: n.info.title,
            servedId: versions.find((v) => v.status === 'approved')?.id || null,
            versions,
            decisions: (decisions || []).filter((d) => d.key === n.key),
            mindMap: n.mode === 'key_points' ? versions.filter((v) => v.content).map((v) => ({ id: v.id, svg: mindMapSvg({ title: 'Fractions', points: v.content.points }) })) : undefined,
          };
        }),
      });
    } catch (err) {
      console.error('admin exam prep list error:', err);
      res.status(500).json({ error: 'Could not load exam prep notes' });
    }
  });

  // Replay only for test notes on an E2E_REPLAY preview (server/model-replay.js).
  function modelCall(req, isTest) {
    return { mode: replayMode(!!isTest, req.get('x-e2e-mode')), recordings: [], cost: { usd: 0 }, isTest: !!isTest };
  }

  async function writeAndSave(req, res, version, chapter, fixReason) {
    const call = modelCall(req, version.is_test);
    let result;
    try {
      result = await writeNote({ mode: version.mode, lang: version.language, chapter, fixReason: fixReason || '', call });
    } catch (err) {
      result = { status: 'failed', content: null, model: null, checks: { passed: false }, error: String(err.message).slice(0, 300) };
    }
    // Approved by 'ai' here only when every gate passed and Haiku wrote it.
    const { saved, autoApproved } = await saveWritten(store(), version, { ...result, usd: call.cost.usd || 0 }, result.error ? { error: result.error } : {});
    console.log('exam prep: wrote', { key: version.key.slice(0, 12), version: version.version, status: saved.status, passed: result.checks?.passed, auto_approved: autoApproved, model: result.model, usd: call.cost.usd, test: version.is_test });
    if (version.is_test) res.set('X-Model-Usd', String(call.cost.usd || 0));
    return { saved, recordings: call.mode === 'record' ? call.recordings : undefined };
  }

  app.post('/api/admin/exam-prep/generate', adminOnly, async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const { board, mode, lang, test } = req.body || {};
      if (!BOARDS.includes(board) || !MODES.includes(mode) || !LANGS.includes(lang)) return res.status(400).json({ error: 'bad_note' });
      const chapter = await pilotChapter(board);
      if (!chapter) return res.status(409).json({ error: 'not_sourced' });
      const note = noteFor({ chapter, mode, lang, isTest: test === true });
      const live = (await store().versions(note.key)).find((v) => LIVE_STATUSES.includes(v.status));
      if (live) return res.status(409).json({ error: 'exists', message: `This note already has a ${live.status} version; use Needs fix on it.`, versionId: live.id });
      const version = await startVersion(store(), note);
      const { saved, recordings } = await writeAndSave(req, res, version, chapter, '');
      res.json({ version: saved, _recordings: recordings });
    } catch (err) {
      console.error('admin exam prep generate error:', err);
      res.status(500).json({ error: 'Could not write this note' });
    }
  });

  app.post('/api/admin/exam-prep/decide', adminOnly, async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const body = req.body || {};
      // One note per request: no lists, no bulk.
      if (Array.isArray(body.versionId) || body.versionIds !== undefined) return res.status(400).json({ error: 'one_version_only' });
      if (body.action === 'needs_fix') {
        const v = UUID.test(String(body.versionId || '')) ? await store().version(body.versionId) : null;
        if (v) {
          const chapter = await pilotChapter(v.board);
          if (!chapter || v.kg_version !== kgVersion(chapter) || v.prompt_version !== PROMPT_VERSION) {
            return res.status(409).json({ error: 'outdated', message: 'The chapter data or prompt changed since this note was written: generate the new note instead.' });
          }
        }
      }
      const r = await decide(store(), body);
      let recordings;
      if (r.newVersion) {
        const chapter = await pilotChapter(r.newVersion.board);
        ({ saved: r.newVersion, recordings } = await writeAndSave(req, res, r.newVersion, chapter, r.newVersion.fix_reason));
      }
      console.log('exam prep: decision', { action: body.action, key: r.decision.key.slice(0, 12), before: r.decision.status_before, after: r.decision.status_after, test: r.decision.is_test });
      res.json({ ...r, _recordings: recordings });
    } catch (err) {
      if (err instanceof ReviewError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error('admin exam prep decide error:', err);
      res.status(500).json({ error: 'Could not save the decision' });
    }
  });

  app.post('/api/admin/exam-prep/undo', adminOnly, async (req, res) => {
    try {
      if (!supabase) return noSupabase(res);
      const key = String((req.body || {}).key || '');
      if (!/^[0-9a-f]{64}$/.test(key)) return res.status(400).json({ error: 'bad_key' });
      const decision = await undoLatest(store(), key);
      console.log('exam prep: undo', { action: decision.action, key: key.slice(0, 12), test: decision.is_test });
      res.json({ undone: decision });
    } catch (err) {
      if (err instanceof ReviewError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error('admin exam prep undo error:', err);
      res.status(500).json({ error: 'Could not undo' });
    }
  });
}
