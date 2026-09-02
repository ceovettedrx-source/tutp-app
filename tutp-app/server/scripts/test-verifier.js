import 'dotenv/config';
import { verifyMcqSections } from '../services/lessonVerifier.js';

// Reproduces the real Priya MCQ bug: the stem states she wrote 2/6 for an
// equivalent fraction of 1/3 with denominator 6, but option (C) cites the
// "ignore the denominator" misconception (in-misc-frac-preparatory-lc02-01)
// while displaying 2/6 as its value — even though its own explanation text
// says the student "wrote 2/2". Applying that misconception's error pattern
// to these actual numbers (scale factor 2) produces 2/2, not 2/6, so Gate B
// should catch the mismatch between the cited misconception and the value
// shown.
const lessonJson = {
  teacher_notes: {
    objective: 'Students will identify equivalent fractions and recognize common errors.',
    key_points: ['Equivalent fractions represent the same amount.'],
    timing_minutes: 20
  },
  student_sections: [
    {
      title: 'Equivalent Fractions — Multiple Choice',
      instructions: 'Choose the correct answer for each question.',
      items: [
        'Priya was asked to write a fraction equivalent to 1/3 with denominator 6. She wrote 2/6. Which option below shows a mistake a student following a different, incorrect method might make, and why? (A) 3/6 — scales the numerator and denominator by different amounts. (B) 2/3 — keeps the original denominator and only scales the numerator. (C) 2/6 — this is what a student gets when they ignore the denominator entirely [in-misc-frac-preparatory-lc02-01], since they wrote 2/2 by only scaling the numerator. (D) 1/6 — forgets to scale the numerator at all.'
      ]
    }
  ],
  grounding: { ncf_code: 'C-1.2', state_chapter: 'Chapter 13: Fractions', verification_status: 'sourced' }
};

const result = await verifyMcqSections(lessonJson);
console.log(JSON.stringify(result, null, 2));
