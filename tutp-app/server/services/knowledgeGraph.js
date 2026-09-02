// Reads the india-learning-commons knowledge graph data copied into
// server/knowledge-graph-data/ (data/, metadata/ — see repo README there).
// Every lookup here must return a real match or a clearly-flagged "not
// sourced" null. Never fabricate a LearningComponent, NCF code, or state
// mapping — callers (lessonMaterialGenerator) depend on that flag to warn
// teachers instead of silently presenting an ungrounded guess as fact.

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.join(__dirname, '..', 'knowledge-graph-data');

let cachedRecords = null;

async function walkJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Recursively loads every .json file under server/knowledge-graph-data/,
 * flattens the "records" array out of each file shaped like
 * {"records": [...]}, and returns one flat array of all records (each
 * already carries its own "type" field, e.g. "LearningComponent"). Files
 * not shaped that way (e.g. metadata/states.json, which uses a "states"
 * key) are skipped. Cached in memory after the first read — call
 * clearCache() to force a re-read from disk.
 */
async function loadAllRecords() {
  if (cachedRecords) return cachedRecords;

  const files = await walkJsonFiles(DATA_ROOT);
  const records = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.records)) {
      records.push(...parsed.records);
    }
  }

  cachedRecords = records;
  return records;
}

/** Clears the in-memory records cache (for tests, or after data changes on disk). */
export function clearCache() {
  cachedRecords = null;
}

function buildLearningComponentResult(match, records) {
  const { stateMapping, learningComponent, learningOutcome } = match;
  const misconceptions = records.filter(
    (r) => r.type === 'Misconception' && r.learning_component_id === learningComponent.id
  );

  return {
    learningComponent,
    learningOutcome,
    stateMapping,
    misconceptions,
    sourced: true,
    verification_status: learningComponent.verification_status
  };
}

/**
 * Looks up the LearningComponent for a grade/subject/state, along with its
 * parent LearningOutcome (carrying the NCF code), the matching StateMapping
 * row, and any Misconceptions documented against that LearningComponent.
 *
 * More than one StateMapping/LearningComponent can legitimately match the
 * same grade+subject+state (e.g. two components in the same textbook
 * chapter). `topic` (optional — matches the route's chapter_or_topic field)
 * is used to try to narrow a multi-match down to one by a case-insensitive
 * substring check against the LearningComponent's or LearningOutcome's
 * statement_en. If that narrowing doesn't land on exactly one match — no
 * topic given, still more than one after narrowing, or narrowing eliminates
 * every match — this never silently guesses; it reports the ambiguity so
 * the caller can ask the teacher to pick.
 *
 * @param {number} grade
 * @param {string} subject
 * @param {string} state
 * @param {string} [topic]
 * @returns {Promise<
 *   { sourced: true, learningComponent: object, learningOutcome: object,
 *     stateMapping: object, misconceptions: object[], verification_status: string }
 *   | { sourced: false, reason: string }
 *   | { sourced: false, ambiguous: true, candidates: { id: string, statement_en: string, grade: number }[] }
 * >}
 */
export async function getLearningComponent(grade, subject, state, topic) {
  const records = await loadAllRecords();

  const stateMappings = records.filter(
    (r) => r.type === 'StateMapping' && r.state === state && r.target_node_type === 'LearningComponent'
  );

  const matches = [];
  for (const stateMapping of stateMappings) {
    const learningComponent = records.find(
      (r) => r.type === 'LearningComponent' && r.id === stateMapping.target_node_id && r.grade === grade
    );
    if (!learningComponent) continue;

    const learningOutcome = records.find(
      (r) => r.type === 'LearningOutcome' && r.id === learningComponent.parent_learning_outcome_id && r.subject === subject
    );
    if (!learningOutcome) continue;

    matches.push({ stateMapping, learningComponent, learningOutcome });
  }

  if (matches.length === 0) {
    return {
      sourced: false,
      reason: 'no matching StateMapping/LearningComponent for this grade+subject+state'
    };
  }

  if (matches.length === 1) {
    return buildLearningComponentResult(matches[0], records);
  }

  if (topic) {
    const needle = topic.toLowerCase();
    const narrowed = matches.filter(
      (m) =>
        m.learningComponent.statement_en.toLowerCase().includes(needle) ||
        m.learningOutcome.statement_en.toLowerCase().includes(needle)
    );
    if (narrowed.length === 1) {
      return buildLearningComponentResult(narrowed[0], records);
    }
  }

  return {
    sourced: false,
    ambiguous: true,
    candidates: matches.map((m) => ({
      id: m.learningComponent.id,
      statement_en: m.learningComponent.statement_en,
      grade: m.learningComponent.grade
    }))
  };
}

/**
 * Looks up Misconception records by id (e.g. the `in-misc-...` ids embedded
 * as [in-misc-...] tags in generated lesson content, so a verifier can pull
 * up the full record — error_pattern_en, produces_choice_pattern — behind a
 * citation and check it against the actual numbers in an item).
 *
 * @param {string[]} ids
 * @returns {Promise<object[]>} matching Misconception records, in no particular order.
 */
export async function getMisconceptionsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const records = await loadAllRecords();
  const idSet = new Set(ids);
  return records.filter((r) => r.type === 'Misconception' && idSet.has(r.id));
}

/**
 * Looks up TeacherTrainingUnit records qualifying a teacher for a
 * grade/subject. There can legitimately be more than one match (e.g. a
 * D.El.Ed unit and a B.Ed unit both cover the same subject at overlapping
 * grades), so this returns every match rather than a single record.
 *
 * @param {number} grade
 * @param {string} subject
 * @returns {Promise<
 *   { sourced: true, teacherTrainingUnits: object[] }
 *   | { sourced: false, teacherTrainingUnits: [], reason: string }
 * >}
 */
export async function getTeacherTrainingUnit(grade, subject) {
  const records = await loadAllRecords();

  const teacherTrainingUnits = records.filter(
    (r) =>
      r.type === 'TeacherTrainingUnit' &&
      r.pedagogy_subject === subject &&
      Array.isArray(r.qualifies_teacher_for_grades) &&
      r.qualifies_teacher_for_grades.includes(grade)
  );

  if (teacherTrainingUnits.length > 0) {
    return { sourced: true, teacherTrainingUnits };
  }

  return {
    sourced: false,
    teacherTrainingUnits: [],
    reason: 'no matching TeacherTrainingUnit for this grade+subject'
  };
}
