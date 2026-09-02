import 'dotenv/config';
import { getLearningComponent } from '../services/knowledgeGraph.js';
import { generateLessonMaterial } from '../services/lessonMaterialGenerator.js';

const teacherInput = { grade: 5, subject: 'mathematics', topic: 'equivalent fractions' };
const kgContext = await getLearningComponent(5, 'mathematics', 'andhra-pradesh', 'equivalent');

const lessonJson = await generateLessonMaterial({ kgContext, teacherInput });

console.log(JSON.stringify(lessonJson, null, 2));
