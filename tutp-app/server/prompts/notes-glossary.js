// Telugu and Hindi maths terms for the notes prompt (notes-quality-v2).
// UNVERIFIED: every entry below is a starting guess pending teacher review
// (the founder reviews the list before release). The prompt names these terms
// exactly as written, for te and hi only; other languages get no glossary.

export const GLOSSARY = [
  { en: 'commutative property (order does not change the result)', te: 'వినిమయ ధర్మం', hi: 'क्रम विनिमय गुण' },
  { en: 'associative property (grouping does not change the result)', te: 'సహచర ధర్మం', hi: 'साहचर्य गुण' },
  { en: 'distributive property', te: 'విభాజక ధర్మం', hi: 'वितरण गुण' },
  { en: 'zero property (anything times 0 is 0)', te: 'శూన్య ధర్మం', hi: 'शून्य का गुण' },
  { en: 'identity property (anything times 1 stays the same)', te: 'తత్సమ ధర్మం', hi: 'तत्समक गुण' },
  { en: 'equal sides (both sides of the = sign have the same value)', te: 'రెండు వైపులా సమానం', hi: 'दोनों पक्ष बराबर' },
  { en: 'factor', te: 'కారణాంకం', hi: 'गुणनखंड' },
  { en: 'product', te: 'లబ్ధం', hi: 'गुणनफल' },
  { en: 'multiple', te: 'గుణిజం', hi: 'गुणज' },
  { en: 'quotient', te: 'భాగఫలం', hi: 'भागफल' },
  { en: 'remainder', te: 'శేషం', hi: 'शेषफल' },
  { en: 'fraction', te: 'భిన్నం', hi: 'भिन्न' },
  { en: 'numerator', te: 'లవం', hi: 'अंश' },
  { en: 'denominator', te: 'హారం', hi: 'हर' },
  { en: 'equation', te: 'సమీకరణం', hi: 'समीकरण' },
];

// Wording the model must never write in Telugu, with the right word.
export const BANNED_TE = [
  { bad: 'స్థానిక లక్షణం', use: null },
  { bad: 'సున్న్య', use: 'సున్నా' },
  { bad: 'సర్వ కాలం', use: 'ఎల్లప్పుడూ' },
];

// The prompt block for a language ('Telugu' | 'Hindi'), or '' for any other.
export function glossaryBlock(lang) {
  const key = lang === 'Telugu' ? 'te' : lang === 'Hindi' ? 'hi' : null;
  if (!key) return '';
  const terms = GLOSSARY.map((g) => `${g.en} = ${g[key]}`).join('; ');
  let out = `MATHS TERMS in ${lang} (use these exact words when the idea comes up, do not invent other technical names): ${terms}.`;
  if (key === 'te') {
    out += ' Never write: ' + BANNED_TE.map((b) => `"${b.bad}"` + (b.use ? ` (write ${b.use})` : '')).join(', ') + '. Write "ఎల్లప్పుడూ" for "always".';
  }
  return out;
}
