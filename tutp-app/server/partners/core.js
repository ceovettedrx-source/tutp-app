// Partner Programme rules (TUT-49), pure functions: no database, no clock of
// their own (every time is passed in), so tests/unit/partners-core.test.js
// can check each rule on its own. Money is integer paise.

export const DEFAULTS = {
  commission_pct: 10,
  max_paid_months: 6,
  hold_days: 7,
  min_payout_paise: 20000,          // Rs 200
  gst_percent: 18,                  // prices assumed GST-inclusive; CA to confirm
  attribution_months: 12,
  claim_days: 7,
  tds_pct: 2,                       // CA to confirm
  pan_required_paise: 2000000,      // Rs 20,000 cumulative per financial year
  milestone_10_paise: 0,
  milestone_25_paise: 0,
  milestone_50_paise: 0,
  terms_version: '2026-10',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Settings rows are { key, value }; anything missing or not a number falls back.
export function settingsFrom(rows) {
  const cfg = { ...DEFAULTS };
  for (const r of rows || []) {
    if (!(r.key in DEFAULTS)) continue;
    if (typeof DEFAULTS[r.key] === 'number') { const n = Number(r.value); if (Number.isFinite(n) && n >= 0) cfg[r.key] = n; }
    else if (typeof r.value === 'string') cfg[r.key] = r.value;
  }
  return cfg;
}

// ---- government teachers: the one allowed answer, in every language
export const GOVT_MESSAGE = {
  en: 'Referral income is only for private-school teachers and private tutors. Government teachers can use Tut-P content and tools free.',
  te: 'రెఫరల్ ఆదాయం ప్రైవేట్ పాఠశాల ఉపాధ్యాయులకు మరియు ప్రైవేట్ ట్యూటర్లకు మాత్రమే. ప్రభుత్వ ఉపాధ్యాయులు Tut-P కంటెంట్ మరియు సాధనాలను ఉచితంగా ఉపయోగించవచ్చు.',
  hi: 'रेफ़रल आय केवल निजी स्कूल के शिक्षकों और निजी ट्यूटरों के लिए है। सरकारी शिक्षक Tut-P की सामग्री और टूल्स मुफ़्त में उपयोग कर सकते हैं।',
};
export const PARTNER_TYPES = ['tutor', 'school_teacher', 'school'];

// ---- money
// Payment amount without GST (the amount is GST-inclusive).
export function netOfGst(amountPaise, gstPercent) {
  return Math.round(Number(amountPaise) / (1 + Number(gstPercent) / 100));
}
// A 30-day payment buys 1 month, a 365-day payment 12.
export function monthsBought(periodDays) { return Number(periodDays) >= 360 ? 12 : 1; }

// Commission on one payment. monthsAlready = months of this family that already
// earned this beneficiary a commission (not counting cancelled ones).
export function commissionFor({ amountPaise, periodDays, monthsAlready, cfg = DEFAULTS }) {
  const bought = monthsBought(periodDays);
  const room = Math.max(0, cfg.max_paid_months - (monthsAlready || 0));
  const eligibleMonths = Math.min(bought, room);
  const base = netOfGst(amountPaise, cfg.gst_percent);
  const amount = eligibleMonths <= 0 ? 0 : Math.round(base * (eligibleMonths / bought) * (cfg.commission_pct / 100));
  return { basePaise: base, eligibleMonths, amountPaise: amount };
}
export const approveAfter = (capturedAtMs, cfg = DEFAULTS) => capturedAtMs + cfg.hold_days * DAY_MS;

// What a commission row should be now, given the payment's state.
// row: { status, approve_after (ms), kind }; payment: { status ('captured'|'refunded'|...) }
export function nextCommissionStatus(row, payment, nowMs) {
  if (row.kind === 'clawback') return 'approved';
  if (row.status === 'paid' || row.status === 'cancelled') return row.status;
  if (payment.status === 'refunded') return 'cancelled';           // refund before payout
  if (payment.status !== 'captured') return row.status;
  return nowMs >= row.approve_after ? 'approved' : 'pending';
}

// ---- payouts and TDS
// Financial year label of an instant in IST: 1 April - 31 March.
export function financialYear(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  const y = d.getUTCFullYear(); const m = d.getUTCMonth();   // 0 = Jan
  const start = m >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
// 'YYYY-MM' period of a payout run at instant ms (IST).
export function payoutPeriod(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const isFirstOfMonthIst = (ms) => new Date(ms + IST_OFFSET_MS).getUTCDate() === 1;

// Plan one partner's payout.
//   approvedPaise  = sum of Approved rows (clawbacks are negative rows in the sum)
//   fyPaidPaise    = already paid or due in this financial year (before this one)
// Result: { action: 'skip'|'carry'|'blocked_pan'|'due', grossPaise, tdsPaise, payablePaise }
export function planPayout({ approvedPaise, fyPaidPaise = 0, hasPan, cfg = DEFAULTS }) {
  if (approvedPaise <= 0) return { action: 'skip', grossPaise: 0, tdsPaise: 0, payablePaise: 0 };
  if (approvedPaise < cfg.min_payout_paise) return { action: 'carry', grossPaise: approvedPaise, tdsPaise: 0, payablePaise: 0 };
  const cumulative = fyPaidPaise + approvedPaise;
  if (cumulative >= cfg.pan_required_paise && !hasPan) return { action: 'blocked_pan', grossPaise: approvedPaise, tdsPaise: 0, payablePaise: 0 };
  // TDS line (shown on the sheet): only once the cumulative total passes the threshold, on the whole amount.
  const tds = cumulative >= cfg.pan_required_paise ? Math.round(approvedPaise * cfg.tds_pct / 100) : 0;
  return { action: 'due', grossPaise: approvedPaise, tdsPaise: tds, payablePaise: approvedPaise - tds };
}

// ---- milestones: thresholds crossed by paidJoinings that are not yet awarded.
// With the configured amount 0 nothing is awarded.
export function milestonesDue(paidJoinings, awarded, cfg = DEFAULTS) {
  return [10, 25, 50]
    .filter((t) => paidJoinings >= t && !(awarded || []).includes(t) && Number(cfg[`milestone_${t}_paise`]) > 0)
    .map((t) => ({ threshold: t, amountPaise: Number(cfg[`milestone_${t}_paise`]) }));
}

// ---- attribution
// Marker cookie: "<CODE>.<epoch ms of first touch>.<kind>" with kind p (partner) or s (school).
export const MARKER_DAYS = 30;
export function parseMarker(value, nowMs) {
  const m = /^([A-Z0-9]{6,12})\.(\d{10,14})\.([ps])$/.exec(String(value || ''));
  if (!m) return null;
  const at = Number(m[2]);
  if (at > nowMs + DAY_MS || nowMs - at > MARKER_DAYS * DAY_MS) return null;      // future or expired
  return { code: m[1], at, kind: m[3] };
}
export const makeMarker = (code, kind, nowMs) => `${code}.${nowMs}.${kind}`;
// First touch wins while the existing marker is still valid.
export function nextMarker(existingValue, code, kind, nowMs) {
  return parseMarker(existingValue, nowMs) ? existingValue : makeMarker(code, kind, nowMs);
}
// A code typed after signup.
export function claimAllowed({ familyCreatedAtMs, nowMs, hasAttribution, cfg = DEFAULTS }) {
  if (hasAttribution) return { ok: false, reason: 'already_attributed' };
  if (nowMs - familyCreatedAtMs > cfg.claim_days * DAY_MS) return { ok: false, reason: 'claim_window_closed' };
  return { ok: true };
}
export function attributionExpiry(lockedAtMs, cfg = DEFAULTS) {
  const d = new Date(lockedAtMs);
  d.setUTCMonth(d.getUTCMonth() + cfg.attribution_months);
  return d.getTime();
}
// partnerPhoneHashes: hashes of the partner (and for a teacher also of the school admin is NOT included);
// familyPhoneHashes: hashes of every parent and member phone of the family.
export const ownFamily = (partnerPhoneHash, familyPhoneHashes) => (familyPhoneHashes || []).includes(partnerPhoneHash);

// Which rows an attribution pays: the partner (if any) and the school (if any),
// each once, for one payment.
export function beneficiariesOf(attribution, schoolAdminPartnerId) {
  const out = [];
  if (attribution.partner_id) out.push({ beneficiary: 'partner', partnerId: attribution.partner_id });
  if (attribution.school_id && schoolAdminPartnerId) out.push({ beneficiary: 'school', partnerId: schoolAdminPartnerId });
  return out;
}

// ---- codes and tokens
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';     // no 0/O/1/I/L
export function makeCode(randomBytes, length = 8) {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomBytes[i] % ALPHABET.length];
  return s;
}

// ---- input checks
export const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
export const validName = (v) => cleanName(v).length >= 2;
export const cleanUpi = (v) => String(v || '').trim().toLowerCase();
export const validUpi = (v) => /^[a-z0-9._-]{2,64}@[a-z]{2,32}$/.test(cleanUpi(v));
export const cleanPan = (v) => String(v || '').trim().toUpperCase();
export const validPan = (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan(v));
export const validLang = (v) => ['en', 'te', 'hi'].includes(v);
