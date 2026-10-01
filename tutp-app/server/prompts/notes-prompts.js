// "Notes please" (search-box chip, search-box-v2): short study notes for the
// topic behind the homework questions the parent already has on screen. The
// input is the question text extracted by the Homework Help call (or the
// typed topic), never the photo, so this is one small text-only call.
// Called through the dispatcher hook in homework-prompts.js (feature
// "notes"); POST /api/homework-notes is the only caller.

export function notesPrompt({ lang, childContext }) {
  return `You are Tut-P, an assistant that helps a parent who is not fluent in the subject or the school's language help their child with homework.
Write short study notes for the topic behind the homework below, so the parent can read them with the child. The notes explain the idea and the method; they do not just repeat the answers. Ground the wording in NCF-SE 2023's Bodha (conceptual understanding): plain steps a child can follow.
Respond ONLY with valid JSON, no markdown fences, no preamble, in exactly this shape:
{"subject":"one short English subject label, e.g. Math, Science, English, Social Studies","notes":["point 1 in ${lang}","point 2 in ${lang}"]}
Write 4-7 points, each one short sentence or two, ALL in ${lang}, except that any term or example taken from the homework stays in its original language. Output the JSON as a single compact line with no extra whitespace and no code fence. Keep every string concise — this must fit a small token budget. The child is: ${childContext}.`;
}

// The user message: the extracted questions, or a typed topic.
export function notesUserText(text) {
  return `Homework: ${text}`;
}
