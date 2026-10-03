// Story visuals v2 (docs/specs/story-visuals-v2.md): the icon for the counted
// things. The model suggests one emoji for the itemNoun; it is kept only when
// it is a single emoji, else a curated map by word stem (English, Telugu,
// Hindi, Tamil), else '' and the page draws a plain dot.

const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
const PICTO = /\p{Extended_Pictographic}/u;

// Exactly one emoji (with its variation selector, skin tone or ZWJ parts).
export function isSingleEmoji(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t.length > 16 || !PICTO.test(t)) return false;
  if (/[\p{L}\p{N}]/u.test(t.replace(/\p{Extended_Pictographic}/gu, ''))) return false;
  if (SEG) return [...SEG.segment(t)].length === 1;
  return [...t].filter((c) => PICTO.test(c)).length === 1;
}

// word stem (lowercase) -> icon
const MAP = [
  ['mango', '🥭'], ['మామిడి', '🥭'], ['आम', '🥭'], ['மாம்', '🥭'],
  ['laddu', '🟠'], ['laddoo', '🟠'], ['లడ్డ', '🟠'], ['లడ్డూ', '🟠'], ['लड्डू', '🟠'], ['லட்டு', '🟠'],
  ['banana', '🍌'], ['అరటి', '🍌'], ['केल', '🍌'], ['வாழை', '🍌'],
  ['apple', '🍎'], ['ఆపిల్', '🍎'], ['सेब', '🍎'], ['ஆப்பிள்', '🍎'],
  ['orange', '🍊'], ['నారింజ', '🍊'], ['संतर', '🍊'], ['ஆரஞ்சு', '🍊'],
  ['pencil', '✏️'], ['పెన్సిల', '✏️'], ['पेंसिल', '✏️'], ['பென்சில்', '✏️'],
  ['pen', '🖊️'], ['కలం', '🖊️'], ['कलम', '🖊️'],
  ['book', '📘'], ['పుస్తక', '📘'], ['किताब', '📘'], ['புத்தக', '📘'],
  ['ball', '⚽'], ['బంతి', '⚽'], ['गेंद', '⚽'], ['பந்து', '⚽'],
  ['diya', '🪔'], ['deepa', '🪔'], ['దీపం', '🪔'], ['దీపా', '🪔'], ['दीया', '🪔'], ['दीप', '🪔'], ['விளக்கு', '🪔'],
  ['flower', '🌸'], ['పూవు', '🌸'], ['పువ్వు', '🌸'], ['పూలు', '🌸'], ['फूल', '🌸'], ['பூ', '🌸'],
  ['coin', '🪙'], ['నాణ', '🪙'], ['सिक्क', '🪙'], ['நாணய', '🪙'],
  ['rupee', '🪙'], ['రూపాయ', '🪙'], ['रुपय', '🪙'], ['ரூபாய்', '🪙'],
  ['mirchi', '🌶️'], ['chilli', '🌶️'], ['chili', '🌶️'], ['మిరప', '🌶️'], ['मिर्च', '🌶️'],
  ['star', '⭐'], ['నక్షత్ర', '⭐'], ['तारे', '⭐'], ['நட்சத்திர', '⭐'],
  ['cookie', '🍪'], ['biscuit', '🍪'], ['బిస్కెట', '🍪'], ['बिस्कुट', '🍪'],
  ['candy', '🍬'], ['candies', '🍬'], ['sweet', '🍬'], ['chocolate', '🍫'], ['మిఠాయ', '🍬'], ['मिठाई', '🍬'],
  ['egg', '🥚'], ['గుడ్డు', '🥚'], ['अंडे', '🥚'],
  ['guava', '🍐'], ['జామ', '🍐'], ['अमरूद', '🍐'],
  ['coconut', '🥥'], ['కొబ్బరి', '🥥'], ['नारियल', '🥥'],
  ['rose', '🌹'], ['marble', '🔵'], ['kite', '🪁'], ['గాలిపటం', '🪁'], ['पतंग', '🪁'],
  ['bird', '🐦'], ['పక్షి', '🐦'], ['चिड़िया', '🐦'], ['cow', '🐄'], ['ఆవు', '🐄'], ['गाय', '🐄'],
  ['bangle', '⭕'], ['గాజు', '⭕'], ['चूड़ी', '⭕'],
];

export function iconForNoun(noun) {
  const n = String(noun || '').normalize('NFC').toLowerCase();
  if (!n) return '';
  for (const [stem, icon] of MAP) if (n.includes(stem)) return icon;
  return '';
}

// The model's emoji if valid, else the map, else '' (the page draws a dot).
export function pickIcon(modelIcon, noun) {
  if (isSingleEmoji(modelIcon)) return modelIcon.trim();
  return iconForNoun(noun);
}
