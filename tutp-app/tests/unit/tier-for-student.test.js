// TUT-45: which tier a child has at a given moment, and the plan table.
// tierForPayments walks the captured payments exactly like computePaidUntil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAID_PLANS, computePaidUntil, paymentSegments, tierForPayments, planBuyable, maxOnSale, endOfIstDay, DAY_MS } from '../../server/billing-plans.js';

const at = (iso) => Date.parse(iso);
const pay = (tier, iso, days = 30) => ({ tier, captured_at: iso, period_days: days });

test('plan table: max_monthly is 250000 paise, 30 days, no annual Max', () => {
  assert.equal(PAID_PLANS.max_monthly.amountPaise, 250000);
  assert.equal(PAID_PLANS.max_monthly.periodDays, 30);
  assert.equal(PAID_PLANS.max_monthly.tier, 'max');
  assert.ok(!Object.keys(PAID_PLANS).some(k => k.startsWith('max') && k !== 'max_monthly'));
  for (const p of Object.values(PAID_PLANS)) assert.ok([30, 365].includes(p.periodDays));
});

test('flag: MAX_ON_SALE unset or anything but 1 keeps Max off; Pro is always buyable', () => {
  assert.equal(planBuyable(PAID_PLANS.max_monthly, {}), false);
  assert.equal(planBuyable(PAID_PLANS.max_monthly, { MAX_ON_SALE: '0' }), false);
  assert.equal(planBuyable(PAID_PLANS.max_monthly, { MAX_ON_SALE: 'true' }), false);
  assert.equal(planBuyable(PAID_PLANS.max_monthly, { MAX_ON_SALE: '1' }), true);
  assert.equal(planBuyable(PAID_PLANS.pro_monthly, {}), true);
  assert.equal(maxOnSale({}), false);
  assert.equal(maxOnSale({ MAX_ON_SALE: '1' }), true);
});

test('never paid is free', () => {
  assert.equal(tierForPayments([], at('2026-10-13T10:00:00Z')), 'free');
});

test('Pro only: pro inside the period, free after it ends', () => {
  const rows = [pay('pro', '2026-10-01T05:00:00Z')];
  assert.equal(tierForPayments(rows, at('2026-10-15T00:00:00Z')), 'pro');
  assert.equal(tierForPayments(rows, at('2026-11-15T00:00:00Z')), 'free');
});

test('Max only: max inside the period, free after it', () => {
  const rows = [pay('max', '2026-10-01T05:00:00Z')];
  assert.equal(tierForPayments(rows, at('2026-10-20T00:00:00Z')), 'max');
  assert.equal(tierForPayments(rows, at('2026-12-01T00:00:00Z')), 'free');
});

test('Pro then Max: Max starts after the paid Pro period (no overlap, no refund)', () => {
  const rows = [pay('pro', '2026-10-01T05:00:00Z'), pay('max', '2026-10-10T05:00:00Z')];
  const segs = paymentSegments(rows);
  assert.equal(segs.length, 2);
  assert.equal(segs[1].start, segs[0].end + 1);
  assert.equal(tierForPayments(rows, at('2026-10-20T00:00:00Z')), 'pro');
  assert.equal(tierForPayments(rows, segs[1].start + 1000), 'max');
});

test('Max expiry goes back to free (and not to pro)', () => {
  const rows = [pay('pro', '2026-09-01T05:00:00Z'), pay('max', '2026-09-20T05:00:00Z')];
  const end = computePaidUntil(rows);
  assert.equal(tierForPayments(rows, end), 'max');
  assert.equal(tierForPayments(rows, end + 1), 'free');
});

test('renewal stacking: Max renewed early extends the running segment, tier stays max', () => {
  const rows = [pay('max', '2026-10-01T05:00:00Z'), pay('max', '2026-10-25T05:00:00Z')];
  const segs = paymentSegments(rows);
  assert.equal(segs[1].start, segs[0].end + 1);
  assert.equal(tierForPayments(rows, at('2026-11-10T00:00:00Z')), 'max');
  assert.equal(tierForPayments(rows, segs[1].end + 1), 'free');
});

test('lapse then re-buy starts fresh from the new capture', () => {
  const rows = [pay('pro', '2026-06-01T05:00:00Z'), pay('max', '2026-10-01T05:00:00Z')];
  assert.equal(tierForPayments(rows, at('2026-08-15T00:00:00Z')), 'free');
  assert.equal(tierForPayments(rows, at('2026-10-02T00:00:00Z')), 'max');
});

test('mixed tiers: Max, then Pro bought while Max is active (downgrade at the end of Max), then Pro renewal', () => {
  const rows = [pay('max', '2026-10-01T05:00:00Z'), pay('pro', '2026-10-05T05:00:00Z'), pay('pro', '2026-10-06T05:00:00Z')];
  const segs = paymentSegments(rows);
  assert.deepEqual(segs.map(s => s.tier), ['max', 'pro', 'pro']);
  assert.equal(tierForPayments(rows, at('2026-10-20T00:00:00Z')), 'max');
  assert.equal(tierForPayments(rows, segs[0].end + 1000), 'pro');
  assert.equal(tierForPayments(rows, segs[2].end), 'pro');
  assert.equal(tierForPayments(rows, segs[2].end + 1), 'free');
});

test('segments end where computePaidUntil ends, for every mix', () => {
  const mixes = [
    [pay('pro', '2026-10-01T05:00:00Z', 365)],
    [pay('pro', '2026-10-01T05:00:00Z'), pay('max', '2026-10-02T05:00:00Z'), pay('pro', '2026-12-30T05:00:00Z')],
    [pay('max', '2026-10-01T18:29:59Z'), pay('max', '2026-10-31T00:00:00Z')],
  ];
  for (const rows of mixes) {
    const segs = paymentSegments(rows);
    assert.equal(segs[segs.length - 1].end, computePaidUntil(rows));
  }
});

test('a row without a tier counts as pro; a captured row with no captured_at uses updated_at; unsorted input is sorted', () => {
  const rows = [{ updated_at: '2026-10-05T05:00:00Z', period_days: 30 }, pay('max', '2026-10-01T05:00:00Z')];
  const segs = paymentSegments(rows);
  assert.deepEqual(segs.map(s => s.tier), ['max', 'pro']);
});

test('boundary: access runs to the last millisecond of the IST day', () => {
  const rows = [pay('max', '2026-10-01T05:00:00Z')];
  const end = computePaidUntil(rows);
  assert.equal(end, endOfIstDay(at('2026-10-01T05:00:00Z') + 30 * DAY_MS));
  assert.equal(tierForPayments(rows, end), 'max');
  assert.equal(tierForPayments(rows, end + 1), 'free');
});

test('computePaidUntil matches the previous behaviour for Pro-only histories', () => {
  const rows = [pay('pro', '2026-10-01T05:00:00Z'), pay('pro', '2026-10-20T05:00:00Z', 365)];
  const first = endOfIstDay(at('2026-10-01T05:00:00Z') + 30 * DAY_MS);
  assert.equal(computePaidUntil(rows), endOfIstDay(first + 365 * DAY_MS));
  assert.equal(computePaidUntil([]), null);
});
