// TUT-66 Watch & Learn routes. The card is optional everywhere: any problem answers { videos: [] }
// with 200, so a results page never breaks. The plan comes from payments only, never from the request.
import { createWatchLearn } from '../youtube/watch-learn.js';
import { mockYoutubeFetch } from '../youtube/e2e-mock.js';

const clean = (v, n = 120) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export function registerWatchLearnRoutes(app, { rateLimit, supabase, getSession, requireOwnStudent, sendSessionExpired, getPaidStatusForStudents, env = process.env }) {
  const e2e = env.E2E_REPLAY === '1';
  // On an e2e preview the YouTube API is a mock, and its "quota" answer must not stop the next test.
  const watch = createWatchLearn({
    supabase, fetchFn: e2e ? mockYoutubeFetch : fetch,
    env: e2e ? { ...env, WATCH_LEARN_YOUTUBE_KEY: 'e2e-mock' } : env, ...(e2e ? { cooldownMs: 0 } : {}),
  });
  const familyKey = (req) => 'family:' + String((getSession(req) || {}).familyId);
  const getLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: familyKey, message: { error: 'Too many requests. Please wait a few minutes.' } });
  const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: familyKey, message: { error: 'Too many reports. Please try again later.' } });

  async function lessonOf(studentId, q) {
    const { data } = await supabase.from('students').select('class').eq('id', studentId).maybeSingle();
    return {
      board: null, cls: data && data.class != null ? data.class : null,
      subject: clean(q.subject, 60), lessonTitle: clean(q.lesson), lang: clean(q.language, 20) || 'English',
    };
  }

  app.get('/api/watch-learn', (req, res) => {
    const session = getSession(req);
    if (!session) return sendSessionExpired(res);
    getLimiter(req, res, async () => {
      res.set('Cache-Control', 'no-store');
      try {
        const studentId = clean(req.query.studentId, 64);
        const own = await requireOwnStudent(req, res, studentId);
        if (!own) return;
        const lesson = await lessonOf(studentId, req.query);
        const paid = (await getPaidStatusForStudents([studentId]))[studentId] || {};
        const out = await watch.get({ ...lesson, tier: paid.active ? (paid.tier || 'pro') : 'free' });
        if (!out) return res.json({ videos: [], locked: 0 });
        const body = { videos: out.videos, locked: out.locked };
        if (e2e) body.api_calls = out.api_calls;
        res.json(body);
      } catch (err) {
        console.error('watch-learn error:', err && err.message);
        if (!res.headersSent) res.json({ videos: [], locked: 0 });
      }
    });
  });

  app.post('/api/watch-learn/report', (req, res) => {
    const session = getSession(req);
    if (!session) return sendSessionExpired(res);
    reportLimiter(req, res, async () => {
      try {
        const body = req.body || {};
        const studentId = clean(body.studentId, 64);
        const own = await requireOwnStudent(req, res, studentId);
        if (!own) return;
        const lesson = await lessonOf(studentId, body);
        const r = await watch.report({ ...lesson, videoId: clean(body.videoId, 20), studentId, familyId: session.familyId });
        if (!r.ok) return res.status(400).json({ error: 'Bad report' });
        try {
          await supabase.from('usage_events').insert({
            event_name: 'feedback.video_reported', family_id: session.familyId, student_id: studentId,
            properties: { video_id: clean(body.videoId, 20), lesson: lesson.lessonTitle, subject: lesson.subject, language: lesson.lang },
          });
        } catch { /* the report itself is stored; the log line never fails it */ }
        res.json({ ok: true });
      } catch (err) {
        console.error('watch-learn report error:', err && err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
      }
    });
  });
}
