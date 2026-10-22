// After an illustration is generated, one cheap vision call asks whether it shows what its scene
// text says (2026-10-15: a cracked desert came back for "a mother boiling tea, steam rising").
//
//   checkPicture({ buffer, contentType, scene, call? }) -> { match: true|false|null, reason, usd }
//   match null = could not check (no key, API error, unreadable reply): the caller keeps the picture.
//
// The picture is made once per question and reused for every family, so this is a one-time cost
// per picture (about a tenth of a cent on haiku-4-5). The caller stores the verdict with the
// picture so it is never checked again. Unit tests: tests/unit/picture-check.test.js.
import { callClaude } from '../anthropic.js';
import { IMAGE_SUFFIX } from '../explain-schema.js';
import { MODELS } from '../models.js';

export const PICTURE_CHECK_MODEL = MODELS.picture_check;
const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const PICTURE_CHECK_PROMPT = 'You check a children\'s lesson picture. Below is the description the picture was made from. '
  + 'Does the picture clearly show what the description says (the main subject, the place and the action)? '
  + 'Answer "no" if the main subject is missing or something unrelated is shown instead (for example a desert for a kitchen, people flying kites for a picture of the Moon). '
  + 'Ignore art style, colour and small details. Reply with JSON only: {"match":true|false,"reason":"at most 15 words"}.';

export function parseVerdict(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (typeof j.match !== 'boolean') return null;
    return { match: j.match, reason: String(j.reason || '').slice(0, 160) };
  } catch { return null; }
}

export async function checkPicture({ buffer, contentType, scene, call = callClaude, cost = null }) {
  try {
    const mediaType = MEDIA_TYPES.includes(contentType) ? contentType : 'image/png';
    const description = String(scene || '').replace(IMAGE_SUFFIX, '').trim();
    const r = await call({
      feature: 'picture_check', cost,
      body: {
        model: PICTURE_CHECK_MODEL, max_tokens: 120,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(buffer).toString('base64') } },
          { type: 'text', text: `${PICTURE_CHECK_PROMPT}\n\nDescription: ${description}` },
        ] }],
      },
    });
    if (!r.ok) return { match: null, reason: 'check_failed', usd: r.usd || 0 };
    const text = ((r.data && r.data.content) || []).map((b) => b.text || '').join('');
    const v = parseVerdict(text);
    return v ? { ...v, usd: r.usd || 0 } : { match: null, reason: 'unreadable_verdict', usd: r.usd || 0 };
  } catch (err) {
    return { match: null, reason: 'check_error', usd: 0 };
  }
}
