// POST /api/visual-tutor
// Body (mode "ui"):    { mode: "ui", question, viewport: {w, h}, elements: [...] }
// Body (mode "image"): { mode: "image", question, image: {base64, mediaType, width, height} }
// Homework Help "Explain on photo" (round B2):
// Body (mode "explain_line"): { mode, question (the card's question), answer
//   (the card's answer), language, image (a crop around that question's line) }
//   -> { found, steps }
// Body (mode "locate_line"): { mode, question, image (the whole photo) }
//   -> { found, box (0..1000) }, when the crop missed its question.
// Mounted in server.js behind requireFamilySessionMw + visualTutorLimiter,
// which sets req.familySession.

import express from 'express';
import { uiSystemPrompt, imageSystemPrompt, explainLineSystemPrompt, locateLineSystemPrompt } from '../prompts/visual-tutor-prompts.js';
import { HOMEWORK_LANGUAGES } from '../prompts/homework-prompts.js';
import { POINTING_MODEL, POINTING_SETTINGS } from '../pointing-model.js';
import { trackVisualTutorCall } from '../../tracking/tracking.js';
import { stepTimer } from '../step-timer.js';

const router = express.Router();
const MODEL = POINTING_MODEL;
const IMAGE_MODES = new Set(['image', 'explain_line', 'locate_line']);
const TYPES = new Set(['point', 'box', 'highlight', 'underline', 'arrow']);
const TONES = new Set(['info', 'mistake', 'correct']);
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
// 900 was too few: a worksheet with 5 mistakes ran past it and the reply was
// cut off mid-JSON (500 parse_error, 2026-09-27). The image prompt now asks
// for at most 3 steps (2 mistakes + 1 correct) with short text, and a cut-off
// reply is reported as "truncated" instead of a parse error.
const MAX_TOKENS = 1600;

// X-Server-Time-Ms on every response: time spent in this server, from the
// request reaching this router to the reply (the model call included). The
// e2e suite holds this to the 8-second budget; the parent's own network time
// comes on top and isn't ours to control.
// Server-Timing splits it into steps (the model call, then the rest), and
// calls that reached the model log the same split.
router.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  req.timer = stepTimer();
  const json = res.json.bind(res);
  res.json = (body) => {
    res.set('X-Server-Time-Ms', String(Number((process.hrtime.bigint() - t0) / 1000000n)));
    if (req.modelCalled) {
      req.timer.mark('reply');
      res.set('Server-Timing', req.timer.header());
      console.log('visual-tutor: timing', { mode: req.body && req.body.mode, status: res.statusCode, steps: req.timer.summary() });
    }
    return json(body);
  };
  next();
});
router.use(express.json({ limit: '3mb' }));

router.post('/', async (req, res) => {
  const { mode, question } = req.body || {};
  if (!question || typeof question !== 'string' || question.length > 500) {
    return res.status(400).json({ error: 'question_required' });
  }

  let system, content, validRefs = null, img = null;

  if (mode === 'ui') {
    const elements = Array.isArray(req.body.elements) ? req.body.elements.slice(0, 120) : [];
    if (!elements.length) return res.status(400).json({ error: 'no_elements' });
    validRefs = new Set(elements.map((e) => String(e.ref)));
    system = uiSystemPrompt();
    content = [{
      type: 'text',
      text: `Screen elements:\n${JSON.stringify(elements)}\n\nParent's question: ${question}`,
    }];
  } else if (IMAGE_MODES.has(mode)) {
    img = req.body.image || {};
    const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(img.mediaType);
    const bytes = img.base64 ? Buffer.byteLength(img.base64, 'base64') : 0;
    if (!okType || !bytes || bytes > MAX_IMAGE_BYTES || !(img.width > 0) || !(img.height > 0)) {
      return res.status(400).json({ error: 'bad_image' });
    }
    const imageBlock = { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } };
    if (mode === 'image') {
      system = imageSystemPrompt(img);
      content = [imageBlock, { type: 'text', text: `Parent's question: ${question}` }];
    } else if (mode === 'explain_line') {
      const answer = typeof req.body.answer === 'string' ? req.body.answer.slice(0, 300) : '';
      const language = HOMEWORK_LANGUAGES.includes(req.body.language) ? req.body.language : 'English';
      system = explainLineSystemPrompt({ width: img.width, height: img.height, language });
      content = [imageBlock, { type: 'text', text: `Tapped question: ${question}\nCard answer: ${answer || 'not given'}` }];
    } else {
      system = locateLineSystemPrompt(img);
      content = [imageBlock, { type: 'text', text: `Question to find: ${question}` }];
    }
  } else {
    return res.status(400).json({ error: 'bad_mode' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  // One usage_events row per Claude call, whatever the outcome. A parse
  // failure still spent tokens, so it's logged with them.
  const log = (outcome, { steps = null, usage, stopReason = null } = {}) => trackVisualTutorCall(req.familySession.familyId, {
    mode, outcome, steps, model: MODEL, stopReason,
    inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null,
  });

  req.timer.mark('prepare');
  req.modelCalled = true;
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID,
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, ...POINTING_SETTINGS, system, messages: [{ role: 'user', content }] }),
    });
    if (!r.ok) {
      console.error('visual-tutor upstream', r.status, await r.text());
      log('upstream_error');
      return res.status(502).json({ error: 'upstream' });
    }
  } catch (err) {
    console.error('visual-tutor network', err);
    log('upstream_error');
    return res.status(502).json({ error: 'upstream' });
  }

  let data;
  try {
    data = await r.json();
  } catch (err) {
    console.error('visual-tutor upstream body', err);
    log('upstream_error');
    return res.status(502).json({ error: 'upstream' });
  }
  req.timer.mark('model');
  const stopReason = data.stop_reason || null;

  // Hit the token limit: the JSON is incomplete, so don't try to parse it.
  if (stopReason === 'max_tokens') {
    console.warn('visual-tutor truncated', { mode, outputTokens: data.usage?.output_tokens ?? null, maxTokens: MAX_TOKENS });
    log('truncated', { usage: data.usage, stopReason });
    return res.status(502).json({ error: 'truncated' });
  }

  try {
    const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(extractJson(raw));
    const clean = mode === 'explain_line' ? sanitizeExplain(parsed, img)
      : mode === 'locate_line' ? sanitizeLocate(parsed, img)
      : sanitize(parsed, { validRefs, img });
    log('success', { steps: clean.steps ? clean.steps.length : null, usage: data.usage, stopReason });
    return res.json(clean);
  } catch (err) {
    console.error('visual-tutor parse', err.message, { stopReason });
    log('parse_error', { usage: data.usage, stopReason });
    return res.status(500).json({ error: 'parse_error' });
  }
});

// The JSON object is everything from the first "{" to the last "}", which
// also drops code fences or a stray sentence around it.
function extractJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in reply');
  return raw.slice(start, end + 1);
}

// Never trust model output: drop hallucinated refs, clamp boxes,
// convert image pixels -> 0..1000 so the client is resolution-independent.
function sanitize(out, { validRefs, img, maxSteps = 4 }) {
  const speech = typeof out.speech === 'string' ? out.speech.slice(0, 600) : '';
  const steps = (Array.isArray(out.steps) ? out.steps : [])
    .slice(0, maxSteps)
    .map((s) => {
      if (!s || !TYPES.has(s.type)) return null;
      const target = fixTarget(s.target, { validRefs, img });
      if (!target) return null;
      const step = {
        type: s.type,
        target,
        tone: TONES.has(s.tone) ? s.tone : 'info',
        label: typeof s.label === 'string' ? s.label.slice(0, 48) : undefined,
        say: typeof s.say === 'string' ? s.say.slice(0, 240) : undefined,
      };
      if (s.type === 'arrow' && s.from) step.from = fixTarget(s.from, { validRefs, img }) || undefined;
      return step;
    })
    .filter(Boolean);
  return { speech, steps };
}

function fixTarget(t, { validRefs, img }) {
  if (!t) return null;
  if (validRefs) {
    return t.kind === 'element' && validRefs.has(String(t.ref)) ? { kind: 'element', ref: String(t.ref) } : null;
  }
  if (img && t.kind === 'image' && Array.isArray(t.box) && t.box.length === 4) {
    let [x1, y1, x2, y2] = t.box.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    [x1, x2] = [clamp(Math.min(x1, x2), 0, img.width), clamp(Math.max(x1, x2), 0, img.width)];
    [y1, y2] = [clamp(Math.min(y1, y2), 0, img.height), clamp(Math.max(y1, y2), 0, img.height)];
    if (x2 - x1 < 4 || y2 - y1 < 4) return null;
    const n = (v, max) => Math.round((v / max) * 1000);
    return { kind: 'image', box: [n(x1, img.width), n(y1, img.height), n(x2, img.width), n(y2, img.height)] };
  }
  return null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// explain_line: { found, steps } with up to 5 checked steps (boxes 0..1000 of
// the crop). found is false when the model says so or no step survives.
function sanitizeExplain(out, img) {
  if (!out || out.found === false) return { found: false, steps: [] };
  const { steps } = sanitize(out, { validRefs: null, img, maxSteps: 5 });
  return steps.length ? { found: true, steps } : { found: false, steps: [] };
}

// locate_line: { found, box } with the box 0..1000 of the whole photo.
function sanitizeLocate(out, img) {
  const target = out && out.found !== false ? fixTarget({ kind: 'image', box: out.box }, { validRefs: null, img }) : null;
  return target ? { found: true, box: target.box } : { found: false, box: null };
}

export { sanitize, sanitizeExplain, sanitizeLocate };
export default router;
