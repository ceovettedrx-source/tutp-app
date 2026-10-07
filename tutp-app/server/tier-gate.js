// Tier gating for Answer/Explain v2 (docs/specs/answer-explain-v2.md section E,
// founder decision 1: "Pro and above" = a child with an active paid period).
// Gating happens HERE, on the server: a free family's response never holds
// the gated fields, so nothing can be unlocked from the browser.
//
//   Free  full Answer Please, Explain: concept_key, title, quick, and the
//         picture's status (one picture a day in full, the rest blurred)
//   Pro+  Explain: also the picture's labels, full, traps, misconception,
//         prev/next, parent questions (the "tonight" card) and the check question
// Unit tests: tests/unit/tier-gate.test.js.

export const UPSELL = { label: 'Pro ₹500/month', text: 'Unlock the full explanation, the exam traps, tonight\'s 2-minute parent card, a one-question check and the picture.' };

// The explain payload for this family. `explain` is the full, cached one.
// `illustration` is { status, url? } from the illustration service.
export function explainView(explain, { paid, illustration = null, kg = null } = {}) {
  const base = { concept_key: explain.concept_key, title: explain.title, quick: explain.quick };
  // img1: a free family also gets the picture's status (the page polls it; the
  // server shows one picture a day in full and blurs the rest, see
  // server/services/concept-picture.js). No labels and no link here.
  if (!paid) return { ...base, tier: 'free', locked: true, upsell: UPSELL, illustration: { status: illustration ? illustration.status : 'pending' } };
  const view = {
    ...base, tier: 'pro', locked: false,
    full: explain.full,
    traps: explain.traps,
    misconception: kg && kg.misconception ? kg.misconception : explain.misconception,
    parent_questions: explain.parent_questions,
    check_question: explain.check_question,
    illustration: { labels: explain.illustration.labels, status: illustration ? illustration.status : 'pending', ...(illustration && illustration.url ? { url: illustration.url } : {}) },
  };
  if (kg && kg.prev) view.prev_link = kg.prev;
  if (kg && kg.next) view.next_link = kg.next;
  return view;
}

// The fields a free explain response must never carry (checked by tests and
// by the e2e on the real payload).
export const PAID_ONLY_FIELDS = ['full', 'traps', 'misconception', 'parent_questions', 'check_question', 'prev_link', 'next_link'];
