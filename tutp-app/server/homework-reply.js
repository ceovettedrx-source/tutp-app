// /api/homework: the model's reply must hold a JSON object the pages can
// parse. Now and then it doesn't (e.g. a missing comma mid-array), and the
// parent sees an error, so the same request is sent once more before giving
// up. Unit tests: tests/unit/homework-reply.test.js.

// Anthropic Messages response -> { ok: true } or { ok: false, error }, by the
// rule the pages use (public/app/shared/homework-modal.js): the first text
// block, from its first '{' to its last '}', must be valid JSON.
export function checkReplyJson(data) {
  const block = ((data && data.content) || []).find(b => b && b.type === 'text');
  const text = block && typeof block.text === 'string' ? block.text : '';
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, error: 'no JSON object in reply' };
  try {
    JSON.parse(text.slice(a, b + 1));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// callModel() -> { ok: true, data } or { ok: false, status, errText } (the
// upstream HTTP error, passed straight back, no retry). A reply whose JSON
// can't be parsed is reported to onBadReply and the call is made once more.
// Returns one of:
//   { kind: 'ok', data, attempts }
//   { kind: 'upstream', status, errText }
//   { kind: 'unparseable', error, attempts }  (both replies were bad)
export async function callWithJsonRetry(callModel, onBadReply = () => {}) {
  let error = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await callModel();
    if (!r.ok) return { kind: 'upstream', status: r.status, errText: r.errText };
    const check = checkReplyJson(r.data);
    if (check.ok) return { kind: 'ok', data: r.data, attempts: attempt };
    error = check.error;
    onBadReply({
      attempt,
      error,
      stopReason: r.data && r.data.stop_reason,
      outputTokens: r.data && r.data.usage && r.data.usage.output_tokens
    });
  }
  return { kind: 'unparseable', error, attempts: 2 };
}
