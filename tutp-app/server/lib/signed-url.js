// Short-lived signed URLs for files in a PRIVATE Supabase Storage bucket.
// Shared on purpose: the later upload-security fix (the family-uploads
// bucket is public today) reuses it. Answer/Explain v2 uses it for the
// "illustrations" bucket (docs/specs/answer-explain-v2.md).
//
//   signedUrl(supabase, bucket, objectPath, ttlSeconds?) -> url string, or null
//   uploadPrivate(supabase, bucket, objectPath, buffer, contentType) -> true/false
//
// Both log and return null/false on any error (callers decide the fallback);
// neither ever builds a public URL.

export const DEFAULT_TTL_SECONDS = 300;
export const MAX_TTL_SECONDS = 3600;

export function clampTtl(ttl) {
  const n = Number(ttl);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(n), MAX_TTL_SECONDS);
}

// Object paths are made by the server, never taken from a caller: letters,
// digits, dot, dash, underscore and single slashes only, no "..".
export function safeObjectPath(p) {
  return typeof p === 'string' && p.length > 0 && p.length <= 300
    && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(p) && !p.includes('..');
}

export async function signedUrl(supabase, bucket, objectPath, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!supabase || !bucket || !safeObjectPath(objectPath)) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, clampTtl(ttlSeconds));
    if (error || !data || !data.signedUrl) {
      console.error('signed-url: could not sign', { bucket, error: error && error.message });
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.error('signed-url: error', { bucket, error: err && err.message });
    return null;
  }
}

export async function uploadPrivate(supabase, bucket, objectPath, buffer, contentType) {
  if (!supabase || !bucket || !safeObjectPath(objectPath) || !buffer) return false;
  try {
    const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, { contentType, upsert: true });
    if (error) { console.error('signed-url: upload failed', { bucket, error: error.message }); return false; }
    return true;
  } catch (err) {
    console.error('signed-url: upload error', { bucket, error: err && err.message });
    return false;
  }
}

// The bytes of a file in a private bucket (server side only), or null.
export async function downloadPrivate(supabase, bucket, objectPath) {
  if (!supabase || !bucket || !safeObjectPath(objectPath)) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).download(objectPath);
    if (error || !data) { console.error('signed-url: download failed', { bucket, error: error && error.message }); return null; }
    return Buffer.from(await data.arrayBuffer());
  } catch (err) {
    console.error('signed-url: download error', { bucket, error: err && err.message });
    return null;
  }
}
