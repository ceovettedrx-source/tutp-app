// Retry-once fetch wrapper for the server-side Supabase client.
//
// Supabase (PostgREST) intermittently rejects our static service_role JWT
// with HTTP 401 + code PGRST303 ("JWT issued at future") — a clock-skew
// blip on their side, roughly once a day, across many different routes.
// PostgREST checks the JWT before running the query, so the rejected request
// never executed. We still only retry GETs: reads are trivially safe to
// repeat, and we haven't confirmed the never-executed guarantee with
// Supabase for writes. POST/PUT/PATCH/DELETE pass through untouched.

const RETRY_CODE = 'PGRST303';

const defaultDelayMs = () => 300 + Math.floor(Math.random() * 201); // 300–500ms
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestInfo(input, init) {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request;
  const method = String(init?.method || (isRequest ? input.method : 'GET')).toUpperCase();
  const hasBody = (init?.body ?? null) !== null || (isRequest && input.body !== null);
  let path = '';
  try {
    // Path only — the query string can carry emails/ids we don't want in logs.
    path = new URL(isRequest ? input.url : String(input)).pathname;
  } catch { /* leave blank */ }
  return { method, hasBody, path };
}

async function isPgrst303(res) {
  if (res.status !== 401) return false;
  try {
    const body = await res.clone().json();
    return body?.code === RETRY_CODE;
  } catch {
    return false;
  }
}

export function createRetryFetch({
  baseFetch = globalThis.fetch,
  delayMs = defaultDelayMs,
  sleep = defaultSleep,
  log = console.warn
} = {}) {
  return async function retryFetch(input, init) {
    const res = await baseFetch(input, init);
    if (res.status !== 401) return res;

    const { method, hasBody, path } = requestInfo(input, init);
    // GET only; a body (including a stream, which couldn't be replayed) means skip.
    if (method !== 'GET' || hasBody) return res;
    if (!(await isPgrst303(res))) return res;

    const wait = delayMs();
    log(`[supabase-retry] ${RETRY_CODE} on GET ${path} — retrying once in ${wait}ms`);
    await sleep(wait);

    let retry;
    try {
      retry = await baseFetch(input, init);
    } catch (err) {
      log(`[supabase-retry] retry failed for GET ${path} — ${err?.message || err}`);
      throw err;
    }

    if (retry.status < 400) {
      log(`[supabase-retry] retry succeeded for GET ${path} (${retry.status})`);
      return retry;
    }
    log(`[supabase-retry] retry failed for GET ${path} (${retry.status}) — returning original error`);
    try { await retry.body?.cancel(); } catch { /* ignore */ }
    return res;
  };
}
