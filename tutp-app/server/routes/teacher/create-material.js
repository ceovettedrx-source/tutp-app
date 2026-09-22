import express from 'express';
import { getLearningComponent } from '../../services/knowledgeGraph.js';
import { generateLessonMaterial, generateLessonMaterialFromUpload } from '../../services/lessonMaterialGenerator.js';
import { verifyMcqSections } from '../../services/lessonVerifier.js';
import { renderLessonHtml } from '../../services/lessonRenderer.js';

const router = express.Router();

const VALID_MATERIAL_TYPES = ['worksheet', 'question_paper', 'notes'];
const VALID_BOARDS = ['state_board', 'cbse', 'icse', 'ib', 'igcse'];

// Same check as isValidQpContentBlock in server.js — copied, not imported,
// because server.js doesn't export it (and importing it would pull in the
// whole app).
function isValidUploadedContentBlock(block) {
  return block && (block.type === 'image' || block.type === 'document') &&
    block.source && block.source.type === 'base64' && block.source.media_type && block.source.data;
}

// POST /api/teacher/create-material
// Full generation flow: ground in the knowledge graph (or, for a Board+Upload
// request, in the teacher's uploaded lesson), generate the lesson_json via
// Claude, render it to HTML, and return all three to the caller. Nothing is
// persisted yet — that's a separate next step.
router.post('/', async (req, res) => {
  const { grade, subject, chapter_or_topic, state, material_type, teacher_id, board, uploaded_content_block } = req.body || {};

  // An uploaded lesson replaces the knowledge-graph lookup, so `state` (which
  // only feeds that lookup) is only required on the KG path.
  const hasUpload = uploaded_content_block !== undefined && uploaded_content_block !== null;
  if (hasUpload && !isValidUploadedContentBlock(uploaded_content_block)) {
    return res.status(400).json({ error: 'Missing or invalid uploaded_content_block attachment' });
  }
  if (board !== undefined && !VALID_BOARDS.includes(board)) {
    return res.status(400).json({ error: `Invalid board — must be one of ${VALID_BOARDS.join(', ')}` });
  }

  const missing = ['grade', 'subject', 'chapter_or_topic', ...(hasUpload ? [] : ['state']), 'teacher_id']
    .filter(field => !req.body?.[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
  }
  if (!VALID_MATERIAL_TYPES.includes(material_type)) {
    return res.status(400).json({ error: `Invalid material_type — must be one of ${VALID_MATERIAL_TYPES.join(', ')}` });
  }
  const numericGrade = Number(grade);
  if (!Number.isInteger(numericGrade) || numericGrade <= 0) {
    return res.status(400).json({ error: 'grade must be a valid number' });
  }

  try {
    let lesson_json;
    if (hasUpload) {
      // Board+Upload: skip the knowledge graph entirely.
      lesson_json = await generateLessonMaterialFromUpload({
        contentBlock: uploaded_content_block,
        teacherInput: { grade: numericGrade, subject, topic: chapter_or_topic, board, material_type }
      });
    } else {
      const kgContext = await getLearningComponent(numericGrade, subject, state, chapter_or_topic);

      if (kgContext.ambiguous) {
        return res.status(300).json({ candidates: kgContext.candidates });
      }

      lesson_json = await generateLessonMaterial({
        kgContext,
        teacherInput: { grade: numericGrade, subject, topic: chapter_or_topic }
      });
    }

    const { checked, all_passed, issues_found, lesson_json: verifiedLessonJson } = await verifyMcqSections(lesson_json);
    lesson_json = verifiedLessonJson;

    const html = renderLessonHtml(lesson_json);

    return res.status(200).json({
      html,
      lesson_json,
      grounding: lesson_json.grounding,
      verification: { checked, all_passed: all_passed ?? null, issues_found: issues_found ?? 0 }
    });
  } catch (err) {
    console.error('create-material error:', err);
    if (err.code === 'LESSON_TRUNCATED') return res.status(502).json({ error: err.message });
    res.status(500).json({ error: 'Server error creating material' });
  }
});

export default router;
