// TUT-49 Partner Programme rules (server/partners/core.js, crypto.js). No database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULTS, settingsFrom, netOfGst, monthsBought, commissionFor, approveAfter, nextCommissionStatus, financialYear, payoutPeriod,
  isFirstOfMonthIst, planPayout, milestonesDue, parseMarker, makeMarker, nextMarker, claimAllowed, attributionExpiry, ownFamily,
  beneficiariesOf, makeCode, validUpi, validPan, GOVT_MESSAGE,
} from '../../server/partners/core.js';
import { createVault } from '../../server/partners/crypto.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 11, 6, 0, 0);

test('Rs 500 payment: base excl. 18% GST is 42373, 10% is 4237', () => {
  assert.equal(netOfGst(50000, 18), 42373);
  assert.deepEqual(commissionFor({ amountPaise: 50000, periodDays: 30, monthsAlready: 0 }), { basePaise: 42373, eligibleMonths: 1, amountPaise: 4237 });
});

test('monthly: six months earn, the seventh earns nothing', () => {
  let used = 0; let total = 0;
  for (let i = 0; i < 7; i++) { const c = commissionFor({ amountPaise: 50000, periodDays: 30, monthsAlready: used }); used += c.eligibleMonths; total += c.amountPaise; }
  assert.equal(used, 6);
  assert.equal(total, 6 * 4237);
  assert.equal(commissionFor({ amountPaise: 50000, periodDays: 30, monthsAlready: 6 }).amountPaise, 0);
});

test('annual payment earns 6/12 of its base; after 2 months used only 4/12', () => {
  assert.equal(monthsBought(365), 12);
  const a = commissionFor({ amountPaise: 500000, periodDays: 365, monthsAlready: 0 });
  assert.equal(a.eligibleMonths, 6);
  assert.equal(a.amountPaise, Math.round(netOfGst(500000, 18) * 0.5 * 0.1));
  assert.equal(commissionFor({ amountPaise: 500000, periodDays: 365, monthsAlready: 2 }).eligibleMonths, 4);
});

test('GST 0 means no deduction; settings fall back for junk values', () => {
  assert.equal(netOfGst(50000, 0), 50000);
  const cfg = settingsFrom([{ key: 'gst_percent', value: 'abc' }, { key: 'commission_pct', value: 12 }, { key: 'unknown', value: 1 }]);
  assert.equal(cfg.gst_percent, 18);
  assert.equal(cfg.commission_pct, 12);
  assert.equal('unknown' in cfg, false);
});

test('hold: pending until 7 days after capture; refund before approval cancels; paid and cancelled never change back', () => {
  const after = approveAfter(T0);
  assert.equal(after, T0 + 7 * DAY);
  const row = { status: 'pending', approve_after: after, kind: 'commission' };
  assert.equal(nextCommissionStatus(row, { status: 'captured' }, T0 + 6 * DAY), 'pending');
  assert.equal(nextCommissionStatus(row, { status: 'captured' }, T0 + 8 * DAY), 'approved');
  assert.equal(nextCommissionStatus(row, { status: 'refunded' }, T0 + 1 * DAY), 'cancelled');
  assert.equal(nextCommissionStatus({ ...row, status: 'approved' }, { status: 'refunded' }, T0 + 9 * DAY), 'cancelled');
  assert.equal(nextCommissionStatus({ ...row, status: 'paid' }, { status: 'refunded' }, T0 + 9 * DAY), 'paid');
  assert.equal(nextCommissionStatus({ ...row, status: 'cancelled' }, { status: 'captured' }, T0 + 9 * DAY), 'cancelled');
  assert.equal(nextCommissionStatus({ status: 'pending', approve_after: after, kind: 'clawback' }, { status: 'refunded' }, T0), 'approved');
});

test('payout: below Rs 200 carries, PAN needed from Rs 20,000 per year, TDS line 2% after the threshold', () => {
  assert.equal(planPayout({ approvedPaise: 15000, hasPan: false }).action, 'carry');
  assert.equal(planPayout({ approvedPaise: 0, hasPan: false }).action, 'skip');
  const small = planPayout({ approvedPaise: 25000, hasPan: false });
  assert.deepEqual([small.action, small.tdsPaise, small.payablePaise], ['due', 0, 25000]);
  assert.equal(planPayout({ approvedPaise: 500000, fyPaidPaise: 1600000, hasPan: false }).action, 'blocked_pan');
  const withPan = planPayout({ approvedPaise: 500000, fyPaidPaise: 1600000, hasPan: true });
  assert.deepEqual([withPan.action, withPan.tdsPaise, withPan.payablePaise], ['due', 10000, 490000]);
  assert.equal(planPayout({ approvedPaise: 500000, fyPaidPaise: 1500000, hasPan: false }).action, 'blocked_pan');
  assert.equal(planPayout({ approvedPaise: 500000, fyPaidPaise: 1499999, hasPan: false }).action, 'due');   // Rs 19,999.99 total: still under
});

test('clawback rows reduce the approved total', () => {
  assert.equal(planPayout({ approvedPaise: 4237 * 6 - 4237, hasPan: true }).grossPaise, 21185);
  assert.equal(planPayout({ approvedPaise: 4237 - 4237, hasPan: true }).action, 'skip');
});

test('financial year runs April to March in IST; payout runs on the 1st (IST)', () => {
  assert.equal(financialYear(Date.UTC(2026, 3, 1, 0, 0)), '2026-27');
  assert.equal(financialYear(Date.UTC(2026, 2, 31, 18, 29)), '2025-26');
  assert.equal(financialYear(Date.UTC(2026, 2, 31, 18, 31)), '2026-27');     // already 1 April in IST
  assert.equal(payoutPeriod(Date.UTC(2026, 10, 1, 0, 0)), '2026-11');
  assert.equal(isFirstOfMonthIst(Date.UTC(2026, 10, 1, 0, 0)), true);
  assert.equal(isFirstOfMonthIst(Date.UTC(2026, 10, 2, 0, 0)), false);
});

test('milestones: amount 0 awards nothing; set amounts award once', () => {
  assert.deepEqual(milestonesDue(30, [], DEFAULTS), []);
  const cfg = { ...DEFAULTS, milestone_10_paise: 10000, milestone_25_paise: 25000 };
  assert.deepEqual(milestonesDue(10, [], cfg), [{ threshold: 10, amountPaise: 10000 }]);
  assert.deepEqual(milestonesDue(30, [10], cfg), [{ threshold: 25, amountPaise: 25000 }]);
  assert.deepEqual(milestonesDue(30, [10, 25], cfg), []);
});

test('first-touch marker: kept while valid for 30 days, replaced after, junk and future ignored', () => {
  const m = makeMarker('ABCD2345', 'p', T0);
  assert.deepEqual(parseMarker(m, T0 + 29 * DAY), { code: 'ABCD2345', at: T0, kind: 'p' });
  assert.equal(parseMarker(m, T0 + 31 * DAY), null);
  assert.equal(parseMarker('junk', T0), null);
  assert.equal(parseMarker(makeMarker('ABCD2345', 'p', T0 + 5 * DAY), T0), null);
  assert.equal(nextMarker(m, 'ZZZZ9999', 'p', T0 + DAY), m);                          // first touch wins
  assert.equal(nextMarker(m, 'ZZZZ9999', 's', T0 + 31 * DAY), makeMarker('ZZZZ9999', 's', T0 + 31 * DAY));
});

test('claim code: day 7 ok, day 8 refused, second claim refused', () => {
  assert.equal(claimAllowed({ familyCreatedAtMs: T0, nowMs: T0 + 7 * DAY, hasAttribution: false }).ok, true);
  assert.equal(claimAllowed({ familyCreatedAtMs: T0, nowMs: T0 + 7 * DAY + 1, hasAttribution: false }).reason, 'claim_window_closed');
  assert.equal(claimAllowed({ familyCreatedAtMs: T0, nowMs: T0 + DAY, hasAttribution: true }).reason, 'already_attributed');
});

test('attribution lasts 12 months; own family detected by phone hash', () => {
  assert.equal(new Date(attributionExpiry(Date.UTC(2026, 9, 11))).toISOString().slice(0, 10), '2027-10-11');
  assert.equal(ownFamily('h1', ['h2', 'h1']), true);
  assert.equal(ownFamily('h1', ['h2']), false);
});

test('who is paid: partner and school once each; school-QR family pays the school only', () => {
  assert.deepEqual(beneficiariesOf({ partner_id: 'P', school_id: 'S' }, 'A'), [{ beneficiary: 'partner', partnerId: 'P' }, { beneficiary: 'school', partnerId: 'A' }]);
  assert.deepEqual(beneficiariesOf({ partner_id: null, school_id: 'S' }, 'A'), [{ beneficiary: 'school', partnerId: 'A' }]);
  assert.deepEqual(beneficiariesOf({ partner_id: 'P', school_id: null }, null), [{ beneficiary: 'partner', partnerId: 'P' }]);
});

test('codes avoid look-alike characters; UPI and PAN formats', () => {
  const code = makeCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.equal(validUpi('someone@okhdfcbank'), true);
  assert.equal(validUpi('not an upi'), false);
  assert.equal(validPan('abcde1234f'), true);
  assert.equal(validPan('1234567890'), false);
});

test('government teacher message is exact in all three languages and says nothing else', () => {
  assert.equal(GOVT_MESSAGE.en, 'Referral income is only for private-school teachers and private tutors. Government teachers can use Tut-P content and tools free.');
  for (const lang of ['te', 'en', 'hi']) assert.ok(GOVT_MESSAGE[lang].length > 20);
  assert.ok(!/family|member|कुटुंब|परिवार|కుటుంబ/i.test(GOVT_MESSAGE.en + GOVT_MESSAGE.te + GOVT_MESSAGE.hi));
});

test('vault: round trip, fresh IV, tamper fails, no key means no vault', () => {
  const key = 'x'.repeat(40);
  const v = createVault(key);
  const a = v.encrypt('9999900001'); const b = v.encrypt('9999900001');
  assert.notEqual(a, b);
  assert.ok(!a.includes('9999900001'));
  assert.equal(v.decrypt(a), '9999900001');
  const parts = a.split('.'); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => v.decrypt(parts.join('.')));
  assert.equal(createVault(undefined), null);
  assert.equal(createVault('short'), null);
  assert.equal(v.encrypt(null), null);
});

test('vault: phone hash is stable, ignores +91 and spaces, differs per key; token hash differs from phone hash', () => {
  const v = createVault('a'.repeat(40)); const w = createVault('b'.repeat(40));
  assert.equal(v.phoneHash('+91 99999 00001'), v.phoneHash('9999900001'));
  assert.notEqual(v.phoneHash('9999900001'), w.phoneHash('9999900001'));
  assert.equal(v.phoneHash('123'), null);
  assert.notEqual(v.tokenHash('9999900001'), v.phoneHash('9999900001'));
});

test('partner code never logs name, phone, PAN or UPI', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'server', 'partners');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const line of src.split('\n').filter((l) => /console\.(log|error|warn)/.test(l))) {
      assert.ok(!/\b(phone|pan|upi|name|whatsapp|token)\b/i.test(line.replace(/'[^']*'/g, '')), `${f}: ${line.trim()}`);
    }
  }
});

test('partner code never sends a message itself: no outbound messaging calls, only wa.me links', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'server', 'partners');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/nodemailer|twilio|resend|sendMessage|graph\.facebook|api\.whatsapp/i.test(src), f);
  }
});
