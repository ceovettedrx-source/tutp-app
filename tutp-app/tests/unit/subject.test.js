// Unit tests for server/subject.js and the Library's use of it (TUT-69). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSubject, subjectVariants, groupSubjects } from '../../server/subject.js';
import { buildLearningRow, describeHomeworkReply, homeworkLibraryItem } from '../../server/library.js';

test('one canonical subject per family of spellings', () => {
  for (const s of ['Math', 'Maths', 'maths', 'MATH', 'Mathematics', ' mathematics ', 'Math.']) assert.equal(canonicalSubject(s), 'Maths', s);
  for (const s of ['Science', 'science', 'General Science', 'Sciences']) assert.equal(canonicalSubject(s), 'Science', s);
  for (const s of ['English', 'english', 'English Language']) assert.equal(canonicalSubject(s), 'English', s);
  assert.equal(canonicalSubject('telugu'), 'Telugu');
  assert.equal(canonicalSubject('HINDI'), 'Hindi');
  for (const s of ['Social', 'Social Studies', 'social science', 'Social Sciences', 'SST']) assert.equal(canonicalSubject(s), 'Social', s);
  for (const s of ['EVS', 'evs', 'Environmental Studies', 'Environmental Science']) assert.equal(canonicalSubject(s), 'EVS', s);
});

test('a subject that is not in a family is kept as written, never invented or merged', () => {
  assert.equal(canonicalSubject('Physics'), 'Physics');
  assert.equal(canonicalSubject('  Fractions '), 'Fractions');
  assert.equal(canonicalSubject('Social Science') === canonicalSubject('Science'), false, 'Social must not fall into Science');
  assert.equal(canonicalSubject('Computer Science'), 'Computer Science');
});

test('empty stays empty', () => {
  for (const s of [null, undefined, '', '   ', 5, {}, []]) assert.equal(canonicalSubject(s), null, String(s));
});

test('the row is saved under the canonical subject', () => {
  const row = (subject) => buildLearningRow({ familyId: 1, studentId: 's', mode: 'answer', subject, title: 't', payload: { a: 1 } }).row.subject;
  assert.equal(row('Math'), 'Maths');
  assert.equal(row('Mathematics'), 'Maths');
  assert.equal(row('Physics'), 'Physics');
  assert.equal(row(''), null);
  assert.equal(row(undefined), null);
});

test('old rows saved as Math group and filter with Maths', () => {
  const raw = ['Math', 'Maths', 'Maths', 'Science', null, 'Mathematics', 'Physics'];
  const groups = groupSubjects(raw);
  assert.deepEqual(groups.find(g => g.subject === 'Maths'), { subject: 'Maths', count: 4 });
  assert.equal(groups.filter(g => g.subject === 'Maths').length, 1, 'one Maths folder');
  assert.deepEqual(groups.find(g => g.subject === null), { subject: null, count: 1 });
  assert.equal(groups.some(g => g.subject === 'Math'), false);
  assert.deepEqual(groups.map(g => g.count), [4, 1, 1, 1], 'biggest folder first');
  assert.deepEqual(subjectVariants(raw, 'Maths').sort(), ['Math', 'Mathematics', 'Maths']);
  assert.deepEqual(subjectVariants(raw, 'Math').sort(), ['Math', 'Mathematics', 'Maths'], 'the old spelling asks for the same folder');
  assert.deepEqual(subjectVariants(raw, 'Physics'), ['Physics']);
  assert.deepEqual(subjectVariants(raw, 'History'), ['History'], 'an unknown folder matches nothing but itself');
});

test('Explain, Story and Notes take the homework subject the page sent; the reply’s own subject wins', () => {
  const env = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
  const story = describeHomeworkReply('storytelling', env({ title: 'The Fox', paragraphs: ['x'] }));
  assert.equal(story.subject, null, 'a story reply carries no subject');
  assert.equal(homeworkLibraryItem({ familyId: 1, studentId: 's', language: 'English', text: 'fox', bodySubject: 'Science' }, story).subject, 'Science');
  assert.equal(homeworkLibraryItem({ familyId: 1, studentId: 's', language: 'English', text: 'fox', bodySubject: { a: 1 } }, story).subject, null, 'a non-string is dropped');
  assert.equal(homeworkLibraryItem({ familyId: 1, studentId: 's', language: 'English', text: 'fox' }, story).subject, null, 'nothing sent stays empty');
  const answer = describeHomeworkReply('homework_help', env({ subject: 'Maths', questions: [{ q_text: '1+1' }] }));
  assert.equal(homeworkLibraryItem({ familyId: 1, studentId: 's', language: 'English', text: '', bodySubject: 'Science' }, answer).subject, 'Maths', 'the reply’s subject wins');
});
