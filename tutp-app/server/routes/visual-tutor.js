// POST /api/visual-tutor
// Body (mode "ui"):    { mode: "ui", question, viewport: {w, h}, elements: [...] }
// Body (mode "image"): { mode: "image", question, image: {base64, mediaType, width, height} }
// Mounted in server.js behind requireFamilySessionMw + visualTutorLimiter,
// which sets req.familySession.

import express from 'express';
import { uiSystemPrompt, imageSystemPrompt } from '../prompts/visual-tutor-prompts.js';
import { trackVisualTutorCall } from '../../tracking/tracking.js';

const router = express.Router();
const MODEL = process.env.VISUAL_TUTOR_MODEL || 'claude-sonnet-5';
const TYPES = new Set(['point', 'box', 'highlight', 'underline', 'arrow']);
const TONES = new Set(['info', 'mistake', 'correct']);
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

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
  } else if (mode === 'image') {
    img = req.body.image || {};
    const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(img.mediaType);
    const bytes = img.base64 ? Buffer.byteLength(img.base64, 'base64') : 0;
    if (!okType || !bytes || bytes > MAX_IMAGE_BYTES || !(img.width > 0) || !(img.height > 0)) {
      return res.status(400).json({ error: 'bad_image' });
    }
    system = imageSystemPrompt(img);
    content = [
      { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
      { type: 'text', text: `Parent's question: ${question}` },
    ];
  } else {
    return res.status(400).json({ error: 'bad_mode' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  // One usage_events row per Claude call, whatever the outcome. A parse
  // failure still spent tokens, so it's logged with them.
  const log = (outcome, { steps = null, usage } = {}) => trackVisualTutorCall(req.familySession.familyId, {
    mode, outcome, steps, model: MODEL,
    inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null,
  });

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
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages: [{ role: 'user', content }] }),
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
    const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const clean = sanitize(JSON.parse(raw.replace(/```json|```/g, '').trim()), { validRefs, img });
    log('success', { steps: clean.steps.length, usage: data.usage });
    return res.json(clean);
  } catch (err) {
    console.error('visual-tutor parse', err);
    log('parse_error', { usage: data?.usage });
    return res.status(500).json({ error: 'parse_error' });
  }
});

// Never trust model output: drop hallucinated refs, clamp boxes,
// convert image pixels -> 0..1000 so the client is resolution-independent.
function sanitize(out, { validRefs, img }) {
  const speech = typeof out.speech === 'string' ? out.speech.slice(0, 600) : '';
  const steps = (Array.isArray(out.steps) ? out.steps : [])
    .slice(0, 4)
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

export default router;
