// The language rule shared by every prompt (docs/specs/img1.md, founder decision 2026-10-07):
//
//   - the model answer the child writes in a notebook (Answer please's answer
//     blocks, keywords, table cells, formulas) stays in the language of the PAGE;
//   - everything the PARENT reads (explanations, notes, stories, idea-card
//     summaries, the parent's "tonight" card, hints, feedback) is in the parent's
//     explain-in language;
//   - key subject terms in the parent-language text are bilingual, the parent's
//     word first and the page's word in brackets: స్థానభ్రంశం (Displacement);
//   - the same rule for every card made from one photo.
//
//   bilingualTerms(lang)  the key-term sentence for the prompt ('' for English)
//   teluguQuality(lang)   the Telugu wording rules ('' for any other language)
//   languageBlock(lang)   both, for a prompt that writes parent-language text
// Unit tests: tests/unit/language-rule.test.js.
import { scienceBlock } from './notes-glossary.js';

const EXAMPLES = {
  Telugu: 'స్థానభ్రంశం (Displacement)',
  Hindi: 'विस्थापन (Displacement)',
  Tamil: 'இடப்பெயர்ச்சி (Displacement)',
};

export function bilingualTerms(lang) {
  if (!lang || lang === 'English') return '';
  const ex = EXAMPLES[lang] || `the ${lang} word (Displacement)`;
  return `KEY TERMS: whenever you name a key subject term in ${lang}, write the ${lang} word first and the term exactly as the page or question writes it in brackets right after it, the first time it appears in that text, for example ${ex}. After that the ${lang} word alone is enough. If the page is itself in ${lang}, write the term once with no brackets. Never put a third language in the brackets.`;
}

const TELUGU_RULES = [
  'Write Telugu the way a good school teacher speaks to a child in class: short sentences, everyday words, natural Telugu word order (the verb at the end), never English sentence order translated word by word.',
  'Use the standard Telugu school-textbook word for a technical term (the list below) and the SAME word every time the concept comes back; do not invent a new technical word.',
  'Prefer the common spoken word to a heavy Sanskrit or old literary (గ్రాంథిక) word when both exist, for example "ఎందుకంటే" and "కాబట్టి" rather than long bookish connectors.',
  'Speak to the parent politely (మీరు, "...చేయండి"), and to the child warmly (నువ్వు).',
  'Never write half Telugu, half English words (such as a Telugu ending stuck on an English word) except the bracketed term; never leave an English sentence in Telugu text.',
  'Every sentence has a verb and is complete; no fragments, no repeated words, no broken letters or stray symbols.',
  'Numbers are digits 0-9, never Telugu numerals; units are written as in the question.',
  'Get the case endings right (for example "నీటిని", never "నీరును"); never repeat a word or an ending over and over inside one phrase (such as "ఆకుల యొక్క ఆకుల్లో ఉన్న ఆకుల"); say "ఆహారం" for the food a plant makes, not "భోజనం"; use the glossary word, not a half-remembered one, for every technical term.',
  'Before you answer, read each Telugu sentence once more as a parent would: if it sounds like a translation, or any word is unfamiliar or wrong, rewrite it in plain spoken Telugu.',
];

export function teluguQuality(lang) {
  if (lang !== 'Telugu') return '';
  return 'TELUGU QUALITY: ' + TELUGU_RULES.map((r, i) => `(${i + 1}) ${r}`).join(' ');
}

// { terms: false } leaves the bilingual-terms sentence out, for a prompt that already states it inline.
export function languageBlock(lang, { terms = true } = {}) {
  return [terms ? bilingualTerms(lang) : '', teluguQuality(lang), scienceBlock(lang)].filter(Boolean).join('\n');
}
