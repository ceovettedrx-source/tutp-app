import { getLearningComponent, getTeacherTrainingUnit } from '../services/knowledgeGraph.js';

const ambiguousResult = await getLearningComponent(5, 'mathematics', 'andhra-pradesh');
const narrowedResult = await getLearningComponent(5, 'mathematics', 'andhra-pradesh', 'equivalent');
const teacherTrainingUnitResult = await getTeacherTrainingUnit(5, 'mathematics');

console.log('=== getLearningComponent(5, "mathematics", "andhra-pradesh") — no topic ===');
console.log(JSON.stringify(ambiguousResult, null, 2));

console.log('=== getLearningComponent(5, "mathematics", "andhra-pradesh", "equivalent") ===');
console.log(JSON.stringify(narrowedResult, null, 2));

console.log('=== getTeacherTrainingUnit(5, "mathematics") ===');
console.log(JSON.stringify(teacherTrainingUnitResult, null, 2));
