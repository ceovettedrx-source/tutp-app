// Immediate alert when production model calls fail for a reason only the
// founder can fix (TUT-11): the Anthropic credit balance is empty, or the API
// key is refused. One email per reason per hour, whatever the call volume.
//
//   classifyFailure(status, data) -> 'billing' | 'auth' | null
//   reportModelFailure({ status, data, feature })   fire and forget, never throws
//   initModelAlert({ send, supabase, to, now })      wired once from server.js
//
// The rate limit is claimed in memory BEFORE any await, so 50 failures in the
// same millisecond send one email; the usage_events row 'alert.model' is the
// shared record between Cloud Run instances. If the database is unreachable
// the in-memory claim alone limits the email (one per hour per instance).
// The email holds the reason, the HTTP status, the feature and the time. It
// never holds a key, a prompt or the raw upstream body.
const HOUR_MS = 60 * 60 * 1000;

const state = { send: null, supabase: null, to: null, now: () => Date.now(), lastSent: new Map() };

export function initModelAlert({ send, supabase = null, to = null, now = () => Date.now() } = {}) {
  state.send = send; state.supabase = supabase; state.to = to; state.now = now; state.lastSent = new Map();
}

const errorText = (data) => {
  const msg = data && data.error && (data.error.message || data.error);
  return typeof msg === 'string' ? msg : (typeof data === 'string' ? data : '');
};

export function classifyFailure(status, data) {
  const text = errorText(data).toLowerCase();
  if (/credit balance|billing|purchase credits|plans & billing/.test(text)) return 'billing';
  if (status === 401 || status === 403) return 'auth';
  const type = data && data.error && data.error.type;
  if (type === 'authentication_error' || type === 'permission_error') return 'auth';
  return null;
}

const REASON_TEXT = {
  billing: 'credit balance too low',
  auth: 'API key refused',
};

export function alertEmail(reason, { status, feature, at }) {
  const subject = `Tut-P: Anthropic calls failing — ${REASON_TEXT[reason] || reason}`;
  const text = [
    `Production Anthropic calls are failing: ${REASON_TEXT[reason] || reason}.`,
    '',
    `HTTP status: ${status}`,
    `First seen on feature: ${feature || 'unknown'}`,
    `Time (UTC): ${new Date(at).toISOString()}`,
    '',
    reason === 'billing'
      ? 'Every homework, explain and notes call fails for parents until the balance is topped up (console.anthropic.com, Billing).'
      : 'Check ANTHROPIC_API_KEY on the Cloud Run service and the key in the Anthropic console.',
    'This email is sent at most once an hour per reason.',
  ].join('\n');
  return { subject, text };
}

export async function reportModelFailure({ status, data, feature = null }) {
  try {
    const reason = classifyFailure(status, data);
    if (!reason || !state.send) return { sent: false, reason };
    const at = state.now();
    const last = state.lastSent.get(reason);
    if (last != null && at - last < HOUR_MS) return { sent: false, reason, limited: true };
    state.lastSent.set(reason, at);                    // claim first: later callers see it at once
    if (state.supabase) {
      try {
        const since = new Date(at - HOUR_MS).toISOString();
        const { data: rows } = await state.supabase.from('usage_events').select('event_name')
          .eq('event_name', 'alert.model').eq('properties->>reason', reason).gte('created_at', since).limit(1);
        if (rows && rows.length) return { sent: false, reason, limited: true };
      } catch { /* database unreachable: the in-memory claim stands */ }
    }
    const { subject, text } = alertEmail(reason, { status, feature, at });
    try {
      await state.send(state.to || 'ceo.vettedrx@gmail.com', subject, text);
    } catch (err) {
      state.lastSent.delete(reason);                   // not sent: let the next failure try again
      console.error('model alert email failed:', err && err.message);
      return { sent: false, reason, error: true };
    }
    if (state.supabase) {
      try { await state.supabase.from('usage_events').insert({ event_name: 'alert.model', properties: { reason, status, feature } }); } catch { /* best effort */ }
    }
    return { sent: true, reason };
  } catch (err) {
    console.error('model alert failed:', err && err.message);
    return { sent: false, reason: null, error: true };
  }
}
