// The mode chips under the homework input box. Each chip is
// { id, intent, i18nKey, flag }:
//   id        what the browser and the logs call the chip
//   intent    the intent it stands for (server/chips/intent.js)
//   i18nKey   key into the page's TUTP_CHIP_MESSAGES (English is the source
//             text; te/hi are drafts in parents' own words, tap-through will tell)
//   flag      capability flag in CAPABILITIES: a chip whose backend is not on
//             main stays hidden, so no chip ever promises something the app
//             cannot do. exam_prep belongs to round 4; flip its flag when
//             that round is on main.
export const CHIPS = [
  { id: 'answer', intent: 'answer', i18nKey: 'chip.answer', flag: 'answer' },
  { id: 'explain', intent: 'explain', i18nKey: 'chip.explain', flag: 'explain' },
  { id: 'notes', intent: 'notes', i18nKey: 'chip.notes', flag: 'notes' },
  { id: 'exam_prep', intent: 'exam_prep', i18nKey: 'chip.exam_prep', flag: 'exam_prep' },
];

export const CAPABILITIES = {
  answer: true,    // UI toggle of the reasoning already in the result
  explain: true,   // same
  notes: true,     // POST /api/homework-notes (server/prompts/notes-prompts.js)
  exam_prep: false // round 4, not on main
};

// The label text itself lives in the page script (public/app/shared/
// search-chips.js, window.TUTP_CHIP_MESSAGES = { en, te, hi }), the same
// shape as the sign-in text in auth-messages.js, keyed by i18nKey.
export function visibleChips(capabilities = CAPABILITIES) {
  return CHIPS.filter((c) => capabilities[c.flag] === true);
}

// What GET /api/search-chips sends the page.
export function chipPayload(capabilities = CAPABILITIES) {
  return { chips: visibleChips(capabilities).map(({ id, intent, i18nKey }) => ({ id, intent, i18nKey })) };
}
