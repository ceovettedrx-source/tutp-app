// TUT-45 Pro -> Max upgrade (docs/specs/TUT-45-max-on-sale.md sections 2.3, 3 and 5, risks 2, 3, 4, 6):
//   node --test tests/unit/billing-upgrade.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PAID_PLANS, computePaidUntil, tierForPayments, DAY_MS } from '../../server/billing-plans.js';
import { upgradeQuote, createPaymentStore, startCheckout, quoteForStudent, applyUpgradeCapture, MIN_CHARGE_PAISE } from '../../server/billing-upgrade.js';

const MAX = PAID_PLANS.max_monthly;
const STUDENT = 'stu-1';
const T0 = Date.parse('2026-10-01T06:00:00Z');
const row = (o) => ({ id: randomUUID(), student_id: STUDENT, tier: 'pro', amount: 50000, period_days: 30, captured_at: new Date(T0).toISOString(), status: 'captured', ...o });
const ENV_ON = { MAX_ON_SALE: '1', RAZORPAY_KEY_ID: 'rzp_test_abc' };

// ---- an in-memory Supabase for the calls billing-upgrade.js makes ----------------
function fakeSupabase(payments, { noUpgradeColumns = false } = {}) {
  const tables = { payments };
  return {
    tables,
    from(name) {
      const rows = (tables[name] ||= []);
      const st = { op: 'select', filters: [], payload: null, limit: null, single: false, cols: '' };
      const match = (r) => st.filters.every((f) => f(r));
      const colError = () => noUpgradeColumns && /superseded_at|upgrade_of|credit_paise/.test(st.cols + JSON.stringify(st.payload || {}))
        ? { code: '42703', message: 'column does not exist' } : null;
      const run = async () => {
        const err = colError();
        if (err) return { data: null, error: err };
        if (st.op === 'insert') { const r = { id: randomUUID(), created_at: new Date().toISOString(), ...st.payload }; rows.push(r); return { data: r, error: null }; }
        if (st.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, st.payload)); return { data: null, error: null }; }
        let out = rows.filter(match).map((r) => ({ ...r }));
        if (st.limit != null) out = out.slice(0, st.limit);
        return { data: st.single ? (out[0] || null) : out, error: null };
      };
      const q = {
        select(cols) { st.cols = cols || ''; return q; },
        insert(p) { st.op = 'insert'; st.payload = p; return q; },
        update(p) { st.op = 'update'; st.payload = p; return q; },
        eq(c, v) { st.filters.push((r) => r[c] === v); return q; },
        in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return q; },
        limit(n) { st.limit = n; return q; },
        maybeSingle() { st.single = true; return q; },
        then(res, rej) { return run().then(res, rej); }
      };
      return q;
    }
  };
}
function fakeRazorpay() {
  const orders = [];
  return { orders, orders_: null, orders: Object.assign(orders, { create: async (o) => { const r = { id: 'order_' + (orders.length + 1), ...o }; orders.push(r); return r; } }) };
}
const mk = (payments, opts) => { const supabase = fakeSupabase(payments, opts); return { supabase, store: createPaymentStore(supabase), razorpay: { orders: fakeRazorpay().orders } }; };

// ---- risk 2: the credit maths -------------------------------------------------------
test('credit = floor(remaining_days x price_paid / period_days); charge = price - credit', () => {
  const now = T0 + 18 * DAY_MS;                       // Pro bought T0 runs 30 days: about 12 left
  const q = upgradeQuote([row({})], MAX, now);
  assert.equal(q.upgrade, true);
  assert.ok(q.remainingDays >= 12 && q.remainingDays <= 13, 'days ' + q.remainingDays);
  assert.equal(q.creditPaise, Math.floor(q.remainingDays * 50000 / 30));
  assert.equal(q.payPaise, 250000 - q.creditPaise);
  assert.ok(q.creditPaise <= 50000, 'credit never above what was paid');
});

test('a credit above the price charges the minimum Rs 1 and drops the rest', () => {
  const annual = row({ amount: 500000, period_days: 365 });
  const q = upgradeQuote([annual], MAX, T0 + 5 * DAY_MS);   // 360 days of Rs 5,000 = about Rs 4,931 > Rs 2,500
  assert.equal(q.payPaise, MIN_CHARGE_PAISE);
  assert.equal(q.creditPaise, 250000 - MIN_CHARGE_PAISE);
});

test('credit never exceeds the unused value: no days left, no credit, no upgrade', () => {
  assert.equal(upgradeQuote([row({})], MAX, T0 + 31 * DAY_MS).upgrade, false);   // lapsed
  assert.equal(upgradeQuote([], MAX, T0).upgrade, false);                        // never paid
  const first = upgradeQuote([row({})], MAX, T0 + 1000);
  assert.ok(first.creditPaise <= 50000 && first.remainingDays <= 30);
});

test('Max already running or queued: a purchase is a renewal, no credit', () => {
  assert.equal(upgradeQuote([row({ tier: 'max', amount: 250000 })], MAX, T0 + DAY_MS).upgrade, false);
  const queuedMax = [row({}), row({ tier: 'max', amount: 250000, captured_at: new Date(T0 + 2 * DAY_MS).toISOString() })];
  assert.equal(upgradeQuote(queuedMax, MAX, T0 + 3 * DAY_MS).upgrade, false);       // Pro then Max: the active one is Pro, but Max is queued
});

test('a queued Pro renewal is credited too and replaced with the running one', () => {
  const a = row({}), b = row({ captured_at: new Date(T0 + 2 * DAY_MS).toISOString() });
  const q = upgradeQuote([a, b], MAX, T0 + 5 * DAY_MS);
  assert.deepEqual(new Set(q.supersedeIds), new Set([a.id, b.id]));
  assert.ok(q.creditPaise > 50000, 'two Pro months of value, not one');
  assert.equal(q.upgradeOf, a.id);
});

// ---- risk 2: the client cannot set the price ------------------------------------
test('checkout: the order and the payment row carry the server amount, credit and tier', async () => {
  const pro = row({ captured_at: new Date(Date.now() - 18 * DAY_MS).toISOString() });
  const { supabase, store, razorpay } = mk([pro]);
  const out = await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'max_monthly', env: ENV_ON });
  assert.equal(out.status, 200);
  const rowOut = supabase.tables.payments.find((p) => p.razorpay_order_id === out.body.orderId);
  assert.equal(razorpay.orders[0].amount, out.body.amount);
  assert.equal(rowOut.amount, out.body.amount);
  assert.equal(rowOut.tier, 'max');
  assert.equal(rowOut.upgrade_of, pro.id);
  assert.equal(rowOut.credit_paise, 250000 - out.body.amount);
  assert.equal(out.body.upgrade.payPaise, out.body.amount);
  // the number the dashboard shows is the number charged
  const quote = await quoteForStudent({ store, studentId: STUDENT, planKey: 'max_monthly', env: ENV_ON });
  assert.equal(quote.body.payPaise, out.body.amount);
  assert.equal(quote.body.creditPaise, rowOut.credit_paise);
});

test('the checkout route reads only studentId and plan from the body (forged amount, credit, tier are ignored)', () => {
  const src = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const start = src.indexOf("app.post('/api/billing/checkout'");
  const block = src.slice(start, src.indexOf("app.get('/api/billing/upgrade-quote'", start));
  assert.ok(block.includes('const { studentId, plan: planKey } = req.body'));
  assert.equal((block.match(/req\.body/g) || []).length, 1);
  const lib = fs.readFileSync(new URL('../../server/billing-upgrade.js', import.meta.url), 'utf8');
  assert.ok(!/req\.body|req\.query/.test(lib));
});

test('two upgrade attempts in a row: the second is refused while the first is pending, allowed after 15 minutes', async () => {
  const pro = row({ captured_at: new Date(Date.now() - 5 * DAY_MS).toISOString() });
  const { supabase, store, razorpay } = mk([pro]);
  const a = await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'max_monthly', env: ENV_ON });
  const b = await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'max_monthly', env: ENV_ON });
  assert.equal(a.status, 200);
  assert.equal(b.status, 409);
  assert.equal(b.body.error, 'upgrade_pending');
  assert.equal(supabase.tables.payments.filter((p) => p.status === 'created').length, 1);
  const later = await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'max_monthly', env: ENV_ON, now: Date.now() + 16 * 60 * 1000 });
  assert.equal(later.status, 200);
});

// ---- risk 5 / spec 3: the switch and the migration -------------------------------
test('MAX_ON_SALE unset: checkout and quote say not_for_sale; a live key is refused', async () => {
  const { supabase, store, razorpay } = mk([row({})]);
  assert.equal((await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'max_monthly', env: { RAZORPAY_KEY_ID: 'rzp_test_x' } })).body.error, 'not_for_sale');
  assert.equal((await quoteForStudent({ store, studentId: STUDENT, planKey: 'max_monthly', env: {} })).body.error, 'not_for_sale');
  assert.equal((await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'max_monthly', env: { MAX_ON_SALE: '1', RAZORPAY_KEY_ID: 'rzp_live_x' } })).body.error, 'test_mode_only');
});

test('before migration 034: the upgrade path is 503 not_ready; a plain Max purchase and Pro renewal still work', async () => {
  const pro = row({ captured_at: new Date(Date.now() - 5 * DAY_MS).toISOString() });
  const { supabase, store, razorpay } = mk([pro], { noUpgradeColumns: true });
  const up = await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'max_monthly', env: ENV_ON });
  assert.equal(up.status, 503);
  assert.equal(up.body.error, 'not_ready');
  assert.equal((await quoteForStudent({ store, studentId: STUDENT, planKey: 'max_monthly', env: ENV_ON })).status, 503);
  assert.equal(supabase.tables.payments.length, 1, 'no payment row created');
  const renew = await startCheckout({ supabase, store, razorpay, familyId: 7, studentId: STUDENT, planKey: 'pro_monthly', env: ENV_ON });
  assert.equal(renew.status, 200);
  assert.equal(renew.body.amount, 50000);
  const fresh = mk([], { noUpgradeColumns: true });
  const plain = await startCheckout({ supabase: fresh.supabase, store: fresh.store, razorpay: fresh.razorpay, familyId: 8, studentId: 'stu-2', planKey: 'max_monthly', env: ENV_ON });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.amount, 250000);
  assert.equal(plain.body.upgrade, undefined);
});

test('after migration 034 the same child reads with superseded_at', async () => {
  const { store } = mk([row({ superseded_at: new Date(T0 + DAY_MS).toISOString() })]);
  assert.equal(await store.upgradeColumnsReady(), true);
  assert.ok('superseded_at' in (await store.readCaptured(STUDENT))[0]);
});

// ---- risks 3 and 4: no double access; webhook twice = one change ------------------
async function captured(upgradeAtMs) {
  const pro = row({ captured_at: new Date(upgradeAtMs - 18 * DAY_MS).toISOString() });
  const max = row({ id: 'max-1', tier: 'max', amount: 200000, upgrade_of: pro.id, credit_paise: 50000, status: 'created', razorpay_order_id: 'order_x' });
  const { supabase, store } = mk([pro, max]);
  Object.assign(max, { status: 'captured', captured_at: new Date(upgradeAtMs).toISOString() });   // what markPaymentCaptured does
  return { pro, max, supabase, store };
}

test('after capture the paid period ends at Max\'s end, not Max\'s end plus the remaining Pro days', async () => {
  const at = Date.parse('2026-10-19T06:00:00Z');
  const { pro, max, supabase, store } = await captured(at);
  const before = computePaidUntil(await store.readCaptured(STUDENT));
  assert.equal(await applyUpgradeCapture(supabase, 'order_x'), 1);
  const rows = await store.readCaptured(STUDENT);
  const after = computePaidUntil(rows);
  assert.equal(supabase.tables.payments.find((p) => p.id === pro.id).superseded_at, new Date(at).toISOString());
  assert.ok(before > after, 'stacking would have added the old Pro days');
  assert.equal(after, computePaidUntil([{ ...max }]), 'same end as Max alone');
  assert.equal(tierForPayments(rows, at - 1000), 'pro');
  assert.equal(tierForPayments(rows, at + 1000), 'max');
  assert.equal(tierForPayments(rows, after), 'max');
  assert.equal(tierForPayments(rows, after + 5 * DAY_MS), 'free');
});

test('the capture delivered twice (webhook and verify) leaves one captured upgrade row and one superseded_at', async () => {
  const at = Date.parse('2026-10-19T06:00:00Z');
  const { pro, supabase } = await captured(at);
  assert.equal(await applyUpgradeCapture(supabase, 'order_x'), 1);
  assert.equal(await applyUpgradeCapture(supabase, 'order_x'), 0);
  assert.equal(await applyUpgradeCapture(supabase, 'order_x'), 0);
  const all = supabase.tables.payments;
  assert.equal(all.filter((p) => p.tier === 'max' && p.status === 'captured').length, 1);
  assert.equal(all.filter((p) => p.superseded_at).length, 1);
  assert.equal(all.find((p) => p.id === pro.id).superseded_at, new Date(at).toISOString());
});

test('a plain Max purchase (no upgrade_of) and an unknown order supersede nothing', async () => {
  const pro = row({});
  const max = row({ tier: 'max', amount: 250000, razorpay_order_id: 'order_p', captured_at: new Date(T0 + DAY_MS).toISOString() });
  const { supabase } = mk([pro, max]);
  assert.equal(await applyUpgradeCapture(supabase, 'order_p'), 0);
  assert.equal(await applyUpgradeCapture(supabase, 'order_missing'), 0);
  assert.equal(supabase.tables.payments.filter((p) => p.superseded_at).length, 0);
});

test('a late repeat of the capture never supersedes a payment bought after the upgrade', async () => {
  const at = Date.parse('2026-10-19T06:00:00Z');
  const { pro, supabase } = await captured(at);
  await applyUpgradeCapture(supabase, 'order_x');
  const lateProId = randomUUID();
  supabase.tables.payments.push(row({ id: lateProId, captured_at: new Date(at + 40 * DAY_MS).toISOString() }));
  await applyUpgradeCapture(supabase, 'order_x');
  assert.equal(supabase.tables.payments.find((p) => p.id === lateProId).superseded_at, undefined);
  assert.ok(supabase.tables.payments.find((p) => p.id === pro.id).superseded_at);
});

test('a queued Pro renewal is superseded with the running one: no Pro days left after the upgrade', async () => {
  const at = Date.parse('2026-10-19T06:00:00Z');
  const { supabase, store } = await captured(at);
  supabase.tables.payments.push(row({ captured_at: new Date(at - 10 * DAY_MS).toISOString() }));   // a renewal bought 10 days before the upgrade, stacked after the first Pro
  assert.equal(await applyUpgradeCapture(supabase, 'order_x'), 2);
  const rows = await store.readCaptured(STUDENT);
  const maxEnd = computePaidUntil([rows.find((r) => r.tier === 'max')]);
  assert.equal(computePaidUntil(rows), maxEnd);
});

// ---- risk 6: a downgrade keeps the days already paid for --------------------------
test('Max then a Pro purchase: Max till its end, then Pro, and nothing is superseded or refunded', async () => {
  const max = row({ tier: 'max', amount: 250000, captured_at: new Date(T0).toISOString() });
  const pro = row({ captured_at: new Date(T0 + 5 * DAY_MS).toISOString(), razorpay_order_id: 'order_dg' });
  const { supabase, store } = mk([max, pro]);
  assert.equal(await applyUpgradeCapture(supabase, 'order_dg'), 0);
  const rows = await store.readCaptured(STUDENT);
  assert.equal(tierForPayments(rows, T0 + 20 * DAY_MS), 'max');
  assert.equal(tierForPayments(rows, T0 + 40 * DAY_MS), 'pro');
  assert.ok(rows.every((r) => !r.superseded_at));
  assert.equal(supabase.tables.payments.filter((p) => p.status === 'refunded').length, 0);
});
