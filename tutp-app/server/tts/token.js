// Access token of the Cloud Run service account, from the metadata server, cached
// until a minute before it expires. Outside Google Cloud there is none, and TTS
// fails (the page then falls back to the browser voice).
let cached = { token: '', exp: 0 };

export async function metadataToken(fetchImpl = fetch, now = Date.now) {
  if (cached.token && cached.exp - 60000 > now()) return cached.token;
  const r = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!r.ok) throw new Error('metadata token ' + r.status);
  const j = await r.json();
  cached = { token: j.access_token, exp: now() + (Number(j.expires_in) || 300) * 1000 };
  return cached.token;
}
