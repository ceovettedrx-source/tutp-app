// Writes the hand-made model replies of tests/e2e/library.spec.js into
// tests/e2e/recordings/ (story-image-library round). They are replies a model
// could give, written by hand so each test is deterministic and costs nothing:
// a library picture, an id that was not offered, a Venn diagram, a bar model
// with an icon, and a chain equation with a blank. The key is the one the
// server computes (server/model-replay.js recordingKey), so a changed topic
// text needs this script run again.
//
//   node tests/e2e/recordings-handwritten.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recordingKey } from '../../server/model-replay.js';
import { validateStory } from '../../server/story-schema.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recordings');

export const TOPICS = {
  library: 'The chromosome: two chromatids joined at the centromere (e2e library picture)',
  invented: 'Chromatids and the centromere (e2e invented picture id)',
  venn: 'Sets: children who like tea and children who like milk, Kiran likes both (e2e venn)',
  bar: 'Parts of a whole: 5 red marbles and 7 blue marbles make 12 (e2e bar icons)',
  chain: 'Multiplying in steps: 6 x 9 = 6 x 3 x __ (e2e chain and blank)',
};

const scenes = (a, b, c, d) => [
  { label: 'hook', text: a }, { label: 'problem', text: b }, { label: 'mathMoment', text: c }, { label: 'wrapUp', text: d },
];
const STORIES = {
  library: {
    title: 'Meena and the tiny X', gradeSubjectTag: 'Class 8 · Science · Chromosomes', readMinutes: 2,
    scenes: scenes(
      'Meena was helping her science teacher clean the lab microscope on a quiet afternoon.',
      'On a slide she saw a tiny X shape and could not tell what it was or why it looked like two pieces.',
      'Her teacher said it is a chromosome: two identical chromatids, held together at one spot called the centromere.',
      'Meena smiled. Now the X made sense, and she drew it in her notebook with two arms joined in the middle.'),
    visual: { type: 'library', id: 'chromosome' }, equations: [],
    tryTogether: { question: 'Which part holds the two chromatids together?', answer: 'The centromere' },
    parentPrompt: 'Ask your child to draw the X and point to the centromere.',
  },
  invented: {
    title: 'Ravi and the two arms', gradeSubjectTag: 'Class 8 · Science', readMinutes: 2,
    scenes: scenes(
      'Ravi found a picture of a chromosome in his science book at home.',
      'He wanted to know what the two matching halves were called and what joined them.',
      'His sister explained that the halves are chromatids and the joining point is the centromere.',
      'Ravi was happy to be able to name every part of the picture.'),
    visual: { type: 'library', id: 'human-eye' }, equations: [],
    tryTogether: { question: 'What are the two matching halves called?', answer: 'Chromatids' },
    parentPrompt: 'Ask your child to name the two halves.',
  },
  venn: {
    title: 'Asha, the tea stall and the milk stall', gradeSubjectTag: 'Class 6 · Maths · Sets', readMinutes: 2,
    scenes: scenes(
      'Asha and Ravi sold tea at the school fair, and the fair was full of happy children.',
      'Meena sold milk, and Kiran sold both tea and milk, so Asha wondered who belongs to which group.',
      'The children who sell tea are one set and those who sell milk are another set, and Kiran is in both sets, in the overlap.',
      'Asha drew two circles that overlap, and Kiran stood in the middle.'),
    visual: { type: 'venn', left: { label: 'tea', items: ['Asha', 'Ravi'] }, right: { label: 'milk', items: ['Meena'] }, both: ['Kiran'] },
    equations: [], tryTogether: { question: 'In a class, 4 children play cricket only, 3 play kabaddi only and 2 play both. How many children play at least one game?', answer: '9' },
    parentPrompt: 'Draw two overlapping circles and place your family in them.',
  },
  bar: {
    title: 'Kiran and the marbles', gradeSubjectTag: 'Class 3 · Maths', readMinutes: 2,
    scenes: scenes(
      'Kiran poured out his bag of marbles on the verandah floor.',
      'He wanted to know how many marbles he had in all, red and blue together.',
      'He counted 5 red marbles and 7 blue marbles, and saw that 5 + 7 = 12 marbles in all.',
      'Kiran put the marbles back, proud that he knew the total.'),
    visual: { type: 'barModel', itemNoun: 'marbles', total: 12, parts: [{ label: 'red', value: 5 }, { label: 'blue', value: 7 }] },
    equations: ['5 + 7 = 12'], tryTogether: { question: 'You have 6 green marbles and 3 yellow marbles. How many marbles in all? 6 + 3 = ?', answer: '9' },
    parentPrompt: 'Count the spoons and the plates at home together.',
  },
  chain: {
    title: 'Ravi packs the boxes', gradeSubjectTag: 'Class 5 · Maths · Multiplication', readMinutes: 2,
    scenes: scenes(
      'Ravi helped at his uncle\'s shop, where boxes of pencils were stacked up to the roof.',
      'There were 6 shelves with 9 boxes on each shelf, and Ravi had to count them quickly for his uncle.',
      'He split the 9 into 3 and 3, and saw that 6 times 9 is the same as 6 times 3 times 3.',
      'Ravi told his uncle the answer at once, and his uncle laughed with joy.'),
    visual: null, equations: ['6 × 9 = 6 × 3 x ___'],
    tryTogether: { question: 'You have 7 rows of 4 stickers. How many stickers in all? 7 × 4 = ?', answer: '28' },
    parentPrompt: 'Ask your child to split 8 × 6 in a different way.',
  },
};

// Retry pairs (round print-a4-and-science-tryit): the first reply fails a
// check, so the server asks once more with a hint naming the issues; the
// second reply's recording is keyed by that hint, which is worked out here with
// the same validator the server uses. Replayed whatever the run mode.
//   percent    a science story whose try-together is "40% of 50": sent back,
//              the second reply asks how many chromatids 3 chromosomes have
//   longScene  scene 3 has 5 sentences in both replies: after the retry it is
//              trimmed to its first 3 sentences (X-Story-Fixed 1 or more)
export const RETRY_TOPICS = {
  percent: 'Chromosomes: what a chromosome is made of (e2e science percent retry)',
  longScene: 'The cell cycle: why a cell divides (e2e long scene 3 retry)',
};
const BIG_IDEA_LONG = 'A cell divides so that the body can grow and heal. Before it divides, it copies every chromosome. The copies stay joined at the centromere. Then they are pulled apart into two new cells. Each new cell gets a full set.';
const science = (over) => ({
  title: 'Meera and the two threads', gradeSubjectTag: 'Class 10 · Science · Chromosomes', concept: 'chromosomes', readMinutes: 2,
  scenes: scenes(
    'Meera sat on the veranda while her grandmother unrolled two skeins of red wool for the Sankranti kites.',
    'That night Meera read about chromosomes and could not picture how one becomes two without tangling.',
    'After copying, a chromosome is two sister chromatids joined at the centromere. They stay joined until the cell divides.',
    'Meera tied two strings in the middle and pulled them apart, and the idea finally made sense to her.'),
  visual: null, equations: [],
  tryTogether: { question: 'A cell has 3 chromosomes and copies each one. How many chromatids does the cell have now?', answer: '6 chromatids' },
  parentPrompt: 'Ask your child to show the centromere with two strings.',
  ...over,
});
const withScene3 = (s, text) => ({ ...s, scenes: s.scenes.map((x) => (x.label === 'mathMoment' ? { ...x, text } : x)) });
export const RETRIES = {
  percent: {
    topic: RETRY_TOPICS.percent,
    first: science({ tryTogether: { question: 'A chromosome weighs 50 units and 40% of it is DNA. How many units of DNA is that?', answer: '20 units' } }),
    second: science({}),
    firstIssues() { return validateStory(this.first).issues || []; },
  },
  longScene: {
    topic: RETRY_TOPICS.longScene,
    first: withScene3(science({}), BIG_IDEA_LONG),
    second: withScene3(science({}), BIG_IDEA_LONG),
    firstIssues() { return validateStory(this.first).issues || []; },
  },
};
const reply = (name, story) => ({ id: 'msg_handwritten_' + name, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: JSON.stringify(story) }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } });
export function retryFiles(name) {
  const pair = RETRIES[name];
  const issues = pair.firstIssues();
  const hint = 'Your previous reply failed these checks: ' + issues.join('; ') + '. Reply again with the complete JSON in exactly the shape given, fixing them.';
  const text = `Lesson: ${pair.topic}`;
  return {
    first: reply(name + '-1', pair.first), second: reply(name + '-2', pair.second),
    key1: recordingKey('storytelling', { messages: [{ role: 'user', content: [{ type: 'text', text }] }] }, 'English'),
    key2: recordingKey('storytelling', { messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'text', text: hint }] }] }, 'English'),
  };
}

export { STORIES };
export const keyFor = (topic, lang = 'English') => recordingKey('storytelling', { messages: [{ role: 'user', content: [{ type: 'text', text: `Lesson: ${topic}` }] }] }, lang);
// The library story is also asked in Telugu, to check the legend language (the
// story text is English: the fixture only needs the picture and its labels).
export const EXTRA_LANGUAGES = [{ name: 'library', lang: 'Telugu' }];
export const replyFor = (name) => ({ id: 'msg_handwritten_' + name, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: JSON.stringify(STORIES[name]) }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, topic] of Object.entries(TOPICS)) {
    const key = keyFor(topic);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${key}.json`), JSON.stringify({ status: 200, data: replyFor(name) }) + '\n');
    console.log(name, key);
  }
  for (const { name, lang } of EXTRA_LANGUAGES) {
    const key = keyFor(TOPICS[name], lang);
    fs.writeFileSync(path.join(DIR, `${key}.json`), JSON.stringify({ status: 200, data: replyFor(name) }) + '\n');
    console.log(name, lang, key);
  }
  for (const [name, pair] of Object.entries(RETRIES)) {
    const { first, second, key1, key2 } = retryFiles(name);
    fs.writeFileSync(path.join(DIR, `${key1}.json`), JSON.stringify({ status: 200, data: first }) + '\n');
    fs.writeFileSync(path.join(DIR, `${key2}.2.json`), JSON.stringify({ status: 200, data: second }) + '\n');
    console.log(name, 'retry pair', key1, key2 + '.2', 'issues:', pair.firstIssues().join(' | '));
  }
}
