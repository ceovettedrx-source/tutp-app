import 'dotenv/config';
import { writeFileSync } from 'fs';
import { generateLessonMaterial } from '../services/lessonMaterialGenerator.js';
import { renderLessonHtml } from '../services/lessonRenderer.js';

const lesson_json = await generateLessonMaterial({
  kgContext: null,
  referenceNote: '',
  teacherInput: { grade: '6', subject: 'maths', chapter_or_topic: 'Triangles', state: 'andhra_pradesh', material_type: 'worksheet' }
});

const html = renderLessonHtml(lesson_json);

writeFileSync('/tmp/preview-lesson.html', html);
console.log('Written to /tmp/preview-lesson.html');
