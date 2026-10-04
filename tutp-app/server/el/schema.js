// Shape of one Guided Discovery lesson (server/el/content/<id>.json) and its
// check. The generator validates every reply with this; the server validates
// each file when it loads it, so a hand-edited file cannot break the page.
//
// lesson = {
//   id, title, grade, version: 1,
//   predict:   { question, options: [{ text, misconceptionId|null } x3], correctIndex, why },
//   experiment: null | { title, items: [string], steps: [string], adultSteps: [stepIndex], note },
//   parentCard: { role, say: [string], avoid: [string] },
//   notice:    { question, lookFor },
//   hints:     [ { level: 1, text }, { level: 2, text }, { level: 3, text } ],
//   reveal:    { explanation, term, termMeaning },
//   teachBack: { prompt },
//   revisits:  [ { question, answer } x2 ],       // day 3 = 1st, day 10 = 2nd, day 30 = 1st again
//   sim:       { slugs: [string] },
//   safety:    { experiment: 'pass' | 'dropped' | 'none', reasons: [string] },
// }

const str = (v, max = 600) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const strs = (a, min, max, each = 400) => Array.isArray(a) && a.length >= min && a.length <= max && a.every((s) => str(s, each));

export function validateLesson(l) {
  const e = [];
  if (!l || typeof l !== 'object') return { ok: false, errors: ['not an object'] };
  if (!str(l.id, 60)) e.push('id');
  if (!str(l.title, 120)) e.push('title');
  const p = l.predict;
  if (!p || !str(p.question) || !Array.isArray(p.options) || p.options.length !== 3
    || !p.options.every((o) => o && str(o.text, 240))
    || !Number.isInteger(p.correctIndex) || p.correctIndex < 0 || p.correctIndex > 2 || !str(p.why)) e.push('predict');
  else if (!p.options.some((o, i) => i !== p.correctIndex && o.misconceptionId)) e.push('predict: no option carries a misconception id');
  const x = l.experiment;
  if (x !== null && x !== undefined) {
    if (!str(x.title, 160) || !strs(x.items, 1, 10, 80) || !strs(x.steps, 2, 8, 400)
      || !Array.isArray(x.adultSteps) || !x.adultSteps.every((i) => Number.isInteger(i) && i >= 0 && i < (x.steps || []).length)) e.push('experiment');
  }
  const pc = l.parentCard;
  if (!pc || !str(pc.role) || !strs(pc.say, 1, 5, 300) || !strs(pc.avoid, 1, 4, 300)) e.push('parentCard');
  if (!l.notice || !str(l.notice.question) || !str(l.notice.lookFor)) e.push('notice');
  if (!Array.isArray(l.hints) || l.hints.length !== 3 || !l.hints.every((h, i) => h && h.level === i + 1 && str(h.text, 400))) e.push('hints');
  const r = l.reveal;
  if (!r || !str(r.explanation, 900) || !str(r.term, 80) || !str(r.termMeaning, 300)) e.push('reveal');
  if (!l.teachBack || !str(l.teachBack.prompt)) e.push('teachBack');
  if (!Array.isArray(l.revisits) || l.revisits.length !== 2 || !l.revisits.every((q) => q && str(q.question) && str(q.answer, 400))) e.push('revisits');
  if (!l.sim || !Array.isArray(l.sim.slugs) || !l.sim.slugs.every((s) => /^[a-z0-9-]+$/.test(s))) e.push('sim');
  return { ok: e.length === 0, errors: e };
}

// The words a lesson may use for the three "which line did the parent
// teach" fields are free text; only what the child could be harmed by is
// checked (server/el/safety.js).
export const LESSON_TEXT_FIELDS = (l) => [
  l.predict && l.predict.question, ...((l.predict && l.predict.options) || []).map((o) => o.text),
  l.experiment && l.experiment.title, ...((l.experiment && l.experiment.items) || []), ...((l.experiment && l.experiment.steps) || []),
  l.experiment && l.experiment.note,
].filter(Boolean);
