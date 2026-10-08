// POST /api/tts  { text, lang }  ->  audio/mpeg   (TUT-7, Listen everywhere)
// Needs a session (family or teacher), free on every tier, no student id. Rate-limited
// per family. 503 when the voice can't be made: the page then falls back to the
// browser voice and, failing that, shows "Audio not available".
// Preview with E2E_REPLAY=1: a test family gets a short silent clip, with no Google
// call, unless the e2e header asks for live (the one live check).
import { createTts, TTS_LANGS } from '../tts/index.js';
import { replayMode } from '../model-replay.js';
import { isTestFamily } from '../test-families.js';

// 6 frames of silent MPEG-1 layer 3 (128 kbps, 44.1 kHz), about 0.16 s.
const SILENT = Buffer.concat(Array.from({ length: 6 }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])));

export function registerTtsRoutes(app, { rateLimit, getSession, sendSessionExpired, tts = createTts(), isTest = isTestFamily }) {
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => { const s = getSession(req) || {}; return 'tts:' + String(s.familyId || s.teacherId); },
    message: { error: 'Too many requests.' },
  });

  app.post('/api/tts', async (req, res) => {
    const s = getSession(req);
    if (!s || !(s.familyId || s.teacherId)) return sendSessionExpired(res);
    const text = req.body && req.body.text;
    const lang = req.body && req.body.lang;
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'bad_request' });
    if (!TTS_LANGS.includes(lang)) return res.status(400).json({ error: 'bad_lang', langs: TTS_LANGS });
    return limiter(req, res, async () => {
      try {
        if (process.env.E2E_REPLAY === '1' && s.familyId && (await isTest(s.familyId))
            && replayMode(true, req.get('X-E2E-Mode')) !== 'live') {
          res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Tts-Provider': 'replay' });
          return res.send(SILENT);
        }
        const out = await tts.speak({ text, lang });
        res.set({ 'Content-Type': out.mime, 'Cache-Control': 'private, max-age=86400', 'X-Tts-Provider': out.provider, 'X-Tts-Cached': out.cached ? '1' : '0' });
        return res.send(out.audio);
      } catch (e) {
        if (e.code === 'too_long') return res.status(413).json({ error: 'too_long' });
        if (e.code === 'bad_request' || e.code === 'bad_lang') return res.status(400).json({ error: e.code });
        console.error('tts failed:', e.message);
        return res.status(503).json({ error: 'tts_unavailable' });
      }
    });
  });
}
