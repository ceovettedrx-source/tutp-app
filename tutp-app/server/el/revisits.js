// Spaced revisit questions, computed from usage_events timestamps only (no
// table). A child who finished a lesson's teach-back (event teach_back_done,
// properties.concept_id) gets the lesson's two questions again later:
// day 3 -> question 1, day 10 -> question 2, day 30 -> question 1 again.
// A revisit is due from its day for REVISIT_WINDOW_DAYS days, unless the
// parent marked it done (event revisit_done, properties.concept_id and day).

export const REVISIT_DAYS = [3, 10, 30];
export const REVISIT_QUESTION = [0, 1, 0];
export const REVISIT_WINDOW_DAYS = 4;
const DAY = 24 * 60 * 60 * 1000;

// events: [{ event_name, created_at, properties }], lessons: Map(id -> lesson).
// -> [{ conceptId, title, day, question, answer, dueAt }] soonest-due first.
export function computeRevisits(events, now, lessons) {
  const first = new Map();   // conceptId -> earliest teach_back_done time
  const done = new Set();    // conceptId|day
  for (const e of events || []) {
    const id = e.properties && e.properties.concept_id;
    if (!id) continue;
    const t = Date.parse(e.created_at);
    if (!Number.isFinite(t)) continue;
    if (e.event_name === 'teach_back_done') { if (!first.has(id) || t < first.get(id)) first.set(id, t); }
    else if (e.event_name === 'revisit_done') done.add(id + '|' + e.properties.day);
  }
  const due = [];
  for (const [id, t0] of first) {
    const lesson = lessons.get(id);
    if (!lesson) continue;
    REVISIT_DAYS.forEach((day, i) => {
      const from = t0 + day * DAY;
      if (now < from || now >= from + REVISIT_WINDOW_DAYS * DAY || done.has(id + '|' + day)) return;
      const q = lesson.revisits[REVISIT_QUESTION[i]];
      due.push({ conceptId: id, title: lesson.title, day, question: q.question, answer: q.answer, dueAt: new Date(from).toISOString() });
    });
  }
  return due.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}
