// The one place that decides which language a request is in.
//
//   resolveLanguage({ requested, session }) -> { language, source }
//     1. requested  the language the page sent, when it is one of HOMEWORK_LANGUAGES
//     2. parent     the language this parent chose ("Explanations in which language?" at
//                   registration or on the family page), stored per parent
//     3. last       the language this family last used (the newest session.started event)
//     4. default    English
// source is 'page' | 'parent' | 'last' | 'default'. Resolve once per request, then pass that
// one value to every model call, label, check and picture; never read the browser language
// for what a card says. Before this, nine routes each fell back to 'English' on their
// own while the page's labels fell back to the browser language (2026-10-14: the same
// PDF came out in Telugu, then in English with Hindi labels).
//
// The page's own value stays first on purpose: the modal fills "Explain in" from this
// function, so a parent who changes it there must be obeyed.
import { HOMEWORK_LANGUAGES } from './prompts/homework-prompts.js';

let supabase = null;
let rolesOf = async () => [];
// rolesOf(session) -> the roles this session holds in its family ('mother', 'father', ...)
export function initLanguage(client, opts = {}) {
  supabase = client;
  if (typeof opts.rolesOf === 'function') rolesOf = opts.rolesOf;
}

export const DEFAULT_LANGUAGE = 'English';
export const PARENT_ROLES = ['mother', 'father'];

export const isLanguage = (v) => typeof v === 'string' && HOMEWORK_LANGUAGES.includes(v);

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// The parent role a session holds, or ''.
export const parentRoleOf = (roles) => (Array.isArray(roles) ? roles.find((r) => PARENT_ROLES.includes(r)) : '') || '';

// The language this parent chose, or '' (not chosen, not a parent, no database, a lookup error).
export async function parentLanguageOf(session, client = supabase, roleFn = rolesOf) {
  if (!client || !session || !session.familyId) return '';
  try {
    const role = parentRoleOf(await roleFn(session));
    if (!role) return '';
    const { data, error } = await client.from('family_registrations').select('data').eq('id', session.familyId).maybeSingle();
    if (error) return '';
    const chosen = data && data.data && data.data[role] && data.data[role].language;
    return isLanguage(chosen) ? chosen : '';
  } catch { return ''; }
}

// The language this family used last, or '' (no history, no database, a lookup error).
export async function lastLanguageUsed(familyId, client = supabase) {
  if (!client || !familyId) return '';
  try {
    const { data, error } = await client.from('usage_events').select('properties')
      .eq('family_id', familyId).eq('event_name', 'session.started')
      .order('created_at', { ascending: false }).limit(10);
    if (error) return '';
    const hit = (data || []).map((r) => r.properties && r.properties.language).find(isLanguage);
    return hit || '';
  } catch { return ''; }
}

export async function resolveLanguage({ requested, session } = {}, client = supabase, roleFn = rolesOf) {
  if (isLanguage(requested)) return { language: requested, source: 'page' };
  const chosen = await parentLanguageOf(session, client, roleFn);
  if (chosen) return { language: chosen, source: 'parent' };
  const last = await lastLanguageUsed(session && session.familyId, client);
  if (last) return { language: last, source: 'last' };
  return { language: DEFAULT_LANGUAGE, source: 'default' };
}

// Registration: the form sends one top-level `parent_language`. It belongs to the parent whose
// phone was just verified (decided here, never by the client); any language a client put inside
// mother/father is dropped first. Mutates and returns the payload.
export function applyRegistrationLanguage(payload, verifiedPhone) {
  const asked = payload.parent_language;
  delete payload.parent_language;
  for (const slot of PARENT_ROLES) {
    if (payload[slot] && typeof payload[slot] === 'object') { payload[slot] = { ...payload[slot] }; delete payload[slot].language; }
  }
  if (!isLanguage(asked)) return payload;
  const slot = PARENT_ROLES.find((s) => payload[s] && last10(payload[s].phone) === verifiedPhone);
  if (slot) payload[slot].language = asked;
  return payload;
}

// The family page: store the language on this parent only. Returns { ok } or { ok: false, status, error }.
export async function saveParentLanguage({ client = supabase, familyId, role, language }) {
  if (!PARENT_ROLES.includes(role)) return { ok: false, status: 403, error: 'Only a parent can choose the explanation language.' };
  if (!isLanguage(language)) return { ok: false, status: 400, error: 'Choose one of the listed languages.' };
  const { data: row, error } = await client.from('family_registrations').select('data').eq('id', familyId).maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, status: 404, error: 'Family not found.' };
  const data = { ...(row.data || {}) };
  data[role] = { ...(data[role] || {}), language };
  const { error: upErr } = await client.from('family_registrations').update({ data }).eq('id', familyId);
  if (upErr) throw upErr;
  return { ok: true, language };
}
