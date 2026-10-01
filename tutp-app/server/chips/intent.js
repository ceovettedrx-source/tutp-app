// What a typed or spoken instruction asks for, by rules only (no model call):
//   answer | explain | notes | exam_prep | quiz   a known instruction
//   other                                           a short instruction nobody listed
//   none                                            nothing typed, or text too long to be an
//                                                   instruction (that is the homework itself)
// Rules cover English, Telugu, Hindi and those languages typed in English
// letters. When several match, the first in PRIORITY wins: "exam prep notes"
// is exam_prep, "explain notes" is notes, "answer and explain" is explain
// (explaining shows the answer too).
export const INTENTS = ['answer', 'explain', 'notes', 'exam_prep', 'quiz', 'other', 'none'];
const PRIORITY = ['exam_prep', 'notes', 'quiz', 'explain', 'answer'];

// words: the whole token; stems: the token starts with it (Telugu and Hindi
// inflect, and transliteration varies).
const RULES = {
  exam_prep: {
    words: ['exam', 'exams', 'examination', 'examinations', 'परीक्षा', 'పరీక్ష'],
    stems: ['pariksh', 'परीक्ष', 'పరీక్ష'],
  },
  notes: {
    words: ['note', 'notes', 'nots', 'summary', 'summarize', 'summarise', 'नोट्स', 'नोट', 'నోట్స్', 'నోట్', 'నోట్సు'],
    stems: ['saram', 'सारांश', 'సారాంశ', 'नोट', 'నోట్'],
  },
  quiz: {
    words: ['quiz', 'mcq', 'mcqs', 'क्विज़', 'क्विज', 'క్విజ్'],
    stems: ['quiz', 'क्विज', 'క్విజ్'],
  },
  explain: {
    words: ['explain', 'explanation', 'explaining', 'why', 'how', 'understand'],
    stems: ['samjh', 'samajh', 'vivar', 'ardham', 'ardam', 'समझा', 'समझ', 'వివర', 'అర్థ', 'అర్ధ'],
  },
  answer: {
    words: ['answer', 'answers', 'ans', 'solve', 'solution', 'solutions'],
    stems: ['jawab', 'javab', 'jabu', 'samadhan', 'uttar', 'जवाब', 'उत्तर', 'సమాధాన', 'జవాబ'],
  },
};

const MAX_INSTRUCTION_WORDS = 12;

export function tokens(text) {
  return String(text || '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

export function classifyIntent(text) {
  const toks = tokens(text);
  if (!toks.length || toks.length > MAX_INSTRUCTION_WORDS) return 'none';
  for (const intent of PRIORITY) {
    const rule = RULES[intent];
    if (toks.some((t) => rule.words.includes(t) || rule.stems.some((s) => t.startsWith(s)))) return intent;
  }
  return 'other';
}
