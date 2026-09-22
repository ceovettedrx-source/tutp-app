// A trivial, deliberate no-functional-effect line, added 2026-09-09 to force
// a genuinely new Cloud Run revision while proving out deploy.sh's traffic-
// pinning fix (see deploy.sh's own header comment for the full story).
import express from 'express';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { initializeApp as initializeFirebaseApp, getApps as getFirebaseApps } from 'firebase-admin/app';
import { getAuth as getFirebaseAuth } from 'firebase-admin/auth';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
import createMaterialRouter from './server/routes/teacher/create-material.js';
import { createRetryFetch } from './server/services/supabaseRetryFetch.js';
import {
  initTracking, trackSessionStarted, trackSessionCompleted,
  trackFeedbackSubmitted, trackFeedbackClassified, trackFeedbackAutoResolved, trackFeedbackEscalated,
  trackShareClicked
} from './tracking/tracking.js';
import { FEATURES } from './tracking/events.js';
import { classifyFeedback, autoResolveTooComplex, escalateToFounder } from './tracking/feedback-pipeline.js';
import { getCharacterSVG } from './server/services/illustration/characters.js';
import { buildIllustrationParsePrompt, validateParsedProblem, placeholderObjectSVG, NOT_A_MATH_PROBLEM } from './server/services/illustration/problemParser.js';

// Only needed to verify ID tokens (JWT signature + claims against Google's
// public certs) — no service-account credential required for that specific
// operation, so this works even though this Cloud Run service lives in a
// different GCP project than the Firebase project itself.
if (!getFirebaseApps().length) {
  initializeFirebaseApp({ projectId: 'tut-p-98978' });
}

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

async function sendEmail(to, subject, text) {
  if (resend) return resend.emails.send({ from: 'contact@tutp.online', to, subject, text });
  if (mailer) return mailer.sendMail({ from: process.env.GMAIL_USER, to, subject, text });
  console.error('No email transport configured — could not send:', subject);
}

async function sendWaitlistEmail(name, email) {
  const subject = "You're on the Tut-P waitlist! 🎉";
  const text = `Hi ${name},\n\nThanks for joining the Tut-P waitlist! We'll email you at ${email} the moment early access opens.\n\nIn the meantime, you can try our working demo here: https://tutp.online/demo/\n\n- The Tut-P team`;
  const html = `<p>Hi ${name},</p><p>Thanks for joining the Tut-P waitlist! We'll email you at <strong>${email}</strong> the moment early access opens.</p><p>In the meantime, you can try our working demo here: <a href="https://tutp.online/demo/">tutp.online/demo</a></p><p>— The Tut-P team</p>`;

  if (resend) {
    try {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM || 'Tut-P <contact@tutp.online>',
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
        from: process.env.RESEND_FROM || 'Tut-P <contact@tutp.online>',
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
// Play-Based Learning remote invite — best-effort, same non-blocking
// pattern as the two email senders above. Returns whether it actually
// sent, since the invite endpoint that calls this always mints a working
// join link regardless (family_member has no email on file at all, and
// mother/father's email is optional) and reports per-invitee delivery
// status rather than silently failing for anyone without an address.
// ------------------------------------------------------------------
async function sendGameInviteEmail(recipientName, recipientEmail, joinLink) {
  const subject = "You're invited to play on Tut-P!";
  const text = `Hi ${recipientName},\n\nYou've been invited to join a live Play-Based Learning game on Tut-P. Tap the link below, verify with a code sent to your phone, and you'll be dropped straight into the game:\n\n${joinLink}\n\nThis link expires in 2 hours.\n\n- The Tut-P team`;
  const html = `<p>Hi ${recipientName},</p><p>You've been invited to join a live Play-Based Learning game on Tut-P. Tap the link below, verify with a code sent to your phone, and you'll be dropped straight into the game:</p><p><a href="${joinLink}">${joinLink}</a></p><p>This link expires in 2 hours.</p><p>— The Tut-P team</p>`;

  if (resend) {
    try {
      const { error } = await resend.emails.send({ from: process.env.RESEND_FROM || 'Tut-P <contact@tutp.online>', to: recipientEmail, subject, text, html });
      if (error) throw new Error(JSON.stringify(error));
      console.log('Game invite email sent via Resend to', recipientEmail);
      return true;
    } catch (err) {
      console.error('Resend game invite failed:', err.message);
      return false;
    }
  }
  if (mailer) {
    try {
      await mailer.sendMail({ from: `"Tut-P" <${process.env.GMAIL_USER}>`, to: recipientEmail, subject, text, html });
      console.log('Game invite email sent via Gmail to', recipientEmail);
      return true;
    } catch (err) {
      console.error('Gmail game invite failed:', err.message);
      return false;
    }
  }
  return false;
}

// ------------------------------------------------------------------
// Evening homework digest — one email per family, grouped by teacher, so
// each pending item's section reads as coming from the teacher who
// actually posted it (name, subject, school) rather than a generic
// system notice. Still clearly marked as automated in the closing line —
// a parent replying to this reaches contact@tutp.online, not the teacher,
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
        from: process.env.RESEND_FROM || 'Tut-P <contact@tutp.online>',
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
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    global: { fetch: createRetryFetch() }
  });
  initTracking(supabase);
} else {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — waitlist and usage tracking are disabled.');
}

// The `verify` hook stashes the exact raw bytes for the Razorpay webhook
// route (req.rawBody) alongside the normally-parsed req.body — Razorpay's
// signature is an HMAC over the raw request bytes, and by the time a route
// handler runs after this middleware the raw stream is already consumed,
// so this is the one place that can still capture it.
app.use(compression());
app.use(express.json({
  // Client-recompressed photo uploads stay well under 12mb, but PDF
  // attachments (Storytelling/Play-Based/Experiential Learning, homework
  // AI Tutor) travel raw/uncompressed as base64 — a real scanned multi-page
  // homework PDF routinely lands in the 5-15mb range, so 12mb was too tight
  // and silently 413'd those requests.
  limit: '20mb',
  verify: (req, res, buf) => {
    if (req.originalUrl === '/api/webhooks/razorpay' || req.originalUrl === '/api/razorpay-webhook') req.rawBody = buf;
  }
}));
app.use(express.static(path.join(__dirname, 'public'), {
  // express.static's default Cache-Control is "public, max-age=0" — "public"
  // still permits an intermediate cache (e.g. a mobile carrier's compressing/
  // accelerating proxy) to store the response and, if it misbehaves, serve it
  // without revalidating, which is how one device can end up on a stale app
  // shell while another sees the current deploy. "no-cache" removes that
  // ambiguity: any compliant cache must revalidate (via ETag) before reuse.
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.css')) {
      // /css/tailwind.css is a fixed filename rebuilt on every deploy (no
      // content hash), so a long max-age risks a returning browser holding
      // stale CSS past a redeploy. "must-revalidate" keeps that safe: a
      // fresh copy is served immediately from cache for a day, then the
      // browser must check back with the server (a cheap 304 if unchanged)
      // rather than silently reusing a possibly-stale copy indefinitely.
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  }
}));
app.use(cookieParser());

// ------------------------------------------------------------------
// Session cookie — established once at login/registration (see
// POST /api/session below) after verifying a real Firebase ID token, then
// used on every family/student/teacher-scoped route to check the requested
// id actually belongs to the caller. Firebase Auth itself is otherwise only
// a one-shot OTP step in this app (nothing else calls verifyIdToken or
// checks Firebase auth state), so this cookie — not Firebase's own session —
// is what "logged in" actually means for API access.
//
// Sliding 30-day expiration: the refresh middleware below reissues a
// fresh-dated cookie on every request that carries a still-valid one, so
// active use never re-prompts OTP — only genuine 30-day inactivity (or a
// cleared cookie) lets the token actually expire.
// ------------------------------------------------------------------
const SESSION_COOKIE_NAME = 'tutp_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set — session cookies cannot be issued or verified; all family/student/teacher-scoped routes will reject every request.');
}

function issueSessionCookie(res, payload) {
  const token = jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS
  });
}

// Returns { phone, familyId, teacherId } for a valid, unexpired cookie, or
// null otherwise (missing, tampered, or expired) — callers treat null as
// "not logged in" and reject, never as "logged in with no ids."
function getSession(req) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token || !process.env.SESSION_SECRET) return null;
  try {
    const { phone, familyId, teacherId } = jwt.verify(token, process.env.SESSION_SECRET);
    return { phone, familyId: familyId ?? null, teacherId: teacherId ?? null };
  } catch (err) {
    return null;
  }
}

app.use((req, res, next) => {
  const session = getSession(req);
  if (session) issueSessionCookie(res, session);
  next();
});

// The session cookie is httpOnly (client JS can't clear it directly), so a
// real logout needs a server round-trip — clearing sessionStorage alone
// leaves this cookie valid until its 30-day sliding expiry, silently
// re-authenticating whoever's browser it is. No session check here: logging
// out an already-logged-out browser is harmless, and requiring a valid
// session first would just fail the exact request meant to end one.
app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

function requireOwnFamily(req, res, familyId) {
  const session = getSession(req);
  if (!session || !Number.isFinite(familyId) || session.familyId !== familyId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return session;
}

function requireOwnTeacher(req, res, teacherId) {
  const session = getSession(req);
  if (!session || !teacherId || String(session.teacherId) !== String(teacherId)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return session;
}

// ------------------------------------------------------------------
// Admin auth — a browser-friendly cookie session on top of the existing
// ADMIN_TOKEN shared secret, so the founder doesn't have to paste
// ?token=... into every admin URL by hand. The query-string path stays
// supported everywhere it's used today (cron/external tools may already
// depend on it), so requireAdmin below accepts either.
// ------------------------------------------------------------------
const ADMIN_COOKIE_NAME = 'tutp_admin';
const ADMIN_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head><title>Tut-P Admin Login</title></head>
<body>
  <h1>Admin Login</h1>
  <form id="loginForm">
    <input type="password" id="token" placeholder="Admin token" required>
    <button type="submit">Log in</button>
  </form>
  <p id="err" style="color:red;display:none;"></p>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('token').value;
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        window.location.href = '/admin/dashboard';
      } else {
        const errEl = document.getElementById('err');
        errEl.textContent = 'Incorrect token.';
        errEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`);
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait 15 minutes and try again.' }
});

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const { token } = req.body || {};
  if (!process.env.ADMIN_TOKEN || String(token || '').trim() !== process.env.ADMIN_TOKEN.trim()) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!process.env.SESSION_SECRET) {
    return res.status(500).json({ error: 'Server is missing SESSION_SECRET configuration' });
  }
  const signed = jwt.sign({ admin: true }, process.env.SESSION_SECRET, { expiresIn: '7d' });
  res.cookie(ADMIN_COOKIE_NAME, signed, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ADMIN_COOKIE_MAX_AGE_MS
  });
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  const cookieToken = req.cookies?.[ADMIN_COOKIE_NAME];
  if (cookieToken && process.env.SESSION_SECRET) {
    try {
      const decoded = jwt.verify(cookieToken, process.env.SESSION_SECRET);
      if (decoded.admin) return next();
    } catch (err) {
      // Invalid/expired cookie — fall through to the query-token check.
    }
  }
  if (process.env.ADMIN_TOKEN && String(req.query.token || '').trim() === process.env.ADMIN_TOKEN.trim()) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

app.get('/api/admin/kpis', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const now = new Date();
    const startOfTodayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const startOfMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const [signupsRes, dauRes, revenueRes, failedPaymentsRes, activePaidRes] = await Promise.all([
      supabase.from('family_registrations').select('*', { count: 'exact', head: true }),
      supabase.from('usage_events').select('family_id').eq('event_name', 'session.started').gte('created_at', startOfTodayUTC),
      supabase.from('payments').select('amount').eq('status', 'captured').gte('created_at', startOfMonthUTC),
      supabase.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', startOfMonthUTC),
      // Lifetime, not just this month — every family_registrations row that
      // has ever had a captured payment, regardless of when.
      supabase.from('payments').select('student_id').eq('status', 'captured')
    ]);
    if (signupsRes.error) throw signupsRes.error;
    if (dauRes.error) throw dauRes.error;
    if (revenueRes.error) throw revenueRes.error;
    if (failedPaymentsRes.error) throw failedPaymentsRes.error;
    if (activePaidRes.error) throw activePaidRes.error;

    // Supabase-js has no COUNT(DISTINCT col) — dedupe client-side over the
    // (small, already status-filtered) row set instead. Nulls excluded to
    // match SQL's COUNT(DISTINCT) semantics (student_id is nullable —
    // 017_payments_student_id.sql — for payments made before per-child
    // billing started populating it).
    const todayDau = new Set((dauRes.data || []).map(r => r.family_id)).size;
    const activePaidUsers = new Set((activePaidRes.data || []).map(r => r.student_id).filter(Boolean)).size;
    const mtdRevenue = (revenueRes.data || []).reduce((sum, r) => sum + (r.amount || 0), 0) / 100;

    res.json({
      totalSignups: signupsRes.count,
      todayDau,
      mtdRevenue,
      failedPayments: failedPaymentsRes.count,
      activePaidUsers
    });
  } catch (err) {
    console.error('Admin KPIs error:', err);
    res.status(500).json({ error: 'Could not load KPIs' });
  }
});

// 14-day signup breakdown + all-time UTM source breakdown for the admin
// dashboard's "Signups" section. dailyBreakdown is zero-filled to exactly
// 14 rows (today first), same pattern as Revenue/Engagement's daily
// breakdowns — Supabase-js has no GROUP BY, so both groupings happen
// client-side. Rows registered before UTM capture existed have no
// data.utm.source and fall back to 'direct', same as a real direct visit.
app.get('/api/admin/signups', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const now = new Date();
    const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Array.from({ length: 14 }, (_, i) => new Date(startOfTodayUTC - i * 86400000).toISOString().slice(0, 10));
    const windowStartUTC = new Date(startOfTodayUTC - 13 * 86400000).toISOString();

    const [recentRes, allRes] = await Promise.all([
      supabase.from('family_registrations').select('created_at').gte('created_at', windowStartUTC),
      supabase.from('family_registrations').select('data')
    ]);
    if (recentRes.error) throw recentRes.error;
    if (allRes.error) throw allRes.error;

    const byDate = {};
    for (const date of days) byDate[date] = 0;
    for (const row of recentRes.data || []) {
      const date = row.created_at.slice(0, 10);
      if (date in byDate) byDate[date] += 1;
    }
    const dailyBreakdown = days.map(date => ({ date, count: byDate[date] }));

    const sourceCounts = {};
    for (const row of allRes.data || []) {
      const source = row.data?.utm?.source || 'direct';
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    }
    const utmBreakdown = Object.entries(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ dailyBreakdown, utmBreakdown });
  } catch (err) {
    console.error('Admin signups error:', err);
    res.status(500).json({ error: 'Could not load signups' });
  }
});

// Feature-usage bars + 14-day DAU for the admin dashboard's "Engagement"
// section. dailyActiveUsers is zero-filled to exactly 14 rows (today first),
// same pattern as the Revenue route's dailyBreakdown — Supabase-js has no
// GROUP BY or COUNT(DISTINCT ...), so both the per-day distinct family_id
// count and the per-feature event count are computed client-side.
// Activation Rate for the admin dashboard's "Activation" section: the % of
// families that registered in the last 30 days and had at least one
// session.started usage_event within 7 days of signing up — did a new
// signup actually experience the core product in its first week, not just
// register and vanish.
app.get('/api/admin/activation', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const thirtyDaysAgoUTC = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: families, error: familiesErr } = await supabase
      .from('family_registrations')
      .select('id, created_at')
      .gte('created_at', thirtyDaysAgoUTC);
    if (familiesErr) throw familiesErr;

    const total = (families || []).length;
    if (!total) return res.json({ rate: 0, activated: 0, total: 0 });

    const familyIds = families.map(f => f.id);
    const { data: sessionEvents, error: eventsErr } = await supabase
      .from('usage_events')
      .select('family_id, created_at')
      .eq('event_name', 'session.started')
      .in('family_id', familyIds);
    if (eventsErr) throw eventsErr;

    // Only the earliest session.started per family matters for "activated
    // within 7 days of signup".
    const earliestByFamily = {};
    for (const ev of sessionEvents || []) {
      if (ev.family_id == null) continue;
      const t = new Date(ev.created_at).getTime();
      if (!(ev.family_id in earliestByFamily) || t < earliestByFamily[ev.family_id]) {
        earliestByFamily[ev.family_id] = t;
      }
    }

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    let activated = 0;
    for (const family of families) {
      const signupTime = new Date(family.created_at).getTime();
      const firstSession = earliestByFamily[family.id];
      if (firstSession != null && firstSession - signupTime <= SEVEN_DAYS_MS) activated += 1;
    }

    res.json({ rate: activated / total, activated, total });
  } catch (err) {
    console.error('Admin activation error:', err);
    res.status(500).json({ error: 'Could not load activation rate' });
  }
});

app.get('/api/admin/engagement', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const now = new Date();
    const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Array.from({ length: 14 }, (_, i) => new Date(startOfTodayUTC - i * 86400000).toISOString().slice(0, 10));
    const windowStartUTC = new Date(startOfTodayUTC - 13 * 86400000).toISOString();

    const [dauRes, featureRes] = await Promise.all([
      supabase.from('usage_events').select('family_id, created_at').eq('event_name', 'session.started').gte('created_at', windowStartUTC),
      supabase.from('usage_events').select('properties').eq('event_name', 'session.started')
    ]);
    if (dauRes.error) throw dauRes.error;
    if (featureRes.error) throw featureRes.error;

    const byDate = {};
    for (const date of days) byDate[date] = new Set();
    for (const row of dauRes.data || []) {
      const families = byDate[row.created_at.slice(0, 10)];
      if (families && row.family_id != null) families.add(row.family_id);
    }
    const dailyActiveUsers = days.map(date => ({ date, dau: byDate[date].size }));

    const counts = Object.fromEntries(Object.values(FEATURES).map(f => [f, 0]));
    for (const row of featureRes.data || []) {
      const feature = row.properties?.feature;
      if (feature && Object.prototype.hasOwnProperty.call(counts, feature)) counts[feature] += 1;
    }
    const featureUsage = Object.values(FEATURES).map(feature => ({ feature, count: counts[feature] }));

    res.json({ dailyActiveUsers, featureUsage });
  } catch (err) {
    console.error('Admin engagement error:', err);
    res.status(500).json({ error: 'Could not load engagement' });
  }
});

// Recent feedback escalations + 30-day funnel counts for the admin
// dashboard's "Parent Feedback" section — mother's name wins over father's
// when both are present, same fallback pattern as Failed Payments.
app.get('/api/admin/feedback-escalations', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const thirtyDaysAgoUTC = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [escalationsRes, summaryRes] = await Promise.all([
      supabase.from('usage_events')
        .select('properties, created_at, students(name), family_registrations(data)')
        .eq('event_name', 'feedback.escalated')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('usage_events')
        .select('event_name')
        .in('event_name', ['feedback.submitted', 'feedback.auto_resolved', 'feedback.escalated'])
        .gte('created_at', thirtyDaysAgoUTC)
    ]);
    if (escalationsRes.error) throw escalationsRes.error;
    if (summaryRes.error) throw summaryRes.error;

    const recentEscalations = (escalationsRes.data || []).map(e => {
      const familyData = e.family_registrations?.data || {};
      return {
        familyName: familyData.mother?.name || familyData.father?.name || null,
        studentName: e.students?.name || null,
        category: e.properties?.category || null,
        createdAt: e.created_at
      };
    });

    const summary = { submitted: 0, autoResolved: 0, escalated: 0 };
    for (const row of summaryRes.data || []) {
      if (row.event_name === 'feedback.submitted') summary.submitted += 1;
      else if (row.event_name === 'feedback.auto_resolved') summary.autoResolved += 1;
      else if (row.event_name === 'feedback.escalated') summary.escalated += 1;
    }

    res.json({ recentEscalations, summary });
  } catch (err) {
    console.error('Admin feedback-escalations error:', err);
    res.status(500).json({ error: 'Could not load feedback escalations' });
  }
});

// Revenue summary + 14-day daily breakdown for the admin dashboard's
// "Revenue" section. dailyBreakdown always returns exactly 14 rows (today
// first), zero-filled for days with no captured/failed activity — Supabase-js
// has no GROUP BY, so grouping by the UTC date portion of created_at happens
// client-side over the (small, 14-day) row set.
app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const now = new Date();
    const startOfMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Array.from({ length: 14 }, (_, i) => new Date(startOfTodayUTC - i * 86400000).toISOString().slice(0, 10));
    const windowStartUTC = new Date(startOfTodayUTC - 13 * 86400000).toISOString();

    const [totalRes, mtdRes, recentRes] = await Promise.all([
      supabase.from('payments').select('amount').eq('status', 'captured'),
      supabase.from('payments').select('amount').eq('status', 'captured').gte('created_at', startOfMonthUTC),
      supabase.from('payments').select('amount, status, created_at').gte('created_at', windowStartUTC).in('status', ['captured', 'failed'])
    ]);
    if (totalRes.error) throw totalRes.error;
    if (mtdRes.error) throw mtdRes.error;
    if (recentRes.error) throw recentRes.error;

    const totalRevenue = (totalRes.data || []).reduce((sum, r) => sum + (r.amount || 0), 0) / 100;
    const mtdRevenue = (mtdRes.data || []).reduce((sum, r) => sum + (r.amount || 0), 0) / 100;

    const byDate = {};
    for (const date of days) byDate[date] = { date, capturedAmount: 0, capturedCount: 0, failedCount: 0 };
    for (const row of recentRes.data || []) {
      const day = byDate[row.created_at.slice(0, 10)];
      if (!day) continue;
      if (row.status === 'captured') {
        day.capturedAmount += (row.amount || 0) / 100;
        day.capturedCount += 1;
      } else if (row.status === 'failed') {
        day.failedCount += 1;
      }
    }
    const dailyBreakdown = days.map(d => byDate[d]);

    res.json({ totalRevenue, mtdRevenue, dailyBreakdown });
  } catch (err) {
    console.error('Admin revenue error:', err);
    res.status(500).json({ error: 'Could not load revenue' });
  }
});

// Recent failed payments for the admin dashboard's "Failed Payments" table —
// mother's name wins over father's when both are present, matching how the
// family is otherwise referred to across admin views.
app.get('/api/admin/failed-payments', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const { data, error } = await supabase
      .from('payments')
      .select('tier, amount, razorpay_order_id, created_at, students(name), family_registrations(data)')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const rows = (data || []).map(p => {
      const familyData = p.family_registrations?.data || {};
      return {
        familyName: familyData.mother?.name || familyData.father?.name || null,
        studentName: p.students?.name || null,
        tier: p.tier,
        amount: (p.amount || 0) / 100,
        razorpayOrderId: p.razorpay_order_id,
        createdAt: p.created_at
      };
    });

    res.json(rows);
  } catch (err) {
    console.error('Admin failed-payments error:', err);
    res.status(500).json({ error: 'Could not load failed payments' });
  }
});

// ------------------------------------------------------------------
// Tutors directory — admin-managed listings (see 020_tutors.sql). The
// contact-request-with-payment flow (tutor_contact_requests) is a
// separate, parent-facing piece, not part of this admin CRUD.
// ------------------------------------------------------------------
const TUTOR_CATEGORIES = ['online', 'area_wise', 'home_tuition'];
const TUTOR_VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'];

function parseTutorSubjects(subjects) {
  return Array.isArray(subjects)
    ? subjects.map(s => String(s).trim()).filter(Boolean)
    : String(subjects || '').split(',').map(s => s.trim()).filter(Boolean);
}

app.get('/api/admin/tutors', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data, error } = await supabase.from('tutors').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ tutors: data || [] });
  } catch (err) {
    console.error('Admin tutors list error:', err);
    res.status(500).json({ error: 'Could not load tutors' });
  }
});

app.post('/api/admin/tutors', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { name, photoUrl, category, subjects, experienceYears, feeDisplay, area, bio, phone } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'phone is required' });
    if (!TUTOR_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'category must be one of ' + TUTOR_CATEGORIES.join(', ') });
    }

    // verified_by is deliberately not settable at creation — it's the
    // founder's own record of how/when verification happened, so it only
    // gets written via the PATCH route once a real check has taken place.
    const { data, error } = await supabase.from('tutors').insert({
      name: String(name).trim(),
      photo_url: photoUrl || null,
      category,
      subjects: parseTutorSubjects(subjects),
      experience_years: experienceYears !== undefined && experienceYears !== '' ? Number(experienceYears) : null,
      fee_display: feeDisplay || null,
      area: area || null,
      bio: bio || null,
      phone: String(phone).trim()
    }).select().single();
    if (error) throw error;
    res.json({ tutor: data });
  } catch (err) {
    console.error('Admin tutor create error:', err);
    res.status(500).json({ error: 'Could not create tutor' });
  }
});

app.patch('/api/admin/tutors/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { name, photoUrl, category, subjects, experienceYears, feeDisplay, area, bio, phone, verifiedBy, verificationStatus, isActive } = req.body || {};

    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (photoUrl !== undefined) updates.photo_url = photoUrl || null;
    if (category !== undefined) {
      if (!TUTOR_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'category must be one of ' + TUTOR_CATEGORIES.join(', ') });
      }
      updates.category = category;
    }
    if (subjects !== undefined) updates.subjects = parseTutorSubjects(subjects);
    if (experienceYears !== undefined) updates.experience_years = (experienceYears === '' || experienceYears === null) ? null : Number(experienceYears);
    if (feeDisplay !== undefined) updates.fee_display = feeDisplay || null;
    if (area !== undefined) updates.area = area || null;
    if (bio !== undefined) updates.bio = bio || null;
    if (phone !== undefined) {
      if (!String(phone).trim()) return res.status(400).json({ error: 'phone cannot be empty' });
      updates.phone = String(phone).trim();
    }
    if (verifiedBy !== undefined) updates.verified_by = verifiedBy || null;
    if (verificationStatus !== undefined) {
      if (!TUTOR_VERIFICATION_STATUSES.includes(verificationStatus)) {
        return res.status(400).json({ error: 'verificationStatus must be one of ' + TUTOR_VERIFICATION_STATUSES.join(', ') });
      }
      updates.verification_status = verificationStatus;
    }
    if (isActive !== undefined) updates.is_active = !!isActive;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const { data, error } = await supabase.from('tutors').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ tutor: data });
  } catch (err) {
    console.error('Admin tutor update error:', err);
    res.status(500).json({ error: 'Could not update tutor' });
  }
});

// Public tutor directory feed — unauthenticated (unlike the /api/admin/tutors
// routes above), so it only ever returns listings a parent should actually
// see: active AND verified. phone is deliberately left out of the select —
// Phase 1 has no masked-call layer yet, so the raw number must never reach
// the client here regardless of verification/active state.
app.get('/api/tutors', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data, error } = await supabase.from('tutors')
      .select('id, name, photo_url, category, subjects, experience_years, fee_display, area, bio, verification_status')
      .eq('is_active', true)
      .eq('verification_status', 'verified')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ tutors: data || [] });
  } catch (err) {
    console.error('Public tutors list error:', err);
    res.status(500).json({ error: 'Could not load tutors' });
  }
});

// ------------------------------------------------------------------
// Starts the ₹100 tutor-contact fee checkout (Phase 1's pay-to-connect
// flow, referenced in the /tutors comment above). Requires a logged-in
// family — /tutors itself has no login gate, so this is the first point
// that needs one; login_required is a distinct error code (not just a
// generic 401) so the client can tell "not logged in" apart from any other
// failure and redirect to login rather than showing a payment error.
// Same razorpay.orders.create + payments-row-insert shape as /api/register,
// just against tutor_contact_requests instead of payments. The actual
// status transition to 'paid' happens via /api/razorpay-webhook once
// payment.captured fires, not here.
// ------------------------------------------------------------------
app.post('/api/tutor-contact/create-order', async (req, res) => {
  try {
    const session = getSession(req);
    if (!session?.familyId) return res.status(401).json({ error: 'login_required' });
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    if (!razorpay) return res.status(500).json({ error: 'Payments are not configured' });

    const { tutorId } = req.body || {};
    const { data: tutor, error: tutorErr } = await supabase.from('tutors')
      .select('id, name, is_active, verification_status').eq('id', tutorId).maybeSingle();
    if (tutorErr) throw tutorErr;
    if (!tutor || !tutor.is_active || tutor.verification_status !== 'verified') {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const amount = 10000; // ₹100 contact fee, in paise
    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      // Razorpay caps receipt length (56 chars) — tutor.id alone is a 36-char
      // UUID, so a full family/tutor/timestamp receipt overflows it and the
      // order.create() call fails outright. notes below already carries the
      // full, untruncated identifiers, so receipt only needs to be short and
      // unique, not human-decodable.
      receipt: `tc_${session.familyId}_${tutor.id.slice(0, 8)}_${Date.now().toString(36)}`,
      notes: { family_id: String(session.familyId), tutor_id: tutor.id }
    });

    const { error: insertErr } = await supabase.from('tutor_contact_requests').insert({
      family_id: session.familyId, tutor_id: tutor.id, razorpay_order_id: order.id, status: 'created'
    });
    if (insertErr) throw insertErr;

    res.json({ orderId: order.id, amount, currency: 'INR', razorpayKeyId: process.env.RAZORPAY_KEY_ID, tutorName: tutor.name });
  } catch (err) {
    console.error('Tutor-contact create-order error:', err);
    res.status(500).json({ error: 'Could not start payment' });
  }
});

// ------------------------------------------------------------------
// Public tutor discovery page — no login required. Self-contained
// (Tailwind Play CDN, not the built /css/tailwind.css) since this isn't
// in the build pipeline yet; worth moving over if/when this page graduates
// past Phase 1. "Contact tutor" only logs to console for now — the ₹100
// checkout flow is the next piece, not built here.
// ------------------------------------------------------------------
app.get('/tutors', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Find a Tutor — Tut-P</title>
<meta name="description" content="Connect directly with tutors near you or online — no agency markup, just a one-time ₹100 contact fee."/>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Plus+Jakarta+Sans:wght@600;700;800&amp;display=swap" onload="this.onload=null;this.rel='stylesheet'" rel="preload"/>
<noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Plus+Jakarta+Sans:wght@600;700;800&amp;display=swap" rel="stylesheet"/></noscript>
<link as="style" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" onload="this.onload=null;this.rel='stylesheet'" rel="preload"/>
<noscript><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/></noscript>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: { ink: '#1F3D31', paper: '#F7F5EF', accent: '#E8A33D', brand: '#005BBF' },
        fontFamily: {
          headline: ['"Plus Jakarta Sans"', 'sans-serif'],
          body: ['Inter', 'sans-serif']
        }
      }
    }
  }
</script>
<style>
  body { font-family: 'Inter', sans-serif; }
  .material-symbols-outlined { font-variation-settings: 'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24; }

  .filter-chip {
    font-family: Inter, sans-serif; font-size: 14px; font-weight: 600;
    padding: 9px 20px; border-radius: 999px; border: 1px solid rgba(31,61,49,0.2);
    background: #fff; color: #1F3D31; cursor: pointer; transition: all 0.15s ease;
  }
  .filter-chip.chip-active { background: #005BBF; border-color: #005BBF; color: #fff; }

  .tutor-card {
    background: #fff; border-radius: 20px; padding: 20px;
    box-shadow: 0 1px 3px rgba(31,61,49,0.10), 0 1px 2px rgba(31,61,49,0.06);
    display: flex; flex-direction: column; gap: 14px;
  }
  .avatar-circle {
    width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: #005BBF; color: #fff; font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 700; font-size: 16px;
  }
  .verified-pill {
    display: inline-flex; align-items: center; gap: 3px; font-family: Inter, sans-serif;
    font-size: 11px; font-weight: 700; color: #8a5a16; background: rgba(232,163,61,0.18);
    padding: 2px 9px; border-radius: 999px; white-space: nowrap;
  }
  .verified-pill .material-symbols-outlined { font-size: 13px; }
  .subject-chip {
    font-family: Inter, sans-serif; font-size: 12px; font-weight: 500; color: rgba(31,61,49,0.8);
    background: rgba(31,61,49,0.06); padding: 4px 11px; border-radius: 999px;
  }
  .info-row {
    display: flex; align-items: center; gap: 8px; font-family: Inter, sans-serif;
    font-size: 13px; color: rgba(31,61,49,0.75);
  }
  .info-row .material-symbols-outlined { font-size: 18px; color: rgba(31,61,49,0.5); }
  .info-row.fee-row { font-weight: 700; color: #1F3D31; }
  .info-row.fee-row .material-symbols-outlined { color: #1F3D31; }
  .bio-box {
    display: flex; gap: 8px; background: rgba(232,163,61,0.10); border-radius: 12px;
    padding: 12px 14px;
  }
  .bio-box .material-symbols-outlined { font-size: 18px; color: #E8A33D; flex-shrink: 0; }
  .bio-box p {
    font-family: Inter, sans-serif; font-size: 13px; font-style: italic;
    color: rgba(31,61,49,0.8); line-height: 1.4;
  }
  .contact-tutor-btn {
    width: 100%; background: #005BBF; color: #fff; font-family: Inter, sans-serif;
    font-weight: 600; font-size: 14px; padding: 12px 18px; border-radius: 999px; border: none;
    cursor: pointer; transition: background 0.15s ease; margin-top: auto;
  }
  .contact-tutor-btn:hover { background: #00479c; }

  .empty-state {
    grid-column: 1 / -1; text-align: center; padding: 56px 20px;
  }
  .empty-state .material-symbols-outlined { font-size: 32px; color: rgba(31,61,49,0.3); }
  .empty-state p { font-family: Inter, sans-serif; font-size: 14px; color: rgba(31,61,49,0.55); margin-top: 8px; }

  .contact-status-banner {
    max-width: 640px; margin: 0 auto; padding: 12px 18px; border-radius: 10px;
    font-family: Inter, sans-serif; font-size: 14px; text-align: center;
  }
  .contact-status-success { background: #e6f4ea; color: #0a7a3d; }
  .contact-status-neutral { background: #f0f0ec; color: #1F3D31; }
</style>
</head>
<body class="bg-paper">

  <header class="px-6 md:px-10 pt-8">
    <div class="max-w-5xl mx-auto">
      <a href="/" class="font-headline text-ink font-bold text-base tracking-tight">Tut-P</a>
    </div>
  </header>

  <div class="px-6 md:px-10 pt-4">
    <p id="contactStatusBanner" class="contact-status-banner hidden"></p>
  </div>

  <section class="px-6 md:px-10 pt-8 pb-8 text-center">
    <div class="max-w-2xl mx-auto">
      <h1 class="font-headline text-ink font-extrabold text-3xl md:text-4xl leading-tight">Great tutors, fairly paid.</h1>
      <p class="font-body text-ink/70 text-sm md:text-base mt-3 leading-relaxed">No agency markup, no recurring commission — you connect directly with the tutor for a one-time ₹100 contact fee, and what you pay the tutor after that is between the two of you.</p>
    </div>
  </section>

  <section class="px-6 md:px-10">
    <div class="max-w-5xl mx-auto flex gap-3 justify-center flex-wrap" id="categoryChips">
      <button type="button" class="filter-chip chip-active" data-category="online">Online</button>
      <button type="button" class="filter-chip" data-category="area_wise">Near You</button>
      <button type="button" class="filter-chip" data-category="home_tuition">Home Tuition</button>
    </div>
  </section>

  <section class="px-6 md:px-10 py-10">
    <div class="max-w-5xl mx-auto">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" id="tutorsGrid">
        <p class="font-body text-center text-sm text-ink/50 py-16" style="grid-column:1/-1;">Loading tutors…</p>
      </div>
    </div>
  </section>

  <script>
    let allTutors = [];
    let activeCategory = 'online';
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    function initialsOf(name){
      return String(name || '?').trim().split(/\\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    }

    function tutorCardHtml(t){
      const verifiedPill = t.verification_status === 'verified'
        ? '<span class="verified-pill"><span class="material-symbols-outlined">verified</span>Verified</span>'
        : '';
      const subjectsHtml = (t.subjects && t.subjects.length)
        ? t.subjects.map(s => '<span class="subject-chip">' + escapeHtml(s) + '</span>').join('')
        : '<span class="subject-chip">Subjects not listed</span>';
      const expText = t.experience_years != null ? escapeHtml(t.experience_years) + ' yrs experience' : 'Experience not listed';
      const areaRow = (t.category === 'area_wise' && t.area)
        ? '<div class="info-row"><span class="material-symbols-outlined">place</span>' + escapeHtml(t.area) + '</div>'
        : '';
      const bio = t.bio && String(t.bio).trim();
      const bioHtml = bio
        ? '<div class="bio-box"><span class="material-symbols-outlined">format_quote</span><p>' + escapeHtml(bio) + '</p></div>'
        : '';
      return (
        '<div class="tutor-card">' +
          '<div class="flex items-start gap-3">' +
            '<div class="avatar-circle">' + escapeHtml(initialsOf(t.name)) + '</div>' +
            '<div class="min-w-0 flex-1">' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                '<h3 class="font-headline text-base font-bold text-ink truncate">' + escapeHtml(t.name) + '</h3>' +
                verifiedPill +
              '</div>' +
              '<div class="flex flex-wrap gap-1.5 mt-2">' + subjectsHtml + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="info-row"><span class="material-symbols-outlined">work_history</span>' + expText + '</div>' +
          '<div class="info-row fee-row"><span class="material-symbols-outlined">payments</span>' + escapeHtml(t.fee_display || 'Fee on request') + '</div>' +
          areaRow +
          bioHtml +
          '<button type="button" class="contact-tutor-btn" data-tutor-id="' + escapeHtml(t.id) + '" data-tutor-name="' + escapeHtml(t.name) + '">Contact tutor</button>' +
        '</div>'
      );
    }

    function renderTutors(){
      const grid = document.getElementById('tutorsGrid');
      const filtered = allTutors.filter(t => t.category === activeCategory);
      if (!filtered.length) {
        grid.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">search_off</span><p>New tutors join every week — check back soon.</p></div>';
        return;
      }
      grid.innerHTML = filtered.map(tutorCardHtml).join('');
      grid.querySelectorAll('.contact-tutor-btn').forEach(btn => {
        btn.addEventListener('click', () => startContactFlow(btn.getAttribute('data-tutor-id')));
      });
    }

    function showContactStatus(message, variant){
      const el = document.getElementById('contactStatusBanner');
      el.textContent = message;
      el.className = 'contact-status-banner ' + (variant === 'success' ? 'contact-status-success' : 'contact-status-neutral');
    }

    // Shared by a direct "Contact tutor" click and the ?resumeContact= path
    // below (same-origin login round-trip via /app/login/'s dashboards —
    // see checkPendingTutorContact there) so there's exactly one place that
    // creates the order and opens Checkout.js, same shape as register/
    // index.html's runPaymentQueue but for a single one-off order.
    async function startContactFlow(tutorId){
      try {
        const res = await fetch('/api/tutor-contact/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tutorId })
        });
        const data = await res.json();
        if (res.status === 401 && data.error === 'login_required') {
          sessionStorage.setItem('tutp_pending_tutor_contact', tutorId);
          sessionStorage.setItem('tutp_pending_tutor_contact_ts', String(Date.now()));
          window.location.href = '/app/login/';
          return;
        }
        if (!res.ok) throw new Error(data.error || 'Could not start payment');

        const rzp = new Razorpay({
          key: data.razorpayKeyId,
          order_id: data.orderId,
          amount: data.amount,
          currency: data.currency,
          name: 'Tut-P',
          description: 'Contact fee — ' + data.tutorName,
          handler: function(){
            showContactStatus("Payment received — we'll connect you with " + data.tutorName + ' within 24 hours.', 'success');
          },
          modal: {
            ondismiss: function(){
              showContactStatus('Payment not completed — you can try again anytime.', 'neutral');
            }
          }
        });
        rzp.open();
      } catch (err) {
        console.error('[tutors] Could not start contact payment:', err);
        showContactStatus(err.message || 'Could not start payment — please try again.', 'neutral');
      }
    }

    document.querySelectorAll('#categoryChips .filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.getAttribute('data-category');
        document.querySelectorAll('#categoryChips .filter-chip').forEach(b => b.classList.remove('chip-active'));
        btn.classList.add('chip-active');
        renderTutors();
      });
    });

    (async function loadTutors(){
      try {
        const res = await fetch('/api/tutors');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const data = await res.json();
        allTutors = data.tutors || [];
      } catch (err) {
        console.error('[tutors] Could not load tutors:', err);
        allTutors = [];
      } finally {
        renderTutors();
        // Landed back here from /app/login/'s checkPendingTutorContact
        // redirect — resume the same flow a "Contact tutor" click would
        // have started, without making the parent find and click it again.
        // Stripped from the URL immediately so a later refresh/back doesn't
        // re-trigger a second order for the same tutor.
        const resumeTutorId = new URLSearchParams(location.search).get('resumeContact');
        if (resumeTutorId) {
          history.replaceState({}, '', location.pathname);
          startContactFlow(resumeTutorId);
        }
      }
    })();
  </script>
</body>
</html>`);
});

app.get('/admin/dashboard', requireAdmin, (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<title>Tut-P Admin Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    padding: 24px;
    background: #f5f6f8;
    color: #1a1a1a;
  }
  h1 { font-size: 20px; margin: 0 0 20px; }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 16px;
  }
  @media (max-width: 900px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .kpi-card {
    background: #fff;
    border: 1px solid #e2e5e9;
    border-radius: 10px;
    padding: 16px 18px;
  }
  .kpi-label {
    font-size: 12px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin: 0 0 8px;
  }
  .kpi-value {
    font-size: 28px;
    font-weight: 700;
    color: #005bbf;
    margin: 0;
  }
  .kpi-value.loading, .kpi-value.error { color: #999; font-size: 16px; font-weight: 400; }
  .section-title { font-size: 16px; margin: 32px 0 12px; }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    margin-bottom: 16px;
  }
  @media (max-width: 900px) {
    .summary-grid { grid-template-columns: 1fr; }
  }
  .summary-grid-3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 16px;
  }
  @media (max-width: 900px) {
    .summary-grid-3 { grid-template-columns: 1fr; }
  }
  .panel {
    background: #fff;
    border: 1px solid #e2e5e9;
    border-radius: 10px;
    padding: 16px 18px;
  }
  .panel-message { color: #666; font-size: 14px; margin: 0; }
  .panel + .panel { margin-top: 16px; }
  .bar-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .bar-row + .bar-row { margin-top: 10px; }
  .bar-label { width: 170px; flex-shrink: 0; color: #444; }
  .bar-track { flex: 1; background: #eef1f5; border-radius: 4px; overflow: hidden; height: 18px; }
  .bar-fill { background: #005bbf; height: 100%; }
  .bar-count { width: 36px; flex-shrink: 0; text-align: right; color: #666; font-size: 12px; }
  table.data-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.data-table th, table.data-table td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid #e2e5e9;
  }
  table.data-table th {
    font-size: 12px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  table.data-table td.amount { color: #005bbf; font-weight: 700; }
  .form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px; }
  @media (max-width: 900px) { .form-grid { grid-template-columns: 1fr; } }
  .form-grid input, .form-grid select, .form-grid textarea {
    font-family: inherit; font-size: 14px; padding: 8px 10px;
    border: 1px solid #d7dbe1; border-radius: 6px; width: 100%;
  }
  .form-grid textarea { grid-column: 1 / -1; resize: vertical; }
  .btn-primary {
    background: #005bbf; color: #fff; border: none; border-radius: 6px;
    padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .btn-primary:hover { background: #004a99; }
  .btn-toggle {
    border: 1px solid #d7dbe1; background: #fff; border-radius: 6px;
    padding: 5px 10px; font-size: 12px; cursor: pointer;
  }
  .btn-toggle.active { color: #0a7a3d; border-color: #bfe6cd; }
  .btn-toggle.inactive { color: #999; }
</style>
</head>
<body>
  <h1>Tut-P Admin Dashboard</h1>
  <div class="kpi-grid">
    <div class="kpi-card">
      <p class="kpi-label">Total Signups</p>
      <p class="kpi-value loading" id="kpi-totalSignups">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">Today's DAU</p>
      <p class="kpi-value loading" id="kpi-todayDau">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">MTD Revenue</p>
      <p class="kpi-value loading" id="kpi-mtdRevenue">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">Failed Payments</p>
      <p class="kpi-value loading" id="kpi-failedPayments">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">Active Paid Users</p>
      <p class="kpi-value loading" id="kpi-activePaidUsers">…</p>
    </div>
  </div>

  <h2 class="section-title">Signups</h2>
  <div class="panel" id="signupsDailyPanel">
    <p class="panel-message loading" id="signupsDailyMessage">Loading…</p>
  </div>
  <div class="panel" id="signupsUtmPanel">
    <p class="panel-message loading" id="signupsUtmMessage">Loading…</p>
  </div>

  <h2 class="section-title">Activation</h2>
  <div class="summary-grid-3">
    <div class="kpi-card">
      <p class="kpi-label">Activation Rate (30d)</p>
      <p class="kpi-value loading" id="kpi-activationRate">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">Activated</p>
      <p class="kpi-value loading" id="kpi-activationActivated">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">Total Signups (30d)</p>
      <p class="kpi-value loading" id="kpi-activationTotal">…</p>
    </div>
  </div>

  <h2 class="section-title">Engagement</h2>
  <div class="panel" id="featureUsagePanel">
    <p class="panel-message loading" id="featureUsageMessage">Loading…</p>
  </div>
  <div class="panel" id="dauPanel">
    <p class="panel-message loading" id="dauMessage">Loading…</p>
  </div>

  <h2 class="section-title">Parent Feedback</h2>
  <div class="summary-grid-3">
    <div class="kpi-card">
      <p class="kpi-label">Submitted (30d)</p>
      <p class="kpi-value loading" id="kpi-feedbackSubmitted">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">Auto-Resolved (30d)</p>
      <p class="kpi-value loading" id="kpi-feedbackAutoResolved">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">Escalated (30d)</p>
      <p class="kpi-value loading" id="kpi-feedbackEscalated">…</p>
    </div>
  </div>
  <div class="panel" id="feedbackEscalationsPanel">
    <p class="panel-message loading" id="feedbackEscalationsMessage">Loading…</p>
  </div>

  <h2 class="section-title">Revenue</h2>
  <div class="summary-grid">
    <div class="kpi-card">
      <p class="kpi-label">Total Revenue</p>
      <p class="kpi-value loading" id="kpi-totalRevenue">…</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">MTD Revenue</p>
      <p class="kpi-value loading" id="kpi-revenueMtd">…</p>
    </div>
  </div>
  <div class="panel" id="revenuePanel">
    <p class="panel-message loading" id="revenueMessage">Loading…</p>
  </div>

  <h2 class="section-title">Failed Payments</h2>
  <div class="panel" id="failedPaymentsPanel">
    <p class="panel-message loading" id="failedPaymentsMessage">Loading…</p>
  </div>

  <h2 class="section-title">Tutors</h2>
  <div class="panel">
    <form id="tutorForm">
      <div class="form-grid">
        <input type="text" id="tutorName" placeholder="Name" required>
        <input type="tel" id="tutorPhone" placeholder="Phone (kept private — never shown to parents directly)" required>
        <input type="text" id="tutorPhotoUrl" placeholder="Photo URL">
        <select id="tutorCategory" required>
          <option value="" disabled selected>Category</option>
          <option value="online">Online</option>
          <option value="area_wise">Area-wise</option>
          <option value="home_tuition">Home Tuition</option>
        </select>
        <input type="text" id="tutorSubjects" placeholder="Subjects (comma-separated)">
        <input type="number" id="tutorExperience" placeholder="Experience (years)" min="0">
        <input type="text" id="tutorFee" placeholder="Fee (display text, e.g. ₹500/hr)">
        <input type="text" id="tutorArea" placeholder="Area">
        <textarea id="tutorBio" placeholder="Bio" rows="2"></textarea>
      </div>
      <button type="submit" class="btn-primary">Add Tutor</button>
      <p class="panel-message" id="tutorFormMsg" style="display:none;margin-top:10px;"></p>
    </form>
  </div>
  <div class="panel" id="tutorsPanel">
    <p class="panel-message loading" id="tutorsMessage">Loading…</p>
  </div>

  <h2 class="section-title">Resolve Ambiguous Phone</h2>
  <div class="panel">
    <form id="resolvePhoneForm">
      <div class="form-grid">
        <input type="tel" id="resolvePhoneInput" placeholder="Phone number" required>
      </div>
      <button type="submit" class="btn-primary">Look up</button>
      <p class="panel-message" id="resolvePhoneFormMsg" style="display:none;margin-top:10px;"></p>
    </form>
  </div>
  <div class="panel" id="resolvePhonePanel" style="display:none;">
    <p class="panel-message" id="resolvePhoneMessage" style="display:none;"></p>
    <div id="resolvePhoneResults"></div>
  </div>

  <script>
    (async () => {
      try {
        const res = await fetch('/api/admin/kpis');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const data = await res.json();
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          el.textContent = val;
          el.classList.remove('loading');
        };
        setVal('kpi-totalSignups', data.totalSignups);
        setVal('kpi-todayDau', data.todayDau);
        setVal('kpi-mtdRevenue', '₹' + Number(data.mtdRevenue).toLocaleString('en-IN'));
        setVal('kpi-failedPayments', data.failedPayments);
        setVal('kpi-activePaidUsers', data.activePaidUsers);
      } catch (err) {
        document.querySelectorAll('.kpi-value').forEach(el => {
          el.textContent = 'Error';
          el.classList.remove('loading');
          el.classList.add('error');
        });
        console.error('[admin dashboard] Could not load KPIs:', err);
      }
    })();

    (async () => {
      const dailyPanel = document.getElementById('signupsDailyPanel');
      const utmPanel = document.getElementById('signupsUtmPanel');
      try {
        const res = await fetch('/api/admin/signups');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const data = await res.json();

        const dailyRows = data.dailyBreakdown || [];
        if (!dailyRows.length) {
          dailyPanel.innerHTML = '<p class="panel-message">No signups in the last 14 days.</p>';
        } else {
          const rowsHtml = dailyRows.map(r => '<tr><td>' + r.date + '</td><td>' + r.count + '</td></tr>').join('');
          dailyPanel.innerHTML =
            '<table class="data-table">' +
              '<thead><tr><th>Date</th><th>Signups</th></tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>';
        }

        const utmRows = data.utmBreakdown || [];
        if (!utmRows.length) {
          utmPanel.innerHTML = '<p class="panel-message">No signups yet.</p>';
        } else {
          const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
          const rowsHtml = utmRows.map(r => '<tr><td>' + escapeHtml(r.source) + '</td><td>' + r.count + '</td></tr>').join('');
          utmPanel.innerHTML =
            '<table class="data-table">' +
              '<thead><tr><th>Source</th><th>Count</th></tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>';
        }
      } catch (err) {
        dailyPanel.innerHTML = '<p class="panel-message">Error loading signups.</p>';
        utmPanel.innerHTML = '<p class="panel-message">Error loading UTM breakdown.</p>';
        console.error('[admin dashboard] Could not load signups:', err);
      }
    })();

    (async () => {
      const rateEl = document.getElementById('kpi-activationRate');
      const activatedEl = document.getElementById('kpi-activationActivated');
      const totalEl = document.getElementById('kpi-activationTotal');
      try {
        const res = await fetch('/api/admin/activation');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const data = await res.json();
        const setVal = (el, val) => { el.textContent = val; el.classList.remove('loading'); };
        setVal(rateEl, (data.rate * 100).toFixed(1) + '%');
        setVal(activatedEl, data.activated);
        setVal(totalEl, data.total);
      } catch (err) {
        [rateEl, activatedEl, totalEl].forEach(el => {
          el.textContent = 'Error';
          el.classList.remove('loading');
          el.classList.add('error');
        });
        console.error('[admin dashboard] Could not load activation:', err);
      }
    })();

    (async () => {
      const featurePanel = document.getElementById('featureUsagePanel');
      const dauPanel = document.getElementById('dauPanel');
      try {
        const res = await fetch('/api/admin/engagement');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const data = await res.json();

        const formatFeature = (f) => String(f).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const featureRows = data.featureUsage || [];
        if (!featureRows.length) {
          featurePanel.innerHTML = '<p class="panel-message">No feature usage yet.</p>';
        } else {
          const maxCount = Math.max(1, ...featureRows.map(r => r.count));
          featurePanel.innerHTML = featureRows.map(r =>
            '<div class="bar-row">' +
              '<div class="bar-label">' + formatFeature(r.feature) + '</div>' +
              '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round((r.count / maxCount) * 100) + '%"></div></div>' +
              '<div class="bar-count">' + r.count + '</div>' +
            '</div>'
          ).join('');
        }

        const dauRows = data.dailyActiveUsers || [];
        if (!dauRows.length) {
          dauPanel.innerHTML = '<p class="panel-message">No activity in the last 14 days.</p>';
        } else {
          const rowsHtml = dauRows.map(r => '<tr><td>' + r.date + '</td><td>' + r.dau + '</td></tr>').join('');
          dauPanel.innerHTML =
            '<table class="data-table">' +
              '<thead><tr><th>Date</th><th>DAU</th></tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>';
        }
      } catch (err) {
        featurePanel.innerHTML = '<p class="panel-message">Error loading feature usage.</p>';
        dauPanel.innerHTML = '<p class="panel-message">Error loading daily active users.</p>';
        console.error('[admin dashboard] Could not load engagement:', err);
      }
    })();

    (async () => {
      const panel = document.getElementById('feedbackEscalationsPanel');
      const submittedEl = document.getElementById('kpi-feedbackSubmitted');
      const autoResolvedEl = document.getElementById('kpi-feedbackAutoResolved');
      const escalatedEl = document.getElementById('kpi-feedbackEscalated');
      try {
        const res = await fetch('/api/admin/feedback-escalations');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const data = await res.json();

        const setVal = (el, val) => { el.textContent = val; el.classList.remove('loading'); };
        setVal(submittedEl, data.summary.submitted);
        setVal(autoResolvedEl, data.summary.autoResolved);
        setVal(escalatedEl, data.summary.escalated);

        const rows = data.recentEscalations || [];
        if (!rows.length) {
          panel.innerHTML = '<p class="panel-message">No feedback escalations — clean record.</p>';
          return;
        }
        const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const rowsHtml = rows.map(r =>
          '<tr>' +
            '<td>' + escapeHtml(r.familyName || '—') + '</td>' +
            '<td>' + escapeHtml(r.studentName || '—') + '</td>' +
            '<td>' + escapeHtml(r.category || '—') + '</td>' +
            '<td>' + escapeHtml(new Date(r.createdAt).toLocaleString('en-IN')) + '</td>' +
          '</tr>'
        ).join('');
        panel.innerHTML =
          '<table class="data-table">' +
            '<thead><tr><th>Family</th><th>Child</th><th>Category</th><th>Date</th></tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>';
      } catch (err) {
        [submittedEl, autoResolvedEl, escalatedEl].forEach(el => {
          el.textContent = 'Error';
          el.classList.remove('loading');
          el.classList.add('error');
        });
        panel.innerHTML = '<p class="panel-message">Error loading feedback escalations.</p>';
        console.error('[admin dashboard] Could not load feedback escalations:', err);
      }
    })();

    (async () => {
      const panel = document.getElementById('revenuePanel');
      const totalEl = document.getElementById('kpi-totalRevenue');
      const mtdEl = document.getElementById('kpi-revenueMtd');
      try {
        const res = await fetch('/api/admin/revenue');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const data = await res.json();
        totalEl.textContent = '₹' + Number(data.totalRevenue).toLocaleString('en-IN');
        totalEl.classList.remove('loading');
        mtdEl.textContent = '₹' + Number(data.mtdRevenue).toLocaleString('en-IN');
        mtdEl.classList.remove('loading');

        const rows = data.dailyBreakdown || [];
        if (!rows.length) {
          panel.innerHTML = '<p class="panel-message">No payment activity in the last 14 days.</p>';
          return;
        }
        const rowsHtml = rows.map(r =>
          '<tr>' +
            '<td>' + r.date + '</td>' +
            '<td class="amount">₹' + Number(r.capturedAmount).toLocaleString('en-IN') + '</td>' +
            '<td>' + r.capturedCount + '</td>' +
            '<td>' + r.failedCount + '</td>' +
          '</tr>'
        ).join('');
        panel.innerHTML =
          '<table class="data-table">' +
            '<thead><tr><th>Date</th><th>Captured (₹)</th><th>Captured Count</th><th>Failed Count</th></tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>';
      } catch (err) {
        [totalEl, mtdEl].forEach(el => {
          el.textContent = 'Error';
          el.classList.remove('loading');
          el.classList.add('error');
        });
        panel.innerHTML = '<p class="panel-message">Error loading revenue.</p>';
        console.error('[admin dashboard] Could not load revenue:', err);
      }
    })();

    (async () => {
      const panel = document.getElementById('failedPaymentsPanel');
      try {
        const res = await fetch('/api/admin/failed-payments');
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        const rows = await res.json();
        if (!rows.length) {
          panel.innerHTML = '<p class="panel-message">No failed payments — clean record.</p>';
          return;
        }
        const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const rowsHtml = rows.map(r =>
          '<tr>' +
            '<td>' + escapeHtml(r.familyName || '—') + '</td>' +
            '<td>' + escapeHtml(r.studentName || '—') + '</td>' +
            '<td>' + escapeHtml(r.tier || '—') + '</td>' +
            '<td class="amount">₹' + Number(r.amount).toLocaleString('en-IN') + '</td>' +
            '<td>' + escapeHtml(new Date(r.createdAt).toLocaleString('en-IN')) + '</td>' +
          '</tr>'
        ).join('');
        panel.innerHTML =
          '<table class="data-table">' +
            '<thead><tr><th>Family</th><th>Child</th><th>Plan</th><th>Amount</th><th>Date</th></tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>';
      } catch (err) {
        panel.innerHTML = '<p class="panel-message">Error loading failed payments.</p>';
        console.error('[admin dashboard] Could not load failed payments:', err);
      }
    })();

    (function tutorsSection(){
      const panel = document.getElementById('tutorsPanel');
      const form = document.getElementById('tutorForm');
      const formMsg = document.getElementById('tutorFormMsg');
      const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const CATEGORY_LABEL = { online: 'Online', area_wise: 'Area-wise', home_tuition: 'Home Tuition' };
      // Phone numbers are kept out of the initial table HTML entirely (not
      // just visually hidden) so a plain view-source/DOM scan doesn't leak
      // them either — revealing one is a deliberate per-row click, looked
      // up from this in-memory map rather than re-fetched.
      let tutorsById = {};

      async function loadTutors(){
        try {
          const res = await fetch('/api/admin/tutors');
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          const data = await res.json();
          const tutors = data.tutors || [];
          tutorsById = {};
          tutors.forEach(t => { tutorsById[t.id] = t; });
          if (!tutors.length) {
            panel.innerHTML = '<p class="panel-message">No tutors added yet.</p>';
            return;
          }
          const rowsHtml = tutors.map(t =>
            '<tr>' +
              '<td>' + escapeHtml(t.name) + '</td>' +
              '<td>' + escapeHtml(CATEGORY_LABEL[t.category] || t.category) + '</td>' +
              '<td>' + escapeHtml((t.subjects || []).join(', ') || '—') + '</td>' +
              '<td>' + escapeHtml(t.experience_years != null ? t.experience_years : '—') + '</td>' +
              '<td>' + escapeHtml(t.fee_display || '—') + '</td>' +
              '<td>' + escapeHtml(t.area || '—') + '</td>' +
              '<td><span data-phone-cell="' + t.id + '"><button type="button" class="btn-toggle" data-reveal-phone="' + t.id + '">Reveal</button></span></td>' +
              '<td><span data-verification-cell="' + t.id + '">' + escapeHtml(t.verification_status) + '</span></td>' +
              '<td>' +
                '<input type="text" class="verified-by-input" data-tutor-id="' + t.id + '" value="' + escapeHtml(t.verified_by || '') + '" placeholder="How/when verified" style="width:140px;font-size:12px;padding:4px 6px;">' +
                ' <button type="button" class="btn-toggle" data-save-verified-by="' + t.id + '">Save</button>' +
              '</td>' +
              '<td><button type="button" class="btn-toggle ' + (t.is_active ? 'active' : 'inactive') + '" data-tutor-id="' + t.id + '" data-is-active="' + t.is_active + '">' + (t.is_active ? 'Active' : 'Inactive') + '</button></td>' +
            '</tr>'
          ).join('');
          panel.innerHTML =
            '<table class="data-table">' +
              '<thead><tr><th>Name</th><th>Category</th><th>Subjects</th><th>Exp.</th><th>Fee</th><th>Area</th><th>Phone</th><th>Verification</th><th>Verified By</th><th>Status</th></tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>';

          panel.querySelectorAll('[data-reveal-phone]').forEach(btn => {
            btn.addEventListener('click', () => {
              const id = btn.getAttribute('data-reveal-phone');
              const cell = panel.querySelector('[data-phone-cell="' + id + '"]');
              const tutor = tutorsById[id];
              cell.textContent = tutor ? (tutor.phone || '—') : '—';
            });
          });

          panel.querySelectorAll('[data-save-verified-by]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-save-verified-by');
              const input = panel.querySelector('.verified-by-input[data-tutor-id="' + id + '"]');
              btn.disabled = true;
              const original = btn.textContent;
              try {
                const verifiedBy = input.value.trim();
                // Typing a name and clicking Save IS the verification act (see
                // the create-route comment: verified_by only gets written once
                // a real check has happened) — so this also flips
                // verification_status to 'verified'. Clearing the field back
                // to empty and saving reverts it to 'pending'.
                const body = { verifiedBy, verificationStatus: verifiedBy ? 'verified' : 'pending' };
                const res = await fetch('/api/admin/tutors/' + encodeURIComponent(id), {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body)
                });
                if (!res.ok) throw new Error('Request failed: ' + res.status);
                if (tutorsById[id]) {
                  tutorsById[id].verified_by = verifiedBy;
                  tutorsById[id].verification_status = body.verificationStatus;
                }
                const statusCell = panel.querySelector('[data-verification-cell="' + id + '"]');
                if (statusCell) statusCell.textContent = body.verificationStatus;
                btn.textContent = 'Saved';
                setTimeout(() => { btn.textContent = original; }, 1200);
              } catch (err) {
                console.error('[admin dashboard] Could not save verified_by:', err);
                btn.textContent = 'Error';
                setTimeout(() => { btn.textContent = original; }, 1500);
              } finally {
                btn.disabled = false;
              }
            });
          });

          panel.querySelectorAll('.btn-toggle[data-is-active]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-tutor-id');
              const nextActive = btn.getAttribute('data-is-active') !== 'true';
              btn.disabled = true;
              try {
                const res = await fetch('/api/admin/tutors/' + encodeURIComponent(id), {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ isActive: nextActive })
                });
                if (!res.ok) throw new Error('Request failed: ' + res.status);
                await loadTutors();
              } catch (err) {
                console.error('[admin dashboard] Could not toggle tutor status:', err);
                btn.disabled = false;
              }
            });
          });
        } catch (err) {
          panel.innerHTML = '<p class="panel-message">Error loading tutors.</p>';
          console.error('[admin dashboard] Could not load tutors:', err);
        }
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        formMsg.style.display = 'none';
        try {
          const body = {
            name: document.getElementById('tutorName').value.trim(),
            phone: document.getElementById('tutorPhone').value.trim(),
            photoUrl: document.getElementById('tutorPhotoUrl').value.trim(),
            category: document.getElementById('tutorCategory').value,
            subjects: document.getElementById('tutorSubjects').value,
            experienceYears: document.getElementById('tutorExperience').value,
            feeDisplay: document.getElementById('tutorFee').value.trim(),
            area: document.getElementById('tutorArea').value.trim(),
            bio: document.getElementById('tutorBio').value.trim()
          };
          const res = await fetch('/api/admin/tutors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Request failed: ' + res.status);
          form.reset();
          await loadTutors();
        } catch (err) {
          formMsg.textContent = err.message || 'Could not add tutor.';
          formMsg.style.display = 'block';
          console.error('[admin dashboard] Could not create tutor:', err);
        } finally {
          submitBtn.disabled = false;
        }
      });

      loadTutors();
    })();

    (() => {
      const form = document.getElementById('resolvePhoneForm');
      const formMsg = document.getElementById('resolvePhoneFormMsg');
      const panel = document.getElementById('resolvePhonePanel');
      const message = document.getElementById('resolvePhoneMessage');
      const results = document.getElementById('resolvePhoneResults');
      const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      let candidates = [];

      function renderCandidates() {
        if (!candidates.length) {
          message.textContent = 'No candidates found for this number.';
          message.style.display = 'block';
          results.innerHTML = '';
          return;
        }
        message.style.display = 'none';
        const rowsHtml = candidates.map((c, i) =>
          '<tr>' +
            '<td>' + escapeHtml(c.familyId) + '</td>' +
            '<td>' + escapeHtml(c.viewerKey) + '</td>' +
            '<td>' + escapeHtml(c.name || '—') + '</td>' +
            '<td>' + (c.hasPassword ? 'Yes' : 'No') + '</td>' +
            '<td>' +
              '<input type="password" class="set-password-input" data-idx="' + i + '" placeholder="New password (min 8 chars)" style="width:170px;font-size:12px;padding:4px 6px;">' +
              ' <button type="button" class="btn-toggle" data-set-password-idx="' + i + '">Set password</button>' +
              '<span class="panel-message" data-set-password-msg="' + i + '" style="display:none;margin-left:8px;"></span>' +
            '</td>' +
          '</tr>'
        ).join('');
        results.innerHTML =
          '<table class="data-table">' +
            '<thead><tr><th>Family ID</th><th>Viewer Key</th><th>Name</th><th>Has Password</th><th>Action</th></tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>';

        results.querySelectorAll('[data-set-password-idx]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const idx = Number(btn.getAttribute('data-set-password-idx'));
            const input = results.querySelector('.set-password-input[data-idx="' + idx + '"]');
            const msgEl = results.querySelector('[data-set-password-msg="' + idx + '"]');
            const candidate = candidates[idx];
            const password = input.value;
            msgEl.style.display = 'none';
            if (!password || password.length < 8) {
              msgEl.textContent = 'Min 8 characters.';
              msgEl.style.color = '#c0392b';
              msgEl.style.display = 'inline';
              return;
            }
            btn.disabled = true;
            try {
              const res = await fetch('/api/admin/resolve-phone/set-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familyId: candidate.familyId, viewerKey: candidate.viewerKey, password })
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Request failed: ' + res.status);
              input.value = '';
              candidate.hasPassword = true;
              msgEl.textContent = 'Password set.';
              msgEl.style.color = '#0a7a3d';
              msgEl.style.display = 'inline';
            } catch (err) {
              msgEl.textContent = err.message || 'Could not set password.';
              msgEl.style.color = '#c0392b';
              msgEl.style.display = 'inline';
              console.error('[admin dashboard] Could not set password:', err);
            } finally {
              btn.disabled = false;
            }
          });
        });
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        formMsg.style.display = 'none';
        panel.style.display = 'none';
        try {
          const phone = document.getElementById('resolvePhoneInput').value.trim();
          const res = await fetch('/api/admin/resolve-phone?phone=' + encodeURIComponent(phone));
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Request failed: ' + res.status);
          candidates = data.candidates || [];
          panel.style.display = 'block';
          renderCandidates();
        } catch (err) {
          formMsg.textContent = err.message || 'Could not resolve phone number.';
          formMsg.style.display = 'block';
          console.error('[admin dashboard] Could not resolve phone:', err);
        } finally {
          submitBtn.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`);
});

// The one join every student-scoped route needs: does this session's family
// actually own this student_id? Built once here, reused everywhere a route
// takes a bare student_id with no family_id alongside it to check directly.
async function studentBelongsToSession(session, studentId) {
  if (!session || !session.familyId || !studentId || !supabase) return false;
  const { data, error } = await supabase.from('students').select('family_id').eq('id', studentId).maybeSingle();
  if (error) throw error;
  return !!data && Number(data.family_id) === Number(session.familyId);
}

async function requireOwnStudent(req, res, studentId) {
  const session = getSession(req);
  if (!session || !(await studentBelongsToSession(session, studentId))) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return session;
}

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

// One-time payment (Razorpay Orders API) pricing for the paid tiers —
// matches the ₹500/₹1,500/₹2,500 shown on the register page. Paise, since
// that's the unit Razorpay's API takes and returns.
const TIER_PRICE_PAISE = { pro: 50000, ultrapro: 150000, max: 250000 };

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
app.get('/api/waitlist', requireAdmin, async (req, res) => {
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
app.get('/api/stats', requireAdmin, async (req, res) => {
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

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a minute and try again.' }
});

// ------------------------------------------------------------------
// Family registration — saves the full multi-step registration form
// as a single JSONB record (simple, fast to ship; can be normalized
// into separate tables later once the schema is stable).
// ------------------------------------------------------------------
app.post('/api/register', registerLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { regIdToken, ...payload } = req.body || {};
    if (!regIdToken) return res.status(400).json({ error: 'Phone verification missing — please verify your number again.' });
    let decoded;
    try {
      decoded = await getFirebaseAuth().verifyIdToken(regIdToken);
    } catch (err) {
      return res.status(401).json({ error: 'Phone verification expired — please verify your number again.' });
    }
    const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);
    const verifiedPhone = normPhone(decoded.phone_number);
    if (!decoded.phone_number) {
      return res.status(401).json({ error: 'This sign-in method is not supported' });
    }
    const motherPhone = normPhone(payload.mother?.phone);
    const fatherPhone = normPhone(payload.father?.phone);
    if (verifiedPhone !== motherPhone && verifiedPhone !== fatherPhone) {
      return res.status(403).json({ error: 'The verified phone number must match the mother or father phone entered in this form.' });
    }
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
    const childrenWithNames = children.filter(c => c && c.name);
    const studentRows = childrenWithNames.map(c => ({
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
    // .select('id') so each inserted row's id is available below to attach
    // to that child's payments row (student_id) — insertedStudents[i]
    // corresponds to childrenWithNames[i], since a single-array Supabase
    // insert preserves input order in its returned rows.
    let insertedStudents = [];
    if (studentRows.length) {
      const { data: studentsData, error: studentsErr } = await supabase.from('students').insert(studentRows).select('id');
      if (studentsErr) console.error('Could not save students rows (registration itself still succeeded):', studentsErr.message);
      else insertedStudents = studentsData || [];
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

      // Same referralCode value, tried against the family-referral table
      // too — teacher codes (base64url) and family codes (alphanumeric,
      // see getOrCreateFamilyReferralCode) use different generators, so in
      // practice a code only ever matches one of the two tables. Both
      // lookups are safe to run unconditionally rather than branching on
      // format, since a miss here is just "not a family code" (frc null),
      // exactly like the teacher lookup above.
      const { data: frc, error: frcErr } = await supabase.from('family_referral_codes')
        .select('id, family_id').eq('code', referralCode).maybeSingle();
      if (frcErr) {
        console.error('Could not look up family referral code (registration itself still succeeded):', frcErr.message);
      } else if (frc) {
        const { error: familyConvErr } = await supabase.from('family_referral_conversions').insert({
          referral_code_id: frc.id,
          referring_family_id: frc.family_id,
          new_family_id: data.id
        });
        if (familyConvErr) console.error('Could not record family referral conversion (registration itself still succeeded):', familyConvErr.message);
      }
    }

    // Registration itself is always free — a paid tier only determines
    // whether a Razorpay order gets created for that specific child.
    // Best-effort like everything else above: if Razorpay is unreachable
    // or misconfigured, that child is simply left unpaid rather than
    // failing the whole registration (behaves like Free until/unless
    // payment completes; no cleanup job needed, see migration 010's
    // comment). Each paid child gets its own order and its own payments
    // row (017_payments_student_id.sql) — a family with several children
    // on different tiers pays for each independently; the webhook
    // (/api/razorpay-webhook) is what marks each one captured/failed.
    const paymentInfos = [];
    // Parallel to paymentInfos — every paid-tier child who did NOT get an
    // order started, for whatever reason, so the client can tell the parent
    // plainly instead of the registration silently reporting success. Not
    // shown live retry UI (yet) — founder handles these via the existing
    // /admin/dashboard failed-payments visibility.
    const paymentFailures = [];
    for (let i = 0; i < childrenWithNames.length; i++) {
      const child = childrenWithNames[i];
      const student = insertedStudents[i];
      const tier = ['pro', 'ultrapro', 'max'].includes(child.tier) ? child.tier : 'free';
      if (tier === 'free') continue;
      if (!student) { console.error('No students row for', child.name, '— skipping Razorpay order.'); paymentFailures.push({ studentName: child.name, tier }); continue; }
      if (!razorpay) { console.error('Razorpay not configured for tier', tier, '— child left unpaid:', child.name); paymentFailures.push({ studentName: child.name, tier }); continue; }
      const amount = TIER_PRICE_PAISE[tier];
      try {
        const order = await razorpay.orders.create({
          amount,
          currency: 'INR',
          // Same receipt-length fix as /api/tutor-contact/create-order above
          // — student.id is a 36-char UUID, so the old full-identifier
          // receipt overflowed Razorpay's 56-char cap and order.create()
          // failed every time (silently, since this is caught below and the
          // child is just left unpaid). notes carries the full identifiers.
          receipt: `reg_${data.id}_${student.id.slice(0, 8)}_${Date.now().toString(36)}`,
          notes: { family_id: String(data.id), student_id: student.id, tier }
        });
        const { error: paymentErr } = await supabase.from('payments').insert({
          family_id: data.id, student_id: student.id, tier, amount, currency: 'INR',
          razorpay_order_id: order.id, status: 'created'
        });
        if (paymentErr) console.error('Could not save payments row for', child.name, '(registration itself still succeeded):', paymentErr.message);
        paymentInfos.push({ studentId: student.id, studentName: child.name, orderId: order.id, amount, currency: 'INR', razorpayKeyId: process.env.RAZORPAY_KEY_ID, tier });
      } catch (rzpErr) {
        console.error('Could not create Razorpay order for', child.name, '(registration itself still succeeded, left unpaid):', rzpErr.message);
        paymentFailures.push({ studentName: child.name, tier });
      }
    }

    // family_subscriptions predates per-child tiers (010_subscriptions.sql)
    // and isn't restructured in this pass — one placeholder row per family
    // is still inserted for whatever future use the table has, but it no
    // longer tries to summarize per-child tiers into a single value, and
    // nothing in this codebase gates on its status.
    const { error: subErr } = await supabase.from('family_subscriptions').insert({ family_id: data.id, tier: 'free', status: 'active' });
    if (subErr) console.error('Could not save family_subscriptions row (registration itself still succeeded):', subErr.message);

    console.log('New family registration:', children[0].name, 'id:', data.id, 'children:', children.length, 'paid:', paymentInfos.length, 'paymentFailures:', paymentFailures.length);
    res.json({ ok: true, id: data.id, payments: paymentInfos, paymentFailures });
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
    if (!requireOwnFamily(req, res, familyId)) return;
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

// ------------------------------------------------------------------
// Family referral links (parent-to-parent) — the analog to the teacher
// referral_codes/referral_conversions pair above, kept in their own tables
// (021_family_referrals.sql) rather than reusing those: referral_codes.
// teacher_id is NOT NULL + UNIQUE (one code per teacher) and
// referral_conversions carries teacher-payout-only columns
// (share_percentage, teacher_share, payout_status) that don't apply to a
// family referrer. Plain alphanumeric (not referral_codes' base64url)
// since this code is meant to be read in a WhatsApp message, not just
// clicked. Returns the whole row (not just the code) so the route below
// can use its id for the referralCount query without a second lookup.
// ------------------------------------------------------------------
async function getOrCreateFamilyReferralCode(familyId) {
  const { data: existing, error: existingErr } = await supabase
    .from('family_referral_codes').select('id, code').eq('family_id', familyId).maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return existing;

  const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) code += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
    const { data, error } = await supabase.from('family_referral_codes')
      .insert({ family_id: familyId, code }).select('id, code').single();
    if (!error) return data;
    if (error.code !== '23505') throw error; // not a unique-violation — bail
  }
  throw new Error('Could not generate a unique family referral code');
}

app.get('/api/family/:id/referral-code', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.id, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    if (!requireOwnFamily(req, res, familyId)) return;

    const frc = await getOrCreateFamilyReferralCode(familyId);
    const { count, error: countErr } = await supabase.from('family_referral_conversions')
      .select('id', { count: 'exact', head: true }).eq('referral_code_id', frc.id);
    if (countErr) throw countErr;

    res.json({ code: frc.code, shareUrl: 'https://tutp.online/app/register/?ref=' + frc.code, referralCount: count || 0 });
  } catch (err) {
    console.error('Get family referral code error:', err);
    res.status(500).json({ error: 'Could not get referral code' });
  }
});

// ------------------------------------------------------------------
// Funnel tracking for the WhatsApp share prompt (prompt shown is a
// client-only counter today, not tracked server-side) — this is the
// "clicked" step, so prompt-shown vs. clicked vs. converted
// (family_referral_conversions) can be compared on the existing
// usage_events dashboard infrastructure without a new table.
// ------------------------------------------------------------------
app.post('/api/track/share-clicked', async (req, res) => {
  try {
    const familyId = parseInt((req.body || {}).familyId, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    if (!requireOwnFamily(req, res, familyId)) return;
    trackShareClicked(familyId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Track share-clicked error:', err);
    res.status(500).json({ error: 'Could not record event' });
  }
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

// ------------------------------------------------------------------
// Teacher Dashboard Phase 1 — govt/school class-teacher verification
// registration. Separate from /api/register-teacher above (private tutors,
// migration 004): this writes to teacher_registrations (migration 016) and
// starts every row at overall_status='submitted' with a pending id_card
// verification_event. Verification-signal logic (govt-data matching, peer
// vouching, auto-approval) is a later phase — this endpoint only records
// the submission.
// ------------------------------------------------------------------
app.post('/api/teacher-registrations', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const {
      fullName, phone, schoolType, employmentType, schoolName, schoolUdiseCode,
      schoolAddress, principalName, classGrade, section, subject, employeeIdOptional,
      idCardPhotoUrl
    } = req.body || {};

    if (!fullName || !phone || !schoolType || !schoolName || !classGrade || !section || !subject) {
      return res.status(400).json({ error: 'Missing full name, phone, school type, school name, class/grade, section, or subject' });
    }
    if (!['government', 'private'].includes(schoolType)) {
      return res.status(400).json({ error: 'Invalid school type' });
    }
    if (schoolType === 'government' && !['permanent', 'aided', 'contract', 'outsourcing', 'daily_basis'].includes(employmentType)) {
      return res.status(400).json({ error: 'Employment type is required for government school teachers' });
    }

    const registrationId = crypto.randomUUID();
    const nowEpoch = Math.floor(Date.now() / 1000);
    const { error: insertErr } = await supabase.from('teacher_registrations').insert({
      registration_id: registrationId,
      full_name: String(fullName).trim().slice(0, 120),
      phone: String(phone).slice(0, 20),
      school_type: schoolType,
      employment_type: schoolType === 'government' ? employmentType : null,
      school_name: String(schoolName).trim().slice(0, 200),
      school_udise_code: schoolUdiseCode ? String(schoolUdiseCode).trim().slice(0, 40) : null,
      school_address: schoolAddress ? String(schoolAddress).trim().slice(0, 300) : null,
      principal_name: principalName ? String(principalName).trim().slice(0, 120) : null,
      class_grade: String(classGrade).trim().slice(0, 40),
      section: String(section).trim().slice(0, 40),
      subject: String(subject).trim().slice(0, 60),
      employee_id_optional: employeeIdOptional ? String(employeeIdOptional).trim().slice(0, 60) : null,
      id_card_photo_url: idCardPhotoUrl || null,
      overall_status: 'submitted',
      updated_at: nowEpoch
    });
    if (insertErr) throw insertErr;

    const { error: eventErr } = await supabase.from('verification_events').insert({
      event_id: crypto.randomUUID(),
      registration_id: registrationId,
      signal_type: 'id_card',
      result: 'pending_review'
    });
    if (eventErr) console.error('Could not log id_card verification_event (registration itself still succeeded):', eventErr.message);

    console.log('New teacher_registrations submission:', fullName, 'id:', registrationId);
    // Score the automatic verification signals (Phase 2) without holding up
    // the response — runVerificationSignals swallows its own errors, so a
    // signal failure can never fail a registration.
    runVerificationSignals(registrationId); // fire-and-forget
    res.json({ ok: true, registrationId });
  } catch (err) {
    console.error('Teacher registration (verification) error:', err);
    res.status(500).json({ error: 'Could not save registration: ' + (err.message || '') });
  }
});

// ==================================================================
// Teacher Dashboard Phase 2 — verification signal logic.
//
// Three independent signals score a teacher_registrations row; none of
// them ever approves anybody. The most a fully-scored registration can do
// is move overall_status 'submitted' -> 'under_manual_review', which is a
// queue for a human (Phase 3), not an outcome.
//
// Everything below matches fuzzily rather than on exact strings, because
// every field involved is free-typed by a different person: the teacher
// types their own name, a parent types the same teacher's name into
// students.class_teacher_name, and a government spreadsheet spells it a
// third way. Telugu names and school names have no single canonical
// English transliteration, so "Srinivas"/"Sreenivas"/"Shrinivas" and
// "Lakshmi"/"Laxmi" are the same person and must score as such.
// ==================================================================

// Thresholds are deliberately lenient on the "matched" side: a signal only
// ever feeds a human review queue, so an over-eager match costs a reviewer
// a glance, while a missed match costs a real teacher their registration.
const TOKEN_MATCH_THRESHOLD = 0.80;    // two single words are "the same word"
const NAME_MATCH_THRESHOLD = 0.85;
const NAME_PARTIAL_THRESHOLD = 0.68;
const SCHOOL_PARTIAL_THRESHOLD = 0.60; // "plausibly the same school"

// Titles and honorifics are noise — the same teacher is "Sri Ramesh",
// "Mr. Ramesh" and "Ramesh" depending on who typed the field.
const NAME_HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'sri', 'shri', 'smt', 'srimathi', 'kumari',
  'kum', 'dr', 'prof', 'sir', 'madam', 'teacher', 'master'
]);

// Generic words shared by most Telangana/AP school names. They still count,
// but they can't be allowed to carry a match on their own: "ZP High School,
// Kondapur" and "ZP High School, Miryalaguda" are different schools whose
// names overlap almost entirely.
const SCHOOL_GENERIC_WORDS = new Set([
  'school', 'schools', 'high', 'primary', 'upper', 'secondary', 'higher',
  'government', 'govt', 'zilla', 'parishad', 'mandal', 'public', 'english',
  'telugu', 'medium', 'residential', 'model', 'vidyalaya', 'vidyalayam',
  'college', 'institute', 'academy', 'the', 'and', 'of', 'for', 'society'
]);

// Common abbreviations expanded before tokenising, so a teacher typing
// "ZPHS Kondapur" and a dataset row reading "Zilla Parishad High School,
// Kondapur" reduce to the same tokens. Longest and dotted forms first —
// the shorter rules below would otherwise eat their prefixes.
const SCHOOL_ABBREVIATIONS = [
  [/\bm\.?\s?p\.?\s?u\.?\s?p\.?\s?s\.?\b/g, 'mandal parishad upper primary school'],
  [/\bz\.?\s?p\.?\s?h\.?\s?s\.?\b/g, 'zilla parishad high school'],
  [/\bz\.?\s?p\.?\s?p\.?\s?s\.?\b/g, 'zilla parishad primary school'],
  [/\bm\.?\s?p\.?\s?p\.?\s?s\.?\b/g, 'mandal parishad primary school'],
  [/\bk\.?\s?g\.?\s?b\.?\s?v\.?\b/g, 'kasturba gandhi balika vidyalaya'],
  [/\bg\.?\s?h\.?\s?s\.?\b/g, 'government high school'],
  [/\bg\.?\s?p\.?\s?s\.?\b/g, 'government primary school'],
  [/\bu\.?\s?p\.?\s?s\.?\b/g, 'upper primary school'],
  [/\bh\.?\s?s\.?\b/g, 'high school'],
  [/\bhr\.?\s?sec\b/g, 'higher secondary'],
  [/\bgovt\b/g, 'government'],
  [/\bsch\b/g, 'school'],
  [/\beng\b/g, 'english'],
  [/\bmed\b/g, 'medium']
];

// Reduces one transliterated word to a rough Telugu-phonetic skeleton, so
// spelling variants of the same sound collapse together before any edit
// distance is measured. Intentionally lossy — this is a comparison key,
// never something to store or show a user.
function translitKey(token) {
  const plain = String(token || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!plain) return '';
  const t = plain
    .replace(/ksh/g, 'x')          // Lakshmi / Laxmi
    .replace(/sh/g, 's')           // Shiva / Siva, Shrinivas / Srinivas
    .replace(/ch/g, 'c')
    .replace(/th/g, 't')           // Thirupathi / Tirupati
    .replace(/dh/g, 'd')           // Madhu / Madu
    .replace(/bh/g, 'b')
    .replace(/gh/g, 'g')
    .replace(/jh/g, 'j')
    .replace(/kh/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')            // Viswanath / Vishwanath
    .replace(/ee|ea|ie/g, 'i')     // Sreenivas / Srinivas
    .replace(/oo|ou/g, 'u')        // Anoop / Anup
    .replace(/aa/g, 'a')           // Raamu / Ramu
    .replace(/y/g, 'i')            // Reddy / Reddi
    .replace(/([a-z])\1+/g, '$1')  // Redy / Reddy, Anna / Ana
    .replace(/[aeiou]+$/, '');     // Ramesha / Ramesh, Nagaraju / Nagaraj
  return t || plain;
}

// 0..1 similarity between two single words, on their phonetic skeletons.
function tokenSimilarity(a, b) {
  const ka = translitKey(a), kb = translitKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const maxLen = Math.max(ka.length, kb.length);
  return Math.max(0, 1 - levenshtein(ka, kb) / maxLen);
}

// Order-independent greedy pairing, scored over the SHORTER token list.
// Indian names are routinely written with parts omitted — "Srinivas Rao
// Kandukuri" registers and the parent types "Srinivas Rao" — so extra
// tokens on one side must not be penalised. matchedTokens is reported
// alongside the score so callers can refuse to treat a single common
// first name as a whole-name match.
function tokenSetScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return { score: 0, matchedTokens: 0, compared: 0 };
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const used = new Set();
  let total = 0, matched = 0;
  for (const t of shorter) {
    let best = 0, bestIdx = -1;
    for (let i = 0; i < longer.length; i++) {
      if (used.has(i)) continue;
      const s = tokenSimilarity(t, longer[i]);
      if (s > best) { best = s; bestIdx = i; }
    }
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
    if (best >= TOKEN_MATCH_THRESHOLD) matched++;
  }
  return { score: total / shorter.length, matchedTokens: matched, compared: shorter.length };
}

// Single-letter initials are dropped: "K. Srinivas", "Srinivas K" and
// "Srinivas" are one person, and keeping the initial would only add noise
// to an order-independent comparison.
//
// Honorifics are only stripped from the FRONT of the name. Several of them
// are also real Telugu name parts in trailing position — "Padma Sri" and
// "Ramesh Kumari" are names, "Sri Ramesh" is a title plus a name.
function nameParts(full) {
  const parts = String(full || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  while (i < parts.length && NAME_HONORIFICS.has(parts[i])) i++;
  return parts.slice(i);
}

function nameTokens(full) {
  return nameParts(full).filter(t => t.length > 1);
}

function expandSchoolAbbreviations(name) {
  let s = String(name || '').toLowerCase();
  for (const [pattern, full] of SCHOOL_ABBREVIATIONS) s = s.replace(pattern, full);
  return s;
}

function schoolTokens(name) {
  return expandSchoolAbbreviations(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

// 0..1 similarity between two people's names, plus how many whole words
// actually lined up.
//
// When the two sides carry a different number of words, the difference is
// usually spacing rather than a different name — Telugu compounds get
// written both ways ("Madhu Sudhan"/"Madusudan", "Padma Sri"/"Padmasri").
// In that case the whole name joined into one skeleton is compared too, and
// the better of the two scores wins. This is deliberately NOT done when the
// word counts already agree: long joined strings tolerate more edits before
// the score drops, which would quietly pull unrelated pairs like "Anitha
// Kumari"/"Sunitha Kumari" over the line.
function fuzzyNameScore(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  const byToken = tokenSetScore(ta, tb);
  if (!ta.length || !tb.length || ta.length === tb.length) return byToken;
  const joined = tokenSimilarity(ta.join(''), tb.join(''));
  if (joined <= byToken.score) return byToken;
  const compared = Math.min(ta.length, tb.length);
  return { score: joined, matchedTokens: compared, compared };
}

// A name "matches" when it scores high AND at least two words line up — or,
// where one side genuinely is a single name part, when that one word does.
//
// The floor counts name PARTS (initials included), not the tokens that
// survive scoring. "K. Ramesh" and "S. Ramesh" both reduce to the single
// token "ramesh" and would otherwise score a perfect 1.0 against each
// other — but they are two parts each, so two words have to line up, and
// only one can.
function isFuzzyNameMatch(a, b, threshold = NAME_MATCH_THRESHOLD) {
  const { score, matchedTokens } = fuzzyNameScore(a, b);
  if (score < threshold) return false;
  const required = Math.min(2, Math.max(1, Math.min(nameParts(a).length, nameParts(b).length)));
  return matchedTokens >= required;
}

// School similarity, weighted towards the distinctive words (the village or
// locality) over the generic ones ("government high school") that most
// school names in the state share.
function fuzzySchoolScore(a, b) {
  const ta = schoolTokens(a), tb = schoolTokens(b);
  if (!ta.length || !tb.length) return 0;
  const overall = tokenSetScore(ta, tb).score;
  const da = ta.filter(t => !SCHOOL_GENERIC_WORDS.has(t));
  const db = tb.filter(t => !SCHOOL_GENERIC_WORDS.has(t));
  if (!da.length || !db.length) return overall;
  return 0.7 * tokenSetScore(da, db).score + 0.3 * overall;
}

// Same school if either the UDISE codes agree exactly (authoritative) or
// the names are close enough to be plausibly the same place.
function isSameSchool(a, b) {
  const codeA = String(a.school_udise_code || '').replace(/\s/g, '');
  const codeB = String(b.school_udise_code || '').replace(/\s/g, '');
  if (codeA && codeB) return codeA === codeB;
  return fuzzySchoolScore(a.school_name, b.school_name) >= SCHOOL_PARTIAL_THRESHOLD;
}

const GRADE_ROMAN = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6',
  vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12'
};

// "7", "7th", "Class 7", "VII" and "class vii" are the same grade. Non-
// numeric grades (lkg, ukg, nursery) fall through as their own words.
function normGrade(s) {
  const t = normText(s).replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(class|std|standard|grade)\b/g, ' ')
    .trim();
  const digits = t.match(/\d+/);
  if (digits) return digits[0];
  const word = t.replace(/\s+/g, '');
  return GRADE_ROMAN[word] || word;
}

// "A", "a", "Section A" and "Sec-A" are the same section.
function normSection(s) {
  return normText(s).replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(section|sec)\b/g, ' ')
    .replace(/\s+/g, '');
}

// ------------------------------------------------------------------
// Signal 1 — govt_data_match.
//
// govt_teacher_reference is empty today (migration 016 ships it with no
// seed data, since nothing official is verified yet), and it will stay
// partially populated long after that: districts get imported one at a
// time. Both of those are 'cold_start', NOT 'no_match'. A 'no_match' is a
// real negative signal against a teacher, so it is only returned when the
// dataset actually covers their school and their name is not in it.
// ------------------------------------------------------------------
async function evaluateGovtDataMatch(reg) {
  const { count, error: countErr } = await supabase
    .from('govt_teacher_reference')
    .select('reference_id', { count: 'exact', head: true });
  if (countErr) throw countErr;
  if (!count) {
    return { status: 'cold_start', notes: 'govt_teacher_reference is empty — no reference data imported yet' };
  }

  // Narrow server-side before comparing, so this doesn't become a full-table
  // scan once real district imports land. UDISE code is exact when both
  // sides have one; otherwise match on a prefix of the school name's most
  // distinctive word, which survives the transliteration variants that an
  // ilike on the whole name would not.
  let query = supabase.from('govt_teacher_reference')
    .select('reference_id, teacher_name, school_name, school_udise_code, school_type, employee_id, mandal_name');
  const udise = String(reg.school_udise_code || '').replace(/\s/g, '');
  if (udise) {
    query = query.eq('school_udise_code', udise);
  } else {
    const distinctive = schoolTokens(reg.school_name)
      .filter(t => !SCHOOL_GENERIC_WORDS.has(t))
      .sort((a, b) => b.length - a.length)[0];
    query = query.eq('school_type', reg.school_type).limit(500);
    if (distinctive) query = query.ilike('school_name', `%${distinctive.slice(0, 4)}%`);
  }
  const { data: refRows, error } = await query;
  if (error) throw error;

  const sameSchool = (refRows || []).filter(row => isSameSchool(reg, row));
  if (!sameSchool.length) {
    // The dataset has rows, but none for this school — it can neither
    // confirm nor deny this teacher, which is still a cold start for them.
    return { status: 'cold_start', notes: `no reference rows for "${reg.school_name}" — school not covered by imported data yet` };
  }

  let best = { score: 0, matchedTokens: 0, name: '' };
  for (const row of sameSchool) {
    const { score, matchedTokens } = fuzzyNameScore(reg.full_name, row.teacher_name);
    if (score > best.score) best = { score, matchedTokens, name: row.teacher_name };
  }

  const employeeIdHit = reg.employee_id_optional && sameSchool.some(row =>
    row.employee_id && normText(row.employee_id) === normText(reg.employee_id_optional));

  const detail = `best "${best.name}" score ${best.score.toFixed(2)} across ${sameSchool.length} same-school row(s)`;
  if (employeeIdHit && best.score >= NAME_PARTIAL_THRESHOLD) {
    return { status: 'matched', notes: `employee id + name — ${detail}` };
  }
  if (isFuzzyNameMatch(reg.full_name, best.name)) {
    return { status: 'matched', notes: detail };
  }
  if (best.score >= NAME_PARTIAL_THRESHOLD) {
    return { status: 'partial', notes: detail };
  }
  return { status: 'no_match', notes: detail };
}

// ------------------------------------------------------------------
// Signal 2 — parent_name_match.
//
// Parents type their child's class teacher into students.class_teacher_name
// (Manage Family -> "Class Teacher & Sharing"). If the parents of the very
// section this registration claims are already naming this person, that is
// corroboration no single document can give.
//
// 'no_data_yet' is the honest answer whenever that section has no students
// on the platform, or none of them have filled the field in — it is not a
// negative signal, and it is the expected result at launch.
// ------------------------------------------------------------------
async function evaluateParentNameMatch(reg) {
  // The only filter pushed server-side is "has a class teacher name at all",
  // which is a small slice of the table. class/section/school can't be
  // filtered in the query because all three are free-typed in three
  // different formats ("7" / "7th" / "Class 7") — normalising them is the
  // entire point of the predicate below. This runs once per registration,
  // not per request.
  const { data: students, error } = await supabase
    .from('students')
    .select('id, name, class, section, school_name, class_teacher_name')
    .not('class_teacher_name', 'is', null);
  if (error) throw error;

  const grade = normGrade(reg.class_grade);
  const section = normSection(reg.section);
  const inSection = (students || []).filter(s =>
    String(s.class_teacher_name || '').trim() &&
    normGrade(s.class) === grade &&
    normSection(s.section) === section &&
    fuzzySchoolScore(reg.school_name, s.school_name) >= SCHOOL_PARTIAL_THRESHOLD
  );

  if (!inSection.length) {
    return { status: 'no_data_yet', notes: `no student in ${reg.class_grade}-${reg.section} at "${reg.school_name}" has a class teacher name on file` };
  }

  let best = { score: 0, matchedTokens: 0, name: '' };
  let agreeing = 0;
  for (const s of inSection) {
    const { score, matchedTokens } = fuzzyNameScore(reg.full_name, s.class_teacher_name);
    if (score >= NAME_PARTIAL_THRESHOLD) agreeing++;
    if (score > best.score) best = { score, matchedTokens, name: s.class_teacher_name };
  }

  const detail = `${agreeing}/${inSection.length} parent-entered name(s) agree; best "${best.name}" score ${best.score.toFixed(2)}`;
  // Deliberately lenient: the parent is free-typing a name they may only
  // ever have heard spoken, and the result routes to a human either way.
  if (isFuzzyNameMatch(reg.full_name, best.name, NAME_PARTIAL_THRESHOLD)) {
    return { status: 'matched', notes: detail };
  }
  return { status: 'mismatch', notes: detail };
}

async function logVerificationEvent(registrationId, signalType, result, notes) {
  const { error } = await supabase.from('verification_events').insert({
    event_id: crypto.randomUUID(),
    registration_id: registrationId,
    signal_type: signalType,
    result,
    notes: notes ? String(notes).slice(0, 500) : null
  });
  if (error) console.error(`Could not log ${signalType} verification_event for ${registrationId}:`, error.message);
}

// ------------------------------------------------------------------
// Signal 3 — status aggregation.
//
// Moves 'submitted' -> 'under_manual_review' once every signal is resolved,
// and does nothing else, ever. There is no path from here to 'approved':
// approving a teacher is a human action in Phase 3. Nor does this touch a
// row a human has already moved.
//
// "Resolved" per signal:
//  - govt_data_match_status: anything other than 'pending'. 'pending' is
//    the column default and only evaluateGovtDataMatch overwrites it, so a
//    non-pending value always means it ran.
//  - peer_vouch_status: anything other than 'pending'. The default
//    'not_applicable' counts — most teachers will never be vouched for.
//  - parent_name_match_status: the column default is 'no_data_yet', which
//    is ALSO a legitimate post-evaluation result, so the column alone
//    cannot say whether it ran. verification_events is the record of that.
// ------------------------------------------------------------------
async function refreshOverallStatus(registrationId) {
  const { data: reg, error } = await supabase.from('teacher_registrations')
    .select('registration_id, overall_status, govt_data_match_status, peer_vouch_status, parent_name_match_status')
    .eq('registration_id', registrationId).maybeSingle();
  if (error) throw error;
  if (!reg) return null;
  if (reg.overall_status !== 'submitted') return reg.overall_status;

  const { data: events, error: eventsErr } = await supabase.from('verification_events')
    .select('signal_type').eq('registration_id', registrationId);
  if (eventsErr) throw eventsErr;
  const parentEvaluated = (events || []).some(e => e.signal_type === 'parent_name_match');

  const allResolved =
    reg.govt_data_match_status !== 'pending' &&
    reg.peer_vouch_status !== 'pending' &&
    parentEvaluated;
  if (!allResolved) return reg.overall_status;

  const { error: updErr } = await supabase.from('teacher_registrations')
    .update({ overall_status: 'under_manual_review', updated_at: Math.floor(Date.now() / 1000) })
    .eq('registration_id', registrationId)
    .eq('overall_status', 'submitted'); // no-op if a human moved it meanwhile
  if (updErr) throw updErr;

  await logVerificationEvent(registrationId, 'manual_review', 'queued',
    `govt=${reg.govt_data_match_status}, peer=${reg.peer_vouch_status}, parent=${reg.parent_name_match_status}`);
  return 'under_manual_review';
}

// Runs both automatic signals, then re-aggregates. Never throws at the
// caller: registering and vouching must not fail because a signal did.
async function runVerificationSignals(registrationId) {
  try {
    const { data: reg, error } = await supabase.from('teacher_registrations')
      .select('registration_id, full_name, school_type, school_name, school_udise_code, class_grade, section, employee_id_optional')
      .eq('registration_id', registrationId).maybeSingle();
    if (error) throw error;
    if (!reg) return null;

    const govt = await evaluateGovtDataMatch(reg);
    const parent = await evaluateParentNameMatch(reg);

    const { error: updErr } = await supabase.from('teacher_registrations').update({
      govt_data_match_status: govt.status,
      parent_name_match_status: parent.status,
      updated_at: Math.floor(Date.now() / 1000)
    }).eq('registration_id', registrationId);
    if (updErr) throw updErr;

    await logVerificationEvent(registrationId, 'govt_data', govt.status, govt.notes);
    await logVerificationEvent(registrationId, 'parent_name_match', parent.status, parent.notes);
    const overallStatus = await refreshOverallStatus(registrationId);
    return { govtDataMatch: govt, parentNameMatch: parent, overallStatus };
  } catch (err) {
    console.error('Verification signals failed for', registrationId, '-', err.message);
    return null;
  }
}

const peerVouchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many vouch attempts — please wait a minute and try again.' }
});

// ------------------------------------------------------------------
// An already-approved teacher vouches for a pending one at their school.
//
// AUTH GAP, deliberate, to be closed in Phase 3: teacher_registrations has
// no session of its own yet (Phase 1's registration POST is itself
// unauthenticated), so the only thing between a stranger and a vouch is
// knowing an approved registration_id. The approved-status check below is
// the validation this phase asked for, not a substitute for authenticating
// the voucher — which is part of why a vouch still only ever routes to
// manual review. Existing auth/session code is untouched on purpose.
// ------------------------------------------------------------------
app.post('/api/teacher-registrations/:id/peer-vouch', peerVouchLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const targetId = req.params.id;
    const { voucherRegistrationId, notes } = req.body || {};
    if (!voucherRegistrationId) return res.status(400).json({ error: 'Missing voucherRegistrationId' });
    if (voucherRegistrationId === targetId) return res.status(400).json({ error: 'A registration cannot vouch for itself' });

    const { data: rows, error } = await supabase.from('teacher_registrations')
      .select('registration_id, full_name, school_name, school_udise_code, overall_status, peer_vouch_status, peer_vouch_teacher_id')
      .in('registration_id', [targetId, voucherRegistrationId]);
    if (error) throw error;
    const target = (rows || []).find(r => r.registration_id === targetId);
    const voucher = (rows || []).find(r => r.registration_id === voucherRegistrationId);
    if (!target) return res.status(404).json({ error: 'Registration not found' });
    if (!voucher) return res.status(404).json({ error: 'Vouching teacher not found' });

    if (voucher.overall_status !== 'approved') {
      return res.status(403).json({ error: 'Only an approved teacher can vouch for another teacher' });
    }
    if (target.overall_status === 'approved' || target.overall_status === 'rejected') {
      return res.status(409).json({ error: `This registration is already ${target.overall_status}` });
    }
    if (target.peer_vouch_status === 'approved') {
      return res.status(409).json({ error: 'This registration already has a peer vouch' });
    }
    if (!isSameSchool(voucher, target)) {
      return res.status(403).json({ error: 'A vouch is only accepted from a teacher at the same school' });
    }

    const { error: updErr } = await supabase.from('teacher_registrations').update({
      peer_vouch_teacher_id: voucher.registration_id,
      peer_vouch_status: 'approved',
      updated_at: Math.floor(Date.now() / 1000)
    }).eq('registration_id', targetId);
    if (updErr) throw updErr;

    await logVerificationEvent(targetId, 'peer_vouch', 'approved',
      `vouched by ${voucher.full_name} (${voucher.registration_id})${notes ? ' — ' + String(notes).slice(0, 200) : ''}`);
    const overallStatus = await refreshOverallStatus(targetId);

    console.log('Peer vouch recorded for', targetId, 'by', voucher.registration_id);
    res.json({ ok: true, peerVouchStatus: 'approved', overallStatus });
  } catch (err) {
    console.error('Peer vouch error:', err);
    res.status(500).json({ error: 'Could not record vouch: ' + (err.message || '') });
  }
});

// Re-runs the automatic signals for one registration. Needed because both
// are time-dependent: govt_data_match turns from 'cold_start' into a real
// answer when a district import lands, and parent_name_match turns from
// 'no_data_yet' into one when that section's parents fill the field in.
// Admin-token protected, same shared-secret pattern as /api/waitlist.
app.post('/api/teacher-registrations/:id/evaluate', requireAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
  const result = await runVerificationSignals(req.params.id);
  if (!result) return res.status(404).json({ error: 'Registration not found, or signal evaluation failed — see server logs' });
  res.json({ ok: true, ...result });
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
    if (!requireOwnTeacher(req, res, req.params.id)) return;
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
    if (!requireOwnTeacher(req, res, req.params.id)) return;
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
    if (!requireOwnTeacher(req, res, req.params.id)) return;
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
    if (!requireOwnTeacher(req, res, req.params.id)) return;
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
    if (!requireOwnTeacher(req, res, req.params.id)) return;
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
app.use('/api/teacher/create-material', createMaterialRouter);

app.get('/api/teacher/:id/referrals', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    if (!requireOwnTeacher(req, res, req.params.id)) return;
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
// Razorpay webhook — one-time payments (Orders API), separate endpoint
// from /api/webhooks/razorpay above (which is the older, unused recurring-
// subscription path — no RAZORPAY_PLAN_ID_* is configured, so it never
// fires in practice). This is the one the dashboard is actually configured
// to call, for payment.captured / payment.failed. Same raw-body + HMAC
// verification pattern as above; matches by razorpay_order_id, which
// /api/register creates and stores in the payments table up front.
// ------------------------------------------------------------------
async function handlePaymentCaptured(event) {
  const payment = event.payload?.payment?.entity;
  if (!payment || !payment.order_id) return;
  const { error } = await supabase.from('payments')
    .update({ razorpay_payment_id: payment.id, status: 'captured', updated_at: new Date().toISOString() })
    .eq('razorpay_order_id', payment.order_id);
  if (error) console.error('Could not mark payment captured:', error.message);
}

async function handlePaymentFailed(event) {
  const payment = event.payload?.payment?.entity;
  if (!payment || !payment.order_id) return;
  const { error } = await supabase.from('payments')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('razorpay_order_id', payment.order_id);
  if (error) console.error('Could not mark payment failed:', error.message);
}

// Same razorpay_order_id match as handlePaymentCaptured/handlePaymentFailed
// above, against tutor_contact_requests instead of payments — an order's
// razorpay_order_id only ever exists in one of the two tables, so this is
// a harmless no-op update (0 rows matched) whenever the event is actually
// a family registration payment, and vice versa. refund_deadline is set
// here (created_at + 24h) since capture is the only point that starts the
// SLA clock the refund-check cron watches.
async function handleTutorContactCaptured(event) {
  const payment = event.payload?.payment?.entity;
  if (!payment || !payment.order_id) return;
  const refundDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('tutor_contact_requests')
    .update({ razorpay_payment_id: payment.id, status: 'paid', refund_deadline: refundDeadline })
    .eq('razorpay_order_id', payment.order_id);
  if (error) console.error('Could not mark tutor contact request paid:', error.message);
}

async function handleTutorContactFailed(event) {
  const payment = event.payload?.payment?.entity;
  if (!payment || !payment.order_id) return;
  const { error } = await supabase.from('tutor_contact_requests')
    .update({ status: 'failed' })
    .eq('razorpay_order_id', payment.order_id);
  if (error) console.error('Could not mark tutor contact request failed:', error.message);
}

app.post('/api/razorpay-webhook', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const signature = req.headers['x-razorpay-signature'];
    if (!process.env.RAZORPAY_WEBHOOK_SECRET || !signature || !req.rawBody) {
      return res.status(400).json({ error: 'Missing webhook signature or secret' });
    }
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(req.rawBody).digest('hex');
    if (expected !== signature) {
      console.error('Razorpay webhook (payments) signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body || {};
    switch (event.event) {
      case 'payment.captured': await handlePaymentCaptured(event); await handleTutorContactCaptured(event); break;
      case 'payment.failed': await handlePaymentFailed(event); await handleTutorContactFailed(event); break;
      default: break; // unhandled event types are fine to ignore — ack so Razorpay stops retrying
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Razorpay webhook (payments) error:', err);
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
    if (family && family.ambiguous) {
      return res.status(409).json({ error: 'Multiple accounts found for this number — please contact support to resolve this.' });
    }
    res.json({ registered: !!family, family_id: family ? family.id : null, roleMatches: family ? family.roleMatches : [] });
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

// Returns { id, motherName, fatherName, roleMatches } for the family owning
// this phone (last-10-digit match against mother/father), null if none
// found, or { ambiguous: true, count } if this phone's normalized digits
// match more than one distinct family_registrations row — two real
// families (confirmed 2026-09-13: ids 9/10 and 11/12, both duplicate
// registrations sharing a phone) previously collapsed silently to
// "most-recent wins" here, permanently stranding the older family. Callers
// must check for `ambiguous` before trusting `id`/`roleMatches`.
// roleMatches lists every role — 'mother', 'father', and/or one entry
// per family_members row — that actually has this exact phone on file today
// (phone is 3 independently free-typed fields with no uniqueness constraint
// between them, so more than one role sharing a number is rare now that
// everyone has their own phone, but the schema doesn't rule it out). The
// login page uses this to skip the profile-tile grid when exactly one role
// matches, falling back to the grid otherwise so it never silently guesses
// wrong in that edge case.
// Builds the roleMatches entries — 'mother'/'father'/'family_member', same
// shape findFamilyIdByPhone has always returned — for one family_registrations
// row, restricted to whichever roles actually carry `digits` as their phone.
// Shared by both findFamilyIdByPhone's single-match and ambiguous branches
// below, so there's exactly one place that decides what counts as a match.
async function buildRoleMatches(matchRow, digits) {
  const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const roleMatches = [];
  if (norm(matchRow.data?.mother?.phone) === digits) {
    roleMatches.push({ role: 'mother', name: matchRow.data?.mother?.name || null });
  }
  if (norm(matchRow.data?.father?.phone) === digits) {
    roleMatches.push({ role: 'father', name: matchRow.data?.father?.name || null });
  }
  const { data: members, error: membersErr } = await supabase
    .from('family_members')
    .select('id, name, phone')
    .eq('family_id', matchRow.id);
  if (membersErr) throw membersErr;
  (members || []).forEach(m => {
    if (norm(m.phone) === digits) roleMatches.push({ role: 'family_member', memberId: m.id, name: m.name || null });
  });
  return roleMatches;
}

async function findFamilyIdByPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  // Phone numbers inside family_registrations.data aren't normalized (free-
  // typed at registration), so an exact JSONB match on the raw string isn't
  // reliable — but pulling every family's full data blob into Node and
  // matching in JS (the old approach here) is an unindexed full-table scan
  // that gets slower, and ships more data over the network, as the family
  // count grows. digits is always exactly 10 numeric characters at this
  // point, so it's safe to interpolate into the ilike pattern directly.
  // This narrows candidates server-side first via a substring match on the
  // last 10 digits (any formatting variation still contains its own last-10-
  // digit run), then applies the exact normalized-match check below over
  // just that small candidate set instead of the whole table.
  //
  // Ordered by id desc purely so the ambiguous-count log line below reads
  // most-recent-first; it no longer determines which row "wins", since more
  // than one match is now surfaced as ambiguous rather than silently
  // resolved to the newest row (see comment above the function).
  const { data, error } = await supabase
    .from('family_registrations')
    .select('id, data')
    .or(`data->mother->>phone.ilike.%${digits}%,data->father->>phone.ilike.%${digits}%`)
    .order('id', { ascending: false });
  if (error) throw error;
  const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const matches = (data || []).filter(row =>
    norm(row.data?.mother?.phone) === digits || norm(row.data?.father?.phone) === digits
  );
  if (!matches.length) return null;

  if (matches.length > 1) {
    console.error('findFamilyIdByPhone: ambiguous phone match across', matches.length, 'family_registrations rows:', matches.map(m => m.id));

    // Build every candidate across every ambiguous row — 'mother'/'father'
    // aren't unique once more than one family is in play, so each entry is
    // tagged with its own familyId. hasPassword is checked per candidate
    // (family_registrations.data.<role>.passwordHash for mother/father,
    // family_members.password_hash for a family_member) so /api/session can
    // decide whether the picker flow is safe to offer at all — see the
    // allHavePasswords check there. Only mother/father entries' password
    // hashes come for free (already in `row.data`); family_member hashes
    // need one batched extra query rather than one per candidate.
    const perRowEntries = [];
    for (const row of matches) {
      const entries = await buildRoleMatches(row, digits);
      perRowEntries.push({ row, entries });
    }

    const memberIds = perRowEntries.flatMap(({ entries }) =>
      entries.filter(e => e.role === 'family_member').map(e => e.memberId)
    );
    let memberHasPasswordById = {};
    if (memberIds.length) {
      const { data: memberRows, error: memberErr } = await supabase
        .from('family_members').select('id, password_hash').in('id', memberIds);
      if (memberErr) throw memberErr;
      memberHasPasswordById = Object.fromEntries((memberRows || []).map(m => [m.id, !!m.password_hash]));
    }

    const candidates = [];
    for (const { row, entries } of perRowEntries) {
      for (const entry of entries) {
        const hasPassword = entry.role === 'family_member'
          ? !!memberHasPasswordById[entry.memberId]
          : !!row.data?.[entry.role]?.passwordHash;
        candidates.push({
          familyId: row.id,
          viewerKey: entry.role === 'family_member' ? String(entry.memberId) : entry.role,
          name: entry.name,
          hasPassword
        });
      }
    }
    const allHavePasswords = candidates.length > 0 && candidates.every(c => c.hasPassword);
    return { ambiguous: true, allHavePasswords, candidates };
  }

  const match = matches[0];
  const roleMatches = await buildRoleMatches(match, digits);

  return {
    id: match.id,
    motherName: match.data?.mother?.name || null,
    fatherName: match.data?.father?.name || null,
    roleMatches
  };
}

// Same last-10-digit match as findFamilyIdByPhone, against teachers.phone.
async function findTeacherIdByPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  const { data, error } = await supabase.from('teachers').select('id, phone');
  if (error) throw error;
  const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const match = (data || []).find(row => norm(row.phone) === digits);
  return match ? match.id : null;
}

// ------------------------------------------------------------------
// Admin diagnostic for a stuck/ambiguous phone number: surfaces every
// {familyId, viewerKey, name, hasPassword} candidate for a number, whether
// findFamilyIdByPhone considers it ambiguous or not — the founder needs the
// full picture (who's colliding, who already has a password) to decide how
// to unblock a family, not just the ambiguous case the login flow itself
// cares about. findFamilyIdByPhone's ambiguous branch already returns that
// exact candidates shape, so it's reused directly; its single-match branch
// doesn't build one (no caller needed it before now), so that shape is
// assembled here instead of changing findFamilyIdByPhone's return value for
// every login attempt.
// ------------------------------------------------------------------
app.get('/api/admin/resolve-phone', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const family = await findFamilyIdByPhone(req.query.phone);
    if (!family) return res.json({ candidates: [] });

    if (family.ambiguous) {
      return res.json({ candidates: family.candidates });
    }

    // Single match: build the same {familyId, viewerKey, name, hasPassword}
    // shape from family.roleMatches, one extra lookup per role type.
    const candidates = [];
    const parentRoles = family.roleMatches.filter(r => r.role === 'mother' || r.role === 'father');
    if (parentRoles.length) {
      const { data: famRow, error: famErr } = await supabase
        .from('family_registrations').select('data').eq('id', family.id).maybeSingle();
      if (famErr) throw famErr;
      parentRoles.forEach(r => {
        candidates.push({ familyId: family.id, viewerKey: r.role, name: r.name, hasPassword: !!famRow?.data?.[r.role]?.passwordHash });
      });
    }
    const memberRoles = family.roleMatches.filter(r => r.role === 'family_member');
    if (memberRoles.length) {
      const { data: memberRows, error: memberErr } = await supabase
        .from('family_members').select('id, password_hash').in('id', memberRoles.map(r => r.memberId));
      if (memberErr) throw memberErr;
      const hasPasswordById = Object.fromEntries((memberRows || []).map(m => [m.id, !!m.password_hash]));
      memberRoles.forEach(r => {
        candidates.push({ familyId: family.id, viewerKey: String(r.memberId), name: r.name, hasPassword: !!hasPasswordById[r.memberId] });
      });
    }
    res.json({ candidates });
  } catch (err) {
    console.error('Admin resolve-phone error:', err);
    res.status(500).json({ error: 'Could not resolve phone number' });
  }
});

// ------------------------------------------------------------------
// Admin-only manual override for a family stuck behind a phone collision:
// sets one specific candidate's password directly by familyId/viewerKey,
// same write logic as /api/session/set-password (bcrypt hash into
// family_registrations.data for mother/father, family_members.password_hash
// for a member) — but without that route's pendingToken/candidate
// re-derivation, since here an authenticated admin is trusted to have
// already picked the right familyId/viewerKey via resolve-phone above.
// Setting one account's password is what then lets the OTHER account's
// owner see the picker/setup flow the next time they log in.
// ------------------------------------------------------------------
app.post('/api/admin/resolve-phone/set-password', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { familyId, viewerKey, password } = req.body || {};
    const famId = parseInt(familyId, 10);
    if (!Number.isFinite(famId) || !viewerKey) {
      return res.status(400).json({ error: 'Missing or invalid familyId/viewerKey' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    if (viewerKey === 'mother' || viewerKey === 'father') {
      const { data: famRow, error: famErr } = await supabase.from('family_registrations')
        .select('data').eq('id', famId).maybeSingle();
      if (famErr) throw famErr;
      if (!famRow) return res.status(404).json({ error: 'Family not found' });
      const updatedData = { ...(famRow.data || {}) };
      updatedData[viewerKey] = { ...(updatedData[viewerKey] || {}), passwordHash };
      const { error: updateErr } = await supabase.from('family_registrations')
        .update({ data: updatedData }).eq('id', famId);
      if (updateErr) throw updateErr;
    } else {
      const { error: updateErr } = await supabase.from('family_members')
        .update({ password_hash: passwordHash }).eq('id', viewerKey).eq('family_id', famId);
      if (updateErr) throw updateErr;
    }

    res.json({ ok: true, familyId: famId, viewerKey });
  } catch (err) {
    console.error('Admin resolve-phone set-password error:', err);
    res.status(500).json({ error: 'Could not set password' });
  }
});

// ------------------------------------------------------------------
// Establishes the session cookie every family/student/teacher-scoped route
// below now requires. Called once, right after a real OTP verification
// succeeds (login), or right after registration completes (register/
// register-teacher, where the family/teacher row didn't exist yet at OTP
// time) — see the matching client-side calls in login/register/
// register-teacher's index.html.
// ------------------------------------------------------------------
app.post('/api/session', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });
    if (!process.env.SESSION_SECRET) return res.status(500).json({ error: 'Server is missing SESSION_SECRET configuration' });
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    let decoded;
    try {
      decoded = await getFirebaseAuth().verifyIdToken(idToken);
    } catch (err) {
      console.error('verifyIdToken failed:', err.message);
      return res.status(401).json({ error: 'Invalid or expired sign-in — please log in again' });
    }
    const phone = decoded.phone_number;
    if (!phone) return res.status(401).json({ error: 'This sign-in method is not supported' });

    const [family, teacherId] = await Promise.all([
      findFamilyIdByPhone(phone),
      findTeacherIdByPhone(phone)
    ]);
    if (family && family.ambiguous) {
      // Accidental-duplicate registrations (no passwords on file for at
      // least one candidate) keep today's hard-stop — this morning's safety
      // net stays unchanged. Only once every candidate has a password set
      // is it safe to let the phone's owner pick which account they mean,
      // since a password is what actually distinguishes them at that point.
      if (!family.allHavePasswords) {
        // Exactly one passwordless candidate among all of this phone's
        // matches is the one genuinely unambiguous case: nobody else could
        // mean that slot, since every other candidate already has its own
        // password. Two or more passwordless candidates is still a real
        // "which one do you mean" question this flow can't answer from
        // phone+OTP alone, so it falls through to the same 409 as today.
        const passwordless = family.candidates.filter(c => !c.hasPassword);
        if (passwordless.length === 1) {
          const target = passwordless[0];
          const pendingToken = jwt.sign({ phone, purpose: 'password-setup' }, process.env.SESSION_SECRET, { expiresIn: '5m' });
          return res.json({ needsPasswordSetup: true, pendingToken, viewerKey: target.viewerKey, familyId: target.familyId });
        }
        return res.status(409).json({ error: 'Multiple accounts found for this number — please contact support to resolve this.' });
      }
      // Short-lived, narrow-purpose token: proves `phone` was just
      // OTP-verified, without re-touching Firebase or handing the client
      // a long-lived credential for what should be a five-minute step.
      const pendingToken = jwt.sign({ phone, purpose: 'account-picker' }, process.env.SESSION_SECRET, { expiresIn: '5m' });
      const candidates = family.candidates.map(({ hasPassword, ...rest }) => rest);
      return res.json({ needsPicker: true, pendingToken, candidates });
    }
    const session = { phone, familyId: family ? family.id : null, teacherId: teacherId || null };
    issueSessionCookie(res, session);
    res.json({ ok: true, familyId: session.familyId, teacherId: session.teacherId });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Could not create session' });
  }
});

const selectAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait 15 minutes and try again.' }
});

// ------------------------------------------------------------------
// Completes login for a phone number ambiguous across multiple
// password-bearing accounts (see /api/session above). pendingToken only
// proves which phone was OTP-verified — it does NOT trust the client's
// familyId/viewerKey pairing on its own, since that would let a valid
// pendingToken for one phone be replayed against a completely unrelated
// family's password hash. Instead it re-derives the legitimate candidate
// set for that phone server-side (via findFamilyIdByPhone, the same
// authority /api/session used to mint the token) and only proceeds to a
// password check once the submitted pair is confirmed to actually be one
// of that phone's own candidates.
// ------------------------------------------------------------------
app.post('/api/session/select-account', selectAccountLimiter, async (req, res) => {
  try {
    const { pendingToken, familyId, viewerKey, password } = req.body || {};
    if (!pendingToken || familyId == null || !viewerKey || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!process.env.SESSION_SECRET) return res.status(500).json({ error: 'Server is missing SESSION_SECRET configuration' });
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    let decoded;
    try {
      decoded = jwt.verify(pendingToken, process.env.SESSION_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'This selection has expired — please log in again' });
    }
    if (decoded.purpose !== 'account-picker' || !decoded.phone) {
      return res.status(401).json({ error: 'Invalid selection token' });
    }

    const famId = parseInt(familyId, 10);
    if (!Number.isFinite(famId)) return res.status(400).json({ error: 'Invalid family id' });

    const family = await findFamilyIdByPhone(decoded.phone);
    if (!family || !family.ambiguous || !family.allHavePasswords) {
      return res.status(401).json({ error: 'This selection is no longer valid — please log in again' });
    }
    const candidate = family.candidates.find(c => c.familyId === famId && c.viewerKey === String(viewerKey));
    if (!candidate) return res.status(401).json({ error: 'Incorrect password' });

    let passwordHash = null;
    if (viewerKey === 'mother' || viewerKey === 'father') {
      const { data: famRow, error: famErr } = await supabase.from('family_registrations')
        .select('data').eq('id', famId).maybeSingle();
      if (famErr) throw famErr;
      passwordHash = famRow?.data?.[viewerKey]?.passwordHash || null;
    } else {
      const { data: member, error: memberErr } = await supabase.from('family_members')
        .select('password_hash').eq('id', viewerKey).eq('family_id', famId).maybeSingle();
      if (memberErr) throw memberErr;
      passwordHash = member?.password_hash || null;
    }
    // Generic error either way — don't reveal whether the account exists,
    // has no password set, or just got the password wrong.
    if (!passwordHash) return res.status(401).json({ error: 'Incorrect password' });

    const passwordMatches = await bcrypt.compare(String(password), passwordHash);
    if (!passwordMatches) return res.status(401).json({ error: 'Incorrect password' });

    const session = { phone: decoded.phone, familyId: famId, teacherId: null, viewerKey };
    issueSessionCookie(res, session);
    res.json({ ok: true, familyId: famId, viewerKey });
  } catch (err) {
    console.error('Select-account error:', err);
    res.status(500).json({ error: 'Could not complete sign-in' });
  }
});

// ------------------------------------------------------------------
// First-time password setup for the one candidate /api/session found
// unambiguous (see needsPasswordSetup above — exactly one passwordless
// match for this phone). Deliberately takes only pendingToken + the new
// password, nothing else identifying the account: which account gets the
// password is re-derived server-side from the token's phone, the same
// defense-in-depth as select-account, so a client can't steer this at
// a different family's slot by passing a different familyId/viewerKey.
// If the ambiguity has changed shape since the token was minted (someone
// else set a password for that slot, or a new duplicate appeared), this
// bails out to a fresh login rather than guess which account is meant.
// ------------------------------------------------------------------
app.post('/api/session/set-password', selectAccountLimiter, async (req, res) => {
  try {
    const { pendingToken, password } = req.body || {};
    if (!pendingToken || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!process.env.SESSION_SECRET) return res.status(500).json({ error: 'Server is missing SESSION_SECRET configuration' });
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    let decoded;
    try {
      decoded = jwt.verify(pendingToken, process.env.SESSION_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'This setup link has expired — please log in again' });
    }
    if (decoded.purpose !== 'password-setup' || !decoded.phone) {
      return res.status(401).json({ error: 'Invalid setup token' });
    }

    const family = await findFamilyIdByPhone(decoded.phone);
    if (!family || !family.ambiguous) {
      return res.status(401).json({ error: 'This setup link is no longer valid — please log in again' });
    }
    const passwordless = family.candidates.filter(c => !c.hasPassword);
    if (passwordless.length !== 1) {
      return res.status(401).json({ error: 'This setup link is no longer valid — please log in again' });
    }
    const target = passwordless[0];

    const passwordHash = await bcrypt.hash(password, 10);

    if (target.viewerKey === 'mother' || target.viewerKey === 'father') {
      const { data: famRow, error: famErr } = await supabase.from('family_registrations')
        .select('data').eq('id', target.familyId).maybeSingle();
      if (famErr) throw famErr;
      const updatedData = { ...(famRow?.data || {}) };
      updatedData[target.viewerKey] = { ...(updatedData[target.viewerKey] || {}), passwordHash };
      const { error: updateErr } = await supabase.from('family_registrations')
        .update({ data: updatedData }).eq('id', target.familyId);
      if (updateErr) throw updateErr;
    } else {
      const { error: updateErr } = await supabase.from('family_members')
        .update({ password_hash: passwordHash }).eq('id', target.viewerKey).eq('family_id', target.familyId);
      if (updateErr) throw updateErr;
    }

    const session = { phone: decoded.phone, familyId: target.familyId, teacherId: null, viewerKey: target.viewerKey };
    issueSessionCookie(res, session);
    res.json({ ok: true, familyId: target.familyId, viewerKey: target.viewerKey });
  } catch (err) {
    console.error('Set-password error:', err);
    res.status(500).json({ error: 'Could not set password' });
  }
});

app.post('/api/resolve-student', resolveStudentLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { phone, name, roll_number, section } = req.body || {};
    if (!phone || !name) return res.status(400).json({ error: 'Missing phone or name' });

    const family = await findFamilyIdByPhone(phone);
    if (family && family.ambiguous) {
      return res.status(409).json({ error: 'Multiple accounts found for this number — please contact support to resolve this.' });
    }
    if (!family) return res.json({ familyFound: false, found: false });

    const { data: siblings, error } = await supabase.from('students').select('*').eq('family_id', family.id);
    if (error) throw error;
    const students = siblings || [];
    const roleMatches = family.roleMatches;

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
      if (candidates.length === 1) return res.json({ familyFound: true, found: true, student_id: candidates[0].id, family_id: family.id, roleMatches });
      return res.json({ familyFound: true, found: false, family_id: family.id, roleMatches });
    }

    // Pass 1: name + phone only.
    const matches = students.filter(s => isCloseNameMatch(name, s.name));
    if (matches.length === 1) {
      return res.json({ familyFound: true, found: true, student_id: matches[0].id, family_id: family.id, roleMatches });
    }
    // Zero matches, or more than one equally-plausible match — both need disambiguation.
    return res.json({ familyFound: true, found: false, needsDisambiguation: true, family_id: family.id, roleMatches });
  } catch (err) {
    console.error('Resolve-student error:', err);
    res.status(500).json({ error: 'Could not resolve student' });
  }
});

// ------------------------------------------------------------------
// Fetch a single student/family by id, so app/child, app/mother and app/father
// can personalize their static "Leo"/"Alexandria" placeholders once a
// real student_id/family_id is known (set in sessionStorage at login).
// Requires the requesting session's family to actually own this student —
// see requireOwnStudent above.
// ------------------------------------------------------------------
app.get('/api/student/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    if (!(await requireOwnStudent(req, res, req.params.id))) return;
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
    if (!requireOwnFamily(req, res, familyId)) return;
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
    if (!requireOwnFamily(req, res, familyId)) return;
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
// the one student_id in sessionStorage from login. Also backs the "Class
// Teacher & Sharing" card on the Manage Family page, which is why
// class_teacher_name/share_homework_status_with_teacher are included here
// rather than behind a separate fetch per selected student.
app.get('/api/family/:id/students', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.id, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    if (!requireOwnFamily(req, res, familyId)) return;
    const { data, error } = await supabase
      .from('students')
      .select('id, name, class, class_teacher_name, share_homework_status_with_teacher')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ students: data || [] });
  } catch (err) {
    console.error('Get family students error:', err);
    res.status(500).json({ error: 'Could not fetch family students' });
  }
});

// Saves the parent-side class-teacher name + homework-sharing consent
// (Teacher Dashboard Phase 1) — the toggle defaults OFF client-side and
// stays OFF here too unless explicitly sent true.
app.patch('/api/students/:id/teacher-settings', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const studentId = req.params.id;
    if (!(await requireOwnStudent(req, res, studentId))) return;
    const { classTeacherName, shareHomeworkStatusWithTeacher } = req.body || {};
    const { error } = await supabase
      .from('students')
      .update({
        class_teacher_name: classTeacherName ? String(classTeacherName).trim().slice(0, 120) : null,
        share_homework_status_with_teacher: !!shareHomeworkStatusWithTeacher
      })
      .eq('id', studentId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Save student teacher-settings error:', err);
    res.status(500).json({ error: 'Could not save teacher settings' });
  }
});

// ------------------------------------------------------------------
// Bonding scores — personal per viewer, never exposed as a full ranking.
// A viewer_key is 'mother', 'father', or a family_members.id (uuid text).
// The response only ever carries the requested viewer's own score plus
// the family's max, so one viewer can never read another's raw score.
// ------------------------------------------------------------------

// Confirms a session's own phone actually holds the given viewer_key's role
// (mother/father/a specific family_members.id) within the family right now —
// requireOwnFamily alone only proves "this session belongs to this family,"
// which isn't enough for a value meant to be private per person. Shared by
// both bonding-score endpoints below so "private to the viewer" holds for
// reads and writes alike.
async function sessionOwnsViewerKey(session, viewerKey) {
  // Sessions minted by /api/session/select-account or /api/session/set-password
  // already know exactly which account they are — trust that directly
  // instead of re-deriving from phone. (Re-deriving wouldn't even be
  // possible here for those sessions: the phone is ambiguous across
  // multiple accounts by definition, and a password isn't available at
  // this point to re-disambiguate.) Older sessions (minted before this
  // field existed, or via the single-match /api/session path where the
  // phone maps to only one account anyway) have no session.viewerKey and
  // fall back to the original phone-based re-derivation, so existing
  // logged-in users aren't logged out by this change.
  if (session.viewerKey != null) {
    return String(session.viewerKey) === String(viewerKey);
  }
  const family = await findFamilyIdByPhone(session.phone);
  if (family && family.ambiguous) return false;
  const ownRoleKeys = family ? family.roleMatches.map(m => m.role === 'family_member' ? String(m.memberId) : m.role) : [];
  return ownRoleKeys.includes(String(viewerKey));
}

app.get('/api/bonding-score/:familyId/:viewerKey', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.familyId, 10);
    const viewerKey = req.params.viewerKey;
    if (!Number.isFinite(familyId) || !viewerKey) return res.status(400).json({ error: 'Invalid family id or viewer key' });
    const session = requireOwnFamily(req, res, familyId);
    if (!session) return;
    if (!(await sessionOwnsViewerKey(session, viewerKey))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: rows, error } = await supabase
      .from('bonding_scores')
      .select('viewer_key, score')
      .eq('family_id', familyId);
    if (error) throw error;

    const own = (rows || []).find(r => r.viewer_key === viewerKey);
    if (!own) return res.json({ hasData: false, score: null, leaderScore: null, isLeader: false });
    const leaderScore = (rows || []).reduce((max, r) => Math.max(max, r.score), own.score);
    res.json({ hasData: true, score: own.score, leaderScore, isLeader: own.score >= leaderScore });
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
    const session = requireOwnFamily(req, res, familyId);
    if (!session) return;
    if (!(await sessionOwnsViewerKey(session, viewer_key))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const viewerKeyStr = String(viewer_key);

    const { error } = await supabase
      .from('bonding_scores')
      .upsert({ family_id: familyId, viewer_key: viewerKeyStr, score: Math.max(0, Math.min(100, scoreNum)), updated_at: new Date().toISOString() }, { onConflict: 'family_id,viewer_key' });
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
    if (!requireOwnFamily(req, res, familyId)) return;
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
    if (!requireOwnFamily(req, res, familyId)) return;
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
    if (!requireOwnFamily(req, res, familyId)) return;
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
    if (!requireOwnTeacher(req, res, teacher_id)) return;

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
    if (!requireOwnTeacher(req, res, req.params.id)) return;
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
    if (!requireOwnTeacher(req, res, hw.teacher_id)) return;

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
    if (!(await requireOwnStudent(req, res, student_id))) return;
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
    if (!(await requireOwnStudent(req, res, req.params.studentId))) return;
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
    if (!requireOwnFamily(req, res, familyId)) return;
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
// Parent Engagement Score (PES) v1 — homework completion in the last
// 14 days, family-wide. Shared by the live completion tile/modal
// (GET /api/homework-completion/:familyId below) and the once-daily
// scoring cron (POST /api/cron/parent-engagement-score, further down)
// so both always agree on the same numbers.
//
// homework_status only ever gets a row when a child marks an item
// done (see /api/homework-assignments/:id/mark-done above) — nothing
// writes a "pending" row up front. So "total homework" has to come
// from homeworkForStudent()'s full matched set (grade/section/school/
// geo), not from counting homework_status rows directly, or every
// family with any activity would score 100%.
// ------------------------------------------------------------------
const PES_WINDOW_DAYS = 14;

async function computeFamilyHomeworkCompletion(familyId) {
  const since = new Date();
  since.setDate(since.getDate() - PES_WINDOW_DAYS);

  const { data: students, error: studentsErr } = await supabase.from('students')
    .select('id, name, class, section, school_name, area, state, district, mandal').eq('family_id', familyId);
  if (studentsErr) throw studentsErr;

  const children = [];
  const childScores = [];
  let totalAssigned = 0, totalDone = 0;

  for (const s of (students || [])) {
    const homework = (await homeworkForStudent(s)).filter(h => new Date(h.created_at) >= since);
    const assigned = homework.length;
    if (assigned === 0) continue; // no homework in the window — excluded from the average, not scored as 0
    const done = homework.filter(h => h.is_done).length;
    const percentage = Math.round((done / assigned) * 100);
    children.push({ student_id: s.id, name: s.name, assigned, done, percentage });
    childScores.push(percentage);
    totalAssigned += assigned;
    totalDone += done;
  }

  if (!childScores.length) return { hasData: false, percentage: null, totalAssigned: 0, totalDone: 0, children: [] };

  const percentage = Math.round(childScores.reduce((a, b) => a + b, 0) / childScores.length);
  return { hasData: true, percentage, totalAssigned, totalDone, children };
}

// Live-computed completion stats for the dashboard's completion tile
// and "View Full Report" expansion — always fresh, unlike the
// once-daily bonding_scores value written by the cron below.
app.get('/api/homework-completion/:familyId', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.familyId, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    if (!requireOwnFamily(req, res, familyId)) return;
    res.json(await computeFamilyHomeworkCompletion(familyId));
  } catch (err) {
    console.error('Get homework completion error:', err);
    res.status(500).json({ error: 'Could not fetch homework completion' });
  }
});

// ------------------------------------------------------------------
// "This Week's Goal" on the parent dashboards: how many learning sessions
// this family has completed so far this week. Deliberately the honest,
// lightweight signal — a plain count of session.completed events — and NOT
// the researched Parent Engagement / PIS model (that is a separate, deferred
// build). Family-level, not per child: Play-Based Learning's
// session.completed events carry no student_id (see trackSessionCompleted),
// so a per-child count would silently miss them. The week runs
// Monday 00:00 to Sunday 23:59 IST, since the families are in India.
// ------------------------------------------------------------------
const WEEKLY_SESSION_TARGET = 5;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// The UTC instant of the most recent Monday 00:00 IST.
function startOfWeekIST(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS); // UTC getters now read IST wall-clock
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7;   // Mon=0 ... Sun=6
  const mondayIstMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysSinceMonday);
  return new Date(mondayIstMidnight - IST_OFFSET_MS);
}

app.get('/api/weekly-sessions/:familyId', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const familyId = parseInt(req.params.familyId, 10);
    if (!Number.isFinite(familyId)) return res.status(400).json({ error: 'Invalid family id' });
    if (!requireOwnFamily(req, res, familyId)) return;
    const weekStart = startOfWeekIST();
    const { count, error } = await supabase
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', familyId)
      .eq('event_name', 'session.completed')
      .gte('created_at', weekStart.toISOString());
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json({ count: count || 0, target: WEEKLY_SESSION_TARGET, weekStart: weekStart.toISOString() });
  } catch (err) {
    console.error('Get weekly sessions error:', err);
    res.status(500).json({ error: 'Could not fetch weekly sessions' });
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

// ------------------------------------------------------------------
// Parent Engagement Score cron — called once daily by a Cloud
// Scheduler job, same shared-secret-token pattern as the evening
// homework alert above. Computes each family's 14-day homework
// completion (computeFamilyHomeworkCompletion, defined above) and
// writes it into bonding_scores for every viewer in that family —
// 'mother', 'father', and each family_members row — since PES v1 is
// family-wide, not per-viewer (reuses the same upsert POST
// /api/bonding-score does, in-process rather than over HTTP). A
// family with no homework activity in the window is skipped
// entirely, so bonding_scores stays absent for it and the frontend
// shows "Not enough data yet" instead of a misleading 0.
// ------------------------------------------------------------------
app.post('/api/cron/parent-engagement-score', async (req, res) => {
  if (!process.env.CRON_TOKEN || req.query.token !== process.env.CRON_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const { data: studentRows, error: studentsErr } = await supabase.from('students').select('family_id');
    if (studentsErr) throw studentsErr;
    const familyIds = [...new Set((studentRows || []).map(s => s.family_id))];

    let familiesScored = 0, familiesSkipped = 0;
    for (const familyId of familyIds) {
      const stats = await computeFamilyHomeworkCompletion(familyId);
      if (!stats.hasData) { familiesSkipped++; continue; }

      const { data: members, error: membersErr } = await supabase.from('family_members')
        .select('id').eq('family_id', familyId);
      if (membersErr) throw membersErr;
      const viewerKeys = ['mother', 'father', ...(members || []).map(m => m.id)];

      for (const viewerKey of viewerKeys) {
        const { error: upsertErr } = await supabase.from('bonding_scores').upsert({
          family_id: familyId, viewer_key: viewerKey, score: stats.percentage, updated_at: new Date().toISOString()
        }, { onConflict: 'family_id,viewer_key' });
        if (upsertErr) throw upsertErr;
      }
      familiesScored++;
    }

    res.json({ ok: true, familiesScored, familiesSkipped });
  } catch (err) {
    console.error('Parent engagement score cron error:', err);
    res.status(500).json({ error: 'Could not compute parent engagement scores' });
  }
});

// ------------------------------------------------------------------
// Weekly retention digest — meant to run once a week via a new Cloud
// Scheduler job (none exists yet for this route; copy the pattern from
// the two that already exist — tutp-parent-engagement-score,
// tutp-evening-homework-alerts — same CRON_TOKEN auth, just a weekly
// schedule instead of daily). Summarizes each family's last-7-days
// session.completed count and positive-feedback count, emailed to
// whichever parent has an email on file (mother wins if she has one,
// same fallback the evening homework alert uses). Families with zero
// activity this week are skipped entirely — a silent week shouldn't
// get a guilt-trip email.
// ------------------------------------------------------------------
app.post('/api/cron/weekly-digest', async (req, res) => {
  if (!process.env.CRON_TOKEN || req.query.token !== process.env.CRON_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const sevenDaysAgoUTC = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [completedRes, feedbackRes] = await Promise.all([
      supabase.from('usage_events').select('family_id').eq('event_name', 'session.completed').gte('created_at', sevenDaysAgoUTC),
      supabase.from('usage_events').select('family_id, properties').eq('event_name', 'feedback.submitted').gte('created_at', sevenDaysAgoUTC)
    ]);
    if (completedRes.error) throw completedRes.error;
    if (feedbackRes.error) throw feedbackRes.error;

    const sessionsByFamily = {};
    for (const row of completedRes.data || []) {
      if (row.family_id == null) continue;
      sessionsByFamily[row.family_id] = (sessionsByFamily[row.family_id] || 0) + 1;
    }
    const positiveFeedbackByFamily = {};
    for (const row of feedbackRes.data || []) {
      if (row.family_id == null || row.properties?.sentiment !== 'positive') continue;
      positiveFeedbackByFamily[row.family_id] = (positiveFeedbackByFamily[row.family_id] || 0) + 1;
    }

    // Union of families with any activity this week — everyone else is
    // skipped entirely rather than emailed a silent week.
    const activeFamilyIds = new Set([...Object.keys(sessionsByFamily), ...Object.keys(positiveFeedbackByFamily)].map(Number));

    let emailsSent = 0;
    for (const familyId of activeFamilyIds) {
      const sessionsCompleted = sessionsByFamily[familyId] || 0;
      const positiveFeedback = positiveFeedbackByFamily[familyId] || 0;

      const { data: family, error: familyErr } = await supabase.from('family_registrations')
        .select('data').eq('id', familyId).maybeSingle();
      if (familyErr || !family) continue;
      const recipient = family.data?.mother?.email ? family.data.mother : family.data?.father;
      if (!recipient || !recipient.email) continue; // no email channel on file for this family

      const subject = 'Your Tut-P week in review';
      const text = `Hi ${recipient.name || 'there'},\n\nHere's how your family used Tut-P this week:\n\n- ${sessionsCompleted} learning session${sessionsCompleted === 1 ? '' : 's'} completed\n- ${positiveFeedback} moment${positiveFeedback === 1 ? '' : 's'} you marked as genuinely helpful\n\nKeep it going — see you again soon.\n\n- The Tut-P team`;
      await sendEmail(recipient.email, subject, text);
      emailsSent++;
    }

    res.json({ ok: true, emailsSent, activeFamilies: activeFamilyIds.size });
  } catch (err) {
    console.error('Weekly digest error:', err);
    res.status(500).json({ error: 'Could not run weekly digest' });
  }
});

// ------------------------------------------------------------------
// Tutor contact-request refunds — Phase 1's SLA safety net. Phase 1 has
// no real-time masked calling yet, so a paid contact request only
// becomes status='connected' when the founder manually confirms the
// parent and tutor were put in touch. refund_deadline (set alongside
// status='paid' — see the not-yet-built checkout flow's payment.captured
// handler) is the promise to the parent that this won't just sit paid
// and unconnected forever.
// ------------------------------------------------------------------
async function refundTutorContact(request) {
  if (!razorpay) {
    console.error('Could not refund tutor contact request', request.id, ': Razorpay is not configured');
    return false;
  }
  try {
    await razorpay.payments.refund(request.razorpay_payment_id, { speed: 'optimum' });
  } catch (err) {
    // Razorpay didn't confirm the refund — leave status as 'paid' so the
    // next cron run retries. Never mark 'refunded' on a guess.
    console.error('Could not refund tutor contact request', request.id, ':', err.message || err);
    return false;
  }
  const { error } = await supabase.from('tutor_contact_requests')
    .update({ status: 'refunded' })
    .eq('id', request.id);
  if (error) {
    // The refund itself succeeded at Razorpay — only our own status
    // update failed. Flagged distinctly so this doesn't read as a normal
    // "will retry cleanly" failure: a retry here would try to refund an
    // already-refunded payment.
    console.error('Refunded at Razorpay but could not update tutor_contact_requests', request.id, ':', error.message);
    return false;
  }
  return true;
}

app.post('/api/cron/tutor-contact-refund-check', async (req, res) => {
  if (!process.env.CRON_TOKEN || req.query.token !== process.env.CRON_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });

    const { data: dueRequests, error } = await supabase.from('tutor_contact_requests')
      .select('id, razorpay_payment_id, family_id, tutor_id')
      .eq('status', 'paid')
      .lte('refund_deadline', new Date().toISOString());
    if (error) throw error;

    let refunded = 0;
    let failed = 0;
    for (const request of dueRequests || []) {
      const ok = await refundTutorContact(request);
      if (ok) refunded++; else failed++;
    }

    const subject = `Tutor contact refund check: ${refunded} refunded, ${failed} failed`;
    const text = `Tutor contact refund cron ran.\n\nDue for refund: ${(dueRequests || []).length}\nRefunded: ${refunded}\nFailed (needs manual attention): ${failed}` +
      (failed > 0 ? '\n\nCheck tutor_contact_requests rows still at status=\'paid\' past their refund_deadline.' : '');
    await sendEmail(process.env.FOUNDER_ALERT_EMAIL || 'ceo.vettedrx@gmail.com', subject, text);

    res.json({ ok: true, refunded, failed });
  } catch (err) {
    console.error('Tutor contact refund check error:', err);
    res.status(500).json({ error: 'Could not run tutor contact refund check' });
  }
});

// Free-tier usage cap: 5 session.completed events per bucket per child,
// unless that child has ever had a captured payment (any tier) — a paid
// child is unlimited regardless of bucket. Two buckets rather than one
// shared cap since Homework Help and the other five features (quiz/
// storytelling/experiential_learning/play_based_learning/exam_prep) are
// each capped independently.
const FREE_LIMIT_PER_BUCKET = 5;
const OTHER_FEATURES_BUCKET = ['quiz', 'storytelling', 'experiential_learning', 'play_based_learning', 'exam_prep'];

async function checkFreeLimit(studentId, bucket) {
  const { count: capturedCount, error: paymentsErr } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('status', 'captured');
  if (paymentsErr) throw paymentsErr;
  if (capturedCount > 0) return { allowed: true };

  const { data: events, error: eventsErr } = await supabase
    .from('usage_events')
    .select('properties')
    .eq('student_id', studentId)
    .eq('event_name', 'session.completed');
  if (eventsErr) throw eventsErr;

  const count = (events || []).filter(e => {
    const feature = e.properties?.feature;
    return bucket === 'homework_help' ? feature === 'homework_help' : OTHER_FEATURES_BUCKET.includes(feature);
  }).length;

  return { allowed: count < FREE_LIMIT_PER_BUCKET, count, remaining: Math.max(0, FREE_LIMIT_PER_BUCKET - count) };
}

// Shape validation for the freeform userContent array this route forwards to
// Claude — same attachment-block check as isValidQpContentBlock below, plus a
// text-block variant, since /api/homework's content mixes a text block with
// an optional image/document attachment (unlike the QP route's two required
// attachments).
function isValidHomeworkContentBlock(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.type === 'text') return typeof block.text === 'string' && block.text.length > 0;
  if (block.type === 'image' || block.type === 'document') {
    return !!(block.source && block.source.type === 'base64' && block.source.media_type && block.source.data);
  }
  return false;
}

// The browser never sees the API key — it only ever talks to this route.
app.post('/api/homework', async (req, res) => {
  try {
    const { systemPrompt, userContent, studentId } = req.body;
    if (!systemPrompt || !userContent) {
      return res.status(400).json({ error: 'Missing systemPrompt or userContent' });
    }
    if (!Array.isArray(userContent) || !userContent.length || !userContent.every(isValidHomeworkContentBlock)) {
      return res.status(400).json({ error: 'Invalid userContent' });
    }
    // Client UI caps this at 2 (multi-page homework); enforced here too so
    // the cap can't be bypassed by calling this route directly.
    const attachmentCount = userContent.filter(b => b.type === 'image' || b.type === 'document').length;
    if (attachmentCount > 2) {
      return res.status(400).json({ error: 'At most 2 photo/PDF attachments are allowed per request.' });
    }
    const session = await requireOwnStudent(req, res, studentId);
    if (!session) return;

    const VALID_FEATURES = Object.values(FEATURES);
    const feature = VALID_FEATURES.includes(req.body.feature) ? req.body.feature : FEATURES.HOMEWORK_HELP;
    const bucket = feature === FEATURES.HOMEWORK_HELP ? 'homework_help' : 'other_features';
    const limit = await checkFreeLimit(studentId, bucket);
    if (!limit.allowed) {
      return res.status(402).json({
        error: 'free_limit_reached',
        bucket,
        message: `You've used all 5 free ${bucket === 'homework_help' ? 'homework help sessions' : 'other feature sessions'} for this child. Upgrade to continue.`
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    }

    trackSessionStarted(session.familyId, studentId, { feature, language: req.body.language });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        // A broad/unspecific attachment (e.g. a whole textbook chapter page
        // with no single stated question) combined with a token-inefficient
        // output language (Telugu and other Indic scripts use far more
        // tokens per character than English) measured up to ~1220 output
        // tokens for a full 5-question quiz — comfortably over the previous
        // 1000 cap, which silently truncated mid-JSON. Raised again to 3000
        // after Homework Help's extracted_questions mode (unlike Quiz's
        // fixed 5 questions) hit this cap mid-JSON on a real multi-question
        // exam paper — the prompt now also caps extraction at 8 questions,
        // but 3000 keeps a safety margin on top of that cap rather than
        // relying on the prompt limit alone.
        max_tokens: 3000,
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
    trackSessionCompleted(session.familyId, studentId, { feature, durationSeconds: null });
    res.json(data);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error calling Claude' });
  }
});

// ------------------------------------------------------------------
// Homework illustration — step 1 of the "show the problem as a picture"
// flow. Claude parses a maths word problem into structured JSON; the
// characters then get deterministic Open Peeps SVGs (no extra AI call) and
// every object gets one placeholder SVG until the real object library
// exists. Session-gated + rate-limited since it spends Claude tokens; not
// tied to a studentId, so it doesn't count against the free-tier buckets.
// ------------------------------------------------------------------
const illustrateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute and try again.' }
});

app.post('/api/homework/illustrate', illustrateLimiter, async (req, res) => {
  try {
    const session = getSession(req);
    if (!session || !session.familyId) return res.status(403).json({ error: 'Forbidden' });

    const { problemText, language } = req.body || {};
    if (typeof problemText !== 'string' || !problemText.trim() || problemText.length > 1000) {
      return res.status(400).json({ error: 'problemText must be a non-empty string of at most 1000 characters' });
    }
    if (language !== 'te' && language !== 'en') {
      return res.status(400).json({ error: "language must be 'te' or 'en'" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        // Output is a small JSON object (a few names/entities, which in
        // Telugu script are token-heavy) — 1500 leaves a wide margin.
        max_tokens: 1500,
        system: buildIllustrationParsePrompt(language),
        messages: [{ role: 'user', content: `<problem>\n${problemText.trim()}\n</problem>` }]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error (illustrate):', response.status, errText);
      return res.status(502).json({ error: 'Claude API returned an error' });
    }

    const data = await response.json();
    let raw = data.content?.[0]?.text || '';
    const fenceMatch = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) raw = fenceMatch[1];
    let parsed;
    try {
      parsed = validateParsedProblem(JSON.parse(raw));
    } catch (parseErr) {
      console.error('Could not parse illustrate JSON:', parseErr.message, 'raw:', raw);
      return res.status(502).json({ error: 'Claude returned an unexpected response' });
    }
    if (parsed.error === NOT_A_MATH_PROBLEM) {
      return res.status(422).json({ error: NOT_A_MATH_PROBLEM });
    }

    const characterSVGs = {};
    for (const c of parsed.characters) characterSVGs[c.name] = getCharacterSVG(c.name, {});

    res.json({
      parsed,
      characterSVGs,
      placeholderObjectSVG: placeholderObjectSVG(parsed.quantities[0].entity)
    });
  } catch (err) {
    console.error('Illustrate route error:', err);
    res.status(500).json({ error: 'Server error illustrating problem' });
  }
});

// ------------------------------------------------------------------
// Post-session parent feedback pulse — a positive rating just gets
// recorded; anything else runs through Claude for triage (too_complex
// gets auto-rewritten and handed back immediately, everything else
// escalates to the founder by email) rather than sitting unseen.
// ------------------------------------------------------------------
app.post('/api/feedback', async (req, res) => {
  try {
    const { studentId, feature, sentiment, explanationClear, freeText, originalExplanation } = req.body || {};
    const session = await requireOwnStudent(req, res, studentId);
    if (!session) return;

    trackFeedbackSubmitted(session.familyId, studentId, { feature, sentiment, explanationClear, freeText });

    if (sentiment === 'positive') {
      res.json({ ok: true });
      return;
    }

    const { category, auto_resolvable } = await classifyFeedback({ feature, sentiment, explanationClear, freeText, originalExplanation });
    trackFeedbackClassified(session.familyId, studentId, { category, autoResolvable: auto_resolvable });

    if (auto_resolvable) {
      const newExplanation = await autoResolveTooComplex(originalExplanation);
      trackFeedbackAutoResolved(session.familyId, studentId, { category, resolutionAction: 'simplified_explanation' });
      res.json({ ok: true, resolved: true, newExplanation });
    } else {
      await escalateToFounder(sendEmail, { familyId: session.familyId, studentId, feature, category, note: freeText });
      trackFeedbackEscalated(session.familyId, studentId, { category, patternCount: null });
      res.json({ ok: true, escalated: true });
    }
  } catch (err) {
    console.error('Feedback pipeline error:', err);
    res.status(500).json({ error: 'Could not process feedback' });
  }
});

// ------------------------------------------------------------------
// Demo-only, no-login variant of /api/homework — /demo/ is a standalone
// teaser with no account and no session cookie, so it can never satisfy
// requireOwnStudent above. This route is the unauthenticated logic
// /api/homework itself used to have (see git history), split out once
// /api/homework gained a real per-student auth gate + tracking, rather
// than punching a studentId-less bypass hole back into the real route.
// No tracking here — there's no family/student to attribute it to.
// ------------------------------------------------------------------
app.post('/api/homework-demo', async (req, res) => {
  try {
    const { systemPrompt, userContent } = req.body;
    if (!systemPrompt || !userContent) {
      return res.status(400).json({ error: 'Missing systemPrompt or userContent' });
    }
    if (!Array.isArray(userContent) || !userContent.length || !userContent.every(isValidHomeworkContentBlock)) {
      return res.status(400).json({ error: 'Invalid userContent' });
    }
    const attachmentCount = userContent.filter(b => b.type === 'image' || b.type === 'document').length;
    if (attachmentCount > 2) {
      return res.status(400).json({ error: 'At most 2 photo/PDF attachments are allowed per request.' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error (demo):', response.status, errText);
      return res.status(502).json({ error: 'Claude API returned an error', detail: errText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Server error (demo):', err);
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
    if (!(await requireOwnStudent(req, res, student_id))) return;

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
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
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
// Phase 3.6: AI Question Paper Generator. Stateless — the two attachments
// (lesson content + an old paper as a style reference) travel as inline
// base64 vision/document content blocks straight through to Claude, same
// as /api/homework's demo pattern, and nothing is persisted.
// Prompt is built server-side (like /api/homework-explain, not left to the
// client like /api/homework) so the extraction/generation instructions stay
// centralized and can't be tampered with by the caller.
//
// One mode per call, teacher-selected (not all modes auto-generated):
// a combined call was truncating mid-generation even at max_tokens 8000
// shared across multiple papers, since each full paper can itself need
// more than that. The teacher picks exactly one mode and one exam pattern
// up front, and the frontend fires a single request for that combination.
// ------------------------------------------------------------------
// Cognitive-demand modes for the Question Paper Generator, replacing the old
// 3-value difficulty tier (logical/methodology/tough — "tough" is retired,
// not merged into this). mixed's guidance text is composed from the other
// three rather than hand-duplicated, so a wording change to any one mode
// automatically flows into Mixed too.
const QP_MODE_TEXT = {
  logical_reasoning: 'questions that test conceptual/logical reasoning, deduction, pattern recognition, and sequencing — not rote recall',
  understanding_application: 'a natural mix of questions that test understanding (explaining what/why a concept works) and questions that test application (using the concept in a new or real-life context)',
  skill_based: 'questions that test direct procedure, method, and recall — step-by-step problem-solving technique, lower cognitive load than open-ended reasoning'
};
const QP_MODES = {
  logical_reasoning: QP_MODE_TEXT.logical_reasoning,
  understanding_application: QP_MODE_TEXT.understanding_application,
  skill_based: QP_MODE_TEXT.skill_based,
  mixed: `a genuine mix of all three: ${QP_MODE_TEXT.logical_reasoning}; ${QP_MODE_TEXT.understanding_application}; and ${QP_MODE_TEXT.skill_based}. Let the lesson content and the old paper's structure decide the natural balance across sections/groups — do not force an even split or a fixed quota per group.`
};

// Exam pattern is tone/scope guidance only — it does NOT define the paper's
// structure. The uploaded old question paper remains the sole source of
// truth for sections, question counts, and marks distribution.
const QP_EXAM_PATTERNS = {
  weekly: 'Weekly Test — narrow scope, typically covering only the most recent lesson(s); shorter and lower-stakes',
  monthly: 'Monthly Test — moderate scope, covering roughly a month of content',
  quarterly: '3-Month Exam — broader scope, covering a full term/quarter of content',
  half_yearly: '6-Month Exam — broad, cumulative scope covering half a year of content',
  pre_final: 'Pre-Final Exam — comprehensive, revision-level scope, close to full-year coverage',
  final: 'Final Exam — full-year cumulative scope; the highest-stakes exam of the year'
};

// Board, like exam pattern, is tone/terminology guidance only — it does NOT
// define the paper's structure. 'other' uses the teacher's own free-text
// board name in place of a description below.
const QP_BOARDS = {
  cbse: 'CBSE (Central Board of Secondary Education)',
  state_board: 'a State Board',
  icse: 'ICSE (Indian Certificate of Secondary Education)'
};

function buildQuestionPaperSystemPrompt(subject, mode, examPattern, boardLabel) {
  return `You are an experienced Indian school exam-paper setter. You will be given two attachments: an OLD QUESTION PAPER (a style reference) and NEW LESSON CONTENT.

Step 1 — analyze the old question paper's structure:
- Its sections. SKIP any generic/administrative preamble such as a "General Instructions" block or a Name/Roll No. line — those are added separately by our own system, never extract them as a section. Section titles must NOT include a marks total (e.g. do not write "(18 Marks)" as part of the title, even if the old paper's own heading did) — marks totals are computed and appended separately by our own system; including one yourself will make it appear twice.
- For each section, any section-level instructions that are genuinely separate from the choice/marks statement (e.g. "use a separate answer sheet for this section") — null if there is none. Do NOT restate the "answer any X of Y, each carrying Z marks" choice information here; that is composed automatically from chooseCount/totalCount/marksPerQuestion and would otherwise be printed twice.
- For each section, how its questions are grouped. Many exam papers use a CHOICE pattern per group — e.g. "Answer any 4 out of the given 6 questions, each carrying 3 marks" — where more candidate questions are printed than the student is required to answer. For every group in every section, extract exactly: (1) oldPaperHadChoice — true if the old paper's group offered more candidates than required (a real choice, however it was phrased: "answer any X of Y", "OR" between alternatives, etc.), false only if every question in that group was compulsory with no alternative offered; (2) chooseCount — how many the student must answer; (3) totalCount — how many candidate questions are printed (equal to chooseCount only when oldPaperHadChoice is false); (4) marksPerQuestion — the marks each one carries. Report oldPaperHadChoice as your own independent judgment call, not simply computed from the other two numbers — it is a deliberate second check on your own extraction. Do not flatten a choice group into a plain compulsory list — the choice is part of the structure and must be preserved.
- The time allowed for the whole exam, only if it is printed on the old paper (e.g. "Time: 2 Hours"). If it is not stated, report null — never guess a time.

Step 2 — using that exact structure (same sections, same groups, same chooseCount/totalCount/marksPerQuestion per group), write ONE new question paper based on the NEW LESSON CONTENT (not the old paper's content), for this cognitive-demand mode: ${QP_MODES[mode]}. For every group, write exactly totalCount NEW candidate questions, not just chooseCount — if the old paper offered 6 candidates for 4 required answers, your new paper must also offer 6 new candidates for 4 required answers.

This paper is for a: ${QP_EXAM_PATTERNS[examPattern]}. Let this shape the scope and tone of the questions you write — a Weekly Test should feel narrower and lower-stakes than a Final Exam, even in the same mode — but it does NOT change the structure: the OLD QUESTION PAPER's sections and groups from Step 1 are still what you must follow exactly.

This paper is being written for: ${boardLabel}. Let this shape terminology and question phrasing typical of that board's exams, but it does NOT change the structure either — the OLD QUESTION PAPER's structure from Step 1 remains authoritative.

Respond ONLY with valid JSON, no markdown fences, no preamble, in exactly this shape:
{"title":"string","subject":"string","timeAllowedFromOldPaper":"string or null","sections":[{"title":"string","instructions":"string or null","questionGroups":[{"oldPaperHadChoice":boolean,"chooseCount":number,"totalCount":number,"marksPerQuestion":number,"questions":[{"text":"string"}]}]}]}${subject ? `\nSubject: ${subject}.` : ''}`;
}

function isValidQpContentBlock(block) {
  return block && (block.type === 'image' || block.type === 'document') &&
    block.source && block.source.type === 'base64' && block.source.media_type && block.source.data;
}

// Defensive net for BUG 1: catches an administrative-preamble section that
// slips through despite the Step 1 instruction to skip it (e.g. the old
// paper's own "General Instructions" block echoed back as a fake section).
function isAdministrativeSectionTitle(title) {
  const t = String(title || '').trim().toLowerCase();
  // Substring match, not exact equality: no real exam section title contains
  // the word "instruction" — that word only ever belongs to a preamble.
  // Exact equality was too brittle (missed e.g. "GENERAL INSTRUCTIONS TO
  // CANDIDATES") and let a duplicate slip through to print.
  if (t.includes('instruction')) return true;
  return t === 'name' || t === 'roll no' || t === 'roll no.' || t === 'roll number' ||
    t === 'name / roll no' || t === 'name and roll no';
}

// Fallback when the old paper doesn't state a time allowed: ~1 minute per
// mark, rounded up to the nearest 30 minutes — a standard rule-of-thumb for
// written exams. Deterministic, not left to the model.
function computeDefaultTimeAllowed(totalMarks) {
  const minutes = Math.ceil((totalMarks || 0) / 30) * 30 || 30;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) return `${minutes} minutes`;
  if (rem === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  return `${hours} hour${hours > 1 ? 's' : ''} ${rem} minutes`;
}

// BUG 2 hard assertion: the model reports oldPaperHadChoice as an
// independent judgment call, separate from the chooseCount/totalCount
// numbers it also reports. If it claims a real choice existed but then
// reports equal counts, that's a self-contradiction — a choice got
// silently flattened to "answer all" — and must fail loudly (502) rather
// than ship a paper that quietly dropped the old paper's structure.
function processQpSections(rawSections) {
  return (rawSections || [])
    .filter(sec => !isAdministrativeSectionTitle(sec.title))
    .map(sec => {
      const questionGroups = (Array.isArray(sec.questionGroups) ? sec.questionGroups : []).map(g => {
        const chooseCount = Number(g.chooseCount) || 0;
        const totalCount = Number(g.totalCount) || chooseCount;
        const marksPerQuestion = Number(g.marksPerQuestion) || 0;
        if (g.oldPaperHadChoice === true && chooseCount === totalCount) {
          throw new Error(`section "${sec.title}": oldPaperHadChoice=true but chooseCount(${chooseCount}) === totalCount(${totalCount}) — a real choice was flattened to "answer all"`);
        }
        return { chooseCount, totalCount, marksPerQuestion, questions: Array.isArray(g.questions) ? g.questions : [] };
      });
      const totalMarks = questionGroups.reduce((sum, g) => sum + g.chooseCount * g.marksPerQuestion, 0);
      // Defensive net: strip a marks total the model wrote into the title
      // itself despite the prompt instruction not to — we append our own
      // computed one right after, so an un-stripped one would print twice
      // (and could disagree with our number, as happened during testing).
      const title = String(sec.title || '').replace(/\s*\(\s*\d+\s*marks?\s*\)\s*$/i, '').trim();
      return { ...sec, title, questionGroups, totalMarks };
    });
}

app.post('/api/question-paper-generate', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    }
    const { subject, lessonContent, oldPaper, mode, examPattern, board, boardOther } = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(QP_MODES, mode)) {
      return res.status(400).json({ error: 'Missing or invalid mode' });
    }
    if (!Object.prototype.hasOwnProperty.call(QP_EXAM_PATTERNS, examPattern)) {
      return res.status(400).json({ error: 'Missing or invalid examPattern' });
    }
    let boardLabel;
    if (board === 'other') {
      boardLabel = boardOther ? String(boardOther).trim().slice(0, 60) : '';
      if (!boardLabel) return res.status(400).json({ error: 'Missing board name for "Other"' });
    } else if (Object.prototype.hasOwnProperty.call(QP_BOARDS, board)) {
      boardLabel = QP_BOARDS[board];
    } else {
      return res.status(400).json({ error: 'Missing or invalid board' });
    }
    if (!isValidQpContentBlock(lessonContent) || !isValidQpContentBlock(oldPaper)) {
      return res.status(400).json({ error: 'Missing or invalid lessonContent/oldPaper attachment' });
    }

    const systemPrompt = buildQuestionPaperSystemPrompt(subject ? String(subject).trim().slice(0, 60) : null, mode, examPattern, boardLabel);
    const userContent = [
      { type: 'text', text: 'OLD QUESTION PAPER (style reference):' },
      oldPaper,
      { type: 'text', text: 'NEW LESSON CONTENT (generate the new paper from this):' },
      lessonContent
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error (question-paper-generate):', mode, response.status, errText);
      return res.status(502).json({ error: 'Claude API returned an error', detail: errText });
    }

    const data = await response.json();
    let raw = data.content?.[0]?.text || '';
    console.log('[QP-DEBUG] stop_reason:', data.stop_reason, 'raw.length:', raw.length);
    // Defensive: strip markdown code fences even though the prompt says not
    // to include them — under long/complex generations the model sometimes
    // wraps the JSON in ```json ... ``` anyway, which JSON.parse chokes on.
    const fenceMatch = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) raw = fenceMatch[1];
    let paper;
    try {
      paper = JSON.parse(raw);
      if (!paper || !paper.sections) throw new Error('Response JSON had no "sections" key');
    } catch (parseErr) {
      console.error('Could not parse question-paper JSON:', mode, parseErr.message, 'stop_reason:', data.stop_reason, 'raw:', raw);
      return res.status(502).json({ error: 'Claude returned an unexpected response — please try again.' });
    }

    console.log('[QP-DEBUG] RAW pre-post-processing paper.sections:', JSON.stringify(paper.sections));

    // Drop any administrative-preamble section that slipped through (BUG 1
    // defensive net), then compute marks totals and the time-allowed
    // fallback ourselves rather than trusting the model's arithmetic.
    try {
      paper.sections = processQpSections(paper.sections);
    } catch (assertErr) {
      console.error('[QP-ASSERT] Choice-structure consistency check failed:', mode, assertErr.message);
      return res.status(502).json({ error: 'Claude\'s response was internally inconsistent about question choice — please try again.' });
    }
    paper.totalMarks = paper.sections.reduce((sum, sec) => sum + (sec.totalMarks || 0), 0);
    paper.timeAllowed = paper.timeAllowedFromOldPaper && String(paper.timeAllowedFromOldPaper).trim()
      ? String(paper.timeAllowedFromOldPaper).trim()
      : computeDefaultTimeAllowed(paper.totalMarks);
    delete paper.timeAllowedFromOldPaper;

    res.json({ ok: true, mode, paper });
  } catch (err) {
    console.error('Question paper generate error:', err);
    res.status(500).json({ error: 'Server error generating question papers' });
  }
});

// ------------------------------------------------------------------
// Play-Based Learning — multiplayer game engine. Replaces the old
// client-only implementation that sent every question's correct answer to
// the browser in one shot before anyone had played. Here, the server is the
// only place that ever holds correct_index/explanation/cognitive_category
// until a player actually answers — the leaderboard and the "Winner of the
// Day" / "Game Changer of the Day" badges are only trustworthy if scoring
// is server-authoritative, not client-computed.
//
// Same reasoning as buildQuestionPaperSystemPrompt: the prompt is built
// server-side from structured params, not accepted as raw text from the
// client, for consistent formatting and to keep it out of caller control.
// ------------------------------------------------------------------
const GAME_CATEGORIES = ['logical_reasoning', 'understanding', 'application', 'skill_based'];

// fixedCount is null only on a game's very first generation call (Player
// 1's block) — that call also judges questionsPerPlayer (3-15) from the
// lesson's size/importance. Every later call (prefetching players 2-4)
// passes the count that first call decided, since the spec requires the
// same count for every player in one game.
function buildGameQuestionsSystemPrompt(lang, childContext, fixedCount) {
  const countInstruction = fixedCount
    ? `Generate exactly ${fixedCount} questions.`
    : `First, judge this lesson's size/importance and decide how many questions this game should have per player — anywhere from 3 (a small/light lesson) to 15 (a large/important one). Report that as "questionsPerPlayer". Then generate exactly that many questions.`;
  return `You are Tut-P, an assistant that turns a school lesson into a multiple-choice family quiz game — one player answers each question in turn, with a countdown timer, before the family discusses the answer together (untimed).
${countInstruction}
Respond ONLY with valid JSON, no markdown fences, no preamble, in exactly this shape:
{${fixedCount ? '' : '"questionsPerPlayer":number,'}"subject":"one short English subject label","questions":[{"question":"short question in ${lang} testing understanding of the lesson, answerable within a short countdown","options":["A","B","C","D"],"correct":0,"explain":"one clear sentence in ${lang}, written for the child, explaining why the correct answer is right","category":"logical_reasoning|understanding|application|skill_based, always in English regardless of ${lang}","points":10}]}
Vary difficulty a little and vary "points" between 5 and 15 accordingly. Output the JSON as a single compact line with no extra whitespace, no indentation, and no line breaks inside it — do not pretty-print it, and do not wrap it in \`\`\`json or any other code fence. Keep every string concise — this must fit a small token budget. The child is: ${childContext}.`;
}

// Defensive normalization, same spirit as processQpSections: never trust the
// model's own arithmetic/formatting blindly. correct is clamped into range
// rather than trusted as-is since an out-of-range index would otherwise make
// a question unanswerable-correctly.
function processGameQuestions(rawQuestions) {
  return (Array.isArray(rawQuestions) ? rawQuestions : []).map((q, i) => {
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`question ${i + 1}: missing question text or options`);
    }
    const correct = Number(q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      throw new Error(`question ${i + 1}: correct index out of range`);
    }
    const points = Number(q.points);
    return {
      question: q.question,
      options: q.options.map(String),
      correct,
      explain: typeof q.explain === 'string' ? q.explain : '',
      category: GAME_CATEGORIES.includes(q.category) ? q.category : null,
      points: Number.isFinite(points) && points >= 5 && points <= 15 ? points : 10
    };
  });
}

// Shared by the create route (Player 1, count undecided) and the per-player
// prefetch route (fixed count). Throws on any failure — callers turn that
// into a 502, matching the QP/homework routes' convention.
async function generateGameQuestions(lang, childContext, fixedCount, userContent) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Server is missing ANTHROPIC_API_KEY.');
  const systemPrompt = buildGameQuestionsSystemPrompt(lang, childContext, fixedCount);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      // Up to 15 questions/call (the spec's max per-player count) — scaled
      // up from /api/homework's 3000-token cap (measured for ~5-8 questions
      // in a token-heavy Indic script) with a safety margin on top.
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error('Anthropic API error (game-questions):', response.status, errText);
    throw new Error('Claude API returned an error');
  }
  const data = await response.json();
  let raw = data.content?.[0]?.text || '';
  const fenceMatch = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) raw = fenceMatch[1];
  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.questions)) throw new Error('Response JSON had no "questions" array');
  } catch (parseErr) {
    console.error('Could not parse game-questions JSON:', parseErr.message, 'raw:', raw);
    throw new Error('Claude returned an unexpected response');
  }
  const questions = processGameQuestions(parsed.questions);
  const questionsPerPlayer = fixedCount || Number(parsed.questionsPerPlayer);
  if (!Number.isInteger(questionsPerPlayer) || questionsPerPlayer < 3 || questionsPerPlayer > 15) {
    throw new Error('questionsPerPlayer out of range');
  }
  return { subject: typeof parsed.subject === 'string' ? parsed.subject : null, questionsPerPlayer, questions };
}

// Player identity validation: mother/father have no row anywhere (playerRefId
// must be absent), family_member/student must reference a real row belonging
// to this family — never trust a client-supplied refId blindly, since a
// tampered request could otherwise reference another family's child.
async function validateGamePlayers(familyId, players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    throw new Error('A game needs 2-4 players');
  }
  const { data: members, error: membersErr } = await supabase.from('family_members').select('id, name').eq('family_id', familyId);
  if (membersErr) throw membersErr;
  const { data: students, error: studentsErr } = await supabase.from('students').select('id, name').eq('family_id', familyId);
  if (studentsErr) throw studentsErr;
  const memberById = new Map((members || []).map(m => [m.id, m.name]));
  const studentById = new Map((students || []).map(s => [s.id, s.name]));

  return players.map((p, i) => {
    const turnOrder = i + 1;
    if (p.type === 'mother' || p.type === 'father') {
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : (p.type === 'mother' ? 'Mom' : 'Dad');
      return { turnOrder, playerType: p.type, playerRefId: null, playerName: name };
    }
    if (p.type === 'family_member' && memberById.has(p.refId)) {
      return { turnOrder, playerType: 'family_member', playerRefId: p.refId, playerName: memberById.get(p.refId) };
    }
    if (p.type === 'student' && studentById.has(p.refId)) {
      return { turnOrder, playerType: 'student', playerRefId: p.refId, playerName: studentById.get(p.refId) };
    }
    throw new Error(`Player ${turnOrder}: invalid or unrecognized player`);
  });
}

// Resolves a game_players row's contact info for the remote-invite flow.
// mother/father live in family_registrations' JSONB data blob (phone
// required to have logged in at all; email optional — often absent, see
// the existing mother->father email fallback elsewhere in this file).
// family_member has its own row with phone (nullable) but NO email column
// at all — the invite endpoint's per-invitee delivered:false handling is
// what covers that gap, not this function.
async function resolvePlayerContact(familyId, playerType, playerRefId) {
  if (playerType === 'mother' || playerType === 'father') {
    const { data: family, error } = await supabase.from('family_registrations').select('data').eq('id', familyId).maybeSingle();
    if (error) throw error;
    const info = family?.data?.[playerType] || {};
    return { phone: info.phone || null, email: info.email || null };
  }
  if (playerType === 'family_member') {
    const { data: member, error } = await supabase.from('family_members').select('phone').eq('id', playerRefId).maybeSingle();
    if (error) throw error;
    return { phone: member?.phone || null, email: null };
  }
  return { phone: null, email: null };
}

// Creates the session + all player slots, then generates Player 1's full
// question block in the same call (AI-judged questionsPerPlayer + Player
// 1's questions) — reuses the existing ~20s-wait spinner pattern client-side.
// Correct answers/explanations/categories are never included in the response.
app.post('/api/game-sessions', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { familyId: rawFamilyId, language, players, timeLimitSeconds, lessonContent, childContext } = req.body || {};
    const familyId = parseInt(rawFamilyId, 10);
    if (!requireOwnFamily(req, res, familyId)) return;

    // Family-level free-limit check: unlike Homework Help/Quiz/etc.
    // (checkFreeLimit, per-child), Play-Based Learning's session.completed
    // events carry no student_id (see trackSessionCompleted below — it's
    // tracked family-wide, not per-child), so the cap is 5 free games per
    // family rather than per child. A family is exempt entirely once any
    // participating student in THIS session has a captured payment — a
    // paid family plays Play-Based Learning together unlimited.
    const studentPlayerIds = (Array.isArray(players) ? players : [])
      .filter(p => p && p.type === 'student' && p.refId)
      .map(p => p.refId);

    let familyIsPaid = false;
    if (studentPlayerIds.length) {
      const { count: capturedCount, error: paidErr } = await supabase
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .in('student_id', studentPlayerIds)
        .eq('status', 'captured');
      if (paidErr) throw paidErr;
      familyIsPaid = capturedCount > 0;
    }

    if (!familyIsPaid) {
      const { data: familyEvents, error: familyEventsErr } = await supabase
        .from('usage_events')
        .select('properties')
        .eq('family_id', familyId)
        .eq('event_name', 'session.completed');
      if (familyEventsErr) throw familyEventsErr;
      const familyGameCount = (familyEvents || []).filter(e => e.properties?.feature === 'play_based_learning').length;
      if (familyGameCount >= 5) {
        return res.status(402).json({
          error: 'free_limit_reached',
          bucket: 'play_based_learning_family',
          message: "This family has used all 5 free Play-Based Learning games. Upgrade to continue."
        });
      }
    }

    if (![30, 45, 60].includes(Number(timeLimitSeconds))) {
      return res.status(400).json({ error: 'Invalid timeLimitSeconds' });
    }
    if (!language || typeof language !== 'string') {
      return res.status(400).json({ error: 'Missing language' });
    }
    if (!Array.isArray(lessonContent) || !lessonContent.length || !lessonContent.every(isValidHomeworkContentBlock)) {
      return res.status(400).json({ error: 'Missing or invalid lessonContent' });
    }
    const attachmentCount = lessonContent.filter(b => b.type === 'image' || b.type === 'document').length;
    if (attachmentCount > 1) {
      return res.status(400).json({ error: 'At most 1 photo/PDF attachment is allowed for Play-Based Learning.' });
    }

    let validatedPlayers;
    try {
      validatedPlayers = await validateGamePlayers(familyId, players);
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }

    const { data: session, error: sessionErr } = await supabase.from('game_sessions').insert({
      family_id: familyId, language, player_count: validatedPlayers.length, time_limit_seconds: Number(timeLimitSeconds)
    }).select('id').single();
    if (sessionErr) throw sessionErr;

    const { data: playerRows, error: playersErr } = await supabase.from('game_players')
      .insert(validatedPlayers.map(p => ({
        game_session_id: session.id, turn_order: p.turnOrder, player_type: p.playerType, player_ref_id: p.playerRefId, player_name: p.playerName
      })))
      .select('id, turn_order, player_name');
    if (playersErr) throw playersErr;

    let generated;
    try {
      generated = await generateGameQuestions(language, childContext || 'your child', null, lessonContent);
    } catch (genErr) {
      console.error('Game question generation error (Player 1):', genErr.message);
      return res.status(502).json({ error: 'Could not build a game from this lesson — try attaching the actual lesson page or typing what it\'s about.' });
    }

    await supabase.from('game_sessions').update({
      subject: generated.subject, questions_per_player: generated.questionsPerPlayer
    }).eq('id', session.id);

    trackSessionStarted(familyId, null, { feature: FEATURES.PLAY_BASED_LEARNING });

    const player1 = playerRows.find(p => p.turn_order === 1);
    const { data: questionRows, error: qErr } = await supabase.from('game_questions')
      .insert(generated.questions.map((q, i) => ({
        game_session_id: session.id, game_player_id: player1.id, question_index: i + 1,
        question_text: q.question, options: q.options, correct_index: q.correct,
        explanation: q.explain, cognitive_category: q.category, points_possible: q.points
      })))
      .select('id, questionIndex:question_index, questionText:question_text, options');
    if (qErr) throw qErr;

    res.json({
      gameSessionId: session.id,
      questionsPerPlayer: generated.questionsPerPlayer,
      timeLimitSeconds: Number(timeLimitSeconds),
      players: playerRows.map(p => ({ id: p.id, turnOrder: p.turn_order, name: p.player_name })),
      player1Questions: questionRows.sort((a, b) => a.questionIndex - b.questionIndex)
    });
  } catch (err) {
    console.error('Create game session error:', err);
    res.status(500).json({ error: 'Could not start the game' });
  }
});

// Adults-only invite (mother/father/family_member — children join by
// QR/code, a separate not-yet-built flow, never email). Mints one opaque,
// hashed game_access_tokens row per invited player and emails a join link
// when an address is on file. Always returns joinLink even when delivery
// failed, since family_member has no email column at all and mother/
// father's email is optional — the response lets a future host-side "copy
// link" UI fall back cleanly instead of the invite silently going nowhere.
app.post('/api/game-sessions/:id/invite', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { gamePlayerIds } = req.body || {};
    if (!Array.isArray(gamePlayerIds) || !gamePlayerIds.length) {
      return res.status(400).json({ error: 'Missing gamePlayerIds' });
    }
    const { data: session, error: sessionErr } = await supabase.from('game_sessions').select('id, family_id').eq('id', req.params.id).maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return res.status(404).json({ error: 'Game not found' });
    if (!requireOwnFamily(req, res, session.family_id)) return;

    const { data: players, error: playersErr } = await supabase.from('game_players')
      .select('id, player_type, player_ref_id, player_name').eq('game_session_id', session.id).in('id', gamePlayerIds);
    if (playersErr) throw playersErr;
    if (!players || players.length !== gamePlayerIds.length) {
      return res.status(400).json({ error: 'One or more players were not found in this game' });
    }

    const invited = [];
    for (const player of players) {
      // Children join by QR/code (separate, not-yet-built flow), never
      // email — skipped per-player rather than rejecting the whole batch,
      // since a real game very often mixes a student player with adults
      // and a simple "invite everyone in this game" button shouldn't have
      // to know that in advance.
      if (player.player_type === 'student') {
        invited.push({ gamePlayerId: player.id, playerName: player.player_name, delivered: false, joinLink: null, error: 'Children join by QR/code, not email invite' });
        continue;
      }
      const { phone, email } = await resolvePlayerContact(session.family_id, player.player_type, player.player_ref_id);
      if (!phone) {
        invited.push({ gamePlayerId: player.id, playerName: player.player_name, delivered: false, joinLink: null, error: 'No phone number on file for this family member' });
        continue;
      }

      const rawToken = crypto.randomBytes(32).toString('base64url');
      const { error: tokenErr } = await supabase.from('game_access_tokens').insert({
        token_hash: hashGameToken(rawToken), game_session_id: session.id, game_player_id: player.id,
        holder_type: 'family_login', expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      });
      if (tokenErr) throw tokenErr;

      const joinLink = `https://tutp.online/app/login/?joinGame=${rawToken}`;
      const delivered = email ? await sendGameInviteEmail(player.player_name, email, joinLink) : false;
      invited.push({ gamePlayerId: player.id, playerName: player.player_name, delivered, joinLink });
    }

    res.json({ invited });
  } catch (err) {
    console.error('Game invite error:', err);
    res.status(500).json({ error: 'Could not send invites' });
  }
});

// ------------------------------------------------------------------
// Remote multi-device access for Play-Based Learning (game_access_tokens,
// migration 014). Two ways to prove you belong to a given game session: the
// normal tutp_session cookie (host + any adult who has completed real
// login, including via the OTP-gated magic-link invite) or a
// game_participant bearer token scoped to exactly one
// (game_session_id, game_player_id) seat (class-3+ child QR/code join, no
// account). family_login-holder-type tokens are deliberately NOT accepted
// here — their only job is resolving a phone number for the login page's
// OTP step; presented as a bearer token here, one has no power at all.
// ------------------------------------------------------------------
function hashGameToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function resolveGameAccess(req, res, gameSessionId) {
  const session = getSession(req);
  if (session && session.familyId) {
    const { data: gs, error } = await supabase.from('game_sessions').select('family_id').eq('id', gameSessionId).maybeSingle();
    if (error) throw error;
    if (gs && gs.family_id === session.familyId) return { ok: true, gamePlayerId: null };
  }

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (bearerToken) {
    const { data: tokenRow, error } = await supabase.from('game_access_tokens')
      .select('game_player_id, game_session_id, expires_at, revoked_at, holder_type')
      .eq('token_hash', hashGameToken(bearerToken)).maybeSingle();
    if (error) throw error;
    if (tokenRow && tokenRow.holder_type === 'game_participant' && !tokenRow.revoked_at
      && new Date(tokenRow.expires_at) > new Date() && tokenRow.game_session_id === gameSessionId) {
      return { ok: true, gamePlayerId: tokenRow.game_player_id };
    }
  }

  res.status(403).json({ error: 'Forbidden' });
  return null;
}

// Polled every 3-5s by every connected device once remote play ships —
// status, scores, and whose turn it is (current_turn_order/current_lap,
// advanced server-side by POST /answer — see migration 015). Deliberately
// excludes question text/options/correct answers: those stay scoped to the
// existing per-player /generate and /answer endpoints so a device that
// isn't up can't see another player's current question early.
app.get('/api/game-sessions/:id/state', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const access = await resolveGameAccess(req, res, req.params.id);
    if (!access) return;

    const { data: session, error: sessionErr } = await supabase.from('game_sessions')
      .select('id, status, time_limit_seconds, questions_per_player, subject, current_turn_order, current_lap')
      .eq('id', req.params.id).maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return res.status(404).json({ error: 'Game not found' });

    const { data: players, error: playersErr } = await supabase.from('game_players')
      .select('id, turnOrder:turn_order, name:player_name, score:total_score, correctCount:correct_count')
      .eq('game_session_id', session.id).order('turn_order');
    if (playersErr) throw playersErr;

    res.json({
      gameSessionId: session.id,
      status: session.status,
      timeLimitSeconds: session.time_limit_seconds,
      questionsPerPlayer: session.questions_per_player,
      currentTurnOrder: session.current_turn_order,
      currentLap: session.current_lap,
      players
    });
  } catch (err) {
    console.error('Game state error:', err);
    res.status(500).json({ error: 'Could not load game state' });
  }
});

// A game-join token is unguessable (32 random bytes) so this isn't brute-
// force-critical the way resolveStudentLimiter's name+phone lookup is, but
// it's still a public, unauthenticated endpoint worth capping against
// basic abuse.
const gameInviteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a minute and try again.' }
});

// Public (no session cookie exists yet) — lets the login page discover
// which phone number to send a real Firebase OTP to, and which dashboard/
// game to land on afterward. Read-only and repeatable (safe on page
// reload): never grants access by itself. See /consume below for the
// one-shot step that actually requires a real session and does the work
// of granting anything.
app.post('/api/game-invite/resolve', gameInviteLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const { data: tokenRow, error: tokenErr } = await supabase.from('game_access_tokens')
      .select('game_session_id, game_player_id, expires_at, revoked_at, holder_type')
      .eq('token_hash', hashGameToken(token)).maybeSingle();
    if (tokenErr) throw tokenErr;
    if (!tokenRow || tokenRow.holder_type !== 'family_login' || tokenRow.revoked_at || new Date(tokenRow.expires_at) <= new Date()) {
      return res.status(404).json({ error: 'This invite link is invalid or has expired' });
    }

    const { data: player, error: playerErr } = await supabase.from('game_players')
      .select('player_type, player_ref_id').eq('id', tokenRow.game_player_id).maybeSingle();
    if (playerErr) throw playerErr;
    if (!player) return res.status(404).json({ error: 'This invite link is invalid or has expired' });

    const { data: session, error: sessionErr } = await supabase.from('game_sessions')
      .select('family_id, status').eq('id', tokenRow.game_session_id).maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return res.status(404).json({ error: 'This invite link is invalid or has expired' });

    const { phone } = await resolvePlayerContact(session.family_id, player.player_type, player.player_ref_id);
    if (!phone) return res.status(404).json({ error: 'This invite link is invalid or has expired' });

    res.json({
      phone,
      maskedPhone: phone.length > 4 ? phone.slice(0, -4).replace(/\d/g, '•') + phone.slice(-4) : phone,
      playerType: player.player_type,
      familyId: session.family_id,
      gameSessionId: tokenRow.game_session_id,
      gameEnded: session.status !== 'in_progress'
    });
  } catch (err) {
    console.error('Game invite resolve error:', err);
    res.status(500).json({ error: 'Could not resolve this invite link' });
  }
});

// One-shot — called by the dashboard page right after a real tutp_session
// cookie exists (post-OTP), never by the login page itself. Cross-checks
// the freshly logged-in family actually matches who this token was minted
// for (belt-and-suspenders beyond the OTP itself proving phone ownership),
// then revokes the token so a forwarded/replayed link can't be reused.
app.post('/api/game-invite/consume', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const session = getSession(req);
    if (!session || !session.familyId) return res.status(403).json({ error: 'Forbidden' });

    const { data: tokenRow, error: tokenErr } = await supabase.from('game_access_tokens')
      .select('id, game_session_id, game_player_id, expires_at, revoked_at, holder_type')
      .eq('token_hash', hashGameToken(token)).maybeSingle();
    if (tokenErr) throw tokenErr;
    if (!tokenRow || tokenRow.holder_type !== 'family_login' || tokenRow.revoked_at || new Date(tokenRow.expires_at) <= new Date()) {
      return res.status(404).json({ error: 'This invite link is invalid, expired, or already used' });
    }

    const { data: gameSession, error: gsErr } = await supabase.from('game_sessions').select('family_id').eq('id', tokenRow.game_session_id).maybeSingle();
    if (gsErr) throw gsErr;
    if (!gameSession || gameSession.family_id !== session.familyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: player, error: playerErr } = await supabase.from('game_players')
      .select('turn_order, player_name').eq('id', tokenRow.game_player_id).maybeSingle();
    if (playerErr) throw playerErr;

    await supabase.from('game_access_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenRow.id);

    res.json({ gameSessionId: tokenRow.game_session_id, gamePlayerId: tokenRow.game_player_id, turnOrder: player?.turn_order ?? null, playerName: player?.player_name ?? null });
  } catch (err) {
    console.error('Game invite consume error:', err);
    res.status(500).json({ error: 'Could not join the game' });
  }
});

// Prefetch a later player's question block — fired in the background as
// soon as the previous player's turn starts, so by the time turn order
// reaches them their questions are normally already generated. Idempotent:
// if this player's questions already exist, returns them without
// regenerating (guards against the client firing this twice).
app.post('/api/game-sessions/:id/players/:turnOrder/generate', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { lessonContent, childContext } = req.body || {};
    const { data: session, error: sessionErr } = await supabase.from('game_sessions').select('*').eq('id', req.params.id).maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return res.status(404).json({ error: 'Game not found' });
    if (!requireOwnFamily(req, res, session.family_id)) return;
    if (session.status !== 'in_progress') return res.status(400).json({ error: 'Game is no longer in progress' });
    if (!session.questions_per_player) return res.status(400).json({ error: 'Game has not determined a question count yet' });

    const turnOrder = parseInt(req.params.turnOrder, 10);
    const { data: player, error: playerErr } = await supabase.from('game_players').select('id')
      .eq('game_session_id', session.id).eq('turn_order', turnOrder).maybeSingle();
    if (playerErr) throw playerErr;
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const { data: existing, error: existingErr } = await supabase.from('game_questions')
      .select('id, questionIndex:question_index, questionText:question_text, options').eq('game_player_id', player.id).order('question_index');
    if (existingErr) throw existingErr;
    if (existing && existing.length) return res.json({ questions: existing });

    if (!Array.isArray(lessonContent) || !lessonContent.length || !lessonContent.every(isValidHomeworkContentBlock)) {
      return res.status(400).json({ error: 'Missing or invalid lessonContent' });
    }

    let generated;
    try {
      generated = await generateGameQuestions(session.language, childContext || 'your child', session.questions_per_player, lessonContent);
    } catch (genErr) {
      console.error('Game question generation error (prefetch):', genErr.message);
      return res.status(502).json({ error: 'Could not prepare the next player\'s questions — please try again.' });
    }

    const { data: questionRows, error: qErr } = await supabase.from('game_questions')
      .insert(generated.questions.map((q, i) => ({
        game_session_id: session.id, game_player_id: player.id, question_index: i + 1,
        question_text: q.question, options: q.options, correct_index: q.correct,
        explanation: q.explain, cognitive_category: q.category, points_possible: q.points
      })))
      .select('id, questionIndex:question_index, questionText:question_text, options');
    if (qErr) throw qErr;

    res.json({ questions: questionRows.sort((a, b) => a.questionIndex - b.questionIndex) });
  } catch (err) {
    console.error('Prefetch game questions error:', err);
    res.status(500).json({ error: 'Could not prepare the next player\'s questions' });
  }
});

// Grades one answer server-side, updates that player's running score, and
// advances current_turn_order/current_lap on game_sessions — the single
// place turn state changes now that remote devices need a server-side
// source of truth for whose turn it is (see migration 015). Rejects an
// answer for a player who isn't the currently active turn: with only one
// shared device this could never happen (the UI only ever showed the
// active player's question), but a second device changes that from "can't
// happen" to "must be enforced."
app.post('/api/game-sessions/:id/answer', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { gameQuestionId, selectedIndex, answerTimeSeconds } = req.body || {};
    const { data: session, error: sessionErr } = await supabase.from('game_sessions').select('*').eq('id', req.params.id).maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return res.status(404).json({ error: 'Game not found' });
    if (!requireOwnFamily(req, res, session.family_id)) return;

    const { data: question, error: qErr } = await supabase.from('game_questions').select('*')
      .eq('id', gameQuestionId).eq('game_session_id', session.id).maybeSingle();
    if (qErr) throw qErr;
    if (!question) return res.status(404).json({ error: 'Question not found' });
    if (question.answered_at) return res.status(409).json({ error: 'This question was already answered' });

    const { data: player, error: playerErr } = await supabase.from('game_players').select('turn_order, total_score, correct_count').eq('id', question.game_player_id).single();
    if (playerErr) throw playerErr;
    if (player.turn_order !== session.current_turn_order) {
      return res.status(409).json({ error: "It's not this player's turn yet" });
    }

    const idx = Number.isInteger(selectedIndex) ? selectedIndex : null;
    const isCorrect = idx !== null && idx === question.correct_index;
    const clampedTime = Math.max(0, Math.min(session.time_limit_seconds, Math.round(Number(answerTimeSeconds)) || session.time_limit_seconds));

    const { error: updateQErr } = await supabase.from('game_questions').update({
      selected_index: idx, is_correct: isCorrect, answer_time_seconds: clampedTime, answered_at: new Date().toISOString()
    }).eq('id', question.id);
    if (updateQErr) throw updateQErr;

    if (isCorrect) {
      const { error: scoreErr } = await supabase.from('game_players').update({
        total_score: player.total_score + question.points_possible, correct_count: player.correct_count + 1
      }).eq('id', question.game_player_id);
      if (scoreErr) throw scoreErr;
    }

    let nextTurnOrder = player.turn_order + 1;
    let nextLap = session.current_lap;
    if (nextTurnOrder > session.player_count) {
      nextTurnOrder = 1;
      nextLap = session.current_lap + 1;
    }
    const isGameOver = nextLap >= session.questions_per_player;
    const { error: turnErr } = await supabase.from('game_sessions').update({
      current_turn_order: nextTurnOrder, current_lap: nextLap
    }).eq('id', session.id);
    if (turnErr) throw turnErr;

    res.json({
      isCorrect, correctIndex: question.correct_index, explanation: question.explanation,
      pointsAwarded: isCorrect ? question.points_possible : 0,
      currentTurnOrder: nextTurnOrder, currentLap: nextLap, isGameOver
    });
  } catch (err) {
    console.error('Answer game question error:', err);
    res.status(500).json({ error: 'Could not record the answer' });
  }
});

// Ends the game: computes the winner (score, then the tiebreak below),
// marks the session completed, and — separately, app-wide — checks whether
// this game is now the fastest-completing game today (Game Changer of the
// Day), upserting daily_game_badges if so. Tiebreak, applied in order: (1)
// fewer incorrect-or-unanswered questions ranks higher, (2) lower summed
// answer_time_seconds ranks higher, (3) lower turn_order ranks higher — so
// the ranking is always fully deterministic.
app.post('/api/game-sessions/:id/complete', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const { data: session, error: sessionErr } = await supabase.from('game_sessions').select('*').eq('id', req.params.id).maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return res.status(404).json({ error: 'Game not found' });
    if (!requireOwnFamily(req, res, session.family_id)) return;
    if (session.status === 'completed') return res.status(400).json({ error: 'Game is already completed' });

    const { data: players, error: playersErr } = await supabase.from('game_players').select('*').eq('game_session_id', session.id).order('turn_order');
    if (playersErr) throw playersErr;
    const { data: questions, error: questionsErr } = await supabase.from('game_questions').select('*').eq('game_session_id', session.id).order('question_index');
    if (questionsErr) throw questionsErr;

    const statsByPlayer = new Map(players.map(p => [p.id, { incorrectOrUnanswered: 0, totalAnswerTime: 0 }]));
    for (const q of questions) {
      const stats = statsByPlayer.get(q.game_player_id);
      if (!stats) continue;
      if (!q.is_correct) stats.incorrectOrUnanswered++;
      stats.totalAnswerTime += q.answer_time_seconds || 0;
    }
    const ranked = [...players].sort((a, b) => {
      if (b.total_score !== a.total_score) return b.total_score - a.total_score;
      const sa = statsByPlayer.get(a.id), sb = statsByPlayer.get(b.id);
      if (sa.incorrectOrUnanswered !== sb.incorrectOrUnanswered) return sa.incorrectOrUnanswered - sb.incorrectOrUnanswered;
      if (sa.totalAnswerTime !== sb.totalAnswerTime) return sa.totalAnswerTime - sb.totalAnswerTime;
      return a.turn_order - b.turn_order;
    });
    const winner = ranked[0];

    const completedAt = new Date();
    const totalDurationSeconds = Math.max(0, Math.round((completedAt.getTime() - new Date(session.started_at).getTime()) / 1000));

    const { error: updateErr } = await supabase.from('game_sessions').update({
      status: 'completed', completed_at: completedAt.toISOString(), total_duration_seconds: totalDurationSeconds, winning_game_player_id: winner.id
    }).eq('id', session.id);
    if (updateErr) throw updateErr;

    trackSessionCompleted(session.family_id, null, { feature: FEATURES.PLAY_BASED_LEARNING, durationSeconds: totalDurationSeconds });

    // Game Changer of the Day: replace today's badge holder only if this
    // game is now the fastest completed game today. No cron — correct in
    // real time via this on-write comparison.
    const badgeDate = completedAt.toISOString().slice(0, 10);
    let isGameChangerToday = false;
    const { data: currentBadge, error: badgeReadErr } = await supabase.from('daily_game_badges')
      .select('game_session_id').eq('badge_date', badgeDate).eq('badge_type', 'game_changer_of_the_day').maybeSingle();
    if (badgeReadErr) throw badgeReadErr;
    let currentFastest = Infinity;
    if (currentBadge) {
      const { data: currentSession } = await supabase.from('game_sessions').select('total_duration_seconds').eq('id', currentBadge.game_session_id).maybeSingle();
      currentFastest = currentSession?.total_duration_seconds ?? Infinity;
    }
    if (totalDurationSeconds < currentFastest) {
      const { error: badgeErr } = await supabase.from('daily_game_badges').upsert({
        badge_date: badgeDate, badge_type: 'game_changer_of_the_day', game_session_id: session.id, winning_game_player_id: winner.id
      }, { onConflict: 'badge_date,badge_type' });
      if (badgeErr) throw badgeErr;
      isGameChangerToday = true;
    }

    res.json({
      leaderboard: ranked.map((p, i) => ({ rank: i + 1, playerId: p.id, name: p.player_name, score: p.total_score, correctCount: p.correct_count })),
      winnerId: winner.id,
      isGameChangerToday,
      recap: questions.map(q => ({
        playerId: q.game_player_id, questionIndex: q.question_index, questionText: q.question_text,
        isCorrect: q.is_correct, cognitiveCategory: q.cognitive_category
      }))
    });
  } catch (err) {
    console.error('Complete game session error:', err);
    res.status(500).json({ error: 'Could not finish the game' });
  }
});

// Admin/internal only for now — no public banner yet (2026-09-09 founder
// call: showing another family's child's name to other logged-in families
// is a separate opt-in/privacy decision for post-launch).
app.get('/api/game-changer-of-the-day', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Server is missing Supabase configuration' });
    const today = new Date().toISOString().slice(0, 10);
    const { data: badge, error: badgeErr } = await supabase.from('daily_game_badges')
      .select('game_session_id, winning_game_player_id').eq('badge_date', today).eq('badge_type', 'game_changer_of_the_day').maybeSingle();
    if (badgeErr) throw badgeErr;
    if (!badge) return res.json({ hasData: false });

    const { data: player, error: playerErr } = await supabase.from('game_players').select('player_name, total_score').eq('id', badge.winning_game_player_id).maybeSingle();
    if (playerErr) throw playerErr;
    const { data: session, error: sessionErr } = await supabase.from('game_sessions').select('family_id, total_duration_seconds').eq('id', badge.game_session_id).maybeSingle();
    if (sessionErr) throw sessionErr;

    res.json({ hasData: true, playerName: player?.player_name, score: player?.total_score, durationSeconds: session?.total_duration_seconds, familyId: session?.family_id });
  } catch (err) {
    console.error('Game changer of the day error:', err);
    res.status(500).json({ error: 'Could not fetch today\'s Game Changer' });
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
