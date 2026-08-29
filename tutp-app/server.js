import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import rateLimit from 'express-rate-limit';
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

app.use(express.json({ limit: '12mb' })); // photo uploads travel as base64
app.use(express.static(path.join(__dirname, 'public')));

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
    const studentRows = children.filter(c => c && c.name).map(c => ({
      family_id: data.id,
      name: c.name,
      school_name: c.schoolName || null,
      class: c.class || null,
      section: c.section || null,
      roll_number: c.rollNumber || null
    }));
    if (studentRows.length) {
      const { error: studentsErr } = await supabase.from('students').insert(studentRows);
      if (studentsErr) console.error('Could not save students rows (registration itself still succeeded):', studentsErr.message);
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

    console.log('New family registration:', children[0].name, 'id:', data.id, 'children:', children.length);
    res.json({ ok: true, id: data.id });
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
      // Pass 2: name is now just a hint — roll_number/section decides it.
      const candidates = students.filter(s =>
        isCloseNameMatch(name, s.name) &&
        ((roll_number && s.roll_number && String(s.roll_number).trim().toLowerCase() === String(roll_number).trim().toLowerCase()) ||
         (section && s.section && String(s.section).trim().toLowerCase() === String(section).trim().toLowerCase()))
      );
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
      .select('name, relationship, phone')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ members: data || [] });
  } catch (err) {
    console.error('Get family members error:', err);
    res.status(500).json({ error: 'Could not fetch family members' });
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
