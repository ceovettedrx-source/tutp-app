// Answer Please / Explain Please v2 routes (docs/specs/answer-explain-v2.md).
// Everything here is behind ANSWER_V2_ENABLED (flag off = 404, and the old
// /api/homework path is untouched).
//   POST /api/explain-please        one concept (the page asks for every question of a photo
//                                   at once in Explain please mode); free gets quick only (server/tier-gate.js)
//   GET  /api/illustration/:key     poll for the picture: signed URL when ready; a free family
//                                   gets one picture a day in full, a blurred preview otherwise
//   POST /api/illustration/request  start the picture a surface's signed `picture` describes
//   POST /api/answer-events         answer_check_interest | parent_asked | explain_check |
//                                   picture_upsell_view | picture_upsell_click
// plus helpers server.js uses for /api/homework: answerV2Enabled(),
// loadStudentContext(), signConceptKey().
import crypto from 'crypto';
import { HOMEWORK_LANGUAGES } from '../prompts/homework-prompts.js';
import { explainPrompt, explainUserText, EXPLAIN_PROMPT_VERSION } from '../prompts/explain-prompts.js';
import { callWithJsonRetry, checkReplyJson } from '../homework-reply.js';
import { extractAnswerJson, answerCorrectionHint } from '../answer-schema.js';
import { validateExplain, normalizeConceptKey } from '../explain-schema.js';
import { explainView } from '../tier-gate.js';
import { boardKind } from '../answer-marks.js';
import { callClaude } from '../anthropic.js';
import { MODELS, modelSettings } from '../models.js';
import { replayMode } from '../model-replay.js';
import { isTestFamily } from '../test-families.js';
import { getLearningComponent, getNeighbors } from '../services/knowledgeGraph.js';
import { createIllustrationService } from '../services/illustration-service.js';
import { createConceptPictures, verifyPicture } from '../services/concept-picture.js';
import { e2eOverrides, imageEnv } from '../e2e-overrides.js';

// The Messages API body of one Explain Please call (also used by the golden-set runner).
export function explainRequestBody({ system, content, hint = null }) {
  const model = MODELS.explain_v2;
  return { model, ...modelSettings(model), max_tokens: 2500, system, messages: [{ role: 'user', content: hint ? [...content, { type: 'text', text: hint }] : content }] };
}

// The flag, or (preview only, server/e2e-overrides.js) the e2e header.
export const answerV2Enabled = (req, env = process.env) =>
  env.ANSWER_V2_ENABLED === '1' || env.ANSWER_V2_ENABLED === 'true' || e2eOverrides(req, env).answerV2;

export const ANSWER_EVENTS = ['answer_check_interest', 'parent_asked', 'explain_check', 'picture_upsell_view', 'picture_upsell_click'];
const PICTURE_SURFACES = ['explain', 'notes', 'story', 'answer', 'el', 'exam_prep'];
const KEY_RE = /^[a-z0-9][a-z0-9-]{2,59}$/;

// A concept_key the server has seen come out of an answer is signed, so the
// page can hand it back and Explain can trust it as a shared cache key.
export function signConceptKey(key, secret = process.env.SESSION_SECRET || 'dev') {
  return crypto.createHmac('sha256', secret).update('ck:' + key).digest('hex').slice(0, 16);
}
export function verifyConceptKey(key, sig, secret) {
  const want = signConceptKey(key, secret);
  return typeof sig === 'string' && sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

// { name, cls, curriculum, state, board } for the child, from the students
// row and the family's registration (children[].curriculum).
export async function loadStudentContext(supabase, studentId) {
  const { data: s, error } = await supabase.from('students').select('name, class, state, family_id').eq('id', studentId).maybeSingle();
  if (error) throw error;
  if (!s) return { name: '', cls: '', curriculum: '', state: '', board: 'other' };
  let curriculum = '';
  try {
    const { data: fam } = await supabase.from('family_registrations').select('data').eq('id', s.family_id).maybeSingle();
    const kids = (fam && fam.data && Array.isArray(fam.data.children)) ? fam.data.children : [];
    const mine = kids.find((c) => c && c.name === s.name) || kids[0];
    curriculum = (mine && mine.curriculum) || '';
  } catch { /* board is a hint only */ }
  return { name: s.name || '', cls: s.class || '', curriculum, state: s.state || '', board: boardKind(curriculum, s.state) };
}

function classNumber(cls) {
  const m = String(cls || '').match(/\d{1,2}/);
  return m ? Number(m[0]) : null;
}
const stateSlug = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, '-');

// The knowledge graph's misconception and neighbours for this concept, or
// null. Only real records; in English or Telugu (the languages the graph has).
async function kgExtras({ cls, subject, state, title, lang }) {
  try {
    if (!/math/i.test(subject || '')) return null;
    const grade = classNumber(cls);
    if (!grade) return null;
    const r = await getLearningComponent(grade, 'mathematics', stateSlug(state), title);
    if (!r || !r.sourced) return null;
    const out = {};
    const field = lang === 'Telugu' ? 'te' : lang === 'English' ? 'en' : null;
    if (field) {
      const m = (r.misconceptions || []).find((x) => x['error_pattern_' + field]);
      if (m) out.misconception = { text: m['error_pattern_' + field], source: 'kg' };
      const n = await getNeighbors(r.learningComponent.id);
      const tile = (lc) => (lc && lc['statement_' + field] ? { title: lc['statement_' + field], grade: lc.grade } : null);
      if (tile(n.prev)) out.prev = tile(n.prev);
      if (tile(n.next)) out.next = tile(n.next);
    }
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.warn('explain: knowledge graph lookup failed', err && err.message);
    return null;
  }
}

export function registerAnswerExplainRoutes(app, { rateLimit, supabase, getSession, requireOwnStudent, sendSessionExpired, getPaidStatusForStudents, illustrations }) {
  const familyKey = (req) => 'family:' + String((getSession(req) || {}).familyId);
  const explainLimiter = rateLimit({
    // Explain please now explains every question of a photo at once (8 at most), so 60.
    windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: familyKey, message: { error: 'Too many explanations in a short time. Please wait a few minutes and try again.' },
  });
  const pollLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false,
    keyGenerator: familyKey, message: { error: 'Too many requests.' },
  });
  const eventsLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
    keyGenerator: familyKey, message: { error: 'Too many requests.' },
  });
  const logEvent = (name, familyId, studentId, properties = {}) => {
    supabase.from('usage_events').insert({ event_name: name, family_id: familyId, student_id: studentId, properties })
      .then(({ error }) => { if (error) console.error(name + ' log failed:', error.message); }, () => {});
  };
  const illus = illustrations || createIllustrationService({ supabase, logEvent: (n, p) => logEvent(n, null, null, p) });
  const pictures = createConceptPictures({ supabase, illus });
  const isPaid = async (studentId) => (await getPaidStatusForStudents([studentId]))[studentId].active;
  const off = (res) => res.status(404).json({ error: 'not_found' });

  app.post('/api/explain-please', async (req, res) => {
    if (!answerV2Enabled(req)) return off(res);
    const ov = e2eOverrides(req);
    // e2e only: every run gets its own cache and picture rows.
    const keyed = (k) => (ov.keySuffix ? k.slice(0, 50).replace(/-+$/, '') + '-' + ov.keySuffix : k);
    try {
      const body = req.body || {};
      const question = typeof body.question === 'string' ? body.question.trim().slice(0, 800) : '';
      if (!question) return res.status(400).json({ error: 'Missing question' });
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      const own = await requireOwnStudent(req, res, body.studentId);
      if (!own) return;
      const lang = HOMEWORK_LANGUAGES.includes(body.language) ? body.language : 'English';
      explainLimiter(req, res, async () => {
        try {
          const studentId = body.studentId;
          const paid = await isPaid(studentId);
          const ctx = await loadStudentContext(supabase, studentId);
          const subject = typeof body.subject === 'string' ? body.subject.slice(0, 60) : '';
          const given = typeof body.concept_key === 'string' && KEY_RE.test(body.concept_key) && verifyConceptKey(body.concept_key, body.concept_sig) ? body.concept_key : '';

          let explain = null, cache = 'miss';
          if (given) {
            const { data } = await supabase.from('explain_cache').select('payload').eq('concept_key', keyed(given)).eq('language', lang).maybeSingle();
            if (data && data.payload) { explain = data.payload; cache = 'hit'; }
          }
          const testFamily = await isTestFamily(session.familyId);
          const replay = { mode: replayMode(testFamily, req.get('x-e2e-mode')), recordings: [] };
          const cost = { usd: 0 };
          if (!explain) {
            if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
            const childContext = ctx.name ? ctx.name + (ctx.cls ? ' · ' + ctx.cls : '') : 'your child';
            const system = explainPrompt({ lang, childContext, board: ctx.board, subject, qType: typeof body.qType === 'string' ? body.qType.slice(0, 20) : 'short', conceptKey: given });
            const model = MODELS.explain_v2;
            const baseContent = [{ type: 'text', text: explainUserText(question) }];
            let attempts = 0;
            const callModel = async (extra) => {
              const r = await callClaude({
                feature: 'explain_v2', variant: lang, attempt: ++attempts, familyId: session.familyId, studentId,
                mode: replay.mode, recordings: replay.recordings, cost,
                body: explainRequestBody({ system, content: baseContent, hint: extra }),
              });
              return r.ok ? { ok: true, data: r.data } : { ok: false, status: r.status, errText: r.errText };
            };
            const extras = (out) => {
              if (!testFamily) return out;
              res.set('X-Model-Usd', String(cost.usd));
              return replay.mode === 'record' ? { ...out, _recordings: replay.recordings } : out;
            };
            const fail = (status, msg) => { if (testFamily) res.set('X-Model-Usd', String(cost.usd)); return res.status(status).json({ error: msg }); };
            const first = await callWithJsonRetry(() => callModel(null), (info) => console.warn('explain: unparseable model reply', { language: lang, ...info }));
            if (first.kind !== 'ok') {
              console.error('explain: model call failed', { kind: first.kind, status: first.status || null });
              return fail(502, 'The explanation could not be made. Please try again.');
            }
            let check = validateExplain(extractAnswerJson(first.data));
            if (!check.ok) {
              console.warn('explain: reply failed the checks, retrying once', { issues: check.issues });
              const again = await callModel(answerCorrectionHint(check.issues));
              const c2 = again.ok && checkReplyJson(again.data).ok ? validateExplain(extractAnswerJson(again.data)) : null;
              if (c2 && c2.ok) check = c2;
            }
            if (!check.ok) return fail(502, 'The explanation could not be made. Please try again.');
            explain = check.explain;
            if (given) explain.concept_key = given;
            explain.concept_key = keyed(explain.concept_key);
            const key = explain.concept_key;
            // Another question may already have this concept: keep the stored one.
            const { data: existing } = await supabase.from('explain_cache').select('payload').eq('concept_key', key).eq('language', lang).maybeSingle();
            if (existing && existing.payload) { explain = existing.payload; cache = 'concept-hit'; }
            else {
              const { error } = await supabase.from('explain_cache').upsert({ concept_key: key, language: lang, payload: explain, model, prompt_version: EXPLAIN_PROMPT_VERSION }, { onConflict: 'concept_key,language' });
              if (error) console.error('explain: cache write failed', error.message);
            }
            res.locals.extras = extras;
          }
          res.set('X-Explain-Cache', cache);
          logEvent('explain.generated', session.familyId, studentId, { cache, language: lang, tier: paid ? 'pro' : 'free', concept_key: explain.concept_key });

          // Every family gets a picture (img1); what a free family may SEE is decided
          // when the page polls it (server/services/concept-picture.js).
          const illustration = await pictures.request({ key: explain.concept_key, scene: explain.illustration.scene_prompt, env: imageEnv(ov) });
          let kg = null;
          if (paid) kg = await kgExtras({ cls: ctx.cls, subject, state: ctx.state, title: explain.title, lang });
          const view = explainView(explain, { paid, illustration, kg });
          if (testFamily && replay.mode !== 'replay') res.set('X-Model-Usd', String(cost.usd));
          res.json(res.locals.extras ? res.locals.extras(view) : view);
        } catch (err) {
          console.error('explain: server error:', err && err.message);
          if (!res.headersSent) res.status(500).json({ error: 'Server error making the explanation' });
        }
      });
    } catch (err) {
      console.error('explain: server error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error making the explanation' });
    }
  });

  app.get('/api/illustration/:key', async (req, res) => {
    if (!answerV2Enabled(req)) return off(res);
    try {
      const key = normalizeConceptKey(req.params.key);
      if (!key || key !== req.params.key) return res.status(400).json({ error: 'Bad concept key' });
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      const studentId = String(req.query.studentId || '');
      const own = await requireOwnStudent(req, res, studentId);
      if (!own) return;
      pollLimiter(req, res, async () => {
        try {
          // img1: every family may poll. A free family gets the full picture for one
          // concept a day and a blurred preview (no link to the real file) for the rest.
          const ov = e2eOverrides(req);
          const paid = await isPaid(studentId);
          res.set('Cache-Control', 'no-store');
          res.json(await pictures.status({ familyId: session.familyId, studentId, key, paid, env: imageEnv(ov), run: ov.keySuffix }));
        } catch (err) {
          console.error('illustration: poll error:', err && err.message);
          if (!res.headersSent) res.status(500).json({ error: 'Server error' });
        }
      });
    } catch (err) {
      console.error('illustration: poll error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  // A surface's `picture: { concept_key, scene_prompt, sig }` (signed by the route that
  // made the reply) comes back here; the picture is started if nobody has made it yet.
  // Answers { status, concept_key } (the key carries the e2e suffix on a preview).
  app.post('/api/illustration/request', async (req, res) => {
    if (!answerV2Enabled(req)) return off(res);
    try {
      const body = req.body || {};
      const pic = body.picture && typeof body.picture === 'object' ? body.picture : {};
      const key = normalizeConceptKey(pic.concept_key);
      const scene = typeof pic.scene_prompt === 'string' ? pic.scene_prompt : '';
      if (!key || !scene) return res.status(400).json({ error: 'Bad picture' });
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      const own = await requireOwnStudent(req, res, body.studentId);
      if (!own) return;
      if (!verifyPicture(key, scene, pic.sig)) return res.status(400).json({ error: 'Bad picture' });
      pollLimiter(req, res, async () => {
        try {
          const ov = e2eOverrides(req);
          const keyed = ov.keySuffix ? key.slice(0, 50).replace(/-+$/, '') + '-' + ov.keySuffix : key;
          const st = await pictures.request({ key: keyed, scene, env: imageEnv(ov) });
          res.set('Cache-Control', 'no-store');
          res.json({ status: st.status, concept_key: keyed });
        } catch (err) {
          console.error('illustration: request error:', err && err.message);
          if (!res.headersSent) res.status(500).json({ error: 'Server error' });
        }
      });
    } catch (err) {
      console.error('illustration: request error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/answer-events', async (req, res) => {
    if (!answerV2Enabled(req)) return off(res);
    try {
      const body = req.body || {};
      if (!ANSWER_EVENTS.includes(body.event)) return res.status(400).json({ error: 'Unknown event' });
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      const own = await requireOwnStudent(req, res, body.studentId);
      if (!own) return;
      eventsLimiter(req, res, () => {
        const props = {};
        if (typeof body.concept_key === 'string' && KEY_RE.test(body.concept_key)) props.concept_key = body.concept_key;
        if (body.event === 'explain_check') props.correct = body.correct === true;
        if (body.event === 'picture_upsell_view' || body.event === 'picture_upsell_click') {
          props.surface = PICTURE_SURFACES.includes(body.surface) ? body.surface : 'unknown';
        }
        logEvent(body.event, session.familyId, body.studentId, props);
        res.status(204).end();
      });
    } catch (err) {
      console.error('answer-events: error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });
}
