// Private Cloud Storage bucket cache for TTS audio (JSON API over fetch, no library).
// TTS_CACHE_BUCKET unset = no cache (every request is generated). Cache failures never
// fail a Listen request.
import { metadataToken } from './token.js';

export const defaultGetToken = metadataToken;

export function createBucketCache({ env = process.env, fetchImpl = fetch, getToken = defaultGetToken } = {}) {
  const bucket = () => env.TTS_CACHE_BUCKET || '';
  return {
    async get(key) {
      if (!bucket()) return null;
      const r = await fetchImpl(`https://storage.googleapis.com/storage/v1/b/${bucket()}/o/${encodeURIComponent(key)}?alt=media`, {
        headers: { Authorization: 'Bearer ' + await getToken() },
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('bucket read ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    },
    async put(key, audio) {
      if (!bucket()) return;
      const r = await fetchImpl(`https://storage.googleapis.com/upload/storage/v1/b/${bucket()}/o?uploadType=media&name=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + await getToken(), 'Content-Type': 'audio/mpeg' },
        body: audio,
      });
      if (!r.ok) throw new Error('bucket write ' + r.status);
    },
  };
}
