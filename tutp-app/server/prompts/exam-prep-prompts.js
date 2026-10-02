// Prompts for exam prep notes (round 4, docs/specs/round-4-exam-prep-pilot.md).
// A note is written once, from the admin page, grounded only in the
// knowledge graph chapter (server/services/knowledgeGraph.js getChapter),
// with a neutral "your child · Class N" context: never a child's name,
// photo or file. PROMPT_VERSION is part of every note's cache key, so a
// change here starts new notes (shown as "coming soon" until approved).
//
// Everything that changes the reply goes in the user message, not the
// system prompt: e2e recordings are keyed by the messages only
// (server/model-replay.js).

export const PROMPT_VERSION = 'ep1';

export const MODES = ['revision_notes', 'key_points', 'flashcards', 'practice_questions'];
export const QUESTION_TAGS = ['logical_reasoning', 'understanding', 'application', 'skill_based'];

const SHAPES = {
  revision_notes: `{"title": string, "intro": string (1-2 sentences), "sections": [{"heading": string, "points": [string] (3-5), "example": string}] (2-4 sections), "remember": [string] (3-5 short "remember this" lines)}`,
  key_points: `{"points": [{"heading": string (at most 5 words), "text": string (at most 25 words)}] (5-8 points), "formulas": [{"label": string, "rule": string, "example": string}] (3-6 rules, e.g. how to make an equivalent fraction, how to compare)}`,
  flashcards: `{"cards": [{"front": string (a question or a term), "back": string (the short answer)}] (10 to 15 cards; aim for 12)}`,
  practice_questions: `{"questions": [{"type": "mcq" or "short", "question": string, "options": [4 strings] (mcq only; leave out for short), "answer": string (for mcq: exactly the text of the correct option), "explanation": string (one or two sentences), "tag": "logical_reasoning" | "understanding" | "application" | "skill_based"}] (8 to 12 questions; aim for 10; at least 4 mcq; use every tag at least once)}`,
};

const MODE_TASK = {
  revision_notes: 'Revision notes for the night before the exam: short, clear sections a parent can read with the child.',
  key_points: 'Key points and a formula sheet: the rules and facts to remember, each in one line.',
  flashcards: 'Flashcards for quick self-testing: one idea per card.',
  practice_questions: 'Practice questions in the exam pattern of the state board (objective and short-answer questions, as in a Class 5 summative exam). Write every question fresh: never copy a question from a textbook or an exam paper.',
};

export const SYSTEM_PROMPT = `You write exam revision material for Class 5 maths in India, for a parent to use with their child. You are given one textbook chapter of a state board and the exact skills it covers, from Tut-P's knowledge graph. Use only those skills: do not add topics the chapter list does not name, and do not claim to cover the whole chapter. Write your own explanations and examples; never reproduce textbook sentences, exercises or examples. Every fraction you write must be arithmetically correct (check each one). Keep sentences short and friendly for a 10-year-old. Address the parent as "you" and the child as "your child"; never invent a child's name.

Reply with ONLY one JSON object on a single line: no markdown fences, no text before or after it.`;

const LANGUAGE_RULE = {
  en: 'Write every string in simple English.',
  te: 'Write every string in Telugu script (the words a Telugu-medium Class 5 child reads in school). Keep numbers and fractions in digits, like 3/4. Use the Telugu key terms listed below; do not write English words in Telugu script where a Telugu word exists.',
};

export const BOARD_LABELS = {
  'andhra-pradesh': 'Andhra Pradesh State Board',
  telangana: 'Telangana State Board',
};

// The chapter as the model sees it: skills, known mistakes, key terms.
export function chapterContext(chapter, lang) {
  const lines = [
    `Board: ${BOARD_LABELS[chapter.state] || chapter.state}`,
    `Class: ${chapter.grade}`,
    `Subject: ${chapter.subject}`,
    `Chapter: ${chapter.chapter}`,
    '',
    `This material covers only these ${chapter.components.length} skills of the chapter:`,
  ];
  chapter.components.forEach((c, i) => {
    const lc = c.learningComponent;
    lines.push(`${i + 1}. ${lc.statement_en}${lang === 'te' && lc.statement_te ? ` (Telugu: ${lc.statement_te})` : ''}`);
    for (const m of c.misconceptions) {
      lines.push(`   Common mistake: ${m.error_pattern_en}${m.teacher_move ? ` How to help: ${m.teacher_move}` : ''}`);
    }
  });
  const terms = chapter.components.flatMap((c) => c.learningComponent[lang === 'te' ? 'key_terms_te' : 'key_terms_en'] || []);
  if (terms.length) {
    lines.push('', 'Key terms:');
    for (const t of terms) lines.push(`- ${t.term}: ${t.meaning}`);
  }
  return lines.join('\n');
}

// { system, user } for writing one note. fixReason: the founder's reason
// for "needs fix" (only that note is written again).
export function buildGenerateRequest({ mode, lang, chapter, fixReason = '' }) {
  const user = [
    `Task: ${MODE_TASK[mode]}`,
    `Language: ${LANGUAGE_RULE[lang]}`,
    '',
    chapterContext(chapter, lang),
    '',
    `The child is: your child · Class ${chapter.grade}.`,
    '',
    `JSON shape: ${SHAPES[mode]}`,
  ];
  if (fixReason) {
    user.push('', `A reviewer read the previous version of this note and asked for this fix: "${fixReason}". Write the whole note again with that fixed.`);
  }
  return { system: SYSTEM_PROMPT, user: user.join('\n') };
}

export const CHECK_SYSTEM_PROMPT = `You are an independent checker of Class 5 maths revision material written by another model. You are given the chapter's skills from Tut-P's knowledge graph and the material as JSON. Check it strictly:
- correct: every statement, example, fraction, answer and explanation is mathematically right, and every multiple-choice answer is the one correct option.
- on_syllabus: it stays within the listed skills of this chapter and does not claim to cover more.
- age_appropriate: the language and difficulty suit a Class 5 child, and nothing is unsuitable for a child.
List every problem you find in "issues", each naming the exact item (for example "question 4: the answer should be 3/4"). Do the checking silently.

Reply with ONLY this JSON on one line, nothing else: {"correct": boolean, "on_syllabus": boolean, "age_appropriate": boolean, "issues": [string]}`;

export function buildCheckRequest({ mode, lang, chapter, content }) {
  return {
    system: CHECK_SYSTEM_PROMPT,
    user: [
      `Material type: ${mode}. Language: ${lang === 'te' ? 'Telugu' : 'English'}.`,
      '',
      chapterContext(chapter, lang),
      '',
      'Material:',
      JSON.stringify(content),
    ].join('\n'),
  };
}
