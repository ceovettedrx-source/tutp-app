import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

const DATA_DIR = path.join(__dirname, 'data');
const WAITLIST_FILE = path.join(DATA_DIR, 'waitlist.jsonl');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '12mb' })); // homework photos can be a few MB as base64
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// Waitlist capture — powers the "Join waitlist" form on the homepage.
//
// NOTE on storage: Cloud Run instances are ephemeral. This file is a
// best-effort local log so you can see signups quickly (also printed
// to Cloud Run logs, which persist). For guaranteed persistence across
// deploys/restarts, keep min-instances=1 during the launch window and
// periodically export via GET /api/waitlist (see ADMIN_TOKEN below),
// or wire this endpoint to a Google Sheet via Apps Script later.
// ------------------------------------------------------------------
app.post('/api/waitlist', (req, res) => {
  try {
    const { name, email, role, message } = req.body || {};

    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Missing name, email or role' });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return res.status(400).json({ error: 'That email address does not look valid' });
    }

    const entry = {
      name: String(name).slice(0, 120),
      email: String(email).slice(0, 200),
      role: String(role).slice(0, 40),
      message: message ? String(message).slice(0, 2000) : '',
      ts: new Date().toISOString()
    };

    fs.appendFileSync(WAITLIST_FILE, JSON.stringify(entry) + '\n');
    console.log('New waitlist signup:', entry.name, entry.email, entry.role);

    res.json({ ok: true });
  } catch (err) {
    console.error('Waitlist error:', err);
    res.status(500).json({ error: 'Server error saving your signup' });
  }
});

// Simple protected export so you can pull signups without SSH-ing in.
// Visit: /api/waitlist?token=YOUR_ADMIN_TOKEN
// Set ADMIN_TOKEN via: gcloud run services update <service> --update-env-vars ADMIN_TOKEN=some-long-secret
app.get('/api/waitlist', (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const raw = fs.existsSync(WAITLIST_FILE) ? fs.readFileSync(WAITLIST_FILE, 'utf8') : '';
    const rows = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    res.json({ count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not read waitlist' });
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
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it with: gcloud run services update <service> --update-secrets ANTHROPIC_API_KEY=...' });
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
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tut-P server running on port ${PORT}`);
});
