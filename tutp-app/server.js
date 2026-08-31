import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

// Cloud Run sits behind Google's own proxy — trust its X-Forwarded-For so
// req.ip (and therefore per-IP rate limiting below) reflects the real client.
app.set('trust proxy', 1);

// ------------------------------------------------------------------
// Email — prefers Resend (reliable inbox delivery, needs a verified
// domain) and falls back to Gmail SMTP if Resend isn't configured yet.
// Either way, email is best-effort — signups never fail because of it.
// ------------------------------------------------------------------
let resend = null;
let mailer = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
} else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
} else {
  console.warn('No email provider configured (RESEND_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD) — waitlist confirmation emails are disabled.');
}

async function sendWaitlistEmail(name, email) {
  const subject = "You're on the Tut-P waitlist! 🎉";
  const text = `Hi ${name},\n\nThanks for joining the Tut-P waitlist! We'll email you at ${email} the moment early access opens.\n\nIn the meantime, you can try our working demo here: https://tutp.online/demo/\n\n- The Tut-P team`;
  const html = `<p>Hi ${name},</p><p>Thanks for joining the Tut-P waitlist! We'll email you at <strong>${email}</strong> the moment early access opens.</p><p>In the meantime, you can try our working demo here: <a href="https://tutp.online/demo/">tutp.online/demo</a></p><p>— The Tut-P team</p>`;

  if (resend) {
    try {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM || 'Tut-P <hello@tutp.online>',
        to: email,
        subject, text, html
      });
      if (error) throw new Error(JSON.stringify(error));
      console.log('Confirmation email sent via Resend to', email);
    } catch (err) {
      console.error('Resend email failed (signup still saved):', err.message);
    }
    return;
  }
  if (mailer) {
    try {
      await mailer.sendMail({ from: `"Tut-P" <${process.env.GMAIL_USER}>`, to: email, subject, text, html });
      console.log('Confirmation email sent via Gmail to', email);
    } catch (err) {
      console.error('Gmail email failed (signup still saved):', err.message);
    }
  }
}

// ------------------------------------------------------------------
// Teacher registration notice — sent to the admin (not the teacher) so
// they can manually verify and flip is_approved in the Supabase
// dashboard. Best-effort, same as sendWaitlistEmail: registration is
// already saved by the time this fires, so email delivery never blocks it.
// ------------------------------------------------------------------
async function sendTeacherRegistrationEmail(teacher) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'ceo.tutp@gmail.com';
  const classSections = teacher.classSections.map(cs => cs.section ? `${cs.grade} - ${cs.section}` : cs.grade).join(', ');
  const subject = `New teacher registration pending approval: ${teacher.name}`;
  const locality = [teacher.mandal, teacher.district, teacher.state].filter(Boolean).join(', ');
  const text = `A new teacher/tutor has registered on Tut-P and needs approval.\n\nName: ${teacher.name}\nPhone: ${teacher.phone}\nSubjects: ${teacher.subjects.join(', ')}\nSchool/Tuition: ${teacher.schoolName || '(not provided)'}\nLocality: ${locality || '(not provided)'}\nVillage: ${teacher.village || '(not provided)'}\nAddress: ${teacher.address || '(not provided)'}\nGrades/Sections: ${classSections}\n\nTeacher id (for the Supabase dashboard): ${teacher.id}\nApprove by setting is_approved = true on the teachers table for this id.`;
  const html = `<p>A new teacher/tutor has registered on Tut-P and needs approval.</p><ul><li><strong>Name:</strong> ${teacher.name}</li><li><strong>Phone:</strong> ${teacher.phone}</li><li><strong>Subjects:</strong> ${teacher.subjects.join(', ')}</li><li><strong>School/Tuition:</strong> ${teacher.schoolName || '(not provided)'}</li><li><strong>Locality:</strong> ${locality || '(not provided)'}</li><li><strong>Village:</strong> ${teacher.village || '(not provided)'}</li><li><strong>Address:</strong> ${teacher.address || '(not provided)'}</li><li><strong>Grades/Sections:</strong> ${classSections}</li></ul><p><strong>Teacher id:</strong> ${teacher.id}</p><p>Approve by setting <code>is_approved = true</code> on the <code>teachers</code> table for this id.</p>`;

  if (resend) {
    try {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM || 'Tut-P <hello@tutp.online>',
        to: adminEmail,
        subject, text, html
      });
      if (error) throw new Error(JSON.stringify(error));
      console.log('Teacher registration notice sent via Resend to', adminEmail);
    } catch (err) {
      console.error('Resend teacher notice failed (registration still saved):', err.message);
    }
    return;
  }
  if (mailer) {
    try {
      await mailer.sendMail({ from: `"Tut-P" <${process.env.GMAIL_USER}>`, to: adminEmail, subject, text, html });
      console.log('Teacher registration notice sent via Gmail to', adminEmail);
    } catch (err) {
      console.error('Gmail teacher notice failed (registration still saved):', err.message);
    }
  }
}

// ------------------------------------------------------------------
// Evening homework digest — one email per family, grouped by teacher, so
// each pending item's section reads as coming from the teacher who
// actually posted it (name, subject, school) rather than a generic
// system notice. Still clearly marked as automated in the closing line —
// a parent replying to this reaches hello@tutp.online, not the teacher,
// so it must not read as if the teacher personally sent it.
// Best-effort, same posture as the other notification helpers here.
// ------------------------------------------------------------------
async function sendPendingHomeworkEmail(recipientName, email, items) {
  const totalCount = items.length;
  const subject = `Reminder: ${totalCount} pending homework item${totalCount > 1 ? 's' : ''} today`;
  const greeting = `Hello ${recipientName},`;

  const byTeacher = new Map(); // teacher_id -> { teacherName, subject, schoolName, items: [] }
  for (const item of items) {
    if (!byTeacher.has(item.teacherId)) {
      byTeacher.set(item.teacherId, { teacherName: item.teacherName, subject: item.subject, schoolName: item.schoolName, items: [] });
    }
    byTeacher.get(item.teacherId).items.push(item);
  }

  const textSections = [];
  const htmlSections = [];
  for (const group of byTeacher.values()) {
    const heading = group.subject ? `${group.subject} at ${group.schoolName}` : group.schoolName;
    const lines = group.items.map(i => `  • ${i.studentName}: ${i.title}`).join('\n');
    const signature = `- ${group.teacherName}, ${group.subject ? group.subject + ' Teacher' : 'Teacher'}, ${group.schoolName}`;
    textSections.push(`${heading}\n${lines}\n\n${signature}`);

    const listHtml = group.items.map(i => `<li><strong>${i.studentName}</strong>: ${i.title}</li>`).join('');
    htmlSections.push(`<p><strong>${heading}</strong></p><ul>${listHtml}</ul><p>${signature}</p>`);
  }

  const text = `${greeting}\n\nHere's what's still pending for your family today:\n\n${textSections.join('\n\n\n')}\n\n(Sent automatically by Tut-P on behalf of your child's teachers.)`;
  const html = `<p>${greeting}</p><p>Here's what's still pending for your family today:</p>${htmlSections.join('<hr style="border:none;border-top:1px solid #e5e8ee;margin:16px 0;">')}<p style="color:#727785;font-size:0.9em;">(Sent automatically by Tut-P on behalf of your child's teachers.)</p>`;

  if (resend) {
    try {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM || 'Tut-P <hello@tutp.online>',
        to: email,
        subject, text, html
      });
      if (error) throw new Error(JSON.stringify(error));
      console.log('Pending-homework digest sent via Resend to', email);
    } catch (err) {
      console.error('Resend pending-homework digest failed:', err.message);
    }
    return;
  }
  if (mailer) {
    try {
      await mailer.sendMail({ from: `"Tut-P" <${process.env.GMAIL_USER}>`, to: email, subject, text, html });
      console.log('Pending-homework digest sent via Gmail to', email);
    } catch (err) {
      console.error('Gmail pending-homework digest failed:', err.message);
    }
  }
}

// ------------------------------------------------------------------
// Supabase client — server-side only, uses the service_role key so it
// can write regardless of Row Level Security. Never expose this key
// to the browser; it only ever lives in Cloud Run env vars.
// ------------------------------------------------------------------
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — waitlist and usage tracking are disabled.');
}

// The `verify` hook stashes the exact raw bytes for the Razorpay webhook
// route (req.rawBody) alongside the normally-parsed req.body — Razorpay's
// signature is an HMAC over the raw request bytes, and by the time a route
// handler runs after this middleware the raw stream is already consumed,
// so this is the one place that can still capture it.
app.use(express.json({
  limit: '12mb', // photo uploads travel as base64
  verify: (req, res, buf) => {
    if (req.originalUrl === '/api/webhooks/razorpay') req.rawBody = buf;
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// Razorpay — subscriptions (recurring billing) for the paid tiers.
// Registration itself stays free either way; this only ever gets used for
// a family that picked a paid tier. Uses the official SDK (unlike the
// Claude API integration's raw fetch elsewhere in this file) — deliberate:
// payments are the one place where a vendor-maintained, widely-audited
// client is worth the dependency over hand-rolled HTTP.
// ------------------------------------------------------------------
const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;
if (!razorpay) {
  console.warn('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — paid-tier registration is disabled (Free tier is unaffected).');
}

const RAZORPAY_PLAN_ID_BY_TIER = {
  pro: process.env.RAZORPAY_PLAN_ID_PRO,
  ultrapro: process.env.RAZORPAY_PLAN_ID_ULTRAPRO,
  max: process.env.RAZORPAY_PLAN_ID_MAX
};

// ------------------------------------------------------------------
// Waitlist capture — powers the "Join waitlist" form on the homepage.
// ------------------------------------------------------------------
app.post('/api/waitlist', async (req, res) => {
  try {
    const { name, email, role, message } = req.body || {};
    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Missing name, email or role' });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return res.status(400).json({ error: 'That email address does not look valid' });
    }
    if (!supabase) {
      return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    }

    const { error } = await supabase.from('waitlist').insert({
      name: String(name).slice(0, 120),
      email: String(email).slice(0, 200),
      role: String(role).slice(0, 40),
      message: message ? String(message).slice(0, 2000) : null
    });
    if (error) throw error;

    console.log('New waitlist signup:', name, email, role);
    sendWaitlistEmail(name, email); // fire-and-forget — don't block the response on email delivery
    res.json({ ok: true });
  } catch (err) {
    console.error('Waitlist error:', err);
    res.status(500).json({ error: 'Server error saving your signup' });
  }
});

// Protected export: /api/waitlist?token=YOUR_ADMIN_TOKEN
app.get('/api/waitlist', async (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
  try {
    const { data, error, count } = await supabase
      .from('waitlist')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ count, rows: data });
  } catch (err) {
    res.status(500).json({ error: 'Could not read waitlist' });
  }
});

// ------------------------------------------------------------------
// Demo usage tracking — logs each completed homework session (no PII)
// so you have real usage evidence for YC, not just waitlist signups.
// ------------------------------------------------------------------
app.post('/api/track-demo-use', async (req, res) => {
  try {
    if (!supabase) return res.json({ ok: true }); // fail open — never block the demo itself
    const { childClass, curriculum, parentLang, subject } = req.body || {};
    const { error } = await supabase.from('demo_usage').insert({
      child_class: childClass || null,
      curriculum: curriculum || null,
      parent_lang: parentLang || null,
      subject: subject || null
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Usage tracking error:', err);
    res.json({ ok: true }); // never break the parent's homework session over analytics
  }
});

// Combined admin view: waitlist signups + demo usage in one place.
// Visit: /api/stats?token=YOUR_ADMIN_TOKEN
app.get('/api/stats', async (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
  try {
    const [waitlistRes, usageRes] = await Promise.all([
      supabase.from('waitlist').select('*', { count: 'exact' }).order('created_at', { ascending: false }),
      supabase.from('demo_usage').select('*', { count: 'exact' }).order('created_at', { ascending: false })
    ]);
    if (waitlistRes.error) throw waitlistRes.error;
    if (usageRes.error) throw usageRes.error;
    res.json({
      waitlistCount: waitlistRes.count,
      demoSessionCount: usageRes.count,
      waitlist: waitlistRes.data,
      usage: usageRes.data
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Could not read stats' });
  }
});

// ------------------------------------------------------------------
// File upload — child photos, subject workbook photos. Client sends
// base64 JSON (no multer needed); we upload to Supabase Storage
// server-side so storage keys never reach the browser.
// ------------------------------------------------------------------
app.post('/api/upload', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { filename, contentType, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) return res.status(400).json({ error: 'Missing filename or file data' });

    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 8MB)' });

    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const objectPath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from('family-uploads')
      .upload(objectPath, buffer, { contentType: contentType || 'application/octet-stream' });
    if (uploadErr) throw uploadErr;

    const { data: pub } = supabase.storage.from('family-uploads').getPublicUrl(objectPath);
    res.json({ ok: true, url: pub.publicUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Could not upload file: ' + (err.message || '') });
  }
});

// ------------------------------------------------------------------
// Family registration — saves the full multi-step registration form
// as a single JSONB record (simple, fast to ship; can be normalized
// into separate tables later once the schema is stable).
// ------------------------------------------------------------------
app.post('/api/register', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const payload = req.body || {};
    const children = Array.isArray(payload.children) ? payload.children : [];
    if (!children.length || !children[0]?.name) {
      return res.status(400).json({ error: "Missing child's name" });
    }
    const { data, error } = await supabase.from('family_registrations').insert({ data: payload }).select('id').single();
    if (error) throw error;

    // Best-effort: the registration itself is already saved above, so a
    // students/family_members-table hiccup here shouldn't fail the whole signup.
    // school_name/geography/section are trimmed here (not just client-side)
    // since they're part of the homework-matching key — an ilike() match
    // against a teacher's value is exact-but-case-insensitive, so stray
    // whitespace alone is enough to silently break matching.
    // state/district come from the family's Step-1 location (not re-asked
    // per child) — see geoMatches()/migration 008 for why village isn't
    // part of the matching key even though it's captured here.
    const location = payload.location || {};
    const locState = location.state ? String(location.state).trim() : null;
    const locDistrict = location.district ? String(location.district).trim() : null;
    const studentRows = children.filter(c => c && c.name).map(c => ({
      family_id: data.id,
      name: String(c.name).trim(),
      school_name: c.schoolName ? String(c.schoolName).trim() : null,
      class: c.class || null,
      section: c.section ? String(c.section).trim() : null,
      roll_number: c.rollNumber ? String(c.rollNumber).trim() : null,
      state: locState,
      district: locDistrict,
      mandal: c.mandal ? String(c.mandal).trim() : null,
      village: c.village ? String(c.village).trim() : null,
      address: c.address ? String(c.address).trim() : null
    }));
    if (studentRows.length) {
      const { error: studentsErr } = await supabase.from('students').insert(studentRows);
      if (studentsErr) console.error('Could not save students rows (registration itself still succeeded):', studentsErr.message);
      // Feeds the Mandal/Village <datalist>s and the school-name <datalist>
      // on both registration forms.
      for (const row of studentRows) {
        if (row.state && row.district && row.mandal) {
          await upsertMandalDirectory(row.state, row.district, row.mandal);
          if (row.village) await upsertVillageDirectory(row.state, row.district, row.mandal, row.village);
        }
        if (row.school_name && row.state && row.district && row.mandal) {
          await upsertSchoolDirectory(row.school_name, row.state, row.district, row.mandal);
        }
      }
    }

    const extendedFamily = Array.isArray(payload.extendedFamily) ? payload.extendedFamily : [];
    const memberRows = extendedFamily.filter(m => m && m.name).map(m => ({
      family_id: data.id,
      name: m.name,
      relationship: m.role || null,
      phone: m.phone || null
    }));
    if (memberRows.length) {
      const { error: membersErr } = await supabase.from('family_members').insert(memberRows);
      if (membersErr) console.error('Could not save family_members rows (registration itself still succeeded):', membersErr.message);
    }

    // Best-effort: attribute this signup to a referring teacher, if the
    // registration form carried a referral code. No paid conversion event
    // exists yet, so amount/teacher_share stay 0 — conversion_type='signup'
    // records the referral itself for now.
    const referralCode = payload.referralCode ? String(payload.referralCode).trim() : null;
    if (referralCode) {
      const { data: rc, error: rcErr } = await supabase.from('referral_codes')
        .select('id, teacher_id').eq('code', referralCode).maybeSingle();
      if (rcErr) {
        console.error('Could not look up referral code (registration itself still succeeded):', rcErr.message);
      } else if (rc) {
        const { error: convErr } = await supabase.from('referral_conversions').insert({
          referral_code_id: rc.id,
          teacher_id: rc.teacher_id,
          family_id: data.id,
          conversion_type: 'signup'
        });
        if (convErr) console.error('Could not record referral conversion (registration itself still succeeded):', convErr.message);
      }
    }

    // Registration itself is always free — this only determines whether a
    // Razorpay subscription gets created alongside it. Best-effort like
    // everything else above: if Razorpay is unreachable or misconfigured,
    // the family is left in 'pending_payment' rather than failing the
    // whole registration — functionally identical to an abandoned
    // checkout (behaves like Free until/unless payment completes; no
    // cleanup job needed, see migration 010's comment).
    const tier = ['pro', 'ultrapro', 'max'].includes(payload.tier) ? payload.tier : 'free';
    const subRow = { family_id: data.id, tier, status: tier === 'free' ? 'active' : 'pending_payment' };
    let subscriptionInfo = null;

    if (tier !== 'free') {
      const planId = RAZORPAY_PLAN_ID_BY_TIER[tier];
      if (razorpay && planId) {
        try {
          const subscription = await razorpay.subscriptions.create({
            plan_id: planId,
            total_count: 120, // ~10 years of monthly cycles; cancellation is handled via support for now, not a self-serve UI in this phase
            customer_notify: 1,
            notes: { family_id: String(data.id) }
          });
          subRow.razorpay_subscription_id = subscription.id;
          subscriptionInfo = { subscriptionId: subscription.id, razorpayKeyId: process.env.RAZORPAY_KEY_ID };
        } catch (rzpErr) {
          console.error('Could not create Razorpay subscription (registration itself still succeeded, family left pending_payment):', rzpErr.message);
        }
      } else {
        console.error('Razorpay not configured for tier', tier, '— family left pending_payment.');
      }
    }

    const { error: subErr } = await supabase.from('family_subscriptions').insert(subRow);
    if (subErr) console.error('Could not save family_subscriptions row (registration itself still succeeded):', subErr.message);

    console.log('New family registration:', children[0].name, 'id:', data.id, 'children:', children.length, 'tier:', tier);
    res.json({ ok: true, id: data.id, subscription: subscriptionInfo });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Could not save registration: ' + (err.message || '') });
  }
});

// Add a family member after initial registration (e.g. months later).
// Directly linked via family_id — the caller already knows this (from
// sessionStorage.tutp_family_id, set at login), so no phone re-matching needed.
app.post('/api/family/add-member', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { family_id, member } = req.body || {};
    const familyId = parseInt(family_id, 10);
    if (!Number.isFinite(familyId) || !member || !member.name) {
      return res.status(400).json({ error: 'Missing family_id or member name' });
    }
    const { error } = await supabase.from('family_members').insert({
      family_id: familyId,
      name: member.name,
      relationship: member.role || null,
      phone: member.phone || null
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Could not add family member' });
  }
});

// ------------------------------------------------------------------
// School directory — a lightweight autocomplete/dedup list, not a
// relational schools table. Populated as a side effect of teacher and
// family registration whenever a (school name, state, district, mandal)
// combination is submitted; read by /api/schools to back a <datalist>
// "pick or add new" input on both registration forms. name_key is the
// app-computed dedup key (trim+lowercase) so upserting can target a plain
// unique constraint. The old (name_key, area) constraint/column are
// untouched (migration 008) — this only writes the new geo columns now.
// ------------------------------------------------------------------
async function upsertSchoolDirectory(name, state, district, mandal) {
  if (!supabase || !name || !state || !district || !mandal) return;
  const nameKey = String(name).trim().toLowerCase();
  if (!nameKey) return;
  const { error } = await supabase.from('school_directory').upsert({
    name: String(name).trim().slice(0, 200),
    name_key: nameKey.slice(0, 200),
    state: String(state).trim().slice(0, 100),
    district: String(district).trim().slice(0, 100),
    mandal: String(mandal).trim().slice(0, 100)
  }, { onConflict: 'name_key,state,district,mandal', ignoreDuplicates: true });
  if (error) console.error('Could not upsert school_directory (registration itself still succeeded):', error.message);
}

// ------------------------------------------------------------------
// Mandal/Village directories — same "pick or add new" convergence purpose
// as school_directory, scoped by state+district (mandal) and
// state+district+mandal (village). Feed the Mandal/Village <datalist>s on
// both registration forms via /api/mandals and /api/villages below.
// ------------------------------------------------------------------
async function upsertMandalDirectory(state, district, mandal) {
  if (!supabase || !state || !district || !mandal) return;
  const mandalKey = String(mandal).trim().toLowerCase();
  if (!mandalKey) return;
  const { error } = await supabase.from('mandal_directory').upsert({
    state: String(state).trim().slice(0, 100),
    district: String(district).trim().slice(0, 100),
    mandal: String(mandal).trim().slice(0, 100),
    mandal_key: mandalKey.slice(0, 100)
  }, { onConflict: 'state,district,mandal_key', ignoreDuplicates: true });
  if (error) console.error('Could not upsert mandal_directory (registration itself still succeeded):', error.message);
}

async function upsertVillageDirectory(state, district, mandal, village) {
  if (!supabase || !state || !district || !mandal || !village) return;
  const villageKey = String(village).trim().toLowerCase();
  if (!villageKey) return;
  const { error } = await supabase.from('village_directory').upsert({
    state: String(state).trim().slice(0, 100),
    district: String(district).trim().slice(0, 100),
    mandal: String(mandal).trim().slice(0, 100),
    village: String(village).trim().slice(0, 100),
    village_key: villageKey.slice(0, 100)
  }, { onConflict: 'state,district,mandal,village_key', ignoreDuplicates: true });
  if (error) console.error('Could not upsert village_directory (registration itself still succeeded):', error.message);
}

app.get('/api/mandals', async (req, res) => {
  try {
    if (!supabase) return res.json({ names: [] });
    const state = String(req.query.state || '').trim();
    const district = String(req.query.district || '').trim();
    if (!state || !district) return res.json({ names: [] });
    const { data, error } = await supabase.from('mandal_directory')
      .select('mandal, mandal_key').eq('state', state).eq('district', district).order('mandal');
    if (error) throw error;
    const seen = new Set();
    const names = [];
    for (const row of (data || [])) {
      if (seen.has(row.mandal_key)) continue;
      seen.add(row.mandal_key);
      names.push(row.mandal);
    }
    res.json({ names });
  } catch (err) {
    console.error('Get mandals error:', err);
    res.status(500).json({ error: 'Could not fetch mandals' });
  }
});

app.get('/api/villages', async (req, res) => {
  try {
    if (!supabase) return res.json({ names: [] });
    const state = String(req.query.state || '').trim();
    const district = String(req.query.district || '').trim();
    const mandal = String(req.query.mandal || '').trim();
    if (!state || !district || !mandal) return res.json({ names: [] });
    const { data, error } = await supabase.from('village_directory')
      .select('village, village_key').eq('state', state).eq('district', district).eq('mandal', mandal).order('village');
    if (error) throw error;
    const seen = new Set();
    const names = [];
    for (const row of (data || [])) {
      if (seen.has(row.village_key)) continue;
      seen.add(row.village_key);
      names.push(row.village);
    }
    res.json({ names });
  } catch (err) {
    console.error('Get villages error:', err);
    res.status(500).json({ error: 'Could not fetch villages' });
  }
});

// ------------------------------------------------------------------
// Referral links (Phase 3.5) — tracking only, no automated payout yet.
// Each approved teacher gets one referral_codes row (created lazily on
// first request). /r/:code redirects into the parent registration form
// with the code carried as a query param; the register page persists it
// to localStorage so it survives across a browser session, then sends it
// back on /api/register, which resolves it into a referral_conversions row.
// ------------------------------------------------------------------
async function getOrCreateReferralCode(teacherId) {
  const { data: existing, error: existingErr } = await supabase
    .from('referral_codes').select('code').eq('teacher_id', teacherId).maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return existing.code;

  // Short, URL-safe, case-insensitive-friendly code. Collisions are
  // astronomically unlikely at this scale, but retry once just in case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    const { data, error } = await supabase.from('referral_codes')
      .insert({ teacher_id: teacherId, code }).select('code').single();
    if (!error) return data.code;
    if (error.code !== '23505') throw error; // not a unique-violation — bail
  }
  throw new Error('Could not generate a unique referral code');
}

// Best-effort link-open tracking for /r/:code, below. No personal data
// recorded — just that the link was opened; referral_conversions.family_id
// is where we learn who it was, if and when they actually register.
async function recordReferralLinkOpen(code) {
  if (!supabase || !code) return;
  try {
    const { data: rc, error: rcErr } = await supabase.from('referral_codes')
      .select('id, teacher_id').eq('code', code).maybeSingle();
    if (rcErr || !rc) return;
    const { error } = await supabase.from('referral_link_opens')
      .insert({ referral_code_id: rc.id, teacher_id: rc.teacher_id });
    if (error) console.error('Could not record referral link open (redirect itself unaffected):', error.message);
  } catch (err) {
    console.error('Could not record referral link open (redirect itself unaffected):', err.message);
  }
}

app.get('/r/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  res.redirect('/app/register/?ref=' + encodeURIComponent(code));
  recordReferralLinkOpen(code); // fire-and-forget, fired after the redirect so it never delays it
});

app.get('/api/schools', async (req, res) => {
  try {
    if (!supabase) return res.json({ names: [] });
    const { data, error } = await supabase.from('school_directory').select('name, name_key').order('name');
    if (error) throw error;
    const seen = new Set();
    const names = [];
    for (const row of (data || [])) {
      if (seen.has(row.name_key)) continue;
      seen.add(row.name_key);
      names.push(row.name);
    }
    res.json({ names });
  } catch (err) {
    console.error('Get schools error:', err);
    res.status(500).json({ error: 'Could not fetch schools' });
  }
});

// ------------------------------------------------------------------
// Teacher/Tutor registration — separate from family registration. New
// teachers default to is_approved=false; the site admin flips that
// manually in the Supabase dashboard after verifying them (no approval
// UI in this phase). No phone uniqueness enforced — dedup happens
// manually at approval time, same posture as family_registrations.
// school_name/state/district/mandal are required (not just school_name)
// since together they're the matching key homework-to-student resolution
// depends on (village is captured too but isn't part of the match key —
// see geoMatches() in the homework-assignments section for why).
// ------------------------------------------------------------------
app.post('/api/register-teacher', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { name, phone, subjects, schoolName, state, district, mandal, village, address, classSections } = req.body || {};
    const subjectList = Array.isArray(subjects) ? subjects.filter(Boolean) : [];
    const sections = Array.isArray(classSections) ? classSections.filter(cs => cs && cs.grade) : [];
    if (!name || !phone || !subjectList.length || !sections.length || !schoolName || !state || !district || !mandal || !village) {
      return res.status(400).json({ error: 'Missing name, phone, subjects, school/tuition name, state/district/mandal/village, or at least one grade/section' });
    }

    // Trimmed here (not just client-side) so stray whitespace can never
    // sneak into the matching key regardless of caller — an ilike() match
    // against another table's value is exact-but-case-insensitive, so a
    // trailing space alone is enough to silently break homework matching.
    const trimmedSchoolName = String(schoolName).trim();
    const trimmedState = String(state).trim();
    const trimmedDistrict = String(district).trim();
    const trimmedMandal = String(mandal).trim();
    const trimmedVillage = String(village).trim();
    const { data, error } = await supabase.from('teachers').insert({
      name: String(name).trim().slice(0, 120),
      phone: String(phone).slice(0, 20),
      subjects: subjectList.map(s => String(s).trim().slice(0, 60)),
      school_name: trimmedSchoolName.slice(0, 200),
      state: trimmedState.slice(0, 100),
      district: trimmedDistrict.slice(0, 100),
      mandal: trimmedMandal.slice(0, 100),
      village: trimmedVillage.slice(0, 100),
      address: address ? String(address).trim().slice(0, 300) : null
    }).select('id').single();
    if (error) throw error;

    await upsertSchoolDirectory(trimmedSchoolName, trimmedState, trimmedDistrict, trimmedMandal);
    await upsertMandalDirectory(trimmedState, trimmedDistrict, trimmedMandal);
    await upsertVillageDirectory(trimmedState, trimmedDistrict, trimmedMandal, trimmedVillage);

    const sectionRows = sections.map(cs => ({
      teacher_id: data.id,
      grade: String(cs.grade).trim().slice(0, 40),
      section: cs.section ? String(cs.section).trim().slice(0, 40) : null
    }));
    const { error: sectionsErr } = await supabase.from('teacher_class_sections').insert(sectionRows);
    if (sectionsErr) console.error('Could not save teacher_class_sections rows (teacher registration itself still succeeded):', sectionsErr.message);

    console.log('New teacher registration:', name, 'id:', data.id);
    sendTeacherRegistrationEmail({ id: data.id, name, phone, subjects: subjectList, schoolName, state, district, mandal, village, address, classSections: sections }); // fire-and-forget
    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Teacher registration error:', err);
    res.status(500).json({ error: 'Could not save registration: ' + (err.message || '') });
  }
});

// Looked up by phone from the login page's Teacher/Tutor flow, after OTP
// verification, to decide between "register", "pending approval", or
// "approved" (approved routes to the real teacher dashboard).
app.get('/api/teacher-status', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const digits = String(req.query.phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return res.status(400).json({ error: 'Invalid phone number' });

    const { data, error } = await supabase.from('teachers').select('id, is_approved, phone');
    if (error) throw error;
    const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
    const match = (data || []).find(row => norm(row.phone) === digits);
    if (!match) return res.json({ found: false });
    res.json({ found: true, is_approved: !!match.is_approved, id: match.id });
  } catch (err) {
    console.error('Teacher status error:', err);
    res.status(500).json({ error: 'Could not check teacher status' });
  }
});

// Teacher's own profile + their registered grade/sections — powers the
// teacher dashboard, parallel to /api/family/:id and /api/family/:id/students.
app.get('/api/teacher/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data, error } = await supabase.from('teachers')
      .select('id, name, subjects, school_name, area, is_approved')
      .eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Teacher not found' });
    res.json(data);
  } catch (err) {
    console.error('Get teacher error:', err);
    res.status(500).json({ error: 'Could not fetch teacher' });
  }
});

app.get('/api/teacher/:id/class-sections', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data, error } = await supabase.from('teacher_class_sections')
      .select('id, grade, section')
      .eq('teacher_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ classSections: data || [] });
  } catch (err) {
    console.error('Get teacher class-sections error:', err);
    res.status(500).json({ error: 'Could not fetch class/sections' });
  }
});

// ------------------------------------------------------------------
// Homework Monitor — a general class roster (school+geography+class+
// section match, same predicate as homework matching elsewhere in this
// file, but with no homework required to exist) plus a color-coded
// completion status per student, computed over a 7-day rolling window
// (not all-time) so the signal reflects "who needs a nudge right now"
// rather than being diluted by a semester's worth of history.
// ------------------------------------------------------------------
async function studentsForTeacherClassSection(teacher, grade, section) {
  const teacherSchool = normText(teacher.school_name);
  const csGrade = normText(grade);
  const csSection = normText(section);
  const { data: allStudents, error } = await supabase.from('students')
    .select('id, name, family_id, class, section, school_name, area, state, district, mandal');
  if (error) throw error;
  return (allStudents || []).filter(s =>
    normText(s.school_name) === teacherSchool &&
    geoMatches(teacher, s) &&
    normText(s.class) === csGrade &&
    (!section || normText(s.section) === csSection)
  );
}

app.get('/api/teacher/:id/class-sections/:classSectionId/roster', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data: teacher, error: teacherErr } = await supabase.from('teachers')
      .select('id, name, school_name, area, state, district, mandal').eq('id', req.params.id).maybeSingle();
    if (teacherErr) throw teacherErr;
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const { data: cs, error: csErr } = await supabase.from('teacher_class_sections')
      .select('id, grade, section').eq('id', req.params.classSectionId).eq('teacher_id', req.params.id).maybeSingle();
    if (csErr) throw csErr;
    if (!cs) return res.status(404).json({ error: 'Class/section not found' });

    const emptySummary = { done: 0, pending: 0, partial: 0, none: 0, total: 0 };
    if (!teacher.school_name || !(teacher.area || (teacher.state && teacher.district && teacher.mandal))) {
      return res.json({ grade: cs.grade, section: cs.section, needsLocation: true, homeworkInWindow: 0, students: [], summary: emptySummary });
    }

    const students = await studentsForTeacherClassSection(teacher, cs.grade, cs.section);
    if (!students.length) {
      return res.json({ grade: cs.grade, section: cs.section, needsLocation: false, homeworkInWindow: 0, students: [], summary: emptySummary });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const csGrade = normText(cs.grade);
    const csSection = normText(cs.section);
    const { data: recentHomework, error: hwErr } = await supabase.from('homework')
      .select('id, grade, section, created_at')
      .eq('teacher_id', req.params.id)
      .gte('created_at', sevenDaysAgo);
    if (hwErr) throw hwErr;
    const windowHomework = (recentHomework || []).filter(h =>
      normText(h.grade) === csGrade && (!cs.section || normText(h.section) === csSection)
    );

    const studentIds = students.map(s => s.id);
    const doneMap = new Map(); // student_id -> Set(homework_id done)
    if (windowHomework.length) {
      const hwIds = windowHomework.map(h => h.id);
      const { data: statuses, error: statusErr } = await supabase.from('homework_status')
        .select('homework_id, student_id, is_done').in('homework_id', hwIds).in('student_id', studentIds);
      if (statusErr) throw statusErr;
      for (const st of (statuses || [])) {
        if (!st.is_done) continue;
        if (!doneMap.has(st.student_id)) doneMap.set(st.student_id, new Set());
        doneMap.get(st.student_id).add(st.homework_id);
      }
    }

    const familyIds = [...new Set(students.map(s => s.family_id))];
    const familyHasEmail = {};
    if (familyIds.length) {
      const { data: families, error: famErr } = await supabase.from('family_registrations')
        .select('id, data').in('id', familyIds);
      if (famErr) throw famErr;
      for (const f of (families || [])) {
        const recipient = f.data?.mother?.email ? f.data.mother : f.data?.father;
        familyHasEmail[f.id] = Boolean(recipient && recipient.email);
      }
    }

    const totalHwCount = windowHomework.length;
    const summary = { done: 0, pending: 0, partial: 0, none: 0, total: students.length };
    const studentRows = students.map(s => {
      const doneCount = doneMap.get(s.id)?.size || 0;
      let status;
      if (totalHwCount === 0) status = 'none';
      else if (doneCount === totalHwCount) status = 'done';
      else if (doneCount === 0) status = 'pending';
      else status = 'partial';
      summary[status]++;
      return {
        id: s.id,
        name: s.name,
        status,
        pendingCount: totalHwCount - doneCount,
        hasEmail: Boolean(familyHasEmail[s.family_id])
      };
    });

    res.json({ grade: cs.grade, section: cs.section, needsLocation: false, homeworkInWindow: totalHwCount, students: studentRows, summary });
  } catch (err) {
    console.error('Get class roster error:', err);
    res.status(500).json({ error: 'Could not fetch class roster' });
  }
});

// Manual per-student reminder from the Homework Monitor tab — reuses the
// same email as the automated evening digest, but deliberately does NOT
// touch homework_alerts_sent: that guard exists to stop the automated
// cron from double-sending on retries, not to limit how often a teacher
// can manually nudge one family.
app.post('/api/teacher/:id/send-reminder', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { student_id } = req.body || {};
    if (!student_id) return res.status(400).json({ error: 'Missing student_id' });

    const { data: teacher, error: teacherErr } = await supabase.from('teachers')
      .select('id, name, school_name, area, state, district, mandal').eq('id', req.params.id).maybeSingle();
    if (teacherErr) throw teacherErr;
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const { data: student, error: studentErr } = await supabase.from('students')
      .select('id, name, family_id, class, section, school_name, area, state, district, mandal').eq('id', student_id).maybeSingle();
    if (studentErr) throw studentErr;
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Authorization: does this student actually fall under a class/section
    // this teacher teaches, at the same school/geography? Cheap to check,
    // and stops a teacher's reminder button from ever being pointed at a
    // student outside their own class.
    const { data: sections, error: sectionsErr } = await supabase.from('teacher_class_sections')
      .select('grade, section').eq('teacher_id', req.params.id);
    if (sectionsErr) throw sectionsErr;
    const studentGrade = normText(student.class);
    const studentSection = normText(student.section);
    const teachesThisStudent = (sections || []).some(cs => normText(cs.grade) === studentGrade && (!cs.section || normText(cs.section) === studentSection));
    if (!teachesThisStudent || normText(student.school_name) !== normText(teacher.school_name) || !geoMatches(teacher, student)) {
      return res.status(403).json({ error: 'This student is not in your class' });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentHomework, error: hwErr } = await supabase.from('homework')
      .select('id, subject, title, grade, section, created_at')
      .eq('teacher_id', req.params.id)
      .gte('created_at', sevenDaysAgo);
    if (hwErr) throw hwErr;
    const windowHomework = (recentHomework || []).filter(h =>
      normText(h.grade) === studentGrade && (!h.section || normText(h.section) === studentSection)
    );
    if (!windowHomework.length) return res.json({ ok: true, sent: false, reason: 'No homework posted for this student in the last 7 days' });

    const hwIds = windowHomework.map(h => h.id);
    const { data: statuses, error: statusErr } = await supabase.from('homework_status')
      .select('homework_id, is_done').eq('student_id', student.id).in('homework_id', hwIds);
    if (statusErr) throw statusErr;
    const doneSet = new Set((statuses || []).filter(s => s.is_done).map(s => s.homework_id));
    const pendingItems = windowHomework.filter(h => !doneSet.has(h.id)).map(h => ({
      studentName: student.name, subject: h.subject, title: h.title,
      teacherId: teacher.id, teacherName: teacher.name, schoolName: teacher.school_name
    }));
    if (!pendingItems.length) return res.json({ ok: true, sent: false, reason: 'This student is already caught up' });

    const { data: family, error: familyErr } = await supabase.from('family_registrations')
      .select('data').eq('id', student.family_id).maybeSingle();
    if (familyErr) throw familyErr;
    const recipient = family?.data?.mother?.email ? family.data.mother : family?.data?.father;
    if (!recipient || !recipient.email) return res.status(400).json({ error: 'No email on file for this family' });

    await sendPendingHomeworkEmail(recipient.name || 'there', recipient.email, pendingItems);
    res.json({ ok: true, sent: true });
  } catch (err) {
    console.error('Send reminder error:', err);
    res.status(500).json({ error: 'Could not send reminder' });
  }
});

// Fetch (or lazily create) this teacher's referral code, and hand back
// the shareable link. Powers the "Referrals" section on the dashboard.
app.get('/api/teacher/:id/referral-code', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data: teacher, error: teacherErr } = await supabase.from('teachers')
      .select('id, is_approved').eq('id', req.params.id).maybeSingle();
    if (teacherErr) throw teacherErr;
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    if (!teacher.is_approved) return res.status(403).json({ error: 'Referral links are available once your account is approved' });

    const code = await getOrCreateReferralCode(teacher.id);
    res.json({ code, url: `${req.protocol}://${req.get('host')}/r/${code}` });
  } catch (err) {
    console.error('Get referral code error:', err);
    res.status(500).json({ error: 'Could not fetch referral code' });
  }
});

// Read-only referral stats for the dashboard: how many people this
// teacher has referred, and a short list to sanity-check the count.
//
// A referred family can now have many referral_conversions rows — one
// 'signup' row from registration, plus one 'paid' row per monthly charge
// for as long as they stay subscribed (see handleSubscriptionCharged) — so
// everything here is deduped to one entry per family. "Converted" now
// means "became a paying subscriber" (>=1 'paid' row), not just
// "registered via my link" like it did before payments existed — the
// dashboard caption next to this tile spells that out for returning users.
app.get('/api/teacher/:id/referrals', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data, error } = await supabase.from('referral_conversions')
      .select('id, family_id, conversion_type, created_at')
      .eq('teacher_id', req.params.id)
      .order('created_at', { ascending: true }); // ascending so the first row seen per family is the earliest (registration date)
    if (error) throw error;
    const conversions = data || [];

    // Total link opens, independent of whether they ever converted — see
    // migration 009. Counted separately (not derived from conversions)
    // since these two numbers are now genuinely different: an open only
    // becomes a conversion (with a family_id/name) once someone registers.
    const { count: totalReferred, error: opensErr } = await supabase.from('referral_link_opens')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', req.params.id);
    if (opensErr) throw opensErr;

    const firstSeenByFamily = new Map(); // family_id -> earliest conversion row
    const everPaidFamilyIds = new Set();
    for (const c of conversions) {
      if (!firstSeenByFamily.has(c.family_id)) firstSeenByFamily.set(c.family_id, c);
      if (c.conversion_type === 'paid') everPaidFamilyIds.add(c.family_id);
    }

    const familyIds = [...firstSeenByFamily.keys()].filter(id => id != null);
    let familyNames = {};
    if (familyIds.length) {
      const { data: students, error: studentsErr } = await supabase.from('students')
        .select('family_id, name').in('family_id', familyIds);
      if (studentsErr) throw studentsErr;
      for (const s of (students || [])) {
        if (!familyNames[s.family_id]) familyNames[s.family_id] = s.name;
      }
    }

    const referrals = [...firstSeenByFamily.entries()]
      .sort((a, b) => new Date(b[1].created_at) - new Date(a[1].created_at))
      .map(([familyId, c]) => ({
        id: c.id,
        childName: familyNames[familyId] || 'Registered family',
        createdAt: c.created_at
      }));

    res.json({
      totalReferred: totalReferred || 0,
      totalConverted: everPaidFamilyIds.size,
      referrals
    });
  } catch (err) {
    console.error('Get referrals error:', err);
    res.status(500).json({ error: 'Could not fetch referrals' });
  }
});

// ------------------------------------------------------------------
// Razorpay webhook — the source of truth for subscription state. The
// client-side Checkout success callback (registration UI) is only for
// fast optimistic UI; this is what actually finalizes everything.
// Signature verified via HMAC-SHA256 over the raw request body (see the
// express.json({verify}) hook above) using Node's built-in crypto —
// deliberately not the SDK's own signature helper, since its exact export
// path isn't something this environment can live-test against a real
// Razorpay account; a plain, well-documented HMAC compare is simple enough
// to trust directly.
// ------------------------------------------------------------------
async function findFamilySubscriptionByRazorpaySubId(subId) {
  const { data, error } = await supabase.from('family_subscriptions').select('*').eq('razorpay_subscription_id', subId).maybeSingle();
  if (error) throw error;
  return data;
}

async function handleSubscriptionActivated(event) {
  const sub = event.payload?.subscription?.entity;
  if (!sub) return;
  const { error } = await supabase.from('family_subscriptions')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('razorpay_subscription_id', sub.id);
  if (error) console.error('Could not mark subscription active:', error.message);
}

async function handleSubscriptionCancelled(event) {
  const sub = event.payload?.subscription?.entity;
  if (!sub) return;
  const { error } = await supabase.from('family_subscriptions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('razorpay_subscription_id', sub.id);
  if (error) console.error('Could not mark subscription cancelled:', error.message);
}

async function handleSubscriptionHalted(event) {
  const sub = event.payload?.subscription?.entity;
  if (!sub) return;
  const { error } = await supabase.from('family_subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('razorpay_subscription_id', sub.id);
  if (error) console.error('Could not mark subscription past_due:', error.message);
}

// Fires on every successful recurring charge, including the very first
// one. Records the referral-share math (25% on the family's first-ever
// paid charge, 10% on every renewal after) — see the migration 010
// comment for the schema this depends on.
async function handleSubscriptionCharged(event) {
  const sub = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;
  if (!sub || !payment) return;

  const famSub = await findFamilySubscriptionByRazorpaySubId(sub.id);
  if (!famSub) { console.error('subscription.charged for unknown razorpay_subscription_id:', sub.id); return; }

  const periodEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : famSub.current_period_end;
  const { error: subUpdateErr } = await supabase.from('family_subscriptions')
    .update({
      status: 'active',
      current_period_end: periodEnd,
      razorpay_customer_id: payment.customer_id || famSub.razorpay_customer_id,
      updated_at: new Date().toISOString()
    })
    .eq('id', famSub.id);
  if (subUpdateErr) console.error('Could not update family_subscriptions on charge:', subUpdateErr.message);

  // Idempotency — Razorpay redelivers webhooks; never double-record the
  // same charge.
  const { data: existingPayment, error: existingErr } = await supabase.from('referral_conversions')
    .select('id').eq('razorpay_payment_id', payment.id).maybeSingle();
  if (existingErr) { console.error('Could not check existing referral_conversions row:', existingErr.message); return; }
  if (existingPayment) return;

  // Was this family ever referred? Any existing row (the 'signup' row from
  // registration, if present) is the anchor — a family is referred by
  // exactly one teacher, so referral_code_id/teacher_id are the same on
  // every row for this family.
  const { data: referralAnchor, error: anchorErr } = await supabase.from('referral_conversions')
    .select('referral_code_id, teacher_id').eq('family_id', famSub.family_id).limit(1).maybeSingle();
  if (anchorErr) { console.error('Could not look up referral anchor:', anchorErr.message); return; }
  if (!referralAnchor) return; // not a referred family — nothing to record

  const { count: priorPaidCount, error: countErr } = await supabase.from('referral_conversions')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', famSub.family_id).eq('conversion_type', 'paid');
  if (countErr) { console.error('Could not count prior paid conversions:', countErr.message); return; }

  const sharePercentage = (priorPaidCount || 0) === 0 ? 25 : 10;
  const amount = (payment.amount || 0) / 100; // Razorpay amounts are in paise
  const teacherShare = Math.round(amount * sharePercentage) / 100;

  const { error: insertErr } = await supabase.from('referral_conversions').insert({
    referral_code_id: referralAnchor.referral_code_id,
    teacher_id: referralAnchor.teacher_id,
    family_id: famSub.family_id,
    conversion_type: 'paid',
    amount,
    share_percentage: sharePercentage,
    teacher_share: teacherShare,
    razorpay_subscription_id: sub.id,
    razorpay_payment_id: payment.id
  });
  if (insertErr) console.error('Could not insert referral_conversions row for charge:', insertErr.message);
}

app.post('/api/webhooks/razorpay', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const signature = req.headers['x-razorpay-signature'];
    if (!process.env.RAZORPAY_WEBHOOK_SECRET || !signature || !req.rawBody) {
      return res.status(400).json({ error: 'Missing webhook signature or secret' });
    }
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(req.rawBody).digest('hex');
    if (expected !== signature) {
      console.error('Razorpay webhook signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body || {};
    switch (event.event) {
      case 'subscription.activated': await handleSubscriptionActivated(event); break;
      case 'subscription.charged': await handleSubscriptionCharged(event); break;
      case 'subscription.cancelled': await handleSubscriptionCancelled(event); break;
      case 'subscription.halted': await handleSubscriptionHalted(event); break;
      default: break; // unhandled event types are fine to ignore — ack so Razorpay stops retrying
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Razorpay webhook error:', err);
    // 500 (not 200) so Razorpay's own retry schedule kicks in — a failure
    // here is assumed transient (e.g. a momentary Supabase hiccup), not a
    // reason to silently drop the event.
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

// ------------------------------------------------------------------
// Check whether a phone number already belongs to a registered family.
// Phone numbers inside family_registrations.data aren't normalized
// (free-typed at registration), so we compare only the last 10 digits
// in JS rather than relying on an exact JSONB match.
// ------------------------------------------------------------------
app.post('/api/check-family', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const family = await findFamilyIdByPhone((req.body || {}).phone);
    res.json({ registered: !!family, family_id: family ? family.id : null });
  } catch (err) {
    console.error('Check-family error:', err);
    res.status(500).json({ error: 'Could not check family status' });
  }
});

// ------------------------------------------------------------------
// Resolve which student a "Child Name + phone" (and, on a second pass,
// roll number / section) combination refers to. Rate-limited — this is
// effectively a lookup keyed on guessable info (a name + a phone), so it
// shouldn't be brute-forceable.
// ------------------------------------------------------------------
const resolveStudentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a minute and try again.' }
});

function normalizeName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// "Close" match: exact, or a small edit distance relative to name length —
// catches typos like "Ishika" vs "Ishka" without matching unrelated names.
function isCloseNameMatch(input, candidate) {
  const a = normalizeName(input), b = normalizeName(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  const threshold = maxLen <= 4 ? 1 : Math.min(3, Math.ceil(maxLen * 0.25));
  return levenshtein(a, b) <= threshold;
}

// Returns { id, motherName, fatherName } for the family owning this phone
// (last-10-digit match against mother/father), or null if none found.
async function findFamilyIdByPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  // Ordered by id desc — without this, a phone number that was registered
  // more than once (e.g. someone re-submitting the registration form while
  // testing) resolves non-deterministically, since Postgres doesn't
  // guarantee row order without an explicit ORDER BY. Preferring the most
  // recent registration is the sane default.
  const { data, error } = await supabase.from('family_registrations').select('id, data').order('id', { ascending: false });
  if (error) throw error;
  const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const match = (data || []).find(row =>
    norm(row.data?.mother?.phone) === digits || norm(row.data?.father?.phone) === digits
  );
  if (!match) return null;
  return {
    id: match.id,
    motherName: match.data?.mother?.name || null,
    fatherName: match.data?.father?.name || null
  };
}

app.post('/api/resolve-student', resolveStudentLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { phone, name, roll_number, section } = req.body || {};
    if (!phone || !name) return res.status(400).json({ error: 'Missing phone or name' });

    const family = await findFamilyIdByPhone(phone);
    if (!family) return res.json({ familyFound: false, found: false });

    const { data: siblings, error } = await supabase.from('students').select('*').eq('family_id', family.id);
    if (error) throw error;
    const students = siblings || [];

    if (roll_number || section) {
      // Pass 2: roll_number/section decides it — the user is here precisely
      // because their typed name didn't confidently match, so re-requiring
      // a name match would defeat the point. Name is only used as a
      // tiebreaker if roll_number/section alone matches more than one sibling.
      let candidates = students.filter(s =>
        (roll_number && s.roll_number && String(s.roll_number).trim().toLowerCase() === String(roll_number).trim().toLowerCase()) ||
        (section && s.section && String(s.section).trim().toLowerCase() === String(section).trim().toLowerCase())
      );
      if (candidates.length > 1) {
        const nameNarrowed = candidates.filter(s => isCloseNameMatch(name, s.name));
        if (nameNarrowed.length >= 1) candidates = nameNarrowed;
      }
      if (candidates.length === 1) return res.json({ familyFound: true, found: true, student_id: candidates[0].id, family_id: family.id });
      return res.json({ familyFound: true, found: false, family_id: family.id });
    }

    // Pass 1: name + phone only.
    const matches = students.filter(s => isCloseNameMatch(name, s.name));
    if (matches.length === 1) {
      return res.json({ familyFound: true, found: true, student_id: matches[0].id, family_id: family.id });
    }
    // Zero matches, or more than one equally-plausible match — both need disambiguation.
    return res.json({ familyFound: true, found: false, needsDisambiguation: true, family_id: family.id });
  } catch (err) {
    console.error('Resolve-student error:', err);
    res.status(500).json({ error: 'Could not resolve student' });
  }
});

// ------------------------------------------------------------------
// Fetch a single student/family by id, so app/child, app/mother and app/father
// can personalize their static "Leo"/"Alexandria" placeholders once a
// real student_id/family_id is known (set in sessionStorage at login).
// No auth check — matches this app's existing security posture (e.g.
// /api/upload, /api/homework are unauthenticated too); ids are opaque
// uuids/bigints, not sequential guessable identifiers where it matters.
// ------------------------------------------------------------------
app.get('/api/student/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data, error } = await supabase
      .from('students')
      .select('name, class, section, school_name, roll_number')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Student not found' });
    res.json(data);
  } catch (err) {
    console.error('Get student error:', err);
    res.status(500).json({ error: 'Could not fetch student' });
  }
});

app.get('/api/family/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.id, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    const { data, error } = await supabase
      .from('family_registrations')
      .select('data')
      .eq('id', familyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Family not found' });
    res.json({ motherName: data.data?.mother?.name || null, fatherName: data.data?.father?.name || null });
  } catch (err) {
    console.error('Get family error:', err);
    res.status(500).json({ error: 'Could not fetch family' });
  }
});

app.get('/api/family/:id/members', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.id, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    const { data, error } = await supabase
      .from('family_members')
      .select('id, name, relationship, phone')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ members: data || [] });
  } catch (err) {
    console.error('Get family members error:', err);
    res.status(500).json({ error: 'Could not fetch family members' });
  }
});

// Lists every child in a family — the greeting card's per-child chip row
// (mother/father/family-member dashboards) needs all siblings, not just
// the one student_id in sessionStorage from login.
app.get('/api/family/:id/students', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.id, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    const { data, error } = await supabase
      .from('students')
      .select('id, name, class')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ students: data || [] });
  } catch (err) {
    console.error('Get family students error:', err);
    res.status(500).json({ error: 'Could not fetch family students' });
  }
});

// ------------------------------------------------------------------
// Bonding scores — personal per viewer, never exposed as a full ranking.
// A viewer_key is 'mother', 'father', or a family_members.id (uuid text).
// The response only ever carries the requested viewer's own score plus
// the family's max, so one viewer can never read another's raw score.
// ------------------------------------------------------------------
app.get('/api/bonding-score/:familyId/:viewerKey', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.familyId, 10);
    const viewerKey = req.params.viewerKey;
    if (!Number.isFinite(familyId) || !viewerKey) return res.status(400).json({ error: 'Invalid family id or viewer key' });

    const { data: rows, error } = await supabase
      .from('bonding_scores')
      .select('viewer_key, score')
      .eq('family_id', familyId);
    if (error) throw error;

    const own = (rows || []).find(r => r.viewer_key === viewerKey);
    const score = own ? own.score : 0;
    const leaderScore = (rows || []).reduce((max, r) => Math.max(max, r.score), score);
    res.json({ score, leaderScore, isLeader: score >= leaderScore });
  } catch (err) {
    console.error('Get bonding score error:', err);
    res.status(500).json({ error: 'Could not fetch bonding score' });
  }
});

app.post('/api/bonding-score', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { family_id, viewer_key, score } = req.body || {};
    const familyId = parseInt(family_id, 10);
    const scoreNum = parseInt(score, 10);
    if (!Number.isFinite(familyId) || !viewer_key || !Number.isFinite(scoreNum)) {
      return res.status(400).json({ error: 'Missing family_id, viewer_key, or score' });
    }
    const { error } = await supabase
      .from('bonding_scores')
      .upsert({ family_id: familyId, viewer_key, score: Math.max(0, Math.min(100, scoreNum)), updated_at: new Date().toISOString() }, { onConflict: 'family_id,viewer_key' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Set bonding score error:', err);
    res.status(500).json({ error: 'Could not save bonding score' });
  }
});

// ------------------------------------------------------------------
// Per-member dashboard feature visibility — set by mother/father in the
// "Manage Family" settings screen. A missing row means "visible".
// ------------------------------------------------------------------
const VISIBILITY_FEATURES = ['bonding_report', 'homework', 'activities'];

app.get('/api/visibility-rules/:familyId', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.familyId, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    const { data, error } = await supabase
      .from('member_visibility_rules')
      .select('family_member_id, feature_name, is_visible')
      .eq('family_id', familyId);
    if (error) throw error;
    res.json({ rules: data || [] });
  } catch (err) {
    console.error('Get visibility rules error:', err);
    res.status(500).json({ error: 'Could not fetch visibility rules' });
  }
});

app.get('/api/visibility-rules/:familyId/:memberId', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.familyId, 10);
    const memberId = req.params.memberId;
    if (!Number.isFinite(familyId) || !memberId) return res.status(400).json({ error: 'Invalid family id or member id' });
    const { data, error } = await supabase
      .from('member_visibility_rules')
      .select('feature_name, is_visible')
      .eq('family_id', familyId)
      .eq('family_member_id', memberId);
    if (error) throw error;
    const visibility = Object.fromEntries(VISIBILITY_FEATURES.map(f => [f, true]));
    (data || []).forEach(r => { visibility[r.feature_name] = r.is_visible; });
    res.json(visibility);
  } catch (err) {
    console.error('Get member visibility error:', err);
    res.status(500).json({ error: 'Could not fetch member visibility' });
  }
});

app.post('/api/visibility-rules', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { family_id, family_member_id, feature_name, is_visible } = req.body || {};
    const familyId = parseInt(family_id, 10);
    if (!Number.isFinite(familyId) || !family_member_id || !VISIBILITY_FEATURES.includes(feature_name)) {
      return res.status(400).json({ error: 'Missing or invalid family_id, family_member_id, or feature_name' });
    }
    const { error } = await supabase
      .from('member_visibility_rules')
      .upsert({
        family_id: familyId,
        family_member_id,
        feature_name,
        is_visible: !!is_visible,
        updated_at: new Date().toISOString()
      }, { onConflict: 'family_id,family_member_id,feature_name' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Set visibility rule error:', err);
    res.status(500).json({ error: 'Could not save visibility rule' });
  }
});

// ------------------------------------------------------------------
// Teacher-posted homework assignments — named /api/homework-assignments
// (not /api/homework) to avoid colliding with the pre-existing
// /api/homework route below, which is the unrelated AI homework-explain
// proxy to Claude.
//
// There's no schools table — a homework item's audience is resolved at
// read time by text-matching (school_name, geography, grade, section)
// between the posting teacher and each student, same "good enough"
// philosophy as the existing phone/name matching elsewhere in this file.
// homework_status follows member_visibility_rules's convention: a missing
// row means the default (here, "pending"), only written when a student
// marks done.
// ------------------------------------------------------------------
function normText(s) { return String(s || '').trim().toLowerCase(); }

// Geography half of the school-matching key. Dual-mode, deliberately not
// backfilled: rows registered before the state/district/mandal cascade
// shipped only have `area` (the old fixed Hyderabad-locality dropdown) —
// those keep matching each other on `area` exactly as before. Rows
// registered after the cascade shipped only have state/district/mandal —
// those match each other on that triple instead. `village` is captured on
// both forms but intentionally excluded here: it's the most typo-prone
// level of the cascade (a free-text "pick or add new" datalist, unlike the
// closed state/district dropdowns) and isn't needed to disambiguate
// same-named school branches — district+mandal already match the
// granularity the old 20-item area list operated at, so this doesn't widen
// the false-positive risk that `area`/`school_name` were required together
// to prevent in the first place.
function geoMatches(a, b) {
  const aHasGeo = a.state && a.district && a.mandal;
  const bHasGeo = b.state && b.district && b.mandal;
  if (aHasGeo && bHasGeo) {
    return normText(a.state) === normText(b.state) &&
      normText(a.district) === normText(b.district) &&
      normText(a.mandal) === normText(b.mandal);
  }
  return Boolean(a.area) && Boolean(b.area) && normText(a.area) === normText(b.area);
}

// Teacher creates an assignment — checked against their own
// teacher_class_sections so they can only post to a grade/section they
// actually registered to teach.
app.post('/api/homework-assignments', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { teacher_id, grade, section, subject, title, description, attachmentUrl } = req.body || {};
    if (!teacher_id || !grade || !title) {
      return res.status(400).json({ error: 'Missing teacher_id, grade, or title' });
    }

    const { data: teacher, error: teacherErr } = await supabase.from('teachers')
      .select('id, is_approved').eq('id', teacher_id).maybeSingle();
    if (teacherErr) throw teacherErr;
    if (!teacher || !teacher.is_approved) return res.status(403).json({ error: 'Teacher not found or not approved' });

    const { data: sections, error: sectionsErr } = await supabase.from('teacher_class_sections')
      .select('grade, section').eq('teacher_id', teacher_id);
    if (sectionsErr) throw sectionsErr;
    const allowed = (sections || []).some(cs => normText(cs.grade) === normText(grade) && normText(cs.section) === normText(section));
    if (!allowed) return res.status(403).json({ error: 'You are not registered to teach this grade/section' });

    const { data, error } = await supabase.from('homework').insert({
      teacher_id,
      grade: String(grade).trim().slice(0, 40),
      section: section ? String(section).trim().slice(0, 40) : null,
      subject: subject ? String(subject).trim().slice(0, 60) : null,
      title: String(title).trim().slice(0, 200),
      description: description ? String(description).trim().slice(0, 4000) : null,
      attachment_url: attachmentUrl || null
    }).select('id').single();
    if (error) throw error;

    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Post homework assignment error:', err);
    res.status(500).json({ error: 'Could not save homework: ' + (err.message || '') });
  }
});

// Teacher's own posted assignments — feeds their dashboard list.
app.get('/api/teacher/:id/homework-assignments', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data, error } = await supabase.from('homework')
      .select('*').eq('teacher_id', req.params.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ homework: data || [] });
  } catch (err) {
    console.error('Get teacher homework error:', err);
    res.status(500).json({ error: 'Could not fetch homework' });
  }
});

// Done/pending roster for one assignment — the teacher's monitoring view.
app.get('/api/homework-assignments/:id/status', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data: hw, error: hwErr } = await supabase.from('homework')
      .select('id, teacher_id, grade, section').eq('id', req.params.id).maybeSingle();
    if (hwErr) throw hwErr;
    if (!hw) return res.status(404).json({ error: 'Homework not found' });

    const { data: teacher, error: teacherErr } = await supabase.from('teachers')
      .select('school_name, area, state, district, mandal').eq('id', hw.teacher_id).maybeSingle();
    if (teacherErr) throw teacherErr;
    if (!teacher || !teacher.school_name || !(teacher.area || (teacher.state && teacher.district && teacher.mandal))) return res.json({ roster: [] });

    // Matched entirely in JS with normText() on both sides — an ilike()
    // filter can't tolerate incidental whitespace differences between how
    // a teacher and a family independently typed the same school name, so
    // it can silently under-match depending on which side happens to have
    // the stray whitespace. Table sizes are small enough at this stage
    // that fetching broadly and filtering in JS is the safer trade-off.
    const teacherSchool = normText(teacher.school_name);
    const hwGrade = normText(hw.grade);
    const hwSection = normText(hw.section);
    const { data: allStudents, error: studentsErr } = await supabase.from('students')
      .select('id, name, class, section, school_name, area, state, district, mandal');
    if (studentsErr) throw studentsErr;
    const students = (allStudents || []).filter(s =>
      normText(s.school_name) === teacherSchool &&
      geoMatches(teacher, s) &&
      normText(s.class) === hwGrade &&
      (!hw.section || normText(s.section) === hwSection)
    );

    const studentIds = students.map(s => s.id);
    let doneSet = new Set();
    if (studentIds.length) {
      const { data: statuses, error: statusErr } = await supabase.from('homework_status')
        .select('student_id, is_done').eq('homework_id', req.params.id).in('student_id', studentIds);
      if (statusErr) throw statusErr;
      doneSet = new Set((statuses || []).filter(s => s.is_done).map(s => s.student_id));
    }
    res.json({ roster: students.map(s => ({ student_id: s.id, name: s.name, is_done: doneSet.has(s.id) })) });
  } catch (err) {
    console.error('Get homework status error:', err);
    res.status(500).json({ error: 'Could not fetch homework status' });
  }
});

// Child marks a homework item done.
app.post('/api/homework-assignments/:id/mark-done', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { student_id } = req.body || {};
    if (!student_id) return res.status(400).json({ error: 'Missing student_id' });
    const { error } = await supabase.from('homework_status').upsert({
      homework_id: req.params.id,
      student_id,
      is_done: true,
      marked_done_at: new Date().toISOString()
    }, { onConflict: 'homework_id,student_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark homework done error:', err);
    res.status(500).json({ error: 'Could not update homework status' });
  }
});

// Resolves every homework item that matches one student's
// (school_name, geography, class, section), with that student's own
// done/pending status attached. Shared by the for-student and for-family
// routes below.
async function homeworkForStudent(student) {
  if (!student.school_name || !student.class || !(student.area || (student.state && student.district && student.mandal))) return [];

  // Matched entirely in JS with normText() on both sides — see the
  // matching comment in /api/homework-assignments/:id/status for why an
  // ilike() filter isn't safe here (it can't tolerate incidental
  // whitespace differences between independently-typed school names).
  const studentSchool = normText(student.school_name);
  const studentGrade = normText(student.class);
  const studentSection = normText(student.section);

  const { data: allTeachers, error: teacherErr } = await supabase.from('teachers').select('id, name, school_name, area, state, district, mandal');
  if (teacherErr) throw teacherErr;
  const teachersAtSchool = (allTeachers || []).filter(t => normText(t.school_name) === studentSchool && geoMatches(t, student));
  const teacherIds = teachersAtSchool.map(t => t.id);
  if (!teacherIds.length) return [];
  const teacherNameById = Object.fromEntries(teachersAtSchool.map(t => [t.id, t.name]));

  const { data: hwRows, error: hwErr } = await supabase.from('homework')
    .select('id, teacher_id, grade, section, subject, title, description, attachment_url, created_at')
    .in('teacher_id', teacherIds);
  if (hwErr) throw hwErr;
  const matched = (hwRows || []).filter(h => normText(h.grade) === studentGrade && (!h.section || normText(h.section) === studentSection));
  if (!matched.length) return [];

  const hwIds = matched.map(h => h.id);
  const { data: statuses, error: statusErr } = await supabase.from('homework_status')
    .select('homework_id, is_done').eq('student_id', student.id).in('homework_id', hwIds);
  if (statusErr) throw statusErr;
  const doneSet = new Set((statuses || []).filter(s => s.is_done).map(s => s.homework_id));

  return matched.map(h => ({
    id: h.id, subject: h.subject, title: h.title, description: h.description,
    attachment_url: h.attachment_url, created_at: h.created_at,
    teacher_name: teacherNameById[h.teacher_id] || null, is_done: doneSet.has(h.id)
  })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// app/child's homework list.
app.get('/api/homework-assignments/for-student/:studentId', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data: student, error: studentErr } = await supabase.from('students')
      .select('id, class, section, school_name, area, state, district, mandal').eq('id', req.params.studentId).maybeSingle();
    if (studentErr) throw studentErr;
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ homework: await homeworkForStudent(student) });
  } catch (err) {
    console.error('Get homework for student error:', err);
    res.status(500).json({ error: 'Could not fetch homework' });
  }
});

// app/mother, app/father, app/family-member's homework list — aggregated
// across every child in the family. For a family-member viewer, respects
// the same 'homework' visibility flag member_visibility_rules already
// reserved for this in Phase 1 (parents always see it in full).
app.get('/api/homework-assignments/for-family/:familyId', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.familyId, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    const viewerMemberId = req.query.viewer_member_id || null;

    if (viewerMemberId) {
      const { data: rule, error: ruleErr } = await supabase.from('member_visibility_rules')
        .select('is_visible').eq('family_id', familyId).eq('family_member_id', viewerMemberId).eq('feature_name', 'homework').maybeSingle();
      if (ruleErr) throw ruleErr;
      if (rule && rule.is_visible === false) return res.json({ students: [] });
    }

    const { data: students, error: studentsErr } = await supabase.from('students')
      .select('id, name, class, section, school_name, area, state, district, mandal').eq('family_id', familyId);
    if (studentsErr) throw studentsErr;

    const perStudent = await Promise.all((students || []).map(async s => ({
      student_id: s.id,
      student_name: s.name,
      homework: await homeworkForStudent(s)
    })));
    res.json({ students: perStudent });
  } catch (err) {
    console.error('Get homework for family error:', err);
    res.status(500).json({ error: 'Could not fetch homework' });
  }
});

// ------------------------------------------------------------------
// Evening homework alert — called once daily by a Cloud Scheduler job,
// protected by the same shared-secret-token pattern as ADMIN_TOKEN.
// Sends one digest email per family covering every child with homework
// posted today that's still pending, guarded against duplicate sends
// (e.g. a Scheduler retry) by homework_alerts_sent's unique constraint.
// ------------------------------------------------------------------
app.post('/api/cron/evening-homework-alerts', async (req, res) => {
  if (!process.env.CRON_TOKEN || req.query.token !== process.env.CRON_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todaysHomework, error: hwErr } = await supabase.from('homework')
      .select('id, teacher_id, grade, section, subject, title').gte('created_at', todayStart.toISOString());
    if (hwErr) throw hwErr;
    if (!todaysHomework || !todaysHomework.length) return res.json({ ok: true, familiesNotified: 0 });

    const teacherIds = [...new Set(todaysHomework.map(h => h.teacher_id))];
    const { data: teachers, error: teacherErr } = await supabase.from('teachers')
      .select('id, name, school_name, area, state, district, mandal').in('id', teacherIds);
    if (teacherErr) throw teacherErr;
    const teacherById = Object.fromEntries((teachers || []).map(t => [t.id, t]));

    // Fetched once and matched in JS with normText() on both sides — see
    // the matching comment on /api/homework-assignments/:id/status for why
    // an ilike() filter isn't safe here.
    const { data: allStudents, error: allStudentsErr } = await supabase.from('students')
      .select('id, name, family_id, class, section, school_name, area, state, district, mandal');
    if (allStudentsErr) throw allStudentsErr;

    const pendingByFamily = new Map(); // family_id -> [{ studentName, subject, title, teacherId, teacherName, schoolName }]

    for (const hw of todaysHomework) {
      const teacher = teacherById[hw.teacher_id];
      if (!teacher || !teacher.school_name || !(teacher.area || (teacher.state && teacher.district && teacher.mandal))) continue;

      const teacherSchool = normText(teacher.school_name);
      const hwGrade = normText(hw.grade);
      const hwSection = normText(hw.section);
      const students = allStudents.filter(s =>
        normText(s.school_name) === teacherSchool &&
        geoMatches(teacher, s) &&
        normText(s.class) === hwGrade &&
        (!hw.section || normText(s.section) === hwSection)
      );
      if (!students.length) continue;

      const studentIds = students.map(s => s.id);
      const { data: statuses, error: statusErr } = await supabase.from('homework_status')
        .select('student_id, is_done').eq('homework_id', hw.id).in('student_id', studentIds);
      if (statusErr) throw statusErr;
      const doneSet = new Set((statuses || []).filter(s => s.is_done).map(s => s.student_id));

      for (const s of students) {
        if (doneSet.has(s.id)) continue;
        if (!pendingByFamily.has(s.family_id)) pendingByFamily.set(s.family_id, []);
        pendingByFamily.get(s.family_id).push({
          studentName: s.name, subject: hw.subject, title: hw.title,
          teacherId: hw.teacher_id, teacherName: teacher.name, schoolName: teacher.school_name
        });
      }
    }

    const todayDate = todayStart.toISOString().slice(0, 10);
    let familiesNotified = 0;
    for (const [familyId, items] of pendingByFamily.entries()) {
      const { error: guardErr } = await supabase.from('homework_alerts_sent').insert({ family_id: familyId, sent_date: todayDate });
      if (guardErr) {
        if (guardErr.code !== '23505') console.error('Could not record alert guard for family', familyId, guardErr.message);
        continue; // already sent today, or a real error either way skip rather than double-send
      }
      const { data: family, error: familyErr } = await supabase.from('family_registrations')
        .select('data').eq('id', familyId).maybeSingle();
      if (familyErr || !family) continue;
      const recipient = family.data?.mother?.email ? family.data.mother : family.data?.father;
      if (!recipient || !recipient.email) continue; // no channel available for this family yet
      await sendPendingHomeworkEmail(recipient.name || 'there', recipient.email, items);
      familiesNotified++;
    }

    res.json({ ok: true, familiesNotified });
  } catch (err) {
    console.error('Evening homework alert error:', err);
    res.status(500).json({ error: 'Could not run evening homework alerts' });
  }
});

// The browser never sees the API key — it only ever talks to this route.
app.post('/api/homework', async (req, res) => {
  try {
    const { systemPrompt, userContent } = req.body;
    if (!systemPrompt || !userContent) {
      return res.status(400).json({ error: 'Missing systemPrompt or userContent' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Claude API returned an error', detail: errText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error calling Claude' });
  }
});

// ------------------------------------------------------------------
// Personalized homework explanation — reads the student's progress
// profile for this subject (falling back to sensible defaults for a
// student/subject with no record yet) and builds a level- and
// cognitive-load-aware system prompt server-side, then calls Claude
// the same way /api/homework does. Text-only for now — no image
// support (unlike /api/homework), matching what was asked for.
// ------------------------------------------------------------------
const DEFAULT_PROGRESS = {
  level: 'learner',
  logical_understanding: 50, subject_understanding: 50, memory_capacity: 50,
  learning_skill: 50, consistency_engagement: 50, response_time_pattern: 50,
  error_pattern_type: 50, retention_rate: 50, help_seeking_frequency: 50,
  cognitive_load_signal: 50
};

function buildTeacherSystemPrompt(subject, progress) {
  const levelInstruction = {
    beginner: 'This student is a beginner in this subject. Explain in very simple, step-by-step language, using everyday examples. Avoid jargon. Confirm understanding of one small idea before adding the next.',
    learner: 'This student has a working understanding of this subject. Explain at a moderate depth, connecting the idea to what they likely already know, and build toward the answer.',
    master: 'This student is strong in this subject. Keep the explanation concise, skip basics they already know, and end with a follow-up question that stretches their thinking.'
  }[progress.level] || 'Explain at a moderate depth appropriate for a student with a working understanding of this subject.';

  const loadInstruction = progress.cognitive_load_signal >= 65
    ? '\nThis student shows signs of being overloaded right now — cover only ONE concept at a time, keep it short, and avoid stacking multiple new ideas in a single explanation.'
    : '';

  return `You are an experienced, patient Indian school teacher helping a parent guide their child through homework. Never refer to yourself as "AI", "assistant", or "chatbot", and never use phrases like "As an AI..." — you are simply a teacher speaking plainly to a parent.

${levelInstruction}${loadInstruction}

Respond ONLY with valid JSON, no markdown fences, no preamble, in exactly this shape:
{"subject":"one short English subject label","explanation":"2-4 short sentences, simple teacher-tone language, explaining the underlying concept and how to guide the child to the answer (do not just give the final answer)","quiz":[{"question":"short question testing understanding","options":["A","B","C","D"],"correct":0,"explain":"one short sentence on why the correct answer is right"}]}
Generate exactly 5 quiz questions. Keep every string concise. Subject: ${subject}.`;
}

app.post('/api/homework-explain', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    }
    const { student_id, subject, question } = req.body || {};
    if (!student_id || !subject || !question) {
      return res.status(400).json({ error: 'Missing student_id, subject or question' });
    }

    let progress = DEFAULT_PROGRESS;
    if (supabase) {
      const { data, error } = await supabase
        .from('student_progress')
        .select('*')
        .eq('student_id', student_id)
        .eq('subject', subject)
        .maybeSingle();
      if (error) throw error;
      if (data) progress = data;
    }

    const systemPrompt = buildTeacherSystemPrompt(subject, progress);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: `Homework: ${question}` }] }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Claude API returned an error', detail: errText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Homework-explain error:', err);
    res.status(500).json({ error: 'Server error generating explanation' });
  }
});

// ------------------------------------------------------------------
// Phase 3.6: AI Question Paper Generator. Stateless, single-shot — the two
// attachments (lesson content + an old paper as a style reference) travel
// as inline base64 vision/document content blocks straight through to
// Claude, same as /api/homework's demo pattern, and nothing is persisted.
// Prompt is built server-side (like /api/homework-explain, not left to the
// client like /api/homework) so the extraction/generation instructions stay
// centralized and can't be tampered with by the caller.
// ------------------------------------------------------------------
function buildQuestionPaperSystemPrompt(subject) {
  return `You are an experienced Indian school exam-paper setter. You will be given two attachments: an OLD QUESTION PAPER (a style reference) and NEW LESSON CONTENT.

Step 1 — analyze the old question paper's structure: its sections, any section instructions, how many questions are in each section, each question's type (MCQ, short answer, long answer, fill-in-the-blank, etc.), and the marks assigned to each question and section.

Step 2 — using that exact structure (same sections, same question counts per section, same question types, same marks distribution), write three NEW question papers based on the NEW LESSON CONTENT (not the old paper's content) at three difficulty tiers:
- "logical": questions that test conceptual/logical reasoning and application of the ideas in the lesson content, not rote recall.
- "methodology": questions that test correct step-by-step procedure/method for solving problems from the lesson content.
- "tough": higher cognitive demand — multi-step, less scaffolding, application-heavy questions that stretch a strong student.

Every tier must follow the identical structure extracted in Step 1 (same sections, same marks, same question counts per section) — only the questions themselves and their difficulty differ between tiers.

Respond ONLY with valid JSON, no markdown fences, no preamble, in exactly this shape:
{"papers":{"logical":{"title":"string","subject":"string","totalMarks":number,"sections":[{"title":"string","instructions":"string or null","questions":[{"text":"string","marks":number}]}]},"methodology":{"title":"string","subject":"string","totalMarks":number,"sections":[{"title":"string","instructions":"string or null","questions":[{"text":"string","marks":number}]}]},"tough":{"title":"string","subject":"string","totalMarks":number,"sections":[{"title":"string","instructions":"string or null","questions":[{"text":"string","marks":number}]}]}}}${subject ? `\nSubject: ${subject}.` : ''}`;
}

function isValidQpContentBlock(block) {
  return block && (block.type === 'image' || block.type === 'document') &&
    block.source && block.source.type === 'base64' && block.source.media_type && block.source.data;
}

app.post('/api/question-paper-generate', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    }
    const { subject, lessonContent, oldPaper } = req.body || {};
    if (!isValidQpContentBlock(lessonContent) || !isValidQpContentBlock(oldPaper)) {
      return res.status(400).json({ error: 'Missing or invalid lessonContent/oldPaper attachment' });
    }

    const systemPrompt = buildQuestionPaperSystemPrompt(subject ? String(subject).trim().slice(0, 60) : null);
    const userContent = [
      { type: 'text', text: 'OLD QUESTION PAPER (style reference):' },
      oldPaper,
      { type: 'text', text: 'NEW LESSON CONTENT (generate the new papers from this):' },
      lessonContent
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error (question-paper-generate):', response.status, errText);
      return res.status(502).json({ error: 'Claude API returned an error', detail: errText });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';
    let papers;
    try {
      papers = JSON.parse(raw).papers;
      if (!papers) throw new Error('Response JSON had no "papers" key');
    } catch (parseErr) {
      console.error('Could not parse question-paper JSON:', parseErr.message, raw.slice(0, 500));
      return res.status(502).json({ error: 'Claude returned an unexpected response — please try again.' });
    }

    res.json({ ok: true, papers });
  } catch (err) {
    console.error('Question paper generate error:', err);
    res.status(500).json({ error: 'Server error generating question papers' });
  }
});

// Simple health check — useful for confirming the server is alive after deploy
app.get('/health', (req, res) => res.json({
  status: 'ok',
  supabase: !!supabase,
  email: !!(resend || mailer),
  emailProvider: resend ? 'resend' : (mailer ? 'gmail' : 'none')
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tut-P server running on port ${PORT}`);
});
