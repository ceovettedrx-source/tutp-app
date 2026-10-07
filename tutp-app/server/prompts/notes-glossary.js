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

// School-science terms (img1 Telugu quality pass), for every prompt that writes
// parent-language text (answer commentary, explain, notes, story).
// UNVERIFIED like the list above: a starting list in the wording of the Telangana
// and Andhra Pradesh SCERT textbooks, to be checked by a Telugu teacher (the
// founder reviews it with the three Telugu golden cases). Hindi follows NCERT.
export const SCIENCE_GLOSSARY = [
  { en: 'distance', te: 'దూరం', hi: 'दूरी' },
  { en: 'displacement', te: 'స్థానభ్రంశం', hi: 'विस्थापन' },
  { en: 'speed', te: 'వడి', hi: 'चाल' },
  { en: 'velocity', te: 'వేగం', hi: 'वेग' },
  { en: 'acceleration', te: 'త్వరణం', hi: 'त्वरण' },
  { en: 'motion', te: 'చలనం', hi: 'गति' },
  { en: 'relative motion', te: 'సాపేక్ష చలనం', hi: 'सापेक्ष गति' },
  { en: 'rest', te: 'నిశ్చలస్థితి', hi: 'विराम' },
  { en: 'force', te: 'బలం', hi: 'बल' },
  { en: 'work', te: 'పని', hi: 'कार्य' },
  { en: 'energy', te: 'శక్తి', hi: 'ऊर्जा' },
  { en: 'mass', te: 'ద్రవ్యరాశి', hi: 'द्रव्यमान' },
  { en: 'weight', te: 'భారం', hi: 'भार' },
  { en: 'density', te: 'సాంద్రత', hi: 'घनत्व' },
  { en: 'pressure', te: 'పీడనం', hi: 'दाब' },
  { en: 'friction', te: 'ఘర్షణ', hi: 'घर्षण' },
  { en: 'gravity', te: 'గురుత్వాకర్షణ', hi: 'गुरुत्वाकर्षण' },
  { en: 'inertia', te: 'జడత్వం', hi: 'जड़त्व' },
  { en: 'light', te: 'కాంతి', hi: 'प्रकाश' },
  { en: 'reflection', te: 'పరావర్తనం', hi: 'परावर्तन' },
  { en: 'refraction', te: 'వక్రీభవనం', hi: 'अपवर्तन' },
  { en: 'shadow', te: 'నీడ', hi: 'छाया' },
  { en: 'sound', te: 'ధ్వని', hi: 'ध्वनि' },
  { en: 'vibration', te: 'కంపనం', hi: 'कंपन' },
  { en: 'heat', te: 'ఉష్ణం', hi: 'ऊष्मा' },
  { en: 'temperature', te: 'ఉష్ణోగ్రత', hi: 'तापमान' },
  { en: 'electric current', te: 'విద్యుత్ ప్రవాహం', hi: 'विद्युत धारा' },
  { en: 'electric circuit', te: 'విద్యుత్ వలయం', hi: 'विद्युत परिपथ' },
  { en: 'magnet', te: 'అయస్కాంతం', hi: 'चुंबक' },
  { en: 'acid', te: 'ఆమ్లం', hi: 'अम्ल' },
  { en: 'base', te: 'క్షారం', hi: 'क्षार' },
  { en: 'indicator', te: 'సూచిక', hi: 'सूचक' },
  { en: 'mixture', te: 'మిశ్రమం', hi: 'मिश्रण' },
  { en: 'solution', te: 'ద్రావణం', hi: 'विलयन' },
  { en: 'cell', te: 'కణం', hi: 'कोशिका' },
  { en: 'photosynthesis', te: 'కిరణజన్య సంయోగక్రియ', hi: 'प्रकाश संश्लेषण' },
  { en: 'respiration', te: 'శ్వాసక్రియ', hi: 'श्वसन' },
  { en: 'digestion', te: 'జీర్ణక్రియ', hi: 'पाचन' },
  { en: 'nutrition', te: 'పోషణ', hi: 'पोषण' },
  { en: 'food chain', te: 'ఆహార గొలుసు', hi: 'खाद्य शृंखला' },
  { en: 'ecosystem', te: 'ఆవరణ వ్యవస్థ', hi: 'पारितंत्र' },
];

// The prompt block of science terms for a language ('Telugu' | 'Hindi'), or '' for any other.
export function scienceBlock(lang) {
  const key = lang === 'Telugu' ? 'te' : lang === 'Hindi' ? 'hi' : null;
  if (!key) return '';
  return `SCIENCE TERMS in ${lang} (use these exact words when the idea comes up, never another word for the same idea): ` + SCIENCE_GLOSSARY.map((g) => `${g.en} = ${g[key]}`).join('; ') + '.';
}

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
