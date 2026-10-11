// Partner Programme routes (TUT-49). Mounted once from server.js:
//   registerPartnerRoutes(app, { supabase, rateLimit, getSession, sendSessionExpired, requireAdmin, cronAuthorized, isTestFamily, ... })
// Rules are in core.js, the database side in service.js, spec in
// docs/specs/TUT-49-partner-programme.md. Partners and schools only ever get
// counts and amounts back: no route returns a parent or child name or phone.
import path from 'path';
import { fileURLToPath } from 'url';
import { createVault } from './crypto.js';
import { createPartnerService, PartnerError, isMissingTable } from './service.js';
import { GOVT_MESSAGE, nextMarker, parseMarker, MARKER_DAYS, validLang } from './core.js';
import { posterHtml, shareMessage } from './poster.js';
import { qrSvg } from './qr.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF_COOKIE = 'tutp_ref';

export function registerPartnerRoutes(app, deps) {
  const { supabase, rateLimit, getSession, sendSessionExpired, requireAdmin, cronAuthorized, isTestFamily, env = process.env } = deps;
  const vault = createVault(env.PARTNER_DATA_KEY);
  const svc = supabase ? createPartnerService({ supabase, vault, now: deps.now || Date.now }) : null;
  const registrationHook = svc && vault ? svc : null;

  let readyAt = 0, readyState = 'no_migration';
  async function ready() {
    if (!svc) return 'no_key';
    if (Date.now() - readyAt < 15000 && readyState === 'ready') return readyState;
    try { readyState = await svc.readiness(); } catch (err) { console.error('partner readiness check failed:', err.code || err.message); readyState = 'no_migration'; }
    readyAt = Date.now();
    return readyState;
  }
  const limiter = (windowMs, max, name) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' }, keyGenerator: (req) => name + ':' + (req.ip || '') });
  const signupLimiter = limiter(60 * 60 * 1000, 20, 'psignup');
  const claimLimiter = limiter(60 * 60 * 1000, 20, 'pclaim');
  const joinLimiter = limiter(60 * 60 * 1000, 60, 'pjoin');

  const wrap = (fn) => async (req, res) => {
    try {
      const state = await ready();
      if (state === 'no_key') return res.status(503).json({ error: 'partners_not_configured' });
      if (state !== 'ready') return res.status(503).json({ error: 'partners_not_ready' });
      await fn(req, res);
    } catch (err) {
      if (err instanceof PartnerError) return res.status(err.status).json({ error: err.code, ...err.extra });
      if (isMissingTable(err)) return res.status(503).json({ error: 'partners_not_ready' });
      console.error('partner route error:', req.method, req.path, err.code || err.message);
      res.status(500).json({ error: 'server_error' });
    }
  };
  const base = (req) => `${req.protocol}://${req.get('host')}`;
  const sessionPhone = (req, res) => {
    const s = getSession(req);
    if (!s || !s.phone) { sendSessionExpired(res); return null; }
    return s;
  };
  async function currentPartner(req, res) {
    const s = sessionPhone(req, res);
    if (!s) return null;
    const p = await svc.partnerByPhone(s.phone);
    if (!p || p.status !== 'active') { res.status(404).json({ error: 'not_partner' }); return null; }
    return { partner: p, session: s };
  }
  const waLink = (number10, text) => `https://wa.me/91${number10}?text=${encodeURIComponent(text)}`;

  // --- link landing: first-touch marker, then the family registration page
  async function landing(req, res, kind) {
    const code = String(req.params.code || '').toUpperCase();
    try {
      if ((await ready()) === 'ready') {
        const hit = await svc.resolveCode(code, kind);
        if (hit) {
          const next = nextMarker(req.cookies?.[REF_COOKIE], code, kind, Date.now());
          res.cookie(REF_COOKIE, next, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: MARKER_DAYS * 86400000 });
        }
      }
    } catch (err) { console.error('partner landing error:', err.code || err.message); }
    res.redirect(302, '/app/register/');
  }
  app.get('/t/:code', (req, res) => landing(req, res, 'p'));
  app.get('/s/:code', (req, res) => landing(req, res, 's'));

  // The teacher's invite link opens the join page; the page reads the token from the path.
  app.get('/p/join/:token', (req, res) => res.sendFile(path.join(HERE, '..', '..', 'public', 'partners', 'join', 'index.html')));

  // --- signup
  app.post('/api/partner/signup', signupLimiter, async (req, res, next) => {
    const b = req.body || {};
    // Government teachers: the one allowed answer, before anything is read or stored.
    if (b.type === 'govt_teacher') return res.status(400).json({ error: 'govt_not_eligible', message: GOVT_MESSAGE[validLang(b.lang) ? b.lang : 'en'] });
    next();
  }, wrap(async (req, res) => {
    const s = sessionPhone(req, res); if (!s) return;
    const b = req.body || {};
    if (b.type === 'school_teacher') return res.status(400).json({ error: 'invite_required' });
    const partner = await svc.signup({ phone: s.phone, type: b.type, name: b.name, lang: validLang(b.lang) ? b.lang : 'en', consent: b.consent === true, school: b.school });
    res.status(201).json({ partner });
  }));

  app.get('/api/partner/me', wrap(async (req, res) => {
    const c = await currentPartner(req, res); if (!c) return;
    res.json({ partner: svc.profile(c.partner, await svc.schoolById(c.partner.school_id)) });
  }));

  app.get('/api/partner/dashboard', wrap(async (req, res) => {
    const c = await currentPartner(req, res); if (!c) return;
    await svc.reconcile();
    res.json({ partner: svc.profile(c.partner, await svc.schoolById(c.partner.school_id)), dashboard: await svc.dashboard(c.partner) });
  }));

  app.put('/api/partner/payout-details', wrap(async (req, res) => {
    const c = await currentPartner(req, res); if (!c) return;
    const b = req.body || {};
    res.json(await svc.savePayoutDetails(c.partner, { upi: b.upi, holderName: b.holderName, holderConfirmed: b.holderConfirmed, pan: b.pan }));
  }));

  // --- tools: link, WhatsApp share, QR, poster
  async function linkFor(req, c, target) {
    if (target === 'school') {
      if (c.partner.type !== 'school') throw new PartnerError(403, 'school_only');
      const school = await svc.schoolById(c.partner.school_id);
      return { code: school.code, url: `${base(req)}/s/${school.code}`, label: svc.profile(c.partner, school).schoolName };
    }
    return { code: c.partner.code, url: `${base(req)}/t/${c.partner.code}`, label: svc.profile(c.partner, null).name };
  }
  app.get('/api/partner/links', wrap(async (req, res) => {
    const c = await currentPartner(req, res); if (!c) return;
    const lang = validLang(req.query.lang) ? req.query.lang : c.partner.lang;
    const own = await linkFor(req, c, 'self');
    const out = { code: own.code, url: own.url, whatsappShare: `https://wa.me/?text=${encodeURIComponent(shareMessage(lang, own.url))}`, qrUrl: '/api/partner/qr.svg', posterUrl: `/api/partner/poster?lang=${lang}` };
    if (c.partner.type === 'school') {
      const sch = await linkFor(req, c, 'school');
      out.school = { code: sch.code, url: sch.url, whatsappShare: `https://wa.me/?text=${encodeURIComponent(shareMessage(lang, sch.url))}`, qrUrl: '/api/partner/qr.svg?target=school', posterUrl: `/api/partner/poster?target=school&lang=${lang}` };
    }
    res.json(out);
  }));
  app.get('/api/partner/qr.svg', wrap(async (req, res) => {
    const c = await currentPartner(req, res); if (!c) return;
    const l = await linkFor(req, c, req.query.target === 'school' ? 'school' : 'self');
    res.type('image/svg+xml').send(qrSvg(l.url));
  }));
  app.get('/api/partner/poster', wrap(async (req, res) => {
    const c = await currentPartner(req, res); if (!c) return;
    const lang = validLang(req.query.lang) ? req.query.lang : c.partner.lang;
    const l = await linkFor(req, c, req.query.target === 'school' ? 'school' : 'self');
    res.type('html').send(posterHtml({ lang, code: l.code, url: l.url, displayName: l.label }));
  }));

  // --- school: teachers, invites
  async function currentSchoolAdmin(req, res) {
    const c = await currentPartner(req, res); if (!c) return null;
    if (c.partner.type !== 'school') { res.status(403).json({ error: 'school_only' }); return null; }
    return c.partner;
  }
  app.post('/api/school/teachers', wrap(async (req, res) => {
    const admin = await currentSchoolAdmin(req, res); if (!admin) return;
    const b = req.body || {};
    const r = await svc.addTeacher(admin, { name: b.name, whatsapp: b.whatsapp });
    const joinUrl = `${base(req)}/p/join/${r.token}`;
    const school = await svc.schoolById(admin.school_id);
    const text = `Namaste ${String(b.name).trim()}, ${svc.profile(admin, school).schoolName} invites you to the Tut-P partner programme. Open this link to join: ${joinUrl}`;
    res.status(201).json({ inviteId: r.inviteId, joinUrl, whatsappUrl: waLink(r.whatsapp, text) });
  }));
  app.get('/api/school/teachers', wrap(async (req, res) => {
    const admin = await currentSchoolAdmin(req, res); if (!admin) return;
    res.json({ teachers: await svc.listTeachers(admin) });
  }));
  app.post('/api/school/teachers/:id/reissue', wrap(async (req, res) => {
    const admin = await currentSchoolAdmin(req, res); if (!admin) return;
    const r = await svc.reissueInvite(admin, req.params.id);
    const joinUrl = `${base(req)}/p/join/${r.token}`;
    res.json({ inviteId: r.inviteId, joinUrl, whatsappUrl: waLink(r.whatsapp, `Tut-P partner programme invitation: ${joinUrl}`) });
  }));
  app.get('/api/partner/join-info', joinLimiter, wrap(async (req, res) => {
    res.json(await svc.inviteInfo(String(req.query.token || '')));
  }));
  app.post('/api/partner/join', joinLimiter, wrap(async (req, res) => {
    const s = sessionPhone(req, res); if (!s) return;
    const b = req.body || {};
    const partner = await svc.acceptInvite({ token: String(b.token || ''), phone: s.phone, consent: b.consent === true, lang: validLang(b.lang) ? b.lang : 'en' });
    res.status(201).json({ partner });
  }));

  // --- a family typing a partner code after signup (first 7 days)
  app.post('/api/partner/claim-code', claimLimiter, wrap(async (req, res) => {
    const s = getSession(req);
    if (!s || !s.familyId) return sendSessionExpired(res);
    res.json(await svc.claimCode({ familyId: s.familyId, code: (req.body || {}).code, phones: await familyPhones(s.familyId) }));
  }));

  async function familyPhones(familyId) {
    const phones = [];
    const { data: fam } = await supabase.from('family_registrations').select('data').eq('id', familyId).maybeSingle();
    if (fam && fam.data) for (const r of ['mother', 'father']) if (fam.data[r] && fam.data[r].phone) phones.push(fam.data[r].phone);
    const { data: members } = await supabase.from('family_members').select('phone').eq('family_id', familyId);
    for (const m of members || []) if (m.phone) phones.push(m.phone);
    return phones;
  }

  // --- admin
  app.get('/admin/partners', requireAdmin, (req, res) => res.sendFile(path.join(HERE, '..', 'admin', 'partners.html')));
  app.get('/api/admin/partners/summary', requireAdmin, wrap(async (req, res) => res.json(await svc.adminSummary({ includeTest: req.query.includeTest === '1' }))));
  app.get('/api/admin/partners/payouts', requireAdmin, wrap(async (req, res) => res.json(await svc.payoutSheet({ includeTest: req.query.includeTest === '1' }))));
  app.post('/api/admin/partners/reconcile', requireAdmin, wrap(async (req, res) => res.json(await svc.reconcile())));
  app.post('/api/admin/partners/payouts/generate', requireAdmin, wrap(async (req, res) => res.json(await svc.generatePayouts({ force: true }))));
  app.post('/api/admin/partners/payouts/:id/mark-paid', requireAdmin, wrap(async (req, res) => res.json(await svc.markPaid(req.params.id))));
  // Daily: reconcile and approve; on the 1st (IST) also build the payout sheet.
  app.post('/api/cron/partners', wrap(async (req, res) => {
    if (!cronAuthorized(req.headers, env.CRON_TOKEN)) return res.status(403).json({ error: 'forbidden' });
    const reconciled = await svc.reconcile();
    res.json({ reconciled, payouts: await svc.generatePayouts({ force: false }) });
  }));

  // --- tests only: a preview with E2E_REPLAY=1 AND the admin token, test families and test partners only
  app.post('/api/admin/partners/e2e', requireAdmin, wrap(async (req, res) => {
    if (env.E2E_REPLAY !== '1') return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const needTestFamily = async () => { if (!(await isTestFamily(b.familyId))) throw new PartnerError(403, 'test_family_only'); };
    switch (b.action) {
      case 'reset': return res.json(await svc.e2eReset());
      case 'seed-payment': await needTestFamily(); return res.json(await svc.e2eSeedPayment({ familyId: b.familyId, amountPaise: b.amountPaise, periodDays: b.periodDays, capturedAtMs: b.capturedAtMs, status: b.status }));
      case 'payment': return res.json(await svc.e2ePayment(b.paymentId, { status: b.status, ageDays: b.ageDays }));
      case 'lock': {
        await needTestFamily();
        const m = b.marker ? parseMarker(b.marker, Date.now()) : null;
        return res.json(await svc.lockAttribution({ familyId: b.familyId, code: b.code, kind: b.kind || null, firstTouchMs: m ? m.at : Date.now(), phones: await familyPhones(b.familyId), source: b.source || 'link' }));
      }
      case 'setting': {
        if (!/^milestone_(10|25|50)_paise$|^min_payout_paise$/.test(String(b.key))) throw new PartnerError(400, 'bad_key');
        const { error } = await supabase.from('partner_settings').update({ value: Number(b.value) }).eq('key', b.key);
        if (error) throw error;
        svc.clearCache();
        return res.json({ ok: true });
      }
      default: return res.status(400).json({ error: 'bad_action' });
    }
  }));

  return { lockFromRegistration: registrationHook ? (args) => registrationHook.lockFromRegistration(args) : async () => ({ ok: false, reason: 'not_configured' }) };
}
