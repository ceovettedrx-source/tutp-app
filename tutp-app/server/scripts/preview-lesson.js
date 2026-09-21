import { writeFileSync } from 'fs';
import { renderLessonHtml } from '../services/lessonRenderer.js';

// Static stub matching the current lesson_json shape (see
// lessonMaterialGenerator.js) — no API call. Prasara is null on purpose to
// prove the renderer skips null Panchpadi stages.
const lesson_json = {
  teacher_notes: {
    objective: 'Classify triangles by their sides and angles',
    timing_minutes: 40,
    panchpadi_applicable: true,
    panchpadi: {
      aditi: {
        instructions: 'Show three cut-out triangles of different shapes and ask students what they notice is the same and what is different.',
        timing_minutes: 5
      },
      bodha: {
        instructions: 'Introduce equilateral, isosceles and scalene triangles by side length, and acute, right and obtuse by angle, using the cut-outs as examples.',
        timing_minutes: 12
      },
      abhyasa: {
        instructions: 'Students measure the sides and angles of triangles on the worksheet and label each one.',
        timing_minutes: 15
      },
      prayoga: {
        instructions: 'Ask students to find and classify triangles in the classroom (set squares, roof trusses, signboards).',
        timing_minutes: 8
      },
      prasara: null
    },
    pedagogy_grounding_note: 'Structured using the Panchpadi 5-stage method (Prasara omitted — lesson is short); content grounding is covered by the NCF/state badge above.'
  },
  student_sections: [
    {
      title: 'Classify by sides',
      instructions: 'Write whether each triangle is equilateral, isosceles or scalene.',
      items: [
        { text: 'A triangle with sides 5 cm, 5 cm and 5 cm.', diagram: { type: 'triangle', sides: [5, 5, 5] } },
        { text: 'A triangle with sides 3 cm, 4 cm and 5 cm.', diagram: { type: 'triangle', sides: [3, 4, 5] } }
      ]
    },
    {
      title: 'Classify by angles',
      instructions: 'Write whether each triangle is acute, right or obtuse.',
      items: [
        { text: 'A triangle with angles 90°, 45° and 45°.', diagram: { type: 'triangle', angles: [90, 45, 45] } },
        { text: 'A triangle with angles 100°, 40° and 40°.', diagram: null }
      ]
    }
  ],
  grounding: {
    ncf_code: 'M-6.3',
    state_chapter: 'AP Class 6 Maths — Ch. 5 Triangles',
    verification_status: 'placeholder'
  }
};

const outPath = process.argv[2] || '/tmp/preview-lesson.html';
writeFileSync(outPath, renderLessonHtml(lesson_json));
console.log(`Written to ${outPath}`);
