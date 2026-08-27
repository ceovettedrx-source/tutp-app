import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

// ------------------------------------------------------------------
// Email — sends the waitlist confirmation via Gmail SMTP. If not
// configured, signups still succeed (email is best-effort, fire-and-forget).
// ------------------------------------------------------------------
let mailer = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
} else {
  console.warn('GMAIL_USER / GMAIL_APP_PASSWORD not set — waitlist confirmation emails are disabled.');
}

async function sendWaitlistEmail(name, email) {
  if (!mailer) return;
  try {
    await mailer.sendMail({
      from: `"Tut-P" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "You're on the Tut-P waitlist! 🎉",
      text: `Hi ${name},\n\nThanks for joining the Tut-P waitlist! We'll email you at ${email} the moment early access opens.\n\nIn the meantime, you can try our working demo here: https://tutp.online/demo/\n\n- The Tut-P team`,
      html: `<p>Hi ${name},</p><p>Thanks for joining the Tut-P waitlist! We'll email you at <strong>${email}</strong> the moment early access opens.</p><p>In the meantime, you can try our working demo here: <a href="https://tutp.online/demo/">tutp.online/demo</a></p><p>— The Tut-P team</p>`
    });
    console.log('Confirmation email sent to', email);
  } catch (err) {
    console.error('Email send failed (signup still saved):', err.message);
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

app.use(express.json({ limit: '12mb' })); // homework photos can be a few MB as base64
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

// Simple health check — useful for confirming the server is alive after deploy
app.get('/health', (req, res) => res.json({ status: 'ok', supabase: !!supabase, email: !!mailer }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tut-P server running on port ${PORT}`);
});
