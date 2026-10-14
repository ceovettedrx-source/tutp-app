// TUT-45: what can be bought, and which tier a child has at a given moment.
// Pure functions (no database), so tests/unit/tier-for-student.test.js can run them.
// Amounts in paise, Razorpay's unit.

export const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const PAID_PLANS = {
  pro_monthly: { tier: 'pro', amountPaise: 50000, periodDays: 30, label: 'Pro · ₹500/month (incl. GST)' },
  pro_annual: { tier: 'pro', amountPaise: 500000, periodDays: 365, label: 'Annual Pro · ₹5,000/year (incl. GST)' },
  // Max has no annual plan. Sold only while MAX_ON_SALE=1 (see planForSale).
  max_monthly: { tier: 'max', amountPaise: 250000, periodDays: 30, label: 'Max · ₹2,500/month', flag: 'MAX_ON_SALE' }
};

export function maxOnSale(env = process.env) {
  return env.MAX_ON_SALE === '1';
}

// A plan is buyable when it has no flag, or its flag is on.
export function planBuyable(plan, env = process.env) {
  return !plan.flag || env[plan.flag] === '1';
}

// Last millisecond of the IST calendar day containing `ms`.
export function endOfIstDay(ms) {
  const istDayStart = Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return istDayStart + DAY_MS - 1 - IST_OFFSET_MS;
}

// One timeline per child from captured payments, walked in capture order:
// each payment starts at the later of its capture time and the end of the
// previous one, and ends at the last millisecond of an IST day. A renewal of
// the same tier extends the running segment; a different tier bought while
// another is active starts after it (a downgrade takes effect at the end of
// the period already paid for). A captured row with no captured_at stands in
// with updated_at (rows captured before migration 025). A row without a tier
// counts as pro.
export function paymentSegments(capturedPayments) {
  const sorted = capturedPayments
    .map(p => ({
      at: Date.parse(p.captured_at || p.updated_at),
      days: Number(p.period_days) || 30,
      tier: p.tier || 'pro'
    }))
    .filter(p => Number.isFinite(p.at))
    .sort((a, b) => a.at - b.at);
  const segments = [];
  let until = null;
  for (const p of sorted) {
    const start = until !== null && until > p.at ? until + 1 : p.at;
    const base = until !== null && until > p.at ? until : p.at;
    const end = endOfIstDay(base + p.days * DAY_MS);
    segments.push({ tier: p.tier, start, end });
    until = end;
  }
  return segments;
}

// paid_until in ms, or null if the child never paid. Same walk as above.
export function computePaidUntil(capturedPayments) {
  const segs = paymentSegments(capturedPayments);
  return segs.length ? segs[segs.length - 1].end : null;
}

// The tier whose segment contains `now`, else 'free'.
export function tierForPayments(capturedPayments, now = Date.now()) {
  for (const s of paymentSegments(capturedPayments)) {
    if (now >= s.start && now <= s.end) return s.tier;
  }
  return 'free';
}
