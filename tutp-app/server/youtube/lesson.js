// TUT-66: the lesson name of an Answer, from fields the model already returns (no extra call, no new
// prompt field). Each question carries a concept_key like "c9-physics-distance-vs-displacement";
// the words after the class and the subject are the topic. A key that is a hash ("c7-maths-q362552f3")
// or has a digit in its topic is not a lesson name and is skipped. The most common topic wins.
export function lessonFromConceptKey(key) {
  const parts = String(key || '').toLowerCase().split('-').filter(Boolean);
  if (parts.length && /^c\d{1,2}$/.test(parts[0])) parts.shift();
  parts.shift();                                  // the subject
  if (!parts.length || !parts.every((w) => /^[a-z]{2,}$/.test(w))) return '';
  const topic = parts.join(' ');
  return topic.length >= 4 ? topic : '';
}

export function lessonFromQuestions(questions) {
  const count = new Map();
  for (const q of Array.isArray(questions) ? questions : []) {
    const t = lessonFromConceptKey(q && q.concept_key);
    if (t) count.set(t, (count.get(t) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [t, c] of count) if (c > n) { best = t; n = c; }
  return best;
}
