// Which picture a question gets (TUT-19, founder decision 2026-10-09).
//   maths, Class 1-5   one AI "context" picture for the whole page (a setting only: no countable
//                      objects, no numbers, no text) + the exact code-drawn diagram on each card
//   maths, Class 6+    the code-drawn diagram only, no AI picture
//   maths, class unknown   the same as Class 6+ (the safe side: no image spend, no wrong picture)
//   anything else      the concept picture, as before (img1)
// slot: the page asks for the context picture on its first card only ('page'); the others say 'none',
// so one maths page makes one image call.
// Unit tests: tests/unit/picture-rule.test.js.
import crypto from 'crypto';
import { normalizeConceptKey } from './explain-schema.js';
import { normalizeQuestion } from './question-key.js';

export function pictureRule({ maths, band, slot = 'page' }) {
  if (!maths) return 'normal';
  if (band === '1-5') return slot === 'none' ? 'none' : 'context';
  return 'none';
}

// A concept picture belongs to ONE question: the concept_key is shared by every question on the
// same idea, so a picture made for "importance of the atmosphere" (a family flying kites) was
// shown on "Why is life not possible on the Moon?" (2026-10-15). The key is the concept plus a
// hash of the normalised question; Answer cards and Explain use this one function so they still
// share a picture for the same question. Never more than 60 characters.
export function questionPictureKey(conceptKey, questionText) {
  const k = normalizeConceptKey(conceptKey);
  const q = normalizeQuestion(questionText);
  if (!k || !q) return '';
  const h = crypto.createHash('sha256').update(q).digest('hex').slice(0, 8);
  return normalizeConceptKey(k.slice(0, 50).replace(/-+$/, '') + '-q' + h);
}

// A context picture is stored under its own key, so an older concept picture made before this
// rule (with labels like "rice dal oil") is never reused for a maths page.
export function contextPictureKey(conceptKey) {
  const k = String(conceptKey || '');
  return normalizeConceptKey((k.length > 56 ? k.slice(0, 56) : k).replace(/-+$/, '') + '-ctx');
}
