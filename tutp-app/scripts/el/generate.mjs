// One-time generation of the 12 Guided Discovery lessons (static JSON, no DB).
//
//   node scripts/el/generate.mjs [--only id,id] [--dry]
//
// Per concept: (1) one sonnet-5 call writes the lesson, validated against
// server/el/schema.js (one retry); (2) the deterministic safety gate
// (server/el/safety.js); (3) a second sonnet-5 pass checks the experiment
// against the whitelist, the rules and the KG facts. A failing experiment is
// dropped (the lesson stays, sim-only). Writes server/el/content/<id>.json,
// docs/specs/el-v2-safety-report.md and scripts/el/last-run.json (spend).
// The Anthropic key is read from the repo's .env (ENV_FILE overrides) and
// never printed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { CONCEPTS, PHET } from '../../server/el/concepts.js';
import { validateLesson } from '../../server/el/schema.js';
import { checkExperiment, ITEM_WHITELIST } from '../../server/el/safety.js';
import { costUsd } from '../../server/model-cost.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
dotenv.config({ path: process.env.ENV_FILE || 'C:/Users/user/AppData/Local/Google/Cloud SDK/tutp-app/tutp-app/.env' });
const MODEL = 'claude-sonnet-5';
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const spend = { calls: 0, usd: 0, tokensIn: 0, tokensOut: 0 };

async function claude(system, user, maxTokens = 4000) {
  const body = { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], output_config: { effort: 'low' } };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Claude ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  spend.calls++; spend.usd += costUsd(MODEL, data.usage) || 0;
  spend.tokensIn += data.usage.input_tokens; spend.tokensOut += data.usage.output_tokens;
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in reply');
  return JSON.parse(m[0]);
}

const GEN_SYSTEM = `You write one short "guided discovery" science lesson for a parent to run at home with a child (Class 6 to 10, India). Predict first, then do or play, then notice, then name the idea. You never give the answer before the child has guessed.
Return ONLY one JSON object, no markdown, in exactly this shape:
{"id":"<given>","title":"<given>","predict":{"question":"a what-will-happen question the child can answer by guessing","options":[{"text":"...","misconceptionId":null},{"text":"...","misconceptionId":"<given id>"},{"text":"...","misconceptionId":null}],"correctIndex":0,"why":"one sentence on why the right option is right"},
"experiment":{"title":"...","items":["each item is a short noun like 'vinegar' or 'steel spoon'"],"steps":["3 to 6 short steps"],"adultSteps":[indexes of steps only an adult does],"note":"one safety line for the parent"},
"parentCard":{"role":"what the parent does: coach, do not teach","say":["2 to 3 questions to ask"],"avoid":["1 to 2 things not to say, such as telling the answer"]},
"notice":{"question":"what did you see?","lookFor":"what a good observation is"},
"hints":[{"level":1,"text":"direction: where to look"},{"level":2,"text":"comparison: compare two things"},{"level":3,"text":"near-answer: almost says it"}],
"reveal":{"explanation":"3 to 4 plain sentences","term":"the scientific term","termMeaning":"one sentence"},
"teachBack":{"prompt":"ask the child to explain it to someone younger, in their own words"},
"revisits":[{"question":"a fresh question on the same idea (days later)","answer":"short answer"},{"question":"another one, in a new situation","answer":"short answer"}]}
Rules: the options must be three different outcomes; put the right one at the index you choose (correctIndex 0, 1 or 2, vary it); the option carrying misconceptionId is the wrong belief written as an outcome. Plain English a Class 6 child can read. Do not copy textbook sentences.
HOME EXPERIMENT SAFETY (strict): no flame or fire, nothing run from a wall socket or mains electricity, no battery, no knife, scissors, blade, needle or any sharp tool, no chemicals other than the whitelist. Allowed items: ${ITEM_WHITELIST.join(', ')}. Hot water only as an adult step (name "adult" in that step and list its index in adultSteps). If the idea cannot be shown safely with these items, set "experiment" to null (the child will use the simulation instead). Do not invent items.`;

const CHECK_SYSTEM = `You are a strict child-safety and science-accuracy reviewer for a home experiment for Class 6 to 10 children in India. You get the experiment, the allowed-items list, the rules and the concept facts. Reply ONLY with JSON: {"safe":boolean,"safeReasons":["why not safe, empty if safe"],"factsOk":boolean,"factIssues":["any scientific error in the experiment, the prediction or the explanation, empty if none"]}.
Rules: no flame, no mains electricity or batteries, kitchen/household whitelist items only, no sharp tools, hot water only in a step the adult does. Mark safe=false for anything that could burn, cut, shock, poison or be swallowed, or that needs an item outside the list.`;

function genPrompt(c) {
  return `Concept id: ${c.id}\nTitle: ${c.title}\nClass: ${c.grade}\nLearning outcome (the idea the child should reach): ${c.lo}\nThe misconception to use for the wrong option (misconceptionId "in-misc-sci-el-${c.id}-01"): ${c.misconception}\nA simulation is ${c.phet.length ? 'available (' + c.phet.join(', ') + '), so an experiment is optional' : 'not available, so a safe home experiment matters'}.`;
}

const results = [];
async function one(c) {
  const row = { id: c.id, title: c.title, grade: c.grade, status: 'excluded', experiment: 'none', reasons: [], factIssues: [], attempts: 0 };
  let lesson = null;
  for (let attempt = 1; attempt <= 2 && !lesson; attempt++) {
    row.attempts = attempt;
    try {
      const l = await claude(GEN_SYSTEM, genPrompt(c));
      l.id = c.id; l.title = c.title;
      for (const o of l.predict?.options || []) if (o.misconceptionId) o.misconceptionId = `in-misc-sci-el-${c.id}-01`;
      const v = validateLesson({ ...l, sim: { slugs: [] } });
      if (v.ok) lesson = l; else row.reasons.push('schema attempt ' + attempt + ': ' + v.errors.join(','));
    } catch (err) { row.reasons.push(`generation attempt ${attempt}: ${err.message}`); }
  }
  if (!lesson) return row;
  lesson.grade = c.grade; lesson.version = 1;
  lesson.sim = { slugs: c.phet };
  lesson.simUrls = c.phet.map(PHET);
  // Safety gate: deterministic pass, then the second Claude pass.
  let exp = lesson.experiment || null;
  const reasons = [];
  if (exp) {
    const det = checkExperiment(exp);
    if (!det.ok) reasons.push(...det.reasons.map((r) => 'rule: ' + r));
    try {
      const review = await claude(CHECK_SYSTEM, JSON.stringify({ concept: c.lo, allowedItems: ITEM_WHITELIST, experiment: exp, prediction: lesson.predict, explanation: lesson.reveal }), 1200);
      if (!review.safe) reasons.push(...(review.safeReasons || ['second pass: not safe']).map((r) => 'review: ' + r));
      if (!review.factsOk) { row.factIssues = review.factIssues || ['second pass: facts not ok']; reasons.push(...row.factIssues.map((r) => 'facts: ' + r)); }
    } catch (err) { reasons.push('review failed: ' + err.message); }
    if (reasons.length) { lesson.experiment = null; row.experiment = 'dropped'; } else row.experiment = 'pass';
  } else row.experiment = 'none';
  row.reasons.push(...reasons);
  lesson.safety = { experiment: row.experiment, reasons };
  // A lesson with neither a sim nor an experiment has nothing to do: excluded.
  if (!lesson.experiment && !c.phet.length) { row.status = 'excluded'; row.reasons.push('no sim and no safe experiment'); return row; }
  const final = validateLesson(lesson);
  if (!final.ok) { row.reasons.push('final schema: ' + final.errors.join(',')); return row; }
  fs.mkdirSync(path.join(ROOT, 'server', 'el', 'content'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'server', 'el', 'content', c.id + '.json'), JSON.stringify(lesson, null, 2) + '\n');
  row.status = 'included';
  return row;
}

const list = CONCEPTS.filter((c) => !only.length || only.includes(c.id));
const done = await Promise.all(list.map(one));
results.push(...done);

const lines = ['# Guided Discovery: safety report', '', `Generated ${new Date().toISOString().slice(0, 10)} by scripts/el/generate.mjs. Gate: deterministic rules (server/el/safety.js) then a second ${MODEL} pass (whitelist, rules, KG facts). A failing experiment is dropped and the lesson stays sim-only; a lesson with no sim and no safe experiment is excluded.`, '',
  '| concept | class | lesson | home experiment | notes |', '|---|---|---|---|---|'];
for (const r of results) lines.push(`| ${r.id} | ${r.grade} | ${r.status} | ${r.experiment} | ${r.reasons.map((x) => x.replace(/\|/g, '/')).join('; ') || '-'} |`);
lines.push('', `Included: ${results.filter((r) => r.status === 'included').length}/${results.length}. Experiments passed: ${results.filter((r) => r.experiment === 'pass').length}, dropped: ${results.filter((r) => r.experiment === 'dropped').length}, none offered: ${results.filter((r) => r.experiment === 'none').length}.`,
  '', `One-time generation cost: ${spend.calls} calls, ${spend.tokensIn} input and ${spend.tokensOut} output tokens, about $${spend.usd.toFixed(3)}.`);
if (!only.length) fs.writeFileSync(path.join(ROOT, 'docs', 'specs', 'el-v2-safety-report.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(HERE, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), spend, results }, null, 2) + '\n');
console.log(lines.slice(-8).join('\n'));
