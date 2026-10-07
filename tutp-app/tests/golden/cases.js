// The Answer/Explain v2 golden set (docs/specs/answer-explain-v2.md section 7):
// 10 typed homework cases, Class 3-10, maths / physics / biology / social /
// English grammar, English / Telugu / Hindi, TS / AP / CBSE. Run by
// tests/golden/golden.js (record once with `node tests/golden/run.js --record`,
// replayed by tests/unit/golden.test.js on every unit run).
//   lang    explain-in language, set to the question's own language so the
//           check "explain language = question language" is meaningful
//   script  the script of the parent text (explanations, idea cards, notes): the script of `lang`
//   pageScript  img1: the script the page is written in when it differs from `script` (an English
//           page for a Telugu-speaking parent); the child's notebook answers stay in it, and the
//           parent text must carry the key terms bilingual, Telugu word (English term)
//   notes   also run "Notes please" for the case
//   expect  numerical answers worked out by hand: { q (1-based), value, unit }
//   types   q_type the question must get, by question number
export const CASES = [
  { id: 'g1-c3-maths-en-cbse', cls: 'Class 3', board: 'cbse', subject: 'maths', lang: 'English', script: 'latin',
    text: 'Q1. 345 + 278 = ?   Q2. 600 - 257 = ?',
    expect: [{ q: 1, value: 623 }, { q: 2, value: 343 }] },
  { id: 'g2-c4-maths-te-ts', cls: 'Class 4', board: 'state', subject: 'maths', lang: 'Telugu', script: 'telugu',
    text: 'ఒక బుట్టలో 24 మామిడి పండ్లు ఉన్నాయి. అటువంటి 6 బుట్టలలో మొత్తం ఎన్ని మామిడి పండ్లు ఉంటాయి? (2 మార్కులు)',
    expect: [{ q: 1, value: 144 }] },
  { id: 'g3-c5-maths-en-ap', cls: 'Class 5', board: 'state', subject: 'maths', lang: 'English', script: 'latin',
    text: 'Ravi ate 3/8 of a pizza and Sita ate 2/8 of the same pizza. How much of the pizza did they eat together? (2 marks)',
    expect: [{ q: 1, value: 5, frac: '5/8' }] },
  { id: 'g4-c6-social-hi-cbse', cls: 'Class 6', board: 'cbse', subject: 'social', lang: 'Hindi', script: 'devanagari',
    text: 'लोकतंत्र की दो विशेषताएँ लिखिए। (2 अंक)', expect: [] },
  { id: 'g5-c7-bio-te-ts', cls: 'Class 7', board: 'state', subject: 'biology', lang: 'Telugu', script: 'telugu',
    text: 'కిరణజన్య సంయోగక్రియ అంటే ఏమిటి? (2 మార్కులు)', expect: [] },
  { id: 'g6-c8-grammar-en-cbse', cls: 'Class 8', board: 'cbse', subject: 'english', lang: 'English', script: 'latin',
    text: 'Fill in the blank with the correct form of the verb: She ___ (go) to school every day. Change into passive voice: The cat chased the mouse.', expect: [] },
  { id: 'g7-c9-physics-en-ts', cls: 'Class 9', board: 'state', subject: 'physics', lang: 'English', script: 'latin',
    text: '1. Differentiate between distance and displacement. (4 marks)   2. A car travels 120 km in 2 hours. Find its average speed. (3 marks)',
    expect: [{ q: 2, value: 60, unit: /km\s*\/\s*h|kmph|km per hour/i }], types: { 1: 'difference', 2: 'numerical' } },
  { id: 'g8-c9-physics-hi-cbse', cls: 'Class 9', board: 'cbse', subject: 'physics', lang: 'Hindi', script: 'devanagari',
    text: 'एक कार 150 किमी की दूरी 3 घंटे में तय करती है। उसकी औसत चाल ज्ञात कीजिए। (3 अंक)',
    expect: [{ q: 1, value: 50, unit: /किमी|km/i }], types: { 1: 'numerical' } },
  { id: 'g9-c10-physics-te-ap', cls: 'Class 10', board: 'state', subject: 'physics', lang: 'Telugu', script: 'telugu',
    text: 'ఒక కారు నిశ్చల స్థితి నుండి 2 మీ/సె² త్వరణంతో 10 సెకన్లు ప్రయాణిస్తే, దాని చివరి వేగం ఎంత? (3 మార్కులు)',
    expect: [{ q: 1, value: 20, unit: /మీ\s*\/\s*సె|m\s*\/\s*s/i }], types: { 1: 'numerical' } },
  { id: 'g10-c10-bio-en-ts', cls: 'Class 10', board: 'state', subject: 'biology', lang: 'English', script: 'latin',
    text: 'Differentiate between aerobic and anaerobic respiration. (4 marks)', expect: [], types: { 1: 'difference' } },
  // Content pages: school text with NO questions (2026-10-06 regression). The
  // answer must be status ok, mode content, idea cards about the page, and
  // Explain must work on the first card. `about` must appear in the cards.
  { id: 'g11-c7-textbook-en-cbse', cls: 'Class 7', board: 'cbse', subject: 'science', lang: 'English', script: 'latin', content: true, about: /photosynthesis|chlorophyll/i,
    text: 'CHAPTER 1 Nutrition in plants. Photosynthesis. Green plants make their own food in the leaves by a process called photosynthesis. The plant takes in carbon dioxide from the air through tiny pores called stomata and water from the soil. The green pigment chlorophyll traps energy from sunlight. The leaf changes carbon dioxide and water into glucose and releases oxygen. Extra glucose is stored as starch.',
    expect: [] },
  { id: 'g12-c6-notebook-en-ts', cls: 'Class 6', board: 'state', subject: 'science', lang: 'English', script: 'latin', content: true, about: /water cycle|evaporat|condensat/i,
    text: 'The Water Cycle. Evaporation: sun heats water in seas and rivers, it becomes vapour. Condensation: vapour rises, cools and forms tiny drops = clouds. Precipitation: drops get heavy and fall as rain, hail or snow. Collection: water flows into rivers, lakes and sea again.',
    expect: [] },
  { id: 'g13-c7-textbook-te-ts', cls: 'Class 7', board: 'state', subject: 'biology', lang: 'Telugu', script: 'telugu', content: true, about: /కిరణజన్య|పత్రహరితం|క్లోరోఫిల్/,
    text: 'కిరణజన్య సంయోగక్రియ. ఆకుపచ్చ మొక్కలు తమ ఆహారాన్ని తామే తయారు చేసుకుంటాయి. ఆకులలోని పత్రహరితం (క్లోరోఫిల్) సూర్యకాంతి శక్తిని గ్రహిస్తుంది. మొక్క గాలి నుండి కార్బన్ డయాక్సైడ్ ను, నేల నుండి నీటిని తీసుకుని గ్లూకోజ్ ను తయారు చేసి ఆక్సిజన్ ను విడుదల చేస్తుంది.',
    expect: [] },
  // img1 Telugu quality cases (the founder reviews these three by hand, docs/golden-telugu-review.md).
  // g14: an English textbook page for a Telugu-speaking parent: idea cards and notes in Telugu,
  // key terms bilingual. g15: an English-medium worksheet: notebook answers in English, the rest in
  // Telugu. g16: a Telugu textbook page, everything in Telugu.
  { id: 'g14-c6-textbook-en-page-te-parent', cls: 'Class 6', board: 'state', subject: 'science', lang: 'Telugu', script: 'telugu', pageScript: 'latin', content: true, notes: true, about: /కిరణజన్య|photosynthesis|chlorophyll|పత్రహరితం/i,
    text: 'Photosynthesis. Green plants make their own food in their leaves. The leaves take in carbon dioxide from the air, and the roots take in water from the soil. Chlorophyll, the green pigment in the leaves, traps the energy of sunlight. Using this energy, the plant changes carbon dioxide and water into glucose, which is its food, and releases oxygen into the air. This process is called photosynthesis.',
    expect: [] },
  { id: 'g15-c7-maths-en-worksheet-te-parent', cls: 'Class 7', board: 'state', subject: 'maths', lang: 'Telugu', script: 'telugu', pageScript: 'latin', notes: true,
    text: '1. A tank can hold 240 litres of water. It is 3/4 full. How many litres of water are in the tank? (2 marks)   2. Add: 2/5 + 1/5. (1 mark)',
    expect: [{ q: 1, value: 180 }, { q: 2, value: 3, frac: '3/5' }], types: { 1: 'numerical' } },
  { id: 'g16-c9-social-te-textbook-te-parent', cls: 'Class 9', board: 'state', subject: 'social', lang: 'Telugu', script: 'telugu', content: true, notes: true, about: /రాజ్యాంగం/,
    text: 'భారత రాజ్యాంగం. భారత రాజ్యాంగం 1950 జనవరి 26న అమలులోకి వచ్చింది. రాజ్యాంగం మన దేశానికి అత్యున్నత చట్టం. ఇందులో పౌరుల ప్రాథమిక హక్కులు మరియు ప్రాథమిక విధులు ఉన్నాయి. సమానత్వపు హక్కు, స్వేచ్ఛా హక్కు, మత స్వాతంత్ర్యపు హక్కు వంటివి ప్రాథమిక హక్కులు. ప్రతి పౌరుడు రాజ్యాంగాన్ని గౌరవించాలి.',
    expect: [] },
];
