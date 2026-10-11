// Partner Programme service (TUT-49): the database side. All rules live in
// core.js; this file reads and writes the new partner_* tables (migration
// 035) and reads payments / family tables. It never changes an existing table
// and never logs name, phone, PAN or UPI.
import crypto from 'crypto';
import {
  settingsFrom, commissionFor, approveAfter, nextCommissionStatus, planPayout, milestonesDue,
  parseMarker, claimAllowed, attributionExpiry, ownFamily, beneficiariesOf, makeCode, financialYear,
  payoutPeriod, isFirstOfMonthIst, validName, cleanName, validUpi, cleanUpi, validPan, cleanPan,
} from './core.js';

export class PartnerError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
export const isMissingTable = (err) => !!err && (['42P01', 'PGRST205', 'PGRST204'].includes(err.code) || /schema cache|does not exist/i.test(err.message || ''));

const chunks = (arr, n = 100) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const tenDigits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
export const isTestPhone10 = (p) => /^99999000\d\d$/.test(tenDigits(p));

export function createPartnerService({ supabase, vault, now = () => Date.now(), randomBytes = crypto.randomBytes }) {
  const must = ({ data, error }) => { if (error) throw error; return data; };
  let cfgCache = null;

  async function settings() {
    if (cfgCache && now() - cfgCache.at < 30000) return cfgCache.cfg;
    const rows = must(await supabase.from('partner_settings').select('key, value'));
    cfgCache = { at: now(), cfg: settingsFrom(rows) };
    return cfgCache.cfg;
  }

  // 'ready' | 'no_migration' | 'no_key'
  async function readiness() {
    if (!vault) return 'no_key';
    const { error } = await supabase.from('partner_settings').select('key').limit(1);
    if (error) { if (isMissingTable(error)) return 'no_migration'; throw error; }
    return 'ready';
  }

  async function event(name, partnerId, props = {}) {
    const { error } = await supabase.from('partner_events').insert({ event_name: name, partner_id: partnerId || null, props });
    if (error) console.error('partner event not saved:', error.code || '');
  }

  async function uniqueCode(table) {
    for (let i = 0; i < 6; i++) {
      const code = makeCode(randomBytes(8));
      const { data, error } = await supabase.from(table).select('id').eq('code', code).maybeSingle();
      if (error) throw error;
      if (!data) return code;
    }
    throw new Error('could not make a code');
  }

  // ------------------------------------------------------------ partners
  async function partnerByPhone(phone) {
    const h = vault.phoneHash(phone);
    if (!h) return null;
    return must(await supabase.from('partners').select('*').eq('phone_hash', h).maybeSingle());
  }
  async function partnerById(id) {
    return must(await supabase.from('partners').select('*').eq('id', id).maybeSingle());
  }
  async function schoolById(id) {
    return id ? must(await supabase.from('schools').select('*').eq('id', id).maybeSingle()) : null;
  }
  const profile = (p, school) => ({
    id: p.id, type: p.type, code: p.code, name: vault.decrypt(p.name_enc), lang: p.lang,
    schoolId: p.school_id || null, schoolName: school ? vault.decrypt(school.name_enc) : null, schoolCode: school ? school.code : null,
    hasPan: !!p.pan_enc, hasUpi: !!p.upi_enc, upiHolderConfirmed: !!p.upi_holder_confirmed_at, isTest: !!p.is_test, status: p.status,
  });

  async function signup({ phone, type, name, lang, consent, school }) {
    if (!consent) throw new PartnerError(400, 'consent_required');
    if (!validName(name)) throw new PartnerError(400, 'name_required');
    if (!['tutor', 'school'].includes(type)) throw new PartnerError(400, 'bad_type');
    if (!vault.phoneHash(phone)) throw new PartnerError(400, 'bad_phone');
    if (await partnerByPhone(phone)) throw new PartnerError(409, 'already_partner');
    const isTest = isTestPhone10(phone);
    let schoolRow = null;
    if (type === 'school') {
      if (!school || !validName(school.name)) throw new PartnerError(400, 'school_name_required');
      if (school.privateDeclared !== true) throw new PartnerError(400, 'private_declaration_required');
      if (school.acceptTerms !== true) throw new PartnerError(400, 'terms_required');
      if (school.noCompulsion !== true) throw new PartnerError(400, 'no_compulsion_required');
      const cfg = await settings();
      const at = new Date(now()).toISOString();
      schoolRow = must(await supabase.from('schools').insert({
        code: await uniqueCode('schools'), name_enc: vault.encrypt(cleanName(school.name)),
        private_declared_at: at, terms_version: cfg.terms_version, terms_accepted_at: at, no_compulsion_accepted_at: at,
      }).select('*').single());
    }
    let partner;
    try {
      partner = must(await supabase.from('partners').insert({
        type, code: await uniqueCode('partners'), phone_hash: vault.phoneHash(phone), phone_enc: vault.encrypt(tenDigits(phone)),
        name_enc: vault.encrypt(cleanName(name)), school_id: schoolRow ? schoolRow.id : null, lang, consent_at: new Date(now()).toISOString(), is_test: isTest,
      }).select('*').single());
    } catch (err) {
      if (schoolRow) await supabase.from('schools').delete().eq('id', schoolRow.id);
      if (err.code === '23505') throw new PartnerError(409, 'already_partner');
      throw err;
    }
    if (schoolRow) must(await supabase.from('schools').update({ admin_partner_id: partner.id }).eq('id', schoolRow.id));
    await event(type === 'school' ? 'school_signup' : 'partner_signup', partner.id, { type });
    return profile(partner, schoolRow);
  }

  // ------------------------------------------------------------ school invites
  async function addTeacher(admin, { name, whatsapp }) {
    if (admin.type !== 'school') throw new PartnerError(403, 'school_only');
    const school = await schoolById(admin.school_id);
    if (!school || !school.terms_accepted_at || !school.private_declared_at) throw new PartnerError(403, 'terms_required');
    if (!validName(name)) throw new PartnerError(400, 'name_required');
    const wa = tenDigits(whatsapp);
    if (wa.length !== 10) throw new PartnerError(400, 'bad_whatsapp');
    const token = randomBytes(24).toString('base64url');
    const row = must(await supabase.from('school_invites').insert({
      school_id: school.id, teacher_name_enc: vault.encrypt(cleanName(name)), teacher_whatsapp_enc: vault.encrypt(wa),
      token_hash: vault.tokenHash(token), expires_at: new Date(now() + 14 * 86400000).toISOString(),
    }).select('id').single());
    return { inviteId: row.id, token, whatsapp: wa };
  }
  async function reissueInvite(admin, inviteId) {
    const inv = must(await supabase.from('school_invites').select('*').eq('id', inviteId).maybeSingle());
    if (!inv || inv.school_id !== admin.school_id) throw new PartnerError(404, 'not_found');
    if (inv.status !== 'invited') throw new PartnerError(409, 'already_used');
    const token = randomBytes(24).toString('base64url');
    must(await supabase.from('school_invites').update({ token_hash: vault.tokenHash(token), expires_at: new Date(now() + 14 * 86400000).toISOString() }).eq('id', inviteId));
    return { inviteId, token, whatsapp: vault.decrypt(inv.teacher_whatsapp_enc) };
  }
  async function inviteByToken(token) {
    if (typeof token !== 'string' || token.length < 20) throw new PartnerError(404, 'not_found');
    const inv = must(await supabase.from('school_invites').select('*').eq('token_hash', vault.tokenHash(token)).maybeSingle());
    if (!inv) throw new PartnerError(404, 'not_found');
    if (inv.status !== 'invited') throw new PartnerError(410, inv.status === 'revoked' ? 'revoked' : 'used');
    if (Date.parse(inv.expires_at) < now()) throw new PartnerError(410, 'expired');
    return inv;
  }
  async function inviteInfo(token) {
    const inv = await inviteByToken(token);
    const school = await schoolById(inv.school_id);
    return { schoolName: vault.decrypt(school.name_enc), teacherName: vault.decrypt(inv.teacher_name_enc) };
  }
  async function acceptInvite({ token, phone, consent, lang }) {
    if (!consent) throw new PartnerError(400, 'consent_required');
    const inv = await inviteByToken(token);
    if (await partnerByPhone(phone)) throw new PartnerError(409, 'already_partner');
    const school = await schoolById(inv.school_id);
    if (!school || school.status !== 'active') throw new PartnerError(410, 'school_inactive');
    let partner;
    try {
      partner = must(await supabase.from('partners').insert({
        type: 'school_teacher', code: await uniqueCode('partners'), phone_hash: vault.phoneHash(phone), phone_enc: vault.encrypt(tenDigits(phone)),
        name_enc: inv.teacher_name_enc, school_id: inv.school_id, lang, consent_at: new Date(now()).toISOString(), is_test: isTestPhone10(phone),
      }).select('*').single());
    } catch (err) {
      if (err.code === '23505') throw new PartnerError(409, 'already_partner');
      throw err;
    }
    const claimed = must(await supabase.from('school_invites').update({ status: 'registered', teacher_partner_id: partner.id })
      .eq('id', inv.id).eq('status', 'invited').select('id'));
    if (!claimed.length) { await supabase.from('partners').delete().eq('id', partner.id); throw new PartnerError(410, 'used'); }
    await event('partner_signup', partner.id, { type: 'school_teacher' });
    return profile(partner, school);
  }
  async function listTeachers(admin) {
    const invites = must(await supabase.from('school_invites').select('id, teacher_name_enc, status, expires_at, teacher_partner_id, created_at')
      .eq('school_id', admin.school_id).order('created_at', { ascending: true }));
    return invites.map((i) => ({ id: i.id, name: vault.decrypt(i.teacher_name_enc), status: i.status === 'invited' && Date.parse(i.expires_at) < now() ? 'expired' : i.status, partnerId: i.teacher_partner_id }));
  }

  // ------------------------------------------------------------ payout details
  async function savePayoutDetails(partner, { upi, holderName, holderConfirmed, pan }) {
    if (!validUpi(upi)) throw new PartnerError(400, 'bad_upi');
    if (!validName(holderName)) throw new PartnerError(400, 'holder_name_required');
    if (holderConfirmed !== true) throw new PartnerError(400, 'holder_confirmation_required');
    const patch = { upi_enc: vault.encrypt(cleanUpi(upi)), upi_holder_name_enc: vault.encrypt(cleanName(holderName)), upi_holder_confirmed_at: new Date(now()).toISOString() };
    if (pan !== undefined && pan !== null && pan !== '') {
      if (!validPan(pan)) throw new PartnerError(400, 'bad_pan');
      patch.pan_enc = vault.encrypt(cleanPan(pan));
    }
    must(await supabase.from('partners').update(patch).eq('id', partner.id));
    return { ok: true, hasPan: !!(patch.pan_enc || partner.pan_enc) };
  }

  // ------------------------------------------------------------ attribution
  async function resolveCode(code, kind) {
    const c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(c)) return null;
    if (kind !== 's') {
      const p = must(await supabase.from('partners').select('*').eq('code', c).eq('status', 'active').maybeSingle());
      if (p) return { kind: 'p', partner: p, school: p.school_id ? await schoolById(p.school_id) : null };
    }
    if (kind !== 'p') {
      const s = must(await supabase.from('schools').select('*').eq('code', c).eq('status', 'active').maybeSingle());
      if (s) return { kind: 's', partner: null, school: s };
    }
    return null;
  }
  const phoneHashes = (phones) => (phones || []).map((p) => vault.phoneHash(p)).filter(Boolean);

  async function lockAttribution({ familyId, code, kind, firstTouchMs, phones, source }) {
    const hit = await resolveCode(code, kind);
    if (!hit) return { ok: false, reason: 'unknown_code' };
    const fam = phoneHashes(phones);
    if (hit.partner && ownFamily(hit.partner.phone_hash, fam)) return { ok: false, reason: 'own_family' };
    if (hit.school && hit.school.admin_partner_id) {
      const admin = await partnerById(hit.school.admin_partner_id);
      if (admin && ownFamily(admin.phone_hash, fam)) return { ok: false, reason: 'own_family' };
    }
    const existing = must(await supabase.from('partner_attributions').select('id, partner_id, school_id').eq('family_id', familyId).maybeSingle());
    if (existing) return { ok: false, reason: 'already_attributed' };
    const cfg = await settings();
    const lockedAt = now();
    const { error } = await supabase.from('partner_attributions').insert({
      family_id: familyId, partner_id: hit.partner ? hit.partner.id : null, school_id: hit.school ? hit.school.id : null,
      source, first_touch_at: new Date(firstTouchMs || lockedAt).toISOString(), locked_at: new Date(lockedAt).toISOString(),
      expires_at: new Date(attributionExpiry(lockedAt, cfg)).toISOString(),
    });
    if (error) { if (error.code === '23505') return { ok: false, reason: 'already_attributed' }; throw error; }
    await event('referral_signup', hit.partner ? hit.partner.id : null, { source });
    return { ok: true };
  }

  // Called once from POST /api/register after the family row exists. Never throws.
  async function lockFromRegistration({ familyId, markerValue, typedCode, phones }) {
    try {
      if (!vault) return { ok: false, reason: 'not_configured' };
      if (typedCode) return await lockAttribution({ familyId, code: typedCode, kind: null, firstTouchMs: now(), phones, source: 'code' });
      const m = parseMarker(markerValue, now());
      if (!m) return { ok: false, reason: 'no_marker' };
      return await lockAttribution({ familyId, code: m.code, kind: m.kind, firstTouchMs: m.at, phones, source: m.kind === 's' ? 'school_qr' : 'link' });
    } catch (err) {
      console.error('partner attribution not saved (registration is unaffected):', err.code || err.message);
      return { ok: false, reason: 'error' };
    }
  }

  async function claimCode({ familyId, code, phones }) {
    const fam = must(await supabase.from('family_registrations').select('id, created_at').eq('id', familyId).maybeSingle());
    if (!fam) throw new PartnerError(404, 'not_found');
    const existing = must(await supabase.from('partner_attributions').select('id').eq('family_id', familyId).maybeSingle());
    const cfg = await settings();
    const ok = claimAllowed({ familyCreatedAtMs: Date.parse(fam.created_at), nowMs: now(), hasAttribution: !!existing, cfg });
    if (!ok.ok) throw new PartnerError(409, ok.reason);
    const r = await lockAttribution({ familyId, code, kind: null, firstTouchMs: now(), phones, source: 'code' });
    if (!r.ok) throw new PartnerError(r.reason === 'unknown_code' ? 404 : 409, r.reason);
    return { ok: true };
  }

  // ------------------------------------------------------------ reconcile (commissions)
  async function reconcile() {
    const cfg = await settings();
    const nowMs = now();
    const attrs = must(await supabase.from('partner_attributions').select('*'));
    const out = { created: 0, updated: 0, clawbacks: 0, awards: 0 };
    if (!attrs.length) return out;
    const attrByFamily = new Map(attrs.map((a) => [a.family_id, a]));
    const schoolIds = [...new Set(attrs.map((a) => a.school_id).filter(Boolean))];
    const adminOf = new Map();
    for (const part of chunks(schoolIds)) for (const s of must(await supabase.from('schools').select('id, admin_partner_id').in('id', part))) adminOf.set(s.id, s.admin_partner_id);

    const payments = [];
    for (const part of chunks([...attrByFamily.keys()])) {
      payments.push(...must(await supabase.from('payments').select('id, family_id, amount, status, captured_at, period_days')
        .in('family_id', part).in('status', ['captured', 'refunded']).order('captured_at', { ascending: true })));
    }
    const payById = new Map(payments.map((p) => [p.id, p]));
    const existing = [];
    for (const part of chunks(payments.map((p) => p.id))) existing.push(...must(await supabase.from('partner_commissions').select('*').in('payment_id', part)));
    const rowKey = (paymentId, ben, kind) => `${paymentId}|${ben}|${kind}`;
    const rows = new Map(existing.map((r) => [rowKey(r.payment_id, r.beneficiary, r.kind), r]));
    const familiesWithRows = new Set(existing.filter((r) => r.kind === 'commission').map((r) => r.family_id));

    const inserts = [];
    const firstForFamily = new Map();
    for (const attr of attrs) {
      const bens = beneficiariesOf(attr, adminOf.get(attr.school_id));
      const fPays = payments.filter((p) => p.family_id === attr.family_id);
      for (const b of bens) {
        let monthsUsed = 0;
        for (const pay of fPays) {
          const row = rows.get(rowKey(pay.id, b.beneficiary, 'commission'));
          if (row) { if (row.status !== 'cancelled') monthsUsed += Number(row.eligible_months); continue; }
          if (pay.status !== 'captured') continue;
          const capturedMs = Date.parse(pay.captured_at);
          if (!Number.isFinite(capturedMs) || capturedMs > Date.parse(attr.expires_at)) continue;
          const com = commissionFor({ amountPaise: pay.amount, periodDays: pay.period_days, monthsAlready: monthsUsed, cfg });
          if (com.amountPaise <= 0) continue;
          monthsUsed += com.eligibleMonths;
          const after = approveAfter(capturedMs, cfg);
          const rec = {
            payment_id: pay.id, beneficiary: b.beneficiary, partner_id: b.partnerId, family_id: attr.family_id, base_paise: com.basePaise,
            eligible_months: com.eligibleMonths, pct: cfg.commission_pct, amount_paise: com.amountPaise, kind: 'commission',
            status: nextCommissionStatus({ status: 'pending', approve_after: after, kind: 'commission' }, pay, nowMs), approve_after: new Date(after).toISOString(),
          };
          inserts.push(rec);
          if (!familiesWithRows.has(attr.family_id) && !firstForFamily.has(attr.family_id) && b.beneficiary === 'partner') firstForFamily.set(attr.family_id, b.partnerId);
        }
      }
    }
    for (const part of chunks(inserts, 50)) {
      const got = must(await supabase.from('partner_commissions').upsert(part, { onConflict: 'payment_id,beneficiary,kind', ignoreDuplicates: true }).select('id'));
      out.created += got.length;
    }
    for (const [, partnerId] of firstForFamily) await event('referral_paid', partnerId, {});

    for (const row of existing) {
      if (row.kind !== 'commission') continue;
      const pay = payById.get(row.payment_id);
      if (!pay) continue;
      const ns = nextCommissionStatus({ status: row.status, approve_after: Date.parse(row.approve_after), kind: row.kind }, pay, nowMs);
      if (ns !== row.status) { must(await supabase.from('partner_commissions').update({ status: ns }).eq('id', row.id).eq('status', row.status)); out.updated++; }
      if (row.status === 'paid' && pay.status === 'refunded') {
        const claw = {
          payment_id: row.payment_id, beneficiary: row.beneficiary, partner_id: row.partner_id, family_id: row.family_id, base_paise: -row.base_paise,
          eligible_months: 0, pct: row.pct, amount_paise: -row.amount_paise, kind: 'clawback', status: 'approved', approve_after: new Date(nowMs).toISOString(),
        };
        const got = must(await supabase.from('partner_commissions').upsert(claw, { onConflict: 'payment_id,beneficiary,kind', ignoreDuplicates: true }).select('id'));
        out.clawbacks += got.length;
      }
    }
    out.awards = await awardMilestones(cfg);
    return out;
  }

  async function awardMilestones(cfg) {
    if (![10, 25, 50].some((t) => Number(cfg[`milestone_${t}_paise`]) > 0)) return 0;
    const rows = must(await supabase.from('partner_commissions').select('partner_id, family_id, status, kind').eq('kind', 'commission').in('status', ['approved', 'paid']));
    const families = new Map();
    for (const r of rows) { if (!families.has(r.partner_id)) families.set(r.partner_id, new Set()); families.get(r.partner_id).add(r.family_id); }
    let n = 0;
    for (const [partnerId, set] of families) {
      const awarded = must(await supabase.from('partner_milestone_awards').select('threshold').eq('partner_id', partnerId)).map((a) => a.threshold);
      for (const m of milestonesDue(set.size, awarded, cfg)) {
        const got = must(await supabase.from('partner_milestone_awards').upsert({ partner_id: partnerId, threshold: m.threshold, amount_paise: m.amountPaise }, { onConflict: 'partner_id,threshold', ignoreDuplicates: true }).select('id'));
        n += got.length;
      }
    }
    return n;
  }

  // ------------------------------------------------------------ payouts
  async function generatePayouts({ force = false } = {}) {
    const nowMs = now();
    if (!force && !isFirstOfMonthIst(nowMs)) return { skipped: 'not_first_of_month' };
    const cfg = await settings();
    await reconcile();
    const period = payoutPeriod(nowMs);
    const fy = financialYear(nowMs);
    const comms = must(await supabase.from('partner_commissions').select('id, partner_id, amount_paise').eq('status', 'approved').is('payout_id', null));
    const awards = must(await supabase.from('partner_milestone_awards').select('id, partner_id, amount_paise').eq('status', 'approved').is('payout_id', null));
    const byPartner = new Map();
    const add = (list, key) => { for (const r of list) { if (!byPartner.has(r.partner_id)) byPartner.set(r.partner_id, { sum: 0, comms: [], awards: [] }); const e = byPartner.get(r.partner_id); e.sum += r.amount_paise; e[key].push(r.id); } };
    add(comms, 'comms'); add(awards, 'awards');
    const result = { period, due: 0, carried: 0, blocked: 0 };
    for (const [partnerId, e] of byPartner) {
      const partner = await partnerById(partnerId);
      if (!partner || partner.status !== 'active') continue;
      const mine = must(await supabase.from('partner_payouts').select('*').eq('partner_id', partnerId));
      const existingNow = mine.find((p) => p.period === period);
      if (existingNow && existingNow.status !== 'blocked_pan') continue;           // already generated for this month
      const fyPaid = mine.filter((p) => p.period !== period && p.status !== 'blocked_pan' && financialYear(Date.parse(p.period + '-01T06:00:00Z')) === fy).reduce((s, p) => s + p.amount_paise, 0);
      const plan = planPayout({ approvedPaise: e.sum, fyPaidPaise: fyPaid, hasPan: !!partner.pan_enc, cfg });
      if (plan.action === 'skip') continue;
      if (plan.action === 'carry') { result.carried++; continue; }
      if (existingNow) must(await supabase.from('partner_payouts').delete().eq('id', existingNow.id));
      const payout = must(await supabase.from('partner_payouts').insert({
        partner_id: partnerId, period, amount_paise: plan.grossPaise, tds_paise: plan.tdsPaise, status: plan.action === 'due' ? 'due' : 'blocked_pan',
      }).select('id').single());
      if (plan.action === 'blocked_pan') { result.blocked++; continue; }
      if (e.comms.length) must(await supabase.from('partner_commissions').update({ payout_id: payout.id }).in('id', e.comms));
      if (e.awards.length) must(await supabase.from('partner_milestone_awards').update({ payout_id: payout.id }).in('id', e.awards));
      result.due++;
    }
    return result;
  }

  const maskPan = (pan) => (pan ? '******' + pan.slice(-4) : null);

  async function payoutSheet({ includeTest = false } = {}) {
    const payouts = must(await supabase.from('partner_payouts').select('*').in('status', ['due', 'blocked_pan']).order('created_at', { ascending: true }));
    const out = [];
    for (const p of payouts) {
      const partner = await partnerById(p.partner_id);
      if (!partner || (partner.is_test && !includeTest)) continue;
      const school = await schoolById(partner.school_id);
      out.push({
        payoutId: p.id, period: p.period, status: p.status, partnerType: partner.type,
        name: vault.decrypt(partner.name_enc), schoolName: school ? vault.decrypt(school.name_enc) : null,
        upi: vault.decrypt(partner.upi_enc), upiHolderName: vault.decrypt(partner.upi_holder_name_enc), upiHolderConfirmed: !!partner.upi_holder_confirmed_at,
        panMasked: maskPan(vault.decrypt(partner.pan_enc)), amountPaise: p.amount_paise, tdsPaise: p.tds_paise, payablePaise: p.amount_paise - p.tds_paise,
        isTest: !!partner.is_test,
      });
    }
    return { items: out, totalPayablePaise: out.filter((i) => i.status === 'due').reduce((s, i) => s + i.payablePaise, 0), tdsNote: 'TDS line is 2% once the yearly total reaches Rs 20,000 (CA to confirm).' };
  }

  async function markPaid(payoutId) {
    const done = must(await supabase.from('partner_payouts').update({ status: 'paid', paid_at: new Date(now()).toISOString() })
      .eq('id', payoutId).eq('status', 'due').select('id, partner_id, amount_paise'));
    if (!done.length) {
      const cur = must(await supabase.from('partner_payouts').select('status').eq('id', payoutId).maybeSingle());
      if (!cur) throw new PartnerError(404, 'not_found');
      throw new PartnerError(409, cur.status === 'paid' ? 'already_paid' : 'not_payable');
    }
    must(await supabase.from('partner_commissions').update({ status: 'paid' }).eq('payout_id', payoutId).eq('status', 'approved'));
    must(await supabase.from('partner_milestone_awards').update({ status: 'paid' }).eq('payout_id', payoutId).eq('status', 'approved'));
    await event('payout_marked', done[0].partner_id, { payout_id: payoutId, amount_paise: done[0].amount_paise });
    return { ok: true };
  }

  // ------------------------------------------------------------ dashboards (counts and amounts only)
  async function dashboard(partner) {
    const cfg = await settings();
    const comm = must(await supabase.from('partner_commissions').select('family_id, amount_paise, status, kind, beneficiary, payout_id').eq('partner_id', partner.id));
    const live = comm.filter((c) => c.status !== 'cancelled');
    const sum = (list) => list.reduce((s, c) => s + c.amount_paise, 0);
    const attrs = must(await supabase.from('partner_attributions').select('family_id').eq('partner_id', partner.id));
    const paidFamilies = new Set(live.filter((c) => c.kind === 'commission').map((c) => c.family_id));
    const approvedOpen = live.filter((c) => c.status === 'approved' && !c.payout_id);
    const approvedPaise = sum(approvedOpen);
    const school = partner.school_id ? await schoolById(partner.school_id) : null;
    const d = {
      signups: attrs.length, paidJoinings: paidFamilies.size,
      pendingPaise: sum(live.filter((c) => c.status === 'pending')), approvedPaise,
      dueInPayoutPaise: sum(live.filter((c) => c.status === 'approved' && c.payout_id)),
      paidPaise: sum(live.filter((c) => c.status === 'paid')),
      belowMinimum: approvedPaise > 0 && approvedPaise < cfg.min_payout_paise, minPayoutPaise: cfg.min_payout_paise,
      milestones: [10, 25, 50].map((t) => ({ threshold: t, reached: paidFamilies.size >= t, amountPaise: cfg[`milestone_${t}_paise`] })),
    };
    if (partner.type === 'school' && school) d.school = await schoolOverview(partner, school);
    return d;
  }
  async function schoolOverview(admin, school) {
    const invites = await listTeachers(admin);
    const attrs = must(await supabase.from('partner_attributions').select('family_id, partner_id').eq('school_id', school.id));
    const schoolComm = must(await supabase.from('partner_commissions').select('family_id, amount_paise, status, beneficiary').eq('partner_id', admin.id).eq('beneficiary', 'school'));
    const paidFam = new Set(schoolComm.filter((c) => c.status !== 'cancelled').map((c) => c.family_id));
    const teachers = invites.map((i) => {
      const mine = attrs.filter((a) => a.partner_id && a.partner_id === i.partnerId);
      return { id: i.id, name: i.name, status: i.status, signups: mine.length, paidJoinings: mine.filter((a) => paidFam.has(a.family_id)).length };
    });
    const direct = attrs.filter((a) => !a.partner_id);
    return { name: vault.decrypt(school.name_enc), code: school.code, teachers, schoolQr: { signups: direct.length, paidJoinings: direct.filter((a) => paidFam.has(a.family_id)).length } };
  }

  async function adminSummary({ includeTest = false } = {}) {
    const partners = must(await supabase.from('partners').select('id, type, is_test, created_at'));
    const real = partners.filter((p) => includeTest || !p.is_test);
    const ids = new Set(real.map((p) => p.id));
    const events = must(await supabase.from('partner_events').select('event_name, partner_id'));
    const comm = must(await supabase.from('partner_commissions').select('partner_id, amount_paise, status'));
    const by = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
    const money = {};
    for (const c of comm) if (ids.has(c.partner_id)) money[c.status] = (money[c.status] || 0) + c.amount_paise;
    return {
      partners: by(real, (p) => p.type), events: by(events.filter((e) => !e.partner_id || ids.has(e.partner_id)), (e) => e.event_name),
      commissionPaise: money, includeTest,
    };
  }

  // ------------------------------------------------------------ preview-only test helpers (routes guard them)
  async function e2eSeedPayment({ familyId, amountPaise, periodDays, capturedAtMs, status }) {
    const rnd = randomBytes(6).toString('hex');
    const row = must(await supabase.from('payments').insert({
      family_id: familyId, tier: 'pro', amount: amountPaise, currency: 'INR', razorpay_order_id: 'order_E2E_' + rnd, razorpay_payment_id: 'pay_E2E_' + rnd,
      status: status || 'captured', captured_at: new Date(capturedAtMs || now()).toISOString(), period_days: periodDays === 365 ? 365 : 30, note: 'TEST',
    }).select('id').single());
    return { paymentId: row.id };
  }
  async function e2ePayment(paymentId, patch) {
    const upd = {};
    if (patch.status) { upd.status = patch.status; if (patch.status === 'refunded') upd.refunded_at = new Date(now()).toISOString(); }
    if (patch.ageDays) {
      const cur = must(await supabase.from('payments').select('captured_at').eq('id', paymentId).maybeSingle());
      upd.captured_at = new Date(Date.parse(cur.captured_at) - patch.ageDays * 86400000).toISOString();
    }
    must(await supabase.from('payments').update(upd).eq('id', paymentId).eq('note', 'TEST'));
    return { ok: true };
  }
  async function e2eReset() {
    const p = must(await supabase.from('partners').select('id, school_id').eq('is_test', true));
    const ids = p.map((x) => x.id);
    const schools = [...new Set(p.map((x) => x.school_id).filter(Boolean))];
    if (ids.length) {
      const pays = must(await supabase.from('partner_commissions').select('payment_id').in('partner_id', ids)).map((r) => r.payment_id);
      await supabase.from('partner_commissions').delete().in('partner_id', ids);
      await supabase.from('partner_milestone_awards').delete().in('partner_id', ids);
      await supabase.from('partner_payouts').delete().in('partner_id', ids);
      await supabase.from('partner_events').delete().in('partner_id', ids);
      await supabase.from('partner_attributions').delete().in('partner_id', ids);
      if (pays.length) await supabase.from('payments').delete().in('id', pays).eq('note', 'TEST').like('razorpay_order_id', 'order_E2E_%');
    }
    if (schools.length) {
      await supabase.from('partner_attributions').delete().in('school_id', schools);
      await supabase.from('school_invites').delete().in('school_id', schools);
    }
    if (ids.length) await supabase.from('partners').delete().in('id', ids);
    if (schools.length) await supabase.from('schools').delete().in('id', schools);
    return { partners: ids.length, schools: schools.length };
  }

  return {
    settings, readiness, event, partnerByPhone, partnerById, schoolById, profile, signup, addTeacher, reissueInvite, inviteInfo, acceptInvite, listTeachers,
    savePayoutDetails, resolveCode, lockAttribution, lockFromRegistration, claimCode, reconcile, generatePayouts, payoutSheet, markPaid, dashboard, adminSummary,
    e2eSeedPayment, e2ePayment, e2eReset, phoneHashes, clearCache: () => { cfgCache = null; },
  };
}
