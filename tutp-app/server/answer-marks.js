// Answer Please: how long an answer is, by marks. The model reads the marks
// from the question text when they are printed there ("(3 marks)", "[2M]",
// "3 మార్కులు", "3 अंक"); otherwise a default by question type and board is
// used. One table, so a change of pattern is one edit.
// Unit tests: tests/unit/answer-marks.test.js.

export const Q_TYPES = ['short', 'difference', 'numerical', 'mcq', 'fill', 'diagram', 'long'];

// Marks used when the question prints none. Boards: 'state' (TS/AP State
// Board), 'cbse', 'other'. Typical papers: State Board short answers are 2
// marks, long answers 4; CBSE short 2-3, long 5.
const DEFAULT_MARKS = {
  state: { short: 2, difference: 4, numerical: 3, mcq: 1, fill: 1, diagram: 4, long: 4 },
  cbse:  { short: 2, difference: 3, numerical: 3, mcq: 1, fill: 1, diagram: 3, long: 5 },
  other: { short: 2, difference: 3, numerical: 3, mcq: 1, fill: 1, diagram: 3, long: 5 },
};

// "How much to write" per marks, handed to the model.
export function lengthGuide(marks) {
  if (marks <= 1) return 'one word or one short line';
  if (marks === 2) return '2 to 3 short lines';
  if (marks === 3) return '3 to 4 points or one worked solution of 3 steps';
  if (marks === 4) return '4 points, or a 4-row comparison table, or a worked solution with every step';
  return '5 to 6 points with a short introduction and conclusion';
}

// "State Board" / "CBSE" / "ICSE" / state names (curriculum from registration,
// state from the student row) -> 'state' | 'cbse' | 'other'.
export function boardKind(curriculum, state) {
  const c = String(curriculum || '').toLowerCase();
  const s = String(state || '').toLowerCase();
  if (c.includes('cbse')) return 'cbse';
  if (c.includes('state') || /telangana|andhra/.test(s)) return 'state';
  return 'other';
}

export function defaultMarks(qType, board) {
  const table = DEFAULT_MARKS[board] || DEFAULT_MARKS.other;
  return table[qType] != null ? table[qType] : 2;
}

// Marks from the question's own text, or null.
export function marksFromText(text) {
  const s = String(text || '');
  const m = s.match(/[(\[]\s*(\d{1,2})\s*(?:marks?|m|mks)\s*[)\]]/i)
    || s.match(/\b(\d{1,2})\s*marks?\b/i)
    || s.match(/(\d{1,2})\s*(?:మార్కులు|మార్కు)/)
    || s.match(/(\d{1,2})\s*अंक/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 10 ? n : null;
}

export function resolveMarks({ questionText, modelMarks, qType, board }) {
  const printed = marksFromText(questionText);
  if (printed != null) return printed;
  const n = Number(modelMarks);
  if (Number.isInteger(n) && n >= 1 && n <= 10) return n;
  return defaultMarks(qType, board);
}
