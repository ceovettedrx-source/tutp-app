// TUT-73 add-on: the concept picture of a Story (img1). The model's concept_key and
// scene_prompt are cleaned (cleanScenePrompt drops any sentence with a digit or a text
// word), so a one-sentence scene can come back empty and pictureFor() returned null: the
// Story then had no picture and nothing in the log. This builds a safe key and scene in
// code instead. No prompt change, no model call. cleanScenePrompt itself is untouched
// (Answer and Explain depend on it).
//   storyPicture(key, scene, { classNum, seed }) -> { pic, reason, usedFallback }
//     reason: null when the model's own key and scene both survived, else 'key' | 'scene' | 'both'
import crypto from 'crypto';
import { normalizeConceptKey, cleanScenePrompt } from './explain-schema.js';
import { pictureFor } from './services/concept-picture.js';

const GENERIC_TOPIC = 'the lesson';

// "c9-physics-distance-vs-displacement" -> "distance vs displacement" (letters only, so
// the digit rule of cleanScenePrompt cannot empty the scene).
function topicOf(key) {
  const parts = String(key || '').replace(/^c\d+-/, '').split('-').filter(Boolean);
  const words = (parts.length > 1 ? parts.slice(1) : parts).map((w) => w.replace(/[^a-z]/g, '')).filter((w) => w.length > 1);
  return words.join(' ');
}

const sceneFor = (topic) => `A warm friendly illustration of ${topic} in a real Indian everyday setting, for school children.`;

export function fallbackScene(key) {
  const topic = topicOf(key);
  const scene = topic ? cleanScenePrompt(sceneFor(topic)) : '';
  return scene || cleanScenePrompt(sceneFor(GENERIC_TOPIC));
}

export function fallbackKey(classNum, seed) {
  const cls = Number.isInteger(classNum) && classNum >= 1 && classNum <= 12 ? classNum : 5;
  const h = crypto.createHash('sha256').update(String(seed || 'story')).digest('hex').slice(0, 8);
  return `c${cls}-story-${h}`;
}

export function storyPicture(rawKey, rawScene, { classNum, seed, visual } = {}) {
  // A curated library picture already illustrates the story: free, never generated, no fallback.
  if (visual && visual.type === 'library') return { pic: null, reason: null, usedFallback: false };
  const key = normalizeConceptKey(rawKey);
  // scene_prompt is English by contract: a scene with no Latin words (Telugu only) is unusable.
  const cleaned = cleanScenePrompt(rawScene);
  const scene = /[A-Za-z]{3}/.test(cleaned) ? cleaned : '';
  const reason = !key && !scene ? 'both' : !key ? 'key' : !scene ? 'scene' : null;
  if (!reason) return { pic: pictureFor(key, scene), reason: null, usedFallback: false };
  const useKey = key || fallbackKey(classNum, seed);
  const useScene = scene || fallbackScene(useKey);
  const pic = pictureFor(useKey, useScene);
  return { pic, reason, usedFallback: !!pic };
}
