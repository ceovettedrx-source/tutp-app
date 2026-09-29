// Every Anthropic Messages call goes through callClaude (round 2): one place
// for the request headers, cost logging (server/model-cost.js) and e2e
// record/replay (server/model-replay.js).
//
// callClaude({ feature, body, ... }) -> { ok, status, data, errText, usd, replayed }
//   ok        true when the API answered 2xx; data is the parsed reply
//   errText   the upstream error body when not ok (as the routes logged it)
//   usd       this call's cost (0 when replayed, null when unknown)
// cost (optional) is an object whose .usd is increased by each call, so a
// route can report the total of its calls (retries included).
import { modelFetch } from './model-replay.js';
import { logModelCall } from './model-cost.js';

export function anthropicHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
  };
}

export async function callClaude({ feature, body, familyId = null, studentId = null, mode = 'live', variant = '', attempt = 1, recordings = null, cost = null }) {
  const t0 = Date.now();
  const r = await modelFetch({ mode, feature, variant, body, attempt, headers: anthropicHeaders(), recordings });
  const ok = r.status >= 200 && r.status < 300;
  const logged = logModelCall({
    feature, model: body.model, usage: ok ? r.data && r.data.usage : null,
    familyId, studentId, ms: Date.now() - t0, replay: r.replayed
  });
  const usd = ok ? logged.usd : 0;
  if (cost && usd) cost.usd = Math.round(((cost.usd || 0) + usd) * 1e6) / 1e6;
  return {
    ok, status: r.status, replayed: r.replayed, usd,
    data: ok ? r.data : null,
    errText: ok ? '' : (typeof r.data === 'string' ? r.data : JSON.stringify(r.data))
  };
}
