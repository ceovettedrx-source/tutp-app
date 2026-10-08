// ElevenLabs slot (TUT-7). Off until TTS_PROVIDER=elevenlabs and ELEVENLABS_API_KEY
// (secret elevenlabs-api-key) are set. One voice id per language in
// ELEVENLABS_VOICE_<LANG> (EN, HI, TE, ...); a language without one falls back to
// Google in index.js, and so does any error thrown here.
export function elevenVoiceFor(env, lang) {
  return env['ELEVENLABS_VOICE_' + lang.replace(/-.*/, '').toUpperCase()] || null;
}

export async function synthesizeElevenLabs({ env, fetchImpl = fetch, text, voiceId }) {
  const r = await fetchImpl('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId), {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' }),
  });
  if (!r.ok) throw new Error('elevenlabs ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
