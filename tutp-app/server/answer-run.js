// Runs the Answer Please model call(s) for /api/homework and returns one
// checked answer (docs/specs/answer-explain-v2.md, founder decision 7).
//
//   runAnswer({ callModel, board, photos, batch }) ->
//     { kind: 'ok', answer, data, calls }          answer: server/answer-schema.js output, in page order
//     { kind: 'upstream', status, errText }        the model API itself failed
//     { kind: 'invalid', issues }                  still failing the checks after the one retry
//
// callModel({ range, hint, attempt }) -> { ok: true, data } | { ok: false, status, errText }
// (range is null for one call, { from, to } for a batch; hint is the
// correction text of the one retry).
// batch = false: ONE call for all questions.
// batch = true : questions 1-4 and 5-8 as two PARALLEL calls, merged in
//                order (used when the 8-question case goes over the time
//                budget or truncates, measured on the preview).
// A reply that is not JSON or fails the checks is asked once more, per call.
// Unit tests: tests/unit/answer-run.test.js.
import { checkReplyJson } from './homework-reply.js';
import { MODELS, answerSettings } from './models.js';
import { extractAnswerJson, validateAnswer, answerCorrectionHint, mergeAnswers } from './answer-schema.js';

// The Messages API body of one Answer Please call. Used by /api/homework and
// by the golden-set runner, so both ask the model exactly the same way.
// Up to 8 questions with blocks in an Indic script: far more than the old 3000 tokens.
export function answerRequestBody({ system, userContent, hint = null, range = null }) {
  return {
    model: MODELS.answer_v2, ...answerSettings(),
    max_tokens: range ? 4500 : 7000,
    system,
    messages: [{ role: 'user', content: hint ? [...userContent, { type: 'text', text: hint }] : userContent }],
  };
}

async function one({ callModel, range, board, photos }) {
  let issues = ['the reply was not valid JSON'];
  let data = null, calls = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const hint = attempt === 1 ? null : answerCorrectionHint(issues);
    const r = await callModel({ range, hint, attempt });
    calls++;
    if (!r.ok) return { kind: 'upstream', status: r.status, errText: r.errText, calls };
    data = r.data;
    const parsed = checkReplyJson(r.data);
    if (!parsed.ok) { issues = ['the reply was not valid JSON (' + parsed.error + ')']; continue; }
    const v = validateAnswer(extractAnswerJson(r.data), { board, photos, allowEmpty: !!range && range.from > 1, degrade: attempt === 2 });
    if (v.ok) return { kind: 'ok', answer: v.answer, fixed: v.fixed, mismatches: v.mismatches || 0, data, calls };
    issues = v.issues;
  }
  return { kind: 'invalid', issues, data, calls };
}

export async function runAnswer({ callModel, board = 'other', photos = [], batch = false }) {
  if (!batch) return one({ callModel, range: null, board, photos });
  const ranges = [{ from: 1, to: 4 }, { from: 5, to: 8 }];
  const results = await Promise.all(ranges.map((range) => one({ callModel, range, board, photos })));
  const bad = results.find((r) => r.kind !== 'ok');
  if (bad) return bad;
  const answer = mergeAnswers(results.map((r) => r.answer));
  const sum = (k) => results.reduce((n, r) => n + (r[k] || 0), 0);
  return { kind: 'ok', answer, fixed: sum('fixed'), mismatches: sum('mismatches'), data: results[0].data, calls: sum('calls') };
}
