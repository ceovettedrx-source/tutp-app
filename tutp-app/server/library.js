// TUT-69 Learning Library: every generated answer, explanation, notes, story, quiz and EL
// output saved per child (table learning_items, migration 036). Spec: docs/specs/TUT-69-learning-library.md.
//
// Writing is fire-and-forget and never changes an HTTP response. Reading goes through
// requireOwnStudent plus item.family_id === session.familyId. Free families open their
// 10 newest items; older ones answer 402 and the payload is never sent.
import { createHash } from 'node:crypto';
import { UPSELL } from './tier-gate.js';
import { canonicalSubject, groupSubjects, subjectVariants } from './subject.js';

export const LIBRARY_MODES = ['answer', 'explain', 'notes', 'story', 'quiz', 'experiential'];
export const PAYLOAD_CAP_BYTES = 200 * 1024;
export const FREE_OPEN_LIMIT = 10;
export const PAGE_SIZE = 30;
export const IMPORT_MAX = 50;
const SOURCE_TEXT_MAX = 300;
const LABEL_MAX = 60;
const DROP_KEYS = new Set(['usage', '_recordings']);

// A string that is a data: URL, or a long run of base64 (an image that slipped in).
function isImageBlob(s) {
  if (typeof s !== 'string') return false;
  if (/^data:/i.test(s.trim())) return true;
  return s.length > 1500 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

// Deep copy without any data: URL / base64 string and without model bookkeeping.
export function sanitizePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizePayload).filter(v => v !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DROP_KEYS.has(k)) continue;
      if (k === 'base64') continue;
      const s = sanitizePayload(v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  if (typeof value === 'string' && isImageBlob(value)) return undefined;
  return value;
}

// e2e only: a preview with E2E_REPLAY=1 can be told to fail the library insert, to prove a save
// failure never changes the homework response. Production never has E2E_REPLAY, so it ignores this.
export function libraryFailRequested(req, env = process.env) {
  return env.E2E_REPLAY === '1' && !!req && typeof req.get === 'function' && req.get('x-e2e-library-fail') === '1';
}

export function contentHash(mode, payload) {
  return createHash('sha256').update(mode + JSON.stringify(payload)).digest('hex');
}

const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

// Builds the row, or returns { skip: reason }. Pure, unit-tested.
export function buildLearningRow({ familyId, studentId, mode, subject, topic, title, language, payload, sourceText, imported = false }) {
  if (!familyId || !studentId) return { skip: 'no_owner' };
  if (!LIBRARY_MODES.includes(mode)) return { skip: 'bad_mode' };
  if (payload === undefined || payload === null) return { skip: 'no_payload' };
  const clean = sanitizePayload(payload);
  const size = Buffer.byteLength(JSON.stringify(clean), 'utf8');
  if (size > PAYLOAD_CAP_BYTES) return { skip: 'too_big', size };
  return {
    row: {
      family_id: familyId,
      student_id: studentId,
      mode,
      subject: canonicalSubject(clip(subject, 80)),
      topic: clip(topic, 160),
      title: clip(title, 200) || 'Untitled',
      language: clip(language, 40),
      payload: clean,
      source_text: clip(sourceText, SOURCE_TEXT_MAX),
      content_hash: contentHash(mode, clean),
      imported: !!imported,
    },
  };
}

// Fire-and-forget. Never throws, never awaited by a route. A duplicate (23505) is a silent skip.
export function saveLearningItem(supabase, item, { forceError = false } = {}) {
  try {
    if (!supabase) return;
    const built = buildLearningRow(item);
    if (built.skip) {
      if (built.skip !== 'no_owner') console.warn('library: item skipped', { mode: item && item.mode, reason: built.skip, size: built.size });
      return;
    }
    const insert = forceError
      ? Promise.resolve({ error: { code: 'XX', message: 'forced by e2e' } })
      : Promise.resolve(supabase.from('learning_items').insert(built.row));
    insert.then(({ error }) => {
      if (error && error.code !== '23505') console.error('library: save failed', error.message);
    }, (err) => console.error('library: save failed', err && err.message));
  } catch (err) {
    console.error('library: save failed', err && err.message);
  }
}

const FEATURE_MODE = { homework_help: 'answer', quiz: 'quiz', storytelling: 'story', experiential_learning: 'experiential' };

// What /api/homework sent (the Anthropic-style envelope, or the checked story), as a library item.
// Only the readable content is kept, never usage or model bookkeeping.
export function describeHomeworkReply(feature, data) {
  const mode = FEATURE_MODE[feature];
  if (!mode || !data) return null;
  const block = Array.isArray(data.content) ? data.content.find(b => b && b.type === 'text') : null;
  const text = block && typeof block.text === 'string' ? block.text : '';
  let obj = null;
  try { const p = JSON.parse(text); if (p && typeof p === 'object') obj = p; } catch (e) { obj = null; }
  const payload = obj || (text ? { text } : null);
  if (!payload) return null;
  const firstQ = obj && Array.isArray(obj.questions) && obj.questions[0] ? (obj.questions[0].q_text || '') : '';
  const subject = obj && typeof obj.subject === 'string' ? obj.subject : null;
  // The title is what the parent saw heading the result: the reply's own title, else its first card
  // (a lesson photo's first concept). The subject is only the last resort, never "Maths" over a real heading.
  const title = (obj && obj.title) || firstQ || (obj && obj.subject) || text.replace(/\s+/g, ' ').slice(0, 80);
  return { mode, subject, topic: obj && typeof obj.topic === 'string' ? obj.topic : (firstQ || null), title, payload };
}

// The row for a /api/homework reply. A story reply has no subject of its own, so the subject the page
// sent (the homework's) is used when the reply gives none; a reply's own subject wins. Never invented.
export function homeworkLibraryItem({ familyId, studentId, language, text, bodySubject }, d) {
  const sent = typeof bodySubject === 'string' ? bodySubject.trim().slice(0, 60) : '';
  return { familyId, studentId, mode: d.mode, subject: d.subject || sent || null, topic: d.topic, title: d.title, language, payload: d.payload, sourceText: text };
}

// The page cursor is "<created_at>|<id>". A bare created_at (an older page) still works, by time alone.
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const makeCursor = (row) => `${row.created_at}|${row.id}`;
export function parseCursor(raw) {
  const [at, id] = String(raw).split('|');
  if (!CURSOR_AT.test(at) || (id !== undefined && !CURSOR_ID.test(id))) return null;
  return { at, id: id || null };
}

const LIST_COLUMNS ='id, mode, subject, topic, lesson_label, title, language, imported, created_at';

export function registerLibraryRoutes(app, { supabase, getSession, requireOwnStudent, sendForbidden, sendSessionExpired, getPaidStatusForStudents, rateLimit }) {
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => 'family:' + String((getSession(req) || {}).familyId),
    message: { error: 'Too many requests.' },
  });
  // The child view shares the family's session cookie, so the page says which view it is.
  // The header only ever narrows what is returned.
  const isChildView = (req) => String(req.get('X-Tutp-View') || '').toLowerCase() === 'child';
  const isPaid = async (studentId) => (await getPaidStatusForStudents([studentId]))[studentId].active;
  const visibleModes = (req) => (isChildView(req) ? LIBRARY_MODES.filter(m => m !== 'answer') : LIBRARY_MODES);

  // The created_at of the 10th newest visible item: a free family opens items at or after it.
  async function freeThreshold(studentId, modes) {
    const { data, error } = await supabase.from('learning_items').select('created_at')
      .eq('student_id', studentId).in('mode', modes).order('created_at', { ascending: false }).limit(FREE_OPEN_LIMIT);
    if (error) throw error;
    return data && data.length >= FREE_OPEN_LIMIT ? data[data.length - 1].created_at : null;
  }

  app.get('/api/library', limiter, async (req, res) => {
    try {
      const studentId = String(req.query.studentId || '');
      const session = await requireOwnStudent(req, res, studentId);
      if (!session) return;
      const modes = visibleModes(req);
      const mode = req.query.mode ? String(req.query.mode) : null;
      if (mode && !modes.includes(mode)) return res.json({ items: [], next: null, subjects: [], locked_after: null });
      // Folders are canonical subjects ("Math" and "Maths" are one), so old rows saved under another spelling still group.
      const { data: all, error: cErr } = await supabase.from('learning_items').select('subject').eq('student_id', studentId).in('mode', modes).limit(5000);
      if (cErr) throw cErr;
      const rawSubjects = all.map(r => r.subject);
      let q = supabase.from('learning_items').select(LIST_COLUMNS).eq('student_id', studentId)
        .in('mode', mode ? [mode] : modes).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE + 1);
      // subject= (empty) is the "Other" chip: items saved with no subject.
      if (req.query.subject === '') q = q.is('subject', null);
      else if (req.query.subject) q = q.in('subject', subjectVariants(rawSubjects, String(req.query.subject)));
      if (req.query.cursor) {
        const cur = parseCursor(req.query.cursor);
        if (!cur) return res.status(400).json({ error: 'Bad cursor' });
        // Keyset on (created_at, id): rows that share a created_at are never skipped or repeated.
        q = cur.id ? q.or(`created_at.lt.${cur.at},and(created_at.eq.${cur.at},id.lt.${cur.id})`) : q.lt('created_at', cur.at);
      }
      const { data, error } = await q;
      if (error) throw error;
      const more = data.length > PAGE_SIZE;
      const items = data.slice(0, PAGE_SIZE);
      const paid = await isPaid(studentId);
      const threshold = paid ? null : await freeThreshold(studentId, modes);
      const out = items.map(i => ({ ...i, subject: canonicalSubject(i.subject), locked: !!threshold && i.created_at < threshold }));
      const subjects = groupSubjects(rawSubjects);
      const last = items[items.length - 1];
      res.json({ items: out, next: more ? makeCursor(last) : null, subjects, tier: paid ? 'pro' : 'free', ...(paid ? {} : { upsell: UPSELL }) });
    } catch (err) {
      console.error('library: list failed', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/library/:id', limiter, async (req, res) => {
    try {
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      const { data: item, error } = await supabase.from('learning_items').select('*').eq('id', req.params.id).maybeSingle();
      if (error) throw error;
      if (!item || Number(item.family_id) !== Number(session.familyId)) return sendForbidden(res);
      if (!(await requireOwnStudent(req, res, item.student_id))) return;
      const modes = visibleModes(req);
      if (!modes.includes(item.mode)) return sendForbidden(res);
      if (!(await isPaid(item.student_id))) {
        const threshold = await freeThreshold(item.student_id, modes);
        if (threshold && item.created_at < threshold) {
          return res.status(402).json({ error: 'library_locked', upsell: UPSELL });
        }
      }
      const { payload, source_text, content_hash, family_id, ...meta } = item;
      res.json({ ...meta, payload });
    } catch (err) {
      console.error('library: get failed', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  app.patch('/api/library/:id', limiter, async (req, res) => {
    try {
      const session = getSession(req);
      if (!session) return sendSessionExpired(res);
      if (isChildView(req)) return sendForbidden(res);
      const label = req.body && req.body.lesson_label;
      if (typeof label !== 'string' || label.length > LABEL_MAX) return res.status(400).json({ error: 'lesson_label must be text of at most ' + LABEL_MAX + ' characters' });
      const { data: item, error } = await supabase.from('learning_items').select('id, family_id, student_id').eq('id', req.params.id).maybeSingle();
      if (error) throw error;
      if (!item || Number(item.family_id) !== Number(session.familyId)) return sendForbidden(res);
      if (!(await requireOwnStudent(req, res, item.student_id))) return;
      const { error: uErr } = await supabase.from('learning_items').update({ lesson_label: label.trim() || null }).eq('id', item.id);
      if (uErr) throw uErr;
      res.json({ ok: true });
    } catch (err) {
      console.error('library: patch failed', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  // Moves the browser's saved explanations (tutp_saved_explanations_<studentId>) to the server.
  // The page deletes its key only after a 200. Re-sending the same items adds nothing.
  app.post('/api/library/import', limiter, async (req, res) => {
    try {
      const body = req.body || {};
      const studentId = String(body.studentId || '');
      const session = await requireOwnStudent(req, res, studentId);
      if (!session) return;
      if (isChildView(req)) return sendForbidden(res);
      if (!Array.isArray(body.items) || body.items.length > IMPORT_MAX) return res.status(400).json({ error: 'items must be a list of at most ' + IMPORT_MAX });
      const rows = [];
      for (const it of body.items) {
        if (!it || typeof it !== 'object' || typeof it.title !== 'string') continue;
        const built = buildLearningRow({
          familyId: session.familyId, studentId, mode: 'explain', title: it.title,
          topic: it.title, payload: { concept_key: it.concept_key || null, title: it.title, quick: it.quick || null, full: it.full || null, traps: it.traps || null }, imported: true,
        });
        if (built.row) rows.push({ ...built.row, ...(Number.isFinite(it.saved_at) ? { created_at: new Date(it.saved_at).toISOString() } : {}) });
      }
      if (rows.length) {
        const { error } = await supabase.from('learning_items').upsert(rows, { onConflict: 'student_id,mode,content_hash', ignoreDuplicates: true });
        if (error) throw error;
      }
      res.json({ ok: true, received: body.items.length, saved: rows.length });
    } catch (err) {
      console.error('library: import failed', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });
}
