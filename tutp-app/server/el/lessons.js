// Loads the generated Guided Discovery lessons (server/el/content/*.json),
// checks each one again (schema and the deterministic safety gate, so a
// hand-edited file cannot serve a failing experiment), joins the board
// mappings from the knowledge graph, and matches a typed topic to a concept.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONCEPTS, getConcept, PHET } from './concepts.js';
import { validateLesson } from './schema.js';
import { checkExperiment } from './safety.js';
import { getStateMappingsForOutcome } from '../services/knowledgeGraph.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'content');

let loaded = null;
export function loadLessons({ dir = DIR, log = console } = {}) {
  const map = new Map();
  for (const c of CONCEPTS) {
    const f = path.join(dir, c.id + '.json');
    if (!fs.existsSync(f)) continue;
    let lesson;
    try { lesson = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { log.error('el.lesson_unreadable', c.id); continue; }
    const v = validateLesson(lesson);
    if (!v.ok) { log.error('el.lesson_invalid', c.id, v.errors.join(',')); continue; }
    if (lesson.experiment) {
      const s = checkExperiment(lesson.experiment);
      if (!s.ok) { log.warn('el.experiment_dropped_at_load', c.id, s.reasons[0]); lesson.experiment = null; }
    }
    if (!lesson.experiment && !lesson.sim.slugs.length) continue;
    lesson.simUrls = lesson.sim.slugs.map(PHET);
    map.set(c.id, lesson);
  }
  return map;
}
export function lessons() { return loaded || (loaded = loadLessons()); }
export function resetLessonsForTest() { loaded = null; }

export const loIdFor = (conceptId) => `in-ncf2023-science-el-${conceptId}-lo-001`;

// What the page may say about a board: a chapter only when the mapping is
// sourced; a placeholder mapping gives no chapter at all (never a guess).
export async function mappingFor(conceptId, board) {
  const maps = await getStateMappingsForOutcome(loIdFor(conceptId));
  const m = maps.find((x) => x.state === board);
  if (!m) return { board, verification_status: 'none', chapter: null };
  return {
    board, verification_status: m.verification_status,
    chapter: m.verification_status === 'sourced' ? m.textbook_chapter : null,
    grade: m.verification_status === 'sourced' ? m.grade : null,
    sourceUrl: m.source && m.source.url || null,
  };
}

// Typed topic -> concept id, or null. Whole-word / whole-phrase alias match;
// the concept with the longest matching alias wins; ties -> null (never a
// guess between two lessons).
export function matchConcept(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9ऀ-෿' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  if (t.trim().length < 3) return null;
  const hits = [];
  for (const c of CONCEPTS) {
    let best = 0;
    for (const a of [...c.aliases, c.title.toLowerCase()]) if (t.includes(' ' + a + ' ') && a.length > best) best = a.length;
    if (best) hits.push({ id: c.id, best });
  }
  if (!hits.length) return null;
  hits.sort((x, y) => y.best - x.best);
  if (hits[1] && hits[1].best === hits[0].best) return null;
  return lessons().has(hits[0].id) ? hits[0].id : null;
}

export function conceptList() {
  return [...lessons().values()].map((l) => ({
    id: l.id, title: l.title, grade: l.grade, hasExperiment: !!l.experiment, hasSim: l.sim.slugs.length > 0,
  }));
}
export { getConcept };
