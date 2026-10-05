// Writes the knowledge-graph records for the 12 Guided Discovery concepts
// (node scripts/el/build-kg.mjs). Output is committed; re-run after editing
// server/el/concepts.js. No database, no network.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONCEPTS } from '../../server/el/concepts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'knowledge-graph-data', 'data');
const band = (g) => (g <= 5 ? 'preparatory' : g <= 8 ? 'middle' : 'secondary');
const loId = (c) => `in-ncf2023-science-el-${c.id}-lo-001`;

function write(rel, obj) {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
  console.log('wrote', rel, obj.records.length, 'records');
}

write('national/ncf-2023/science/el-pilot-learning-outcomes.json', {
  _note: 'Guided Discovery pilot (experiential-learning-v2). One LearningOutcome and one Misconception per concept; concept-level and board-agnostic. statement_en is Tut-P\'s own paraphrase, never textbook text. ncf_curricular_goal_id and ncf_competency_code are null because the NCF-SE competency was not matched to each concept (never guessed). Misconceptions are widely documented science-education patterns written in Tut-P\'s words; no specific citation has been attached yet, so their verification_status is placeholder.',
  records: CONCEPTS.flatMap((c) => [
    {
      id: loId(c), type: 'LearningOutcome', framework: 'NCF-2023',
      ncf_curricular_goal_id: null, ncf_competency_code: null,
      subject: 'science', grade_band: band(c.grade), grade: c.grade,
      statement_en: c.lo, concept_id: c.id, verification_status: 'placeholder',
    },
    {
      id: `in-misc-sci-el-${c.id}-01`, type: 'Misconception',
      learning_outcome_id: loId(c), learning_component_id: null,
      error_pattern_en: c.misconception, verification_status: 'placeholder',
      source: { document: 'commonly documented student misconception; no specific citation attached yet' },
    },
  ]),
});

write('national/ncert/el-pilot-science-mappings.json', {
  _note: 'CBSE/NCERT chapter mappings for the Guided Discovery pilot. Chapter number and title were read from the official ncert.nic.in contents pages, and the concept was found inside the named chapter PDF (2026-10-05, reprint 2026-27). Chapter titles and numbers only; no textbook text copied.',
  records: CONCEPTS.map((c, i) => ({
    id: `in-map-cbse-ncert-el-${c.id}`, type: 'StateMapping', state: 'cbse-ncert',
    scf_code: 'unstructured', textbook_chapter: `Chapter ${c.ncert.chapter}: ${c.ncert.title}`,
    grade: c.ncert.grade, medium: ['english', 'hindi'],
    alignment_type: 'full', verification_status: 'sourced',
    source: { document: `NCERT Class ${c.ncert.grade} Science, Chapter ${c.ncert.chapter}`, url: c.ncert.url, license_tier: 'tier-3-restricted' },
    target_node_id: loId(c), target_node_type: 'LearningOutcome',
  })),
});

write('states/telangana/el-pilot-science-mappings.json', {
  _note: 'Telangana (TS SCERT) mappings for the Guided Discovery pilot are PLACEHOLDERS: scert.telangana.gov.in could not be reached on 2026-10-05 (connection failed / certificate error), so no chapter title or number is stated. Fill them from the official SCERT textbook list, then set verification_status to sourced.',
  records: CONCEPTS.map((c) => ({
    id: `in-map-telangana-el-${c.id}`, type: 'StateMapping', state: 'telangana',
    scf_code: 'unstructured', textbook_chapter: null, grade: null,
    medium: ['telugu', 'english', 'urdu'],
    alignment_type: 'unknown', verification_status: 'placeholder',
    source: { document: 'TS SCERT Science textbooks (not yet read)', url: 'https://scert.telangana.gov.in', license_tier: 'tier-3-restricted' },
    target_node_id: loId(c), target_node_type: 'LearningOutcome',
  })),
});
