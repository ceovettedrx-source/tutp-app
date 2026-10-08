// Google Cloud Text-to-Speech over REST (no client library). The access token comes
// from the Cloud Run metadata server (see token.js); the service account needs the
// texttospeech API enabled, nothing else.
export const GOOGLE_LANGS = {
  'en-IN': 'en-IN', 'hi-IN': 'hi-IN', 'te-IN': 'te-IN', 'ta-IN': 'ta-IN', 'mr-IN': 'mr-IN',
  'kn-IN': 'kn-IN', 'ml-IN': 'ml-IN', 'bn-IN': 'bn-IN', 'gu-IN': 'gu-IN', 'pa-IN': 'pa-IN',
  'es-ES': 'es-ES', 'fr-FR': 'fr-FR', 'de-DE': 'de-DE', 'ar-XA': 'ar-XA',
};

export function googleRequestBody({ text, lang, voice }) {
  const v = { languageCode: GOOGLE_LANGS[lang] };
  if (voice && voice !== 'default') v.name = voice; else v.ssmlGender = 'FEMALE';
  return { input: { text }, voice: v, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 } };
}

export async function synthesizeGoogle({ fetchImpl = fetch, getToken, text, lang, voice }) {
  const token = await getToken();
  const r = await fetchImpl('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(googleRequestBody({ text, lang, voice })),
  });
  if (!r.ok) throw new Error('google tts ' + r.status);
  const j = await r.json();
  if (!j || !j.audioContent) throw new Error('google tts: no audio');
  return Buffer.from(j.audioContent, 'base64');
}
