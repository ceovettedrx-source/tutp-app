// The one place that decides which language a request is in (docs: fix/explain-language).
//
//   resolveLanguage({ requested, session }) -> { language, source }
//     1. requested  the language the page sent, when it is one of HOMEWORK_LANGUAGES
//     2. last       the language this family last used (the newest session.started event)
//     3. default    English
// source is 'page' | 'last' | 'default'. Resolve once per request, then pass that one
// value to every model call, label, check and picture; never read the browser language
// for what a card says. Before this, nine routes each fell back to 'English' on their
// own while the page's labels fell back to the browser language (2026-10-14: the same
// PDF came out in Telugu, then in English with Hindi labels).
import { HOMEWORK_LANGUAGES } from './prompts/homework-prompts.js';

let supabase = null;
export function initLanguage(client) { supabase = client; }

export const DEFAULT_LANGUAGE = 'English';

export const isLanguage = (v) => typeof v === 'string' && HOMEWORK_LANGUAGES.includes(v);

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

export async function resolveLanguage({ requested, session } = {}, client = supabase) {
  if (isLanguage(requested)) return { language: requested, source: 'page' };
  const last = await lastLanguageUsed(session && session.familyId, client);
  if (last) return { language: last, source: 'last' };
  return { language: DEFAULT_LANGUAGE, source: 'default' };
}
