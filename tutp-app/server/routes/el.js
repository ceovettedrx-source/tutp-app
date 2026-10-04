// Experiential Learning v2: Guided Discovery and the shared video service.
//   GET  /api/el/concepts            the pilot concepts (chips)
//   GET  /api/el/match?text=         typed topic -> concept id or null (no model call)
//   GET  /api/el/lesson/:id          one lesson, in a language, with the board's chapter
//   POST /api/el/teachback           one follow-up question (haiku, max_tokens 300)
//   POST /api/el/event               predict_correct, hints_used, teach_back_done, sim_opened, revisit_done
//   GET  /api/el/revisits            revisit questions that are due for a child
//   GET  /api/el/videos              2+2+1 videos for a concept (server/video/)
// Mounted from server.js with the helpers it owns (session, limits, tracking).
import { lessons, conceptList, matchConcept, mappingFor, getConcept } from '../el/lessons.js';
import { validateLesson } from '../el/schema.js';
import { computeRevisits } from '../el/revisits.js';
import { BOARDS } from '../el/concepts.js';
import { callClaude } from '../anthropic.js';
import { MODELS, modelSettings } from '../models.js';
import { replayMode } from '../model-replay.js';
import { isTestFamily } from '../test-families.js';
import { HOMEWORK_LANGUAGES } from '../prompts/homework-prompts.js';
import { createVideoService, makeReviewer } from '../video/service.js';
import { searchVideos } from '../video/youtube.js';
import { segmentFromChapters, segmentFromGemini, geminiKeyFromSecretManager } from '../video/segments.js';
import { fixtureSearch, fixtureSegment } from '../video/fixtures.js';

export const EL_EVENTS = ['predict_correct', 'hints_used', 'teach_back_done', 'sim_opened', 'revisit_done'];
const SKIP_KEYS = new Set(['id', 'level', 'correctIndex', 'misconceptionId', 'adultSteps', 'slugs', 'version', 'grade', 'simUrls', 'safety', 'term_en']);

// Copies the translated words onto the original lesson, keeping every
// structural field (ids, indexes, levels) from the original, so a translation
// can never change which answer is right or which step is the adult's.
export function mergeText(orig, tr) {
  if (typeof orig === 'string') return typeof tr === 'string' && tr.trim() ? tr : orig;
  if (Array.isArray(orig)) return orig.map((o, i) => mergeText(o, Array.isArray(tr) ? tr[i] : undefined));
  if (orig && typeof orig === 'object') {
    const out = {};
    for (const k of Object.keys(orig)) out[k] = SKIP_KEYS.has(k) ? orig[k] : mergeText(orig[k], tr && typeof tr === 'object' ? tr[k] : undefined);
    return out;
  }
  return orig;
}

export function registerElRoutes(app, { rateLimit, supabase, getSession, requireOwnStudent, sendSessionExpired, sendForbidden, checkFreeLimit, freeLimitMessage, trackSessionStarted, trackSessionCompleted }) {
  const familyKey = (req) => 'family:' + String((getSession(req) || {}).familyId);
  const limiter = (max, windowMs = 10 * 60 * 1000, message = 'Too many requests, please wait a few minutes.') =>
    rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, keyGenerator: familyKey, message: { error: message } });
  const lessonLimiter = limiter(120);
  const teachLimiter = limiter(30);
  const eventLimiter = limiter(300);
  const videoLimiter = limiter(120);

  const translations = new Map();   // conceptId|lang -> lesson

  const needSession = (req, res) => {
    const s = getSession(req);
    if (!s) { sendSessionExpired(res); return null; }
    if (!s.familyId) { sendForbidden(res); return null; }
    return s;
  };

  app.get('/api/el/concepts', (req, res) => {
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ concepts: conceptList() });
  });

  app.get('/api/el/match', (req, res) => {
    const id = matchConcept(String(req.query.text || '').slice(0, 300));
    res.json({ conceptId: id });
  });

  // ---- lesson -------------------------------------------------------------
  app.get('/api/el/lesson/:id', async (req, res) => {
    try {
      const session = needSession(req, res); if (!session) return;
      const lesson = lessons().get(req.params.id);
      if (!lesson) return res.status(404).json({ error: 'unknown_concept' });
      const board = BOARDS.includes(req.query.board) ? req.query.board : 'cbse-ncert';
      const lang = HOMEWORK_LANGUAGES.includes(req.query.language) ? req.query.language : 'English';
      const studentId = String(req.query.studentId || '');
      if (!(await requireOwnStudent(req, res, studentId))) return;
      lessonLimiter(req, res, async () => {
        try {
          const limit = await checkFreeLimit(studentId, 'other_features');
          if (!limit.allowed) return res.status(402).json({ error: 'free_limit_reached', bucket: 'other_features', message: freeLimitMessage(limit, 'other_features') });
          const mapping = await mappingFor(lesson.id, board);
          let out = lesson, translated = false;
          if (lang !== 'English') {
            const t = await translateLesson(req, session, lesson, lang);
            if (t) { out = t; translated = true; }
          }
          trackSessionStarted(session.familyId, studentId, { feature: 'experiential_learning', language: lang });
          const testFamily = await isTestFamily(session.familyId);
          const { safety, ...pub } = out;
          const body = { ...pub, language: lang, translated, mapping, attribution: 'PhET Interactive Simulations, University of Colorado Boulder, CC-BY 4.0' };
          if (testFamily && req._elRecordings && req._elRecordings.length) body._recordings = req._elRecordings;
          if (testFamily) res.set('X-Model-Usd', String(req._elCost && req._elCost.usd || 0));
          res.json(body);
        } catch (err) {
          console.error('el: lesson error:', err && err.message);
          if (!res.headersSent) res.status(500).json({ error: 'Server error loading the lesson' });
        }
      });
    } catch (err) {
      console.error('el: lesson error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error loading the lesson' });
    }
  });

  // One translation call per concept+language, cached for the life of the
  // instance. Returns null (English is served) when the call or the check fails.
  async function translateLesson(req, session, lesson, lang) {
    const key = lesson.id + '|' + lang;
    if (translations.has(key)) return translations.get(key);
    if (!process.env.ANTHROPIC_API_KEY) return null;
    const testFamily = await isTestFamily(session.familyId);
    const mode = replayMode(testFamily, req.get('x-e2e-mode'));
    req._elRecordings = req._elRecordings || [];
    req._elCost = req._elCost || { usd: 0 };
    const source = mergeText(lesson, {});     // plain copy
    const { id: _id, title: _title, grade: _grade, version: _version, sim: _sim, simUrls: _simUrls, safety: _safety, ...words } = source;
    const system = `You translate a children's science lesson into ${lang} for a parent and child in India. Keep the exact JSON structure and every key. Translate only the sentences. Keep numbers, and keep names of household items simple and familiar. Write the way a friendly teacher speaks to a Class 6 to 10 child. Reply ONLY with the JSON object.`;
    const model = MODELS.el_translate;
    const r = await callClaude({
      feature: 'el_translate', variant: lang, familyId: session.familyId, mode, recordings: req._elRecordings, cost: req._elCost,
      body: { model, ...modelSettings(model), max_tokens: 6000, system, messages: [{ role: 'user', content: JSON.stringify({ title: lesson.title, ...words }) }] },
    });
    if (!r.ok) { console.error('el: translate failed', { status: r.status, lang, lesson: lesson.id }); return null; }
    const text = ((r.data.content || []).find((b) => b.type === 'text') || {}).text || '';
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    let parsed;
    try { parsed = JSON.parse(text.slice(a, b + 1)); } catch { console.error('el: translate unparseable', lesson.id, lang); return null; }
    const merged = mergeText(lesson, parsed);
    if (!validateLesson(merged).ok) return null;
    if (mode !== 'replay' || !testFamily) translations.set(key, merged);
    return merged;
  }

  // ---- teach-back ---------------------------------------------------------
  app.post('/api/el/teachback', async (req, res) => {
    try {
      const body = req.body || {};
      const session = needSession(req, res); if (!session) return;
      const lesson = lessons().get(body.conceptId);
      if (!lesson) return res.status(404).json({ error: 'unknown_concept' });
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 800) : '';
      if (text.length < 3) return res.status(400).json({ error: 'Please type or say a few words first.' });
      if (!(await requireOwnStudent(req, res, body.studentId))) return;
      const lang = HOMEWORK_LANGUAGES.includes(body.language) ? body.language : 'English';
      teachLimiter(req, res, async () => {
        try {
          if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
          const testFamily = await isTestFamily(session.familyId);
          const mode = replayMode(testFamily, req.get('x-e2e-mode'));
          const recordings = [], cost = { usd: 0 };
          const model = MODELS.el_teachback;
          const system = `You are Tut-P. A child just explained the idea "${lesson.reveal.term}" (${lesson.title}) in their own words. The idea in short: ${lesson.reveal.explanation}\nReply with exactly ONE short follow-up question in ${lang}, in plain words for a Class 6 to 10 child, that makes them think a little further about what they said (for example "what would happen if ...?" or "why do you think ...?"). Do not praise at length, do not correct, do not give the answer, do not add anything after the question.`;
          const r = await callClaude({
            feature: 'el_teachback', variant: lang, familyId: session.familyId, studentId: body.studentId, mode, recordings, cost,
            body: { model, ...modelSettings(model), max_tokens: 300, system, messages: [{ role: 'user', content: text }] },
          });
          if (testFamily) { res.set('X-Model-Usd', String(cost.usd)); res.set('X-El-Model', model); res.set('X-El-Max-Tokens', '300'); }
          if (!r.ok) {
            console.error('el: teachback model call failed', { status: r.status });
            return res.status(502).json({ error: 'Could not make a question right now.' });
          }
          const raw = ((r.data.content || []).find((b) => b.type === 'text') || {}).text || '';
          const out = oneQuestion(raw);
          if (!out) return res.status(502).json({ error: 'Could not make a question right now.' });
          res.json({ question: out, ...(testFamily && mode === 'record' ? { _recordings: recordings } : {}) });
        } catch (err) {
          console.error('el: teachback error:', err && err.message);
          if (!res.headersSent) res.status(500).json({ error: 'Server error' });
        }
      });
    } catch (err) {
      console.error('el: teachback error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  // ---- events -------------------------------------------------------------
  app.post('/api/el/event', async (req, res) => {
    try {
      const body = req.body || {};
      const session = needSession(req, res); if (!session) return;
      if (!EL_EVENTS.includes(body.name) || !getConcept(body.conceptId)) return res.status(400).json({ error: 'bad_event' });
      if (!(await requireOwnStudent(req, res, body.studentId))) return;
      eventLimiter(req, res, async () => {
        const properties = { feature: 'experiential_learning', concept_id: body.conceptId };
        if (body.name === 'hints_used') properties.hints = Math.max(0, Math.min(3, Number(body.hints) || 0));
        if (body.name === 'predict_correct') properties.correct = body.correct === true;
        if (body.name === 'sim_opened') properties.sim = String(body.sim || '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
        if (body.name === 'revisit_done') properties.day = [3, 10, 30].includes(Number(body.day)) ? Number(body.day) : null;
        if (body.name === 'teach_back_done') properties.language = HOMEWORK_LANGUAGES.includes(body.language) ? body.language : 'English';
        const { error } = await supabase.from('usage_events').insert({ event_name: body.name, family_id: session.familyId, student_id: body.studentId, properties });
        if (error) { console.error('el: event insert failed:', error.message); return res.status(500).json({ error: 'Could not save' }); }
        // The lesson counts as one Experiential Learning session for the free limit, once the child has done the teach-back.
        if (body.name === 'teach_back_done') trackSessionCompleted(session.familyId, body.studentId, { feature: 'experiential_learning', durationSeconds: null, extra: { guided: true, concept_id: body.conceptId } });
        res.status(204).end();
      });
    } catch (err) {
      console.error('el: event error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/el/revisits', async (req, res) => {
    try {
      const session = needSession(req, res); if (!session) return;
      const studentId = String(req.query.studentId || '');
      if (!(await requireOwnStudent(req, res, studentId))) return;
      const since = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase.from('usage_events').select('event_name, created_at, properties')
        .eq('student_id', studentId).in('event_name', ['teach_back_done', 'revisit_done']).gte('created_at', since);
      if (error) throw error;
      res.set('Cache-Control', 'no-store');
      res.json({ revisits: computeRevisits(data || [], Date.now(), lessons()) });
    } catch (err) {
      console.error('el: revisits error:', err && err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ---- videos -------------------------------------------------------------
  app.get('/api/el/videos', async (req, res) => {
    try {
      const session = needSession(req, res); if (!session) return;
      const concept = getConcept(String(req.query.concept || ''));
      if (!concept) return res.status(404).json({ error: 'unknown_concept' });
      const lang = HOMEWORK_LANGUAGES.includes(req.query.language) ? req.query.language : 'English';
      videoLimiter(req, res, async () => {
        try {
          const testFamily = await isTestFamily(session.familyId);
          const mode = replayMode(testFamily, req.get('x-e2e-mode'));
          const fixtureMode = testFamily && mode === 'replay';
          const out = await videosFor({ concept, lang, session, fixtureMode, quota: fixtureMode && req.get('x-e2e-yt') === 'quota' });
          res.set('Cache-Control', 'private, max-age=300');
          res.json(out);
        } catch (err) {
          // Never a "not available" notice: an empty list hides the section.
          console.error('el: videos error:', err && err.message);
          res.json({ videos: [] });
        }
      });
    } catch (err) {
      console.error('el: videos error:', err && err.message);
      if (!res.headersSent) res.json({ videos: [] });
    }
  });

  // The same service for any mode that has only a short topic (the notes
  // flow's typed lesson topic, later Storytelling): query = topic + class +
  // subject, never a long text.
  app.get('/api/videos', async (req, res) => {
    try {
      const session = needSession(req, res); if (!session) return;
      const topic = String(req.query.topic || '').replace(/[^\p{L}\p{N} '-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (topic.length < 3) return res.json({ videos: [] });
      const grade = Math.min(10, Math.max(1, parseInt(req.query.grade, 10) || 8));
      const subject = ['science', 'maths', 'social', 'english'].includes(req.query.subject) ? req.query.subject : 'science';
      const lang = HOMEWORK_LANGUAGES.includes(req.query.language) ? req.query.language : 'English';
      videoLimiter(req, res, async () => {
        try {
          const testFamily = await isTestFamily(session.familyId);
          const mode = replayMode(testFamily, req.get('x-e2e-mode'));
          const fixtureMode = testFamily && mode === 'replay';
          const concept = { id: 'topic:' + topic.toLowerCase(), title: topic, grade, aliases: [], subject };
          res.set('Cache-Control', 'private, max-age=300');
          res.json(await videosFor({ concept, lang, session, fixtureMode, quota: fixtureMode && req.get('x-e2e-yt') === 'quota' }));
        } catch (err) {
          console.error('video: topic error:', err && err.message);
          res.json({ videos: [] });
        }
      });
    } catch (err) {
      console.error('video: topic error:', err && err.message);
      if (!res.headersSent) res.json({ videos: [] });
    }
  });

  const liveService = { svc: null };
  async function videosFor({ concept, lang, session, fixtureMode, quota }) {
    const terms = [concept.title, ...concept.aliases];
    const callModel = async (system, user) => {
      const model = MODELS.el_video_review;
      const r = await callClaude({
        feature: 'el_video_review', familyId: session.familyId, mode: 'live', body: { model, ...modelSettings(model), max_tokens: 600, system, messages: [{ role: 'user', content: user }] },
      });
      if (!r.ok) throw new Error('review call failed ' + r.status);
      const text = ((r.data.content || []).find((b) => b.type === 'text') || {}).text || '';
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    };
    if (fixtureMode) {
      // Test families on a replay preview: hand-written YouTube answers, no network, no cache.
      const svc = createVideoService({
        search: async (q, l) => fixtureSearch(concept.id, l, { quota }),
        review: async (videos) => new Set(videos.filter((v) => !/REJECT/.test(v.title)).map((v) => v.id)),
        segmenter: async (v, c, t) => segmentFromChapters(v, t) || fixtureSegment(v),
      });
      return svc.find({ conceptId: concept.id, concept: concept.title, grade: concept.grade, subject: concept.subject || 'science', lang, terms });
    }
    if (!liveService.svc) {
      liveService.svc = createVideoService({
        search: async (q, l) => searchVideos({ q, lang: l, key: process.env.YOUTUBE_API_KEY }),
        review: makeReviewer(callModel),
        segmenter: async (v, c, t) => segmentFromChapters(v, t) || segmentFromGemini(v, c, { key: await geminiKeyFromSecretManager() }),
      });
    }
    return liveService.svc.find({ conceptId: concept.id, concept: concept.title, grade: concept.grade, subject: concept.subject || 'science', lang, terms });
  }
}

// The first question in a model reply: up to and including its first "?" (or
// the "?" of the full-width/Devanagari forms), trimmed; null when empty.
export function oneQuestion(raw) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = /^[^?？]*[?？]/.exec(t);
  const q = (m ? m[0] : t).trim();
  return q.length >= 3 ? q.slice(0, 300) : null;
}
