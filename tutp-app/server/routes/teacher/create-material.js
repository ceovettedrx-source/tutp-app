import express from 'express';
import { getLearningComponent } from '../../services/knowledgeGraph.js';
import { generateLessonMaterial } from '../../services/lessonMaterialGenerator.js';
import { verifyMcqSections } from '../../services/lessonVerifier.js';
import { renderLessonHtml } from '../../services/lessonRenderer.js';

const router = express.Router();

const VALID_MATERIAL_TYPES = ['worksheet', 'question_paper', 'notes'];

// POST /api/teacher/create-material
// Full generation flow: ground in the knowledge graph, generate the
// lesson_json via Claude, render it to HTML, and return all three to the
// caller. Nothing is persisted yet — that's a separate next step.
router.post('/', async (req, res) => {
  const { grade, subject, chapter_or_topic, state, material_type, teacher_id } = req.body || {};

  const missing = ['grade', 'subject', 'chapter_or_topic', 'state', 'teacher_id']
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
    const kgContext = await getLearningComponent(numericGrade, subject, state, chapter_or_topic);

    if (kgContext.ambiguous) {
      return res.status(300).json({ candidates: kgContext.candidates });
    }

    let lesson_json = await generateLessonMaterial({
      kgContext,
      teacherInput: { grade: numericGrade, subject, topic: chapter_or_topic }
    });

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
    res.status(500).json({ error: 'Server error creating material' });
  }
});

export default router;
