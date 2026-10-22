// Founder alert for failing picture generation (TUT-73). The failures are recorded as
// usage_events "image_billing_fail" (server/services/illustration-service.js). This
// module turns them into at most ONE email per 24 h and feeds the admin tile.
//
//   checkAndAlert()  after a failure: mail the founder unless a marker says one went out
//   summary()        { count, first_seen, last_status } for the last 24 h (admin tile)
//
// The marker row ("image_billing_alert_sent") is written BEFORE the mail, so 50 failures
// make 1 email. Nothing here ever throws into a request, and no key or body is read.
export const FAIL_EVENT = 'image_billing_fail';
export const SENT_EVENT = 'image_billing_alert_sent';
const DAY_MS = 24 * 60 * 60 * 1000;
const THROTTLE_MS = 10 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const istText = (iso) => new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16) + ' IST';

export function createImageBillingMonitor({ supabase, sendEmail, to, now = Date.now }) {
  let lastCheck = 0;

  async function failures() {
    const since = new Date(now() - DAY_MS).toISOString();
    const { data, error } = await supabase.from('usage_events').select('created_at, properties')
      .eq('event_name', FAIL_EVENT).gte('created_at', since).order('created_at', { ascending: true }).limit(5000);
    if (error) throw error;
    return data || [];
  }

  async function summary() {
    const rows = await failures();
    if (!rows.length) return { count: 0, first_seen: null, last_status: null };
    const last = rows[rows.length - 1].properties || {};
    return { count: rows.length, first_seen: rows[0].created_at, last_status: last.status == null ? null : last.status };
  }

  async function checkAndAlert() {
    try {
      const t = now();
      if (t - lastCheck < THROTTLE_MS) return false;
      lastCheck = t;
      const rows = await failures();
      if (!rows.length) return false;
      const since = new Date(t - DAY_MS).toISOString();
      const sent = await supabase.from('usage_events').select('id').eq('event_name', SENT_EVENT).gte('created_at', since).limit(1);
      if (sent.error) throw sent.error;
      if (sent.data && sent.data.length) return false;
      const first = rows[0];
      const status = (first.properties && first.properties.status) || 'error';
      const perFeature = {};
      for (const r of rows) {
        const f = (r.properties && r.properties.feature) || 'unknown';
        perFeature[f] = (perFeature[f] || 0) + 1;
      }
      const marker = await supabase.from('usage_events').insert({ event_name: SENT_EVENT, family_id: null, student_id: null, properties: { count: rows.length } });
      if (marker.error) throw marker.error;
      const lines = Object.entries(perFeature).sort((a, b) => b[1] - a[1]).map(([f, n]) => `  ${f}: ${n}`);
      const text = `Picture generation failed ${rows.length} time(s) in the last 24 hours (first at ${istText(first.created_at)}, HTTP ${status}).\n\nBy feature:\n${lines.join('\n')}\n\nTop up Prepay - AI Studio.\nLearners see the plain diagram until this is fixed.`;
      await sendEmail(to, `Tut-P: picture generation failing (HTTP ${status}) since ${istText(first.created_at)}`, text);
      return true;
    } catch (err) {
      console.error('image billing alert failed:', err && err.message);
      return false;
    }
  }

  return { checkAndAlert, summary };
}
