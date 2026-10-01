// Chip logging base: what the chips and the typed instructions are used for,
// so the (later) adaptive engine has real data. One row per event in
// search_chip_events (supabase/migrations/030_search_chip_events.sql):
//   kind (impression | tap | submit), chip id, classified intent, language,
//   class band, board, date (IST), family hash, and a scrubbed phrase of at
//   most 6 words only when the intent is "other".
// Never stored: images, the full text, the family id, the child's name.
// A phrase is cleared after 30 days (prune below). Test families are not
// logged. A missing table is tolerated: logging switches itself off for 10
// minutes and the page works as before.
import crypto from 'crypto';
import { INTENTS } from './intent.js';
import { scrubPhrase } from './scrub.js';

export const CHIP_IDS = ['answer', 'explain', 'notes', 'exam_prep'];
export const EVENT_KINDS = ['impression', 'tap', 'submit'];
const LANGUAGES = ['English', 'Hindi', 'Telugu', 'Tamil', 'Marathi', 'Spanish', 'French', 'German', 'Arabic'];
const BOARDS = { 'state board': 'state_board', cbse: 'cbse', icse: 'icse', cambridge: 'cambridge', other: 'other' };
const PHRASE_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const MISSING_TABLE_MS = 10 * 60 * 1000;
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// HMAC of the family id: the same family gives the same hash (so distinct
// families can be counted), and the id cannot be read back from it. The key
// is the env var CHIP_HASH_SALT (a Secret Manager secret, attached with
// secretKeyRef like the other secrets). There is NO fallback key: without it
// (or with a short one) logging switches itself off. The key is never logged.
const MIN_KEY_LENGTH = 16;
export function chipHashKey() {
  const key = process.env.CHIP_HASH_SALT;
  return typeof key === 'string' && key.length >= MIN_KEY_LENGTH ? key : null;
}
export function familyHash(familyId, key = chipHashKey()) {
  if (!key) throw new Error('chip hash key is not set');
  return crypto.createHmac('sha256', key).update('family:' + String(familyId)).digest('hex').slice(0, 24);
}

export function classBand(classText) {
  const s = String(classText || '').toLowerCase();
  if (/nursery|lkg|ukg|kg|pre/.test(s)) return 'pre';
  const m = s.match(/\d{1,2}/);
  if (!m) return 'unknown';
  const n = Number(m[0]);
  if (n >= 1 && n <= 2) return '1-2';
  if (n <= 5 && n >= 3) return '3-5';
  if (n >= 6 && n <= 8) return '6-8';
  if (n === 9 || n === 10) return '9-10';
  if (n === 11 || n === 12) return '11-12';
  return 'unknown';
}

// The board is in the registration form's data (children[].curriculum): the
// child with this name, else the first child.
export function boardOf(registrationData, studentName) {
  const kids = registrationData && Array.isArray(registrationData.children) ? registrationData.children : [];
  const kid = kids.find((c) => c && studentName && String(c.name || '').trim().toLowerCase() === String(studentName).trim().toLowerCase()) || kids[0];
  const raw = kid && typeof kid.curriculum === 'string' ? kid.curriculum.trim().toLowerCase() : '';
  return BOARDS[raw] || 'unknown';
}

export function istDate(ms = Date.now()) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// One validated row, or null. text is the typed instruction (submit events
// only): it is scrubbed here and never stored as it is.
export function buildEventRow(ev, ctx) {
  if (!ev || !EVENT_KINDS.includes(ev.kind)) return null;
  const chip = ev.chip == null ? null : String(ev.chip);
  if (chip !== null && !CHIP_IDS.includes(chip)) return null;
  const intent = ev.intent == null ? null : String(ev.intent);
  if (intent !== null && !INTENTS.includes(intent)) return null;
  return {
    kind: ev.kind,
    chip_id: chip,
    intent,
    language: LANGUAGES.includes(ev.language) ? ev.language : 'English',
    class_band: ctx.classBand,
    board: ctx.board,
    event_date: istDate(ctx.now),
    family_hash: ctx.familyHash,
    phrase: ev.kind === 'submit' && intent === 'other' ? scrubPhrase(ev.text, ctx.names) : null,
  };
}

export function createChipLog({ supabase, isTestFamily }) {
  let missingUntil = 0;
  let warnedNoKey = false;
  let lastPrune = 0;
  const contexts = new Map();

  async function context(familyId, studentId) {
    const key = familyId + ':' + (studentId || '');
    const hit = contexts.get(key);
    if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.value;
    let student = null;
    let reg = null;
    try {
      if (studentId) {
        const r = await supabase.from('students').select('name, class').eq('id', studentId).maybeSingle();
        student = r.data || null;
      }
      const r2 = await supabase.from('family_registrations').select('data').eq('id', familyId).maybeSingle();
      reg = r2.data ? r2.data.data : null;
    } catch (err) {
      console.warn('chip log: context lookup failed:', err && err.message);
    }
    const value = {
      classBand: classBand(student && student.class),
      board: boardOf(reg, student && student.name),
      familyHash: familyHash(familyId),
      names: [student && student.name, ...(reg && Array.isArray(reg.children) ? reg.children.map((c) => c && c.name) : [])].filter(Boolean),
    };
    contexts.set(key, { at: Date.now(), value });
    return value;
  }

  async function prune() {
    if (Date.now() - lastPrune < PRUNE_EVERY_MS) return;
    lastPrune = Date.now();
    const cutoff = new Date(Date.now() - PHRASE_DAYS * 86400000).toISOString();
    const { error } = await supabase.from('search_chip_events').update({ phrase: null }).not('phrase', 'is', null).lt('created_at', cutoff);
    if (error) console.warn('chip log: prune failed:', error.code || '');
  }

  // events: [{ kind, chip, intent, language, text? }]. Never throws.
  async function record(familyId, studentId, events) {
    try {
      if (!supabase || !familyId || Date.now() < missingUntil) return;
      if (!chipHashKey()) {
        if (!warnedNoKey) { warnedNoKey = true; console.warn('chip log: CHIP_HASH_SALT is not set (or shorter than 16 characters); chip logging is off'); }
        return;
      }
      if (await isTestFamily(familyId)) return;
      const ctx = { ...(await context(familyId, studentId)), now: Date.now() };
      const rows = (events || []).slice(0, 12).map((e) => buildEventRow(e, ctx)).filter(Boolean);
      if (!rows.length) return;
      const { error } = await supabase.from('search_chip_events').insert(rows);
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205' || /search_chip_events/.test(error.message || '')) {
          missingUntil = Date.now() + MISSING_TABLE_MS;
          console.warn('chip log: search_chip_events is missing (run migration 030); logging paused');
        } else {
          console.warn('chip log: insert failed:', error.code || '');
        }
        return;
      }
      await prune();
    } catch (err) {
      console.warn('chip log: failed:', err && err.message);
    }
  }

  return { record };
}
