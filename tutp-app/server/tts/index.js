// Server voice for Listen (TUT-7). TTS_PROVIDER = google (default) | elevenlabs.
//   speak({ text, lang, familyVoice? }) -> { audio: Buffer, mime, provider, voice, cached }
// Google Cloud TTS is the voice today. ElevenLabs is a slot: it needs the secret
// ELEVENLABS_API_KEY plus a voice id per language (ELEVENLABS_VOICE_<LANG>), and any
// failure or missing language falls back to Google. `familyVoice` is the hook for a
// grandparent voice clone later (an ElevenLabs voice id per family).
// Audio is cached per (provider, voice, language, text hash) in a private bucket and
// served through /api/tts, so no signed URLs are needed.
import crypto from 'crypto';
import { synthesizeGoogle, GOOGLE_LANGS } from './google.js';
import { synthesizeElevenLabs, elevenVoiceFor } from './elevenlabs.js';
import { createBucketCache } from './cache.js';
import { metadataToken } from './token.js';

export const MAX_TTS_CHARS = 4000;
export const TTS_LANGS = Object.keys(GOOGLE_LANGS);

export function cacheKey({ provider, voice, lang, text }) {
  const h = crypto.createHash('sha256').update([provider, voice, lang, text].join('\u0000')).digest('hex');
  return `tts/${provider}/${lang}/${h}.mp3`;
}

export function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function createTts({ env = process.env, fetchImpl = fetch, getToken = () => metadataToken(), cache } = {}) {
  const store = cache || createBucketCache({ env, fetchImpl, getToken });
  const wanted = () => (String(env.TTS_PROVIDER || 'google').toLowerCase() === 'elevenlabs' ? 'elevenlabs' : 'google');

  // The provider and voice that would serve this request (no network).
  function plan({ lang, familyVoice }) {
    if (wanted() === 'elevenlabs' && env.ELEVENLABS_API_KEY) {
      const v = familyVoice || elevenVoiceFor(env, lang);
      if (v) return { provider: 'elevenlabs', voice: v };
    }
    return { provider: 'google', voice: (env['TTS_VOICE_' + lang.replace(/-.*/, '').toUpperCase()] || 'default') };
  }

  async function generate(p, text, lang) {
    if (p.provider === 'elevenlabs') {
      try { return { ...p, audio: await synthesizeElevenLabs({ env, fetchImpl, text, voiceId: p.voice }) }; }
      catch (e) { console.error('tts elevenlabs failed, using google:', e.message); }
      const g = { provider: 'google', voice: 'default' };
      return { ...g, audio: await synthesizeGoogle({ fetchImpl, getToken, text, lang, voice: g.voice }) };
    }
    return { ...p, audio: await synthesizeGoogle({ fetchImpl, getToken, text, lang, voice: p.voice }) };
  }

  async function speak({ text, lang, familyVoice = null }) {
    text = cleanText(text);
    if (!text) throw Object.assign(new Error('empty text'), { code: 'bad_request' });
    if (text.length > MAX_TTS_CHARS) throw Object.assign(new Error('text too long'), { code: 'too_long' });
    if (!GOOGLE_LANGS[lang]) throw Object.assign(new Error('unsupported language'), { code: 'bad_lang' });
    const p = plan({ lang, familyVoice });
    const key = cacheKey({ ...p, lang, text });
    try {
      const hit = await store.get(key);
      if (hit) return { audio: hit, mime: 'audio/mpeg', provider: p.provider, voice: p.voice, cached: true };
    } catch (e) { console.error('tts cache read failed:', e.message); }
    const made = await generate(p, text, lang);
    // A fallback to google is stored under its own key, not the elevenlabs one.
    const saveKey = made.provider === p.provider ? key : cacheKey({ ...made, lang, text });
    store.put(saveKey, made.audio).catch((e) => console.error('tts cache write failed:', e.message));
    return { audio: made.audio, mime: 'audio/mpeg', provider: made.provider, voice: made.voice, cached: false };
  }

  return { speak, plan };
}
