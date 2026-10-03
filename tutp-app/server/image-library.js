// Story image library, run-time side (docs/specs/story-image-library.md). The
// pictures are made offline (scripts/imglib/) and read from
// scripts/imglib/library/manifest.json; nothing here calls a model. Labels are
// drawn by the page on top of the label-free image, in the story's language.
// Unit tests: tests/unit/image-library.test.js.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const LIB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'imglib', 'library');

// The page's "Tell the story in" names -> glossary language codes. Any other
// language falls back to English.
export const LANG_CODE = { English: 'en', Telugu: 'te', Hindi: 'hi', Tamil: 'ta' };
export const MAX_CANDIDATES = 15;
export const REPORT_THRESHOLD = 3;        // distinct families
export const REPORT_WINDOW_DAYS = 30;
export const IMAGE_REPORTED = 'image.reported';

export function loadLibrary(dir = LIB_DIR) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const glossary = JSON.parse(fs.readFileSync(path.join(dir, 'glossary.json'), 'utf8'));
    return { images: Array.isArray(manifest.images) ? manifest.images : [], glossary };
  } catch (e) {
    console.warn('image library: not loaded, stories get no library pictures', e.message);
    return { images: [], glossary: {} };
  }
}

// "Class 5", "5th", "Grade 7 · CBSE" -> 5, 7; null when there is no number.
export function classNumber(s) {
  const m = String(s || '').match(/\d{1,2}/);
  const n = m ? Number(m[0]) : null;
  return n >= 1 && n <= 12 ? n : null;
}

const CLASS_SLACK = 2; // a child may read a lesson a little above or below the class
const isLatin = (s) => /^[a-z0-9 \-']+$/i.test(s);
function hasAlias(text, alias) {
  const a = alias.toLowerCase().trim();
  if (a.length < 2) return false;
  if (!isLatin(a)) return text.includes(a.normalize('NFC'));
  const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
  return new RegExp(`(^|[^a-z])${esc}(s|es)?($|[^a-z])`, 'i').test(text);
}

const usable = (img, hidden) => img && img.status === 'approved' && !(hidden && hidden.has(img.id));
const fitsClass = (img, classNum) => classNum == null || (classNum >= img.classMin - CLASS_SLACK && classNum <= img.classMax + CLASS_SLACK);

// Up to `limit` approved, not hidden images that fit the lesson: aliases (any
// language) found in the typed text, best first. With no typed text (a photo
// lesson) the class-fitting images are offered and the model judges the fit.
export function candidatesFor(lib, { text, classNum, hidden, limit = MAX_CANDIDATES }) {
  const pool = lib.images.filter((img) => usable(img, hidden) && fitsClass(img, classNum));
  const t = String(text || '').normalize('NFC').toLowerCase();
  if (!t.trim()) return pool.slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
  const scored = [];
  for (const img of pool) {
    let score = 0;
    for (const list of Object.values(img.aliases || {})) {
      for (const alias of list) if (hasAlias(t, alias)) score += /\s/.test(alias.trim()) ? 2 : 1;
    }
    if (score > 0) scored.push({ img, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.img.id.localeCompare(b.img.id)).slice(0, limit).map((s) => s.img);
}

// The one-line description the prompt shows for a candidate.
export const promptLine = (img) => `${img.id}: ${img.description}`;

// A library image for one story language: the picture plus its pins and legend.
// term = the name in the story language (English when the glossary has none),
// source = the English term in brackets (empty when the term already is English).
export function buildLibraryVisual(lib, id, langName, hidden) {
  const img = lib.images.find((x) => x.id === id);
  if (!usable(img, hidden)) return null;
  const code = LANG_CODE[langName] || 'en';
  const labels = [];
  for (const a of img.anchors || []) {
    const g = lib.glossary[a.key];
    if (!g || !g.en) continue;
    const term = g[code] || g.en;
    labels.push({ n: labels.length + 1, x: a.x, y: a.y, term, source: term !== g.en ? g.en : '' });
  }
  return { type: 'library', id: img.id, src: `/imglib/${img.file}`, alt: img.alt || img.description, labels };
}

// What validateStory needs: the ids that were offered in the prompt and a
// builder. offered is a Set of ids.
export function storyLibraryContext(lib, { text, classNum, langName, hidden }) {
  const candidates = candidatesFor(lib, { text, classNum, hidden });
  return {
    candidates,
    offered: new Set(candidates.map((c) => c.id)),
    build: (id) => buildLibraryVisual(lib, id, langName, hidden),
  };
}

// usage_events rows ({family_id, properties: {image_id}, created_at}) -> the
// ids reported by at least `threshold` distinct families in the window.
// notBefore: { id: ms } ignores the reports made before that image was last
// regenerated (a regenerated image starts with a clean slate).
export function hiddenFromReports(rows, { now = Date.now(), windowDays = REPORT_WINDOW_DAYS, threshold = REPORT_THRESHOLD, notBefore = {} } = {}) {
  const since = now - windowDays * 86400000;
  const families = new Map();
  for (const r of rows || []) {
    const id = r && r.properties && r.properties.image_id;
    const at = Date.parse(r && r.created_at);
    if (typeof id !== 'string' || !(at >= since) || !(at >= (notBefore[id] || 0)) || r.family_id == null) continue;
    if (!families.has(id)) families.set(id, new Set());
    families.get(id).add(String(r.family_id));
  }
  return new Set([...families].filter(([, f]) => f.size >= threshold).map(([id]) => id));
}

// The hidden set, looked up at most once per ttl. fetchRows() reads the
// reports of the last window; a failed lookup keeps the last good set.
export function createHiddenCache({ fetchRows, notBefore = () => ({}), ttlMs = 5 * 60 * 1000, now = () => Date.now() }) {
  let set = new Set();
  let at = -Infinity;
  let pending = null;
  async function refresh() {
    try { set = hiddenFromReports(await fetchRows(), { now: now(), notBefore: notBefore() }); at = now(); } catch (e) { console.warn('image reports lookup failed:', e.message); at = now() - ttlMs + 30000; }
    pending = null;
  }
  return {
    async get() {
      if (now() - at >= ttlMs) { pending = pending || refresh(); await pending; }
      return set;
    },
    invalidate() { at = -Infinity; },
  };
}
