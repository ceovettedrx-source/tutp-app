// Search box mode chips (search-box-v2):
//   GET  /api/search-chips     the visible chips and their labels (server/chips/chip-config.js)
//   POST /api/chip-events      impressions and taps from the page (server/chips/log.js)
//   POST /api/homework-notes   "Notes please": short notes from the question
//                              text the page already has (one text-only call)
// Mounted from server.js with the helpers it owns (session, rate limiting).
import crypto from 'crypto';
import { chipPayload } from '../chips/chip-config.js';
import { buildHomeworkRequest, HOMEWORK_LANGUAGES } from '../prompts/homework-prompts.js';
import { callWithJsonRetry } from '../homework-reply.js';
import { callClaude } from '../anthropic.js';
import { MODELS, modelSettings } from '../models.js';
import { replayMode } from '../model-replay.js';
import { isTestFamily } from '../test-families.js';
import { normalizeNotes, plainNotes } from '../notes-schema.js';

const MAX_QUESTIONS = 8;
const MAX_QUESTION_CHARS = 600;
const MAX_TOPIC_CHARS = 1500;
const BROWSER_KINDS = ['impression', 'tap'];

// Notes caps, per family (in memory, so per instance like the other
// limiters): 20 requests per 10 minutes and 30 per day. A repeat of the same
// request (same child, language and question text) is answered from a cache
// for 24 hours without a model call and does not count toward either cap.
// The page also keeps each result's notes per language.
export const NOTES_LIMITS = { perTenMinutes: 20, perDay: 30, cacheMax: 300, cacheTtlMs: 24 * 60 * 60 * 1000 };

export function createNotesCache({ max = NOTES_LIMITS.cacheMax, ttlMs = NOTES_LIMITS.cacheTtlMs, now = Date.now } = {}) {
  const map = new Map();   // key -> { at, value }, oldest first
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (now() - hit.at > ttlMs) { map.delete(key); return null; }
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { at: now(), value });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    size: () => map.size,
  };
}

// The notes the model returned: the structured notes (version 2, see
// server/notes-schema.js), else { plain: [string], subject } when the JSON has
// no usable structure (the page shows the plain rendering), else null.
export function parseNotes(data) {
  const block = ((data && data.content) || []).find((b) => b && b.type === 'text');
  const text = block && typeof block.text === 'string' ? block.text : '';
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o;
  try { o = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  const structured = normalizeNotes(o);
  if (structured) return structured;
  const plain = plainNotes(o);
  if (plain) console.warn('notes: plain fallback (reply has no usable structure)');
  return plain;
}

// The text the notes are written from: the numbered questions, else the topic.
export function notesInput(body) {
  const qs = Array.isArray(body.questions) ? body.questions : [];
  const questions = qs.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim().slice(0, MAX_QUESTION_CHARS)).slice(0, MAX_QUESTIONS);
  if (questions.length) return questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, MAX_TOPIC_CHARS) : '';
  return topic;
}

export function registerChipRoutes(app, { rateLimit, supabase, getSession, requireOwnStudent, sendSessionExpired, sendForbidden, chipLog }) {
  const familyKey = (req) => 'family:' + String((getSession(req) || {}).familyId);
  const eventsLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
    keyGenerator: familyKey, message: { error: 'Too many requests.' },
  });
  const notesLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: NOTES_LIMITS.perTenMinutes, standardHeaders: true, legacyHeaders: false,
    keyGenerator: familyKey, message: { error: 'Too many requests — please wait a few minutes and try again.' },
  });
  const notesDailyLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, max: NOTES_LIMITS.perDay, standardHeaders: true, legacyHeaders: false,
    keyGenerator: familyKey, message: { error: "You've reached today's limit for notes. Please try again tomorrow." },
  });
  const notesCache = createNotesCache();

  app.get('/api/search-chips', (req, res) => {
    res.set('Cache-Control', 'private, max-age=300');
    res.json(chipPayload());
  });

  app.post('/api/chip-events', async (req, res) => {
    const session = getSession(req);
    if (!session) return sendSessionExpired(res);
    if (!session.familyId) return sendForbidden(res);
    eventsLimiter(req, res, async () => {
      const body = req.body || {};
      let studentId = null;
      if (body.studentId) {
        studentId = await requireOwnStudent(req, res, body.studentId) ? body.studentId : undefined;
        if (studentId === undefined) return;
      }
      const events = (Array.isArray(body.events) ? body.events : [])
        .filter((e) => e && BROWSER_KINDS.includes(e.kind))
        .map((e) => ({ kind: e.kind, chip: e.chip, intent: e.intent, language: body.language }));
      res.status(204).end();
      chipLog.record(session.familyId, studentId, events);
    });
  });

  app.post('/api/homework-notes', async (req, res) => {
    try {
      const body = req.body || {};
      const text = notesInput(body);
      if (!text) return res.status(400).json({ error: 'Nothing to make notes from.' });
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      const own = await requireOwnStudent(req, res, body.studentId);
      if (!own) return;
      const lang = HOMEWORK_LANGUAGES.includes(body.language) ? body.language : 'English';
      const cacheKey = crypto.createHash('sha256').update([body.studentId, lang, text].join('\u0000')).digest('hex');
      const cached = notesCache.get(cacheKey);
      if (cached) { res.set('X-Notes-Cache', 'hit'); return res.json(cached); }
      notesLimiter(req, res, () => notesDailyLimiter(req, res, async () => {
        try {
          const { data: studentRow, error: studentErr } = await supabase
            .from('students').select('name, class').eq('id', body.studentId).maybeSingle();
          if (studentErr) throw studentErr;
          const childContext = studentRow && studentRow.name
            ? studentRow.name + (studentRow.class ? ' · ' + studentRow.class : '')
            : 'your child';
          if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
          const { system, content } = buildHomeworkRequest({ feature: 'notes', lang, childContext, text, attachments: [] });
          const testFamily = await isTestFamily(session.familyId);
          const replay = { mode: replayMode(testFamily, req.get('x-e2e-mode')), recordings: [] };
          const cost = { usd: 0 };
          const model = MODELS.homework_notes;
          const callModel = async (attempt = 1) => {
            const r = await callClaude({
              feature: 'notes', variant: lang, attempt,
              familyId: session.familyId, studentId: body.studentId, mode: replay.mode, recordings: replay.recordings, cost,
              body: { model, ...modelSettings(model), max_tokens: 1500, system, messages: [{ role: 'user', content }] },
            });
            return r.ok ? { ok: true, data: r.data } : { ok: false, status: r.status, errText: r.errText };
          };
          let attempts = 0;
          const result = await callWithJsonRetry(() => callModel(++attempts), (info) => {
            console.warn('notes: unparseable model reply', { language: lang, ...info });
          });
          const extras = (out) => {
            if (!testFamily) return out;
            res.set('X-Model-Usd', String(cost.usd));
            return replay.mode === 'record' ? { ...out, _recordings: replay.recordings } : out;
          };
          if (result.kind !== 'ok') {
            console.error('notes: model call failed', { kind: result.kind, status: result.status || null });
            if (testFamily) res.set('X-Model-Usd', String(cost.usd));
            return res.status(502).json({ error: 'The notes could not be made. Please try again.' });
          }
          const notes = parseNotes(result.data);
          if (!notes) return res.status(502).json({ error: 'The notes could not be made. Please try again.' });
          res.set('X-Notes-Format', notes.plain ? 'plain' : 'structured');
          notesCache.set(cacheKey, notes);
          res.json(extras(notes));
        } catch (err) {
          console.error('notes: server error:', err && err.message);
          if (!res.headersSent) res.status(500).json({ error: 'Server error making notes' });
        }
      }));
    } catch (err) {
      console.error('notes: server error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error making notes' });
    }
  });
}
