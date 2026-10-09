// Explain Please: the model's reply is checked in code (docs/specs/answer-explain-v2.md
// section B). validateExplain(raw) -> { ok: true, explain } | { ok: false, issues[] }.
//   - concept_key is normalised to a lowercase slug (a-z, 0-9, -), at most 60 chars
//   - traps are exactly 3, parent_questions exactly 2, check options exactly 3
//   - the check options are shuffled in code (models put the right one first
//     far too often) and correct_index follows the shuffle
//   - scene_prompt: any clause that asks for text, letters, numbers, signs or
//     labels is cut out, then the no-text suffix is ALWAYS appended
//     (finalScenePrompt); labels are only ever an HTML overlay
//   - misconception is {text, source: 'model'}; the route replaces it with
//     the knowledge graph's when a record matches (source 'kg')
// Unit tests: tests/unit/explain-schema.test.js.
import crypto from 'crypto';
import { foreignScriptIn, FOREIGN_SCRIPT_HINT, romanizedHindiIn, ROMANIZED_HINDI_HINT } from './lang-check.js';
import { wrongFacts, factHint } from './fact-guard.js';

export const POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
export const IMAGE_SUFFIX = 'No text, no letters, no numbers, no labels, no signs anywhere in the picture.';
const TEXT_WORDS = /\b(text|texts|word|words|letter|letters|number|numbers|numeral|numerals|digit|digits|label|labels|labelled|labeled|caption|captions|sign|signs|signboard|write|writes|written|writing|title|alphabet|font|handwriting|speech bubble|equation|formula)\b/i;

// TUT-18: a picture label is a science term for a region of the picture. A possessive or a
// verb phrase ("Today's roti", "steam rises") is an analogy word, not a term: dropped.
const ANALOGY_LABEL = /['’]s\b|\b(rises?|falls?|goes|go|comes?|moves?|flows?|is|are|becomes?)\b/i;

const str = (v, max = 1500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function normalizeConceptKey(k) {
  const s = String(k || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return /^[a-z0-9][a-z0-9-]{2,}$/.test(s) ? s : '';
}

// Sentences of the model's scene that ask for text are dropped.
export function cleanScenePrompt(s) {
  const parts = String(s || '').split(/(?<=[.!?;])\s+|,\s+(?=with|showing|and|where)/i);
  const kept = parts.filter((p) => p && !TEXT_WORDS.test(p) && !/\d/.test(p));
  return kept.join(' ').trim().slice(0, 400);
}

// TUT-19: the context picture of a maths page (Class 1-5) shows a setting only.
// A sentence that names countable things, a quantity or a number word is dropped, so the
// picture can never show "5 apples" beside a sum that says 3 + 2.
export const MATHS_IMAGE_SUFFIX = 'Only the setting, no countable objects, no groups of things, no numbers, no text, no labels, no signs anywhere in the picture.';
const COUNTABLE = /\b(apples?|mangos?|mangoes|bananas?|oranges?|fruits?|coins?|rupees?|notes?|sweets?|laddus?|candy|candies|chocolates?|biscuits?|marbles?|balls?|pencils?|pens?|books?|toys?|flowers?|birds?|eggs?|stones?|sticks?|beads?|buttons?|stars?|cups?|plates?|glasses|bottles?|packets?|bags?|boxes|rice|dal|oil|dozen|pairs?|groups?|rows?|piles?|bunch(?:es)?|lots?|many|few|several|some|one|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|thousand|half|each|every|equal)\b/i;
export function mathsScenePrompt(scene, conceptKey = '') {
  const parts = String(scene || '').split(/(?<=[.!?;])\s+|,\s+(?=with|showing|and|where)/i);
  const kept = parts.filter((p) => p && !TEXT_WORDS.test(p) && !/\d/.test(p) && !COUNTABLE.test(p));
  const base = kept.join(' ').trim().slice(0, 300)
    || 'A simple, friendly everyday place in India, such as a market lane or a classroom, with nobody counting anything.';
  return `${base} Flat, warm, child-friendly illustration. ${MATHS_IMAGE_SUFFIX}`;
}

// What is sent to the image model: the cleaned scene and the suffix, always.
export function finalScenePrompt(scene, conceptKey = '') {
  const base = cleanScenePrompt(scene)
    || `A simple, friendly everyday scene from India that illustrates the idea of ${String(conceptKey).replace(/^c\d+-/, '').replace(/-/g, ' ') || 'the lesson'}.`;
  return `${base} Flat, warm, child-friendly illustration. ${IMAGE_SUFFIX}`;
}

// Deterministic shuffle (seeded by the concept and question) of the options.
function shuffled(options, seed) {
  const idx = [0, 1, 2];
  let h = crypto.createHash('sha256').update(seed).digest();
  for (let i = idx.length - 1; i > 0; i--) {
    const j = h[i] % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export function validateExplain(raw) {
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['the reply is not a JSON object'] };
  const conceptKey = normalizeConceptKey(raw.concept_key);
  if (!conceptKey) issues.push('concept_key must be a lowercase slug like c9-physics-distance-vs-displacement');
  const title = str(raw.title, 120), quick = str(raw.quick, 600), full = str(raw.full, 2500);
  if (!title) issues.push('title is empty');
  if (!quick) issues.push('quick is empty');
  if (!full) issues.push('full is empty');
  const traps = (Array.isArray(raw.traps) ? raw.traps : []).map((t) => str(t, 300)).filter(Boolean);
  if (traps.length !== 3) issues.push('traps must hold exactly 3 items');
  const pq = (Array.isArray(raw.parent_questions) ? raw.parent_questions : [])
    .map((p) => ({ q: str(p && p.q, 400), expected_answer_hint: str(p && p.expected_answer_hint, 500) })).filter((p) => p.q);
  if (pq.length !== 2) issues.push('parent_questions must hold exactly 2 items');
  const cq = raw.check_question && typeof raw.check_question === 'object' ? raw.check_question : {};
  const options = (Array.isArray(cq.options) ? cq.options : []).map((o) => str(o, 200));
  const ci = cq.correct_index;
  if (!str(cq.q, 500) || options.length !== 3 || options.some((o) => !o) || !Number.isInteger(ci) || ci < 0 || ci > 2) {
    issues.push('check_question needs q, exactly 3 non-empty options and correct_index 0, 1 or 2');
  }
  if (!str(cq.right_feedback) || !str(cq.wrong_feedback)) issues.push('check_question needs right_feedback and wrong_feedback');
  // TUT-19: both are optional. "answer" is the final result of a plain arithmetic question (the
  // math engine checks it; the model's word is never shown as "checked"); "tip" is one short
  // memory trick in the reply language.
  const answer = str(raw.answer, 40), tip = str(raw.tip, 300);
  const ill = raw.illustration && typeof raw.illustration === 'object' ? raw.illustration : {};
  const scene = str(ill.scene_prompt, 500);
  if (!scene) issues.push('illustration.scene_prompt is empty');
  // img1 (server/lang-check.js): a letter of a wrong script inside a word is a hard issue.
  if (foreignScriptIn([title, quick, full, tip, traps, raw.misconception, pq, cq, ill.labels])) issues.push(FOREIGN_SCRIPT_HINT);
  // TUT-18: one language per reply (no Hindi in Latin letters) and no known wrong fact.
  if (romanizedHindiIn([title, quick, full, traps, raw.misconception, pq, cq])) issues.push(ROMANIZED_HINDI_HINT);
  const facts = wrongFacts([title, quick, full, traps, raw.misconception, pq, cq]);
  if (facts.length) issues.push(factHint(facts));
  if (issues.length) return { ok: false, issues };

  const order = shuffled(options, conceptKey + '|' + str(cq.q, 500));
  const newOptions = order.map((i) => options[i]);
  const labels = (Array.isArray(ill.labels) ? ill.labels : []).slice(0, 4)
    .map((l) => ({ text: str(l && l.text, 24), position: POSITIONS.includes(l && l.position) ? l.position : 'center' }))
    .filter((l) => l.text && !ANALOGY_LABEL.test(l.text));
  return {
    ok: true,
    explain: {
      concept_key: conceptKey, title, quick, full, traps, ...(answer ? { answer } : {}), ...(tip ? { tip } : {}),
      misconception: { text: str(raw.misconception && raw.misconception.text !== undefined ? raw.misconception.text : raw.misconception, 600), source: 'model' },
      parent_questions: pq,
      check_question: {
        q: str(cq.q, 500), options: newOptions, correct_index: order.indexOf(ci),
        right_feedback: str(cq.right_feedback), wrong_feedback: str(cq.wrong_feedback),
      },
      illustration: { scene_prompt: finalScenePrompt(scene, conceptKey), labels },
    },
  };
}
