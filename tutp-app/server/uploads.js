// Child file uploads (round upload-security, docs/specs/upload-security.md).
// Pure helpers and the storage calls; the routes and the session checks live in
// server.js. Nothing here trusts a client-sent name, type or path.
import crypto from 'crypto';
import { signedUrl } from './lib/signed-url.js';

export const BUCKET = 'family-uploads';
export const MAX_BYTES = 8 * 1024 * 1024;
export const SIGNED_URL_SECONDS = 15 * 60;
export const OPEN_ROUTE = '/api/files/open?path=';

// The type is read from the file's own bytes; the client's contentType is ignored.
export function sniffType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
  }
  return null;
}

// Decodes the base64 body field strictly (no data: prefix, no stray characters).
export function decodeBase64(b64) {
  if (typeof b64 !== 'string' || !b64.length) return null;
  const clean = b64.replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  return Buffer.from(clean, 'base64');
}

// Registration uploads happen before the family exists, so they sit under a
// folder named by a hash of the OTP-verified phone until /api/register moves them.
export function phoneHash(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  return crypto.createHash('sha256').update('tutp-reg:' + digits).digest('hex').slice(0, 24);
}

const NAME = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|webp|heic|pdf)';
const PATH_RE = new RegExp(`^(families/(\\d{1,12})|teachers/([0-9a-fA-F-]{1,64}|\\d{1,12})|registration/([0-9a-f]{24}))/(${NAME})$`);

// 'families/16/<uuid>.jpg' -> { scope: 'families', owner: '16', name }. null for anything else.
export function parseObjectPath(p) {
  if (typeof p !== 'string' || p.length > 200) return null;
  const m = PATH_RE.exec(p);
  if (!m) return null;
  const scope = m[1].split('/')[0];
  return { scope, owner: m[2] ?? m[3] ?? m[4], name: m[5], path: p };
}

export function newObjectPath(scope, owner, ext) {
  return `${scope}/${owner}/${crypto.randomUUID()}.${ext}`;
}

// May this session read this object? Registration objects are never read back.
export function canRead(session, parsed) {
  if (!session || !parsed) return false;
  if (parsed.scope === 'families') return session.familyId != null && String(session.familyId) === parsed.owner;
  if (parsed.scope === 'teachers') return session.teacherId != null && String(session.teacherId) === parsed.owner;
  return false;
}

// Old rows hold the full public url of a root-level object.
export function legacyPathFromUrl(value, supabaseUrl) {
  if (typeof value !== 'string') return null;
  const m = /^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/family-uploads\/(.+?)(?:\?.*)?$/.exec(value);
  if (!m) return null;
  if (supabaseUrl) {
    try { if (new URL(supabaseUrl).host !== new URL(m[1]).host) return null; } catch { return null; }
  }
  try { return decodeURIComponent(m[2]); } catch { return null; }
}

// What the db holds for a file: a new object path, or an old public url.
export function storedKind(value, supabaseUrl) {
  if (typeof value !== 'string' || !value) return { kind: 'none' };
  if (parseObjectPath(value)) return { kind: 'path', path: value };
  const open = value.startsWith(OPEN_ROUTE) ? decodeURIComponent(value.slice(OPEN_ROUTE.length)) : null;
  if (open && parseObjectPath(open)) return { kind: 'path', path: open };
  const legacy = legacyPathFromUrl(value, supabaseUrl);
  if (legacy) return { kind: 'legacy', path: legacy };
  return { kind: 'other' };
}

// Signing is done by the one shared helper (server/lib/signed-url.js); it logs
// and returns null on any failure, which becomes a throw here so callers keep
// their "could not sign" branches.
export async function signPath(supabase, objectPath, seconds = SIGNED_URL_SECONDS) {
  const url = await signedUrl(supabase, BUCKET, objectPath, seconds);
  if (!url) throw new Error('could not sign ' + BUCKET + ' object');
  return url;
}

// A stored value as a link a reader can use now. New paths and old public urls
// become 15 minute signed urls (the caller has already decided this reader may
// see the row). A failed signing keeps the old public url, which still works
// until the bucket is made private; other values are returned unchanged.
export async function toReadable(supabase, value, supabaseUrl, seconds = SIGNED_URL_SECONDS) {
  const k = storedKind(value, supabaseUrl);
  if (k.kind === 'none') return null;
  if (k.kind === 'other') return value;
  try {
    return await signPath(supabase, k.path, seconds);
  } catch (err) {
    console.error('could not sign a stored file:', err.message);
    return k.kind === 'legacy' ? value : null;
  }
}

// /api/register: every file reference in the payload must be an object this
// phone uploaded (registration/<its hash>/...); anything else is dropped.
// Returns the list of paths to move once the family id is known.
export function collectRegistrationFiles(payload, phone) {
  const mine = phoneHash(phone);
  const found = [];
  const keep = (v) => {
    const p = parseObjectPath(typeof v === 'string' ? v : '');
    if (p && p.scope === 'registration' && p.owner === mine) { found.push(p.path); return p.path; }
    return null;
  };
  for (const child of Array.isArray(payload.children) ? payload.children : []) {
    if (child && typeof child === 'object' && 'photoUrl' in child) child.photoUrl = keep(child.photoUrl);
  }
  if ('photoUrl' in payload) payload.photoUrl = keep(payload.photoUrl);
  if (payload.subjectWorkbooks && typeof payload.subjectWorkbooks === 'object') {
    for (const k of Object.keys(payload.subjectWorkbooks)) {
      const v = keep(payload.subjectWorkbooks[k]);
      if (v) payload.subjectWorkbooks[k] = v; else delete payload.subjectWorkbooks[k];
    }
  }
  return [...new Set(found)];
}

export function rewriteRegistrationFiles(payload, moved) {
  const swap = (v) => (typeof v === 'string' && moved[v] ? moved[v] : v);
  for (const child of Array.isArray(payload.children) ? payload.children : []) {
    if (child && typeof child === 'object' && child.photoUrl) child.photoUrl = swap(child.photoUrl);
  }
  if (payload.photoUrl) payload.photoUrl = swap(payload.photoUrl);
  if (payload.subjectWorkbooks) for (const k of Object.keys(payload.subjectWorkbooks)) payload.subjectWorkbooks[k] = swap(payload.subjectWorkbooks[k]);
  return payload;
}

// Moves each registration object into families/<id>/ and returns { old: new }.
// A failed move leaves that file under registration/ (unreadable, not lost).
export async function adoptRegistrationFiles(supabase, paths, familyId) {
  const moved = {};
  for (const from of paths) {
    const parsed = parseObjectPath(from);
    if (!parsed) continue;
    const to = `families/${familyId}/${parsed.name}`;
    const { error } = await supabase.storage.from(BUCKET).move(from, to);
    if (error) console.error('could not move a registration file:', error.message);
    else moved[from] = to;
  }
  return moved;
}
