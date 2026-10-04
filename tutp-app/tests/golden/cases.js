// The Answer/Explain v2 golden set (docs/specs/answer-explain-v2.md section 7):
// 10 typed homework cases, Class 3-10, maths / physics / biology / social /
// English grammar, English / Telugu / Hindi, TS / AP / CBSE. Run by
// tests/golden/golden.js (record once with `node tests/golden/run.js --record`,
// replayed by tests/unit/golden.test.js on every unit run).
//   lang    explain-in language, set to the question's own language so the
//           check "explain language = question language" is meaningful
//   script  the script the question is written in
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
];
