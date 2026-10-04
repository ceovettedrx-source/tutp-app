// Latency of the 8-question Telugu photo case (founder decision 7).
//   node tests/golden/latency.js [--runs 2]
// Asks the model live, once as ONE call and once as two PARALLEL batches of 4,
// the way /api/homework does, and prints seconds, output tokens, stop reason
// and how many questions passed the checks. Spends about $0.06 per run.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHomeworkRequest } from '../../server/prompts/homework-prompts.js';
import { runAnswer, answerRequestBody } from '../../server/answer-run.js';
import { boxablePhotos } from '../../server/homework-boxes.js';
import { callClaude } from '../../server/anthropic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const runs = Number((process.argv[process.argv.indexOf('--runs') + 1]) || 1) || 1;
const base64 = fs.readFileSync(path.join(HERE, '..', 'e2e', 'fixtures', 'te-8.jpg')).toString('base64');
const attachments = [{ mediaType: 'image/jpeg', base64 }];
const photos = boxablePhotos(attachments);

async function once(batch) {
  const stats = [];
  const cost = { usd: 0 };
  const build = (range) => buildHomeworkRequest({ feature: 'answer_v2', lang: 'Telugu', childContext: 'Asha · Class 7', text: '', attachments, photos, extra: { board: 'state', range } });
  const callModel = async ({ range, hint, attempt }) => {
    const { system, content } = build(range);
    const t0 = Date.now();
    const r = await callClaude({ feature: 'answer_v2_photo', variant: 'Telugu', attempt, mode: 'live', cost, body: answerRequestBody({ system, userContent: content, hint, range }) });
    stats.push({ range: range ? `${range.from}-${range.to}` : 'all', ms: Date.now() - t0, out: r.ok ? r.data.usage.output_tokens : null, stop: r.ok ? r.data.stop_reason : r.status, attempt });
    return r.ok ? { ok: true, data: r.data } : { ok: false, status: r.status, errText: r.errText };
  };
  const t0 = Date.now();
  const res = await runAnswer({ callModel, board: 'state', photos, batch });
  return { total: Date.now() - t0, kind: res.kind, questions: res.kind === 'ok' ? res.answer.questions.length : 0, usd: cost.usd, stats };
}

// --old: the same photo through the current Homework Help prompt (the
// baseline a parent has today), one call as /api/homework makes it.
if (process.argv.includes('--old')) {
  const { POINTING_MODEL, POINTING_SETTINGS } = await import('../../server/pointing-model.js');
  const { system, content } = buildHomeworkRequest({ feature: 'homework_help', lang: 'Telugu', childContext: 'Asha · Class 7', text: '', attachments, photos });
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = await callClaude({ feature: 'homework_help_photo', variant: 'Telugu', attempt: 1, mode: 'live',
      body: { model: POINTING_MODEL, ...POINTING_SETTINGS, max_tokens: 3000, system, messages: [{ role: 'user', content }] } });
    console.log(`old path    total ${((Date.now() - t0) / 1000).toFixed(1)} s  ${r.ok ? r.data.usage.output_tokens + ' output tokens, stop ' + r.data.stop_reason : 'HTTP ' + r.status}`);
  }
  process.exit(0);
}

for (let i = 0; i < runs; i++) {
  for (const batch of [false, true]) {
    const r = await once(batch);
    console.log(`${batch ? 'batch 4+4' : 'one call '}  total ${(r.total / 1000).toFixed(1)} s  ${r.kind}  ${r.questions} questions  $${r.usd.toFixed(3)}`);
    r.stats.forEach((s) => console.log(`    ${s.range}: ${(s.ms / 1000).toFixed(1)} s, ${s.out} output tokens, stop ${s.stop}${s.attempt > 1 ? ' (retry)' : ''}`));
  }
}
