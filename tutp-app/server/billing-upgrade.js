// TUT-45: Pro -> Max upgrade (docs/specs/TUT-45-max-on-sale.md sections 2.3 and 3).
// The credit and the price are computed here from the payments table, never from
// anything the client sends. Pure maths (upgradeQuote) plus small database helpers
// that take the Supabase client as an argument, so tests/unit/billing-upgrade.test.js
// can run them on an in-memory fake.
import { PAID_PLANS, DAY_MS, paymentSegments, planBuyable } from './billing-plans.js';

export const TIER_RANK = { free: 0, pro: 1, ultrapro: 2, max: 3 };
export const MIN_CHARGE_PAISE = 100;               // Razorpay minimum: ₹1
export const PENDING_UPGRADE_MS = 15 * 60 * 1000;  // a second upgrade order inside this window is refused

const rank = (tier) => TIER_RANK[tier] ?? 0;

// What an upgrade to `plan` costs a child right now, or { upgrade: false } when
// this is a plain purchase (nothing lower is running, or an equal or higher tier
// is already running or queued, so the purchase just stacks as a renewal).
// credit = sum over the lower-tier payments with time left of
//   floor(remaining_days x price_paid / period_days)
// remaining_days is whole days to the end of the paid period (the same count the
// dashboard shows), capped at the period, so the credit never exceeds the price paid.
// charge = max(₹1, price - credit); a credit above that is dropped, not refunded.
export function upgradeQuote(payments, plan, now = Date.now()) {
  const segs = paymentSegments(payments);
  const active = segs.find((s) => now >= s.start && now <= s.end);
  if (!active || rank(active.tier) >= rank(plan.tier)) return { upgrade: false };
  if (segs.some((s) => s.end > now && rank(s.tier) >= rank(plan.tier))) return { upgrade: false };
  let raw = 0, remainingDays = 0;
  const supersedeIds = [];
  for (const s of segs) {
    if (s.end <= now || rank(s.tier) >= rank(plan.tier)) continue;
    const days = Math.min(s.days, Math.max(0, Math.ceil((s.end - Math.max(s.start, now)) / DAY_MS)));
    remainingDays += days;
    raw += Math.floor(days * s.amountPaise / s.days);
    if (s.id) supersedeIds.push(s.id);
  }
  const payPaise = Math.max(MIN_CHARGE_PAISE, plan.amountPaise - raw);
  return {
    upgrade: true,
    fromTier: active.tier,
    upgradeOf: active.id || null,
    remainingDays,
    creditPaise: plan.amountPaise - payPaise,
    payPaise,
    supersedeIds
  };
}

// ---- database helpers ------------------------------------------------------------

const COLS_BASE = 'id, student_id, captured_at, updated_at, period_days, tier, amount';
const COLS_UPGRADE = COLS_BASE + ', superseded_at';
const RECHECK_MS = 30 * 1000;
const isMissingColumn = (error) => !!error && (error.code === '42703' || /superseded_at|upgrade_of|credit_paise/.test(String(error.message || '')));

// One reader per Supabase client. Before migration 034 the superseded_at column does
// not exist: reads fall back to the old column list, and ready() says false.
export function createPaymentStore(supabase) {
  let ready = null, checkedAt = 0;

  async function upgradeColumnsReady() {
    if (ready === true) return true;
    if (ready === false && Date.now() - checkedAt < RECHECK_MS) return false;
    const { error } = await supabase.from('payments').select('upgrade_of, credit_paise, superseded_at').limit(1);
    ready = !error;
    checkedAt = Date.now();
    return ready;
  }

  // Captured payments of one or more children, as rows for paymentSegments.
  async function readCaptured(studentIds) {
    const ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    const run = (cols) => supabase.from('payments').select(cols).in('student_id', ids).eq('status', 'captured');
    let res = ready === false ? await run(COLS_BASE) : await run(COLS_UPGRADE);
    if (res.error && isMissingColumn(res.error)) { ready = false; checkedAt = Date.now(); res = await run(COLS_BASE); }
    if (res.error) throw res.error;
    return res.data || [];
  }

  return { upgradeColumnsReady, readCaptured };
}

// The Razorpay order and the pending payment row for one child and one plan.
// Returns { status, body } for the route to send. Only studentId and planKey
// ever come from the client; the amount, the credit and the tier come from here.
export async function startCheckout({ supabase, store, razorpay, familyId, studentId, planKey, env = process.env, now = Date.now() }) {
  const plan = PAID_PLANS[planKey];
  if (!plan) return { status: 400, body: { error: 'Invalid plan' } };
  if (!planBuyable(plan, env)) return { status: 400, body: { error: 'not_for_sale' } };
  // Max is test-mode only until the founder lifts this: never a live-key order.
  if (plan.flag && !String(env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_')) return { status: 400, body: { error: 'test_mode_only' } };

  const quote = upgradeQuote(await store.readCaptured(studentId), plan, now);
  let amountPaise = plan.amountPaise;
  const extra = {};
  if (quote.upgrade) {
    if (!(await store.upgradeColumnsReady())) return { status: 503, body: { error: 'not_ready' } };
    const { data: open, error: oErr } = await supabase.from('payments').select('id, created_at, upgrade_of').eq('student_id', studentId).eq('status', 'created');
    if (oErr) throw oErr;
    if ((open || []).some((r) => r.upgrade_of && now - Date.parse(r.created_at) < PENDING_UPGRADE_MS)) {
      return { status: 409, body: { error: 'upgrade_pending' } };
    }
    amountPaise = quote.payPaise;
    extra.upgrade_of = quote.upgradeOf;
    extra.credit_paise = quote.creditPaise;
  }

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `bill_${familyId}_${String(studentId).slice(0, 8)}_${now.toString(36)}`,
    notes: { family_id: String(familyId), student_id: String(studentId), tier: plan.tier, plan: planKey, ...(quote.upgrade ? { upgrade: '1' } : {}) }
  });
  const { error } = await supabase.from('payments').insert({
    family_id: familyId, student_id: studentId, tier: plan.tier, amount: amountPaise, currency: 'INR',
    period_days: plan.periodDays, razorpay_order_id: order.id, status: 'created', ...extra
  });
  if (error) throw error;
  const body = { orderId: order.id, amount: amountPaise, currency: 'INR', razorpayKeyId: env.RAZORPAY_KEY_ID, planLabel: plan.label };
  if (quote.upgrade) body.upgrade = { remainingDays: quote.remainingDays, creditPaise: quote.creditPaise, payPaise: quote.payPaise };
  return { status: 200, body };
}

// What the dashboard shows before payment. Same function as checkout, so the
// number shown is the number charged.
export async function quoteForStudent({ store, studentId, planKey, env = process.env, now = Date.now() }) {
  const plan = PAID_PLANS[planKey];
  if (!plan) return { status: 400, body: { error: 'Invalid plan' } };
  if (!planBuyable(plan, env)) return { status: 400, body: { error: 'not_for_sale' } };
  const quote = upgradeQuote(await store.readCaptured(studentId), plan, now);
  if (!quote.upgrade) return { status: 200, body: { upgrade: false, payPaise: plan.amountPaise } };
  if (!(await store.upgradeColumnsReady())) return { status: 503, body: { error: 'not_ready' } };
  return { status: 200, body: { upgrade: true, fromTier: quote.fromTier, remainingDays: quote.remainingDays, creditPaise: quote.creditPaise, payPaise: quote.payPaise } };
}

// Called after a payment is marked captured (webhook or /api/billing/verify,
// whichever comes first; the other is a no-op and so is a repeat). If the row is an
// upgrade, every lower-tier payment of the child captured at or before it stops
// counting from this payment's capture time (superseded_at = its captured_at, the
// Razorpay time, never "now"). Idempotent: it only touches rows with no superseded_at,
// and never a payment captured after the upgrade (a later renewal keeps its days).
export async function applyUpgradeCapture(supabase, orderId) {
  const { data: row, error } = await supabase.from('payments')
    .select('id, student_id, tier, status, upgrade_of, captured_at, updated_at').eq('razorpay_order_id', orderId).maybeSingle();
  if (error) { if (isMissingColumn(error)) return 0; throw error; }
  if (!row || row.status !== 'captured' || !row.upgrade_of) return 0;
  const at = Date.parse(row.captured_at || row.updated_at);
  const { data: cands, error: cErr } = await supabase.from('payments')
    .select('id, tier, captured_at, updated_at, superseded_at').eq('student_id', row.student_id).eq('status', 'captured');
  if (cErr) throw cErr;
  const ids = (cands || [])
    .filter((p) => p.id !== row.id && !p.superseded_at && rank(p.tier || 'pro') < rank(row.tier) && Date.parse(p.captured_at || p.updated_at) <= at)
    .map((p) => p.id);
  if (!ids.length) return 0;
  const { error: uErr } = await supabase.from('payments').update({ superseded_at: new Date(at).toISOString() }).in('id', ids);
  if (uErr) throw uErr;
  return ids.length;
}
