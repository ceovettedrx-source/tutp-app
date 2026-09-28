// Cache-safe static JS/CSS: every local script, stylesheet and module import
// in public/ is served as /path.js?v=<content hash>, so a deploy that changes
// a file changes its URL and no browser or proxy can keep the old copy
// (2026-09-28: phones kept a stale /app/shared/auth-messages.js, which only
// phone-auth.js imports, after traffic moved to 00301-roj).
//
//   versioned (?v= matches the file's current hash) -> cached for a year, immutable
//   anything else (no ?v=, an old hash, HTML)       -> no-cache (revalidate every time)
//
// A JS file's hash is taken after its own imports are rewritten, so a change
// to auth-messages.js also gives phone-auth.js a new URL.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';

// Root-relative local paths only ("/x.js", not "//cdn/x.js" or "https://..."),
// with no query or hash already on them.
const LOCAL = String.raw`\/[^\/"'?#\s][^"'?#\s]*`;
const TAG_REF = new RegExp(String.raw`(\b(?:src|href)\s*=\s*)(["'])(${LOCAL}\.(?:m?js|css))\2`, 'g');
const IMPORT_REF = new RegExp(String.raw`(\bfrom\s*|\bimport\s*\(?\s*)(["'])(${LOCAL}\.m?js)\2`, 'g');

export function isVersioned(urlPath) {
  return /\.(?:m?js|css)$/.test(urlPath);
}

// readFile(urlPath) -> Buffer, or null when there is no such file.
export function createAssetVersions(readFile) {
  const assets = new Map();   // urlPath -> { body, version } | null
  const visiting = new Set();

  function rewrite(text, versionOf) {
    const add = (whole, lead, quote, ref) => {
      const v = versionOf(ref);
      return v ? `${lead}${quote}${ref}?v=${v}${quote}` : whole;
    };
    return text.replace(TAG_REF, add).replace(IMPORT_REF, add);
  }

  function asset(urlPath) {
    if (assets.has(urlPath)) return assets.get(urlPath);
    if (!isVersioned(urlPath) || visiting.has(urlPath)) return null; // a cycle stays unversioned
    const raw = readFile(urlPath);
    if (!raw) { assets.set(urlPath, null); return null; }
    visiting.add(urlPath);
    const body = urlPath.endsWith('.css') ? raw : Buffer.from(rewrite(raw.toString('utf8'), versionOf));
    visiting.delete(urlPath);
    const entry = { body, version: crypto.createHash('sha256').update(body).digest('hex').slice(0, 10) };
    assets.set(urlPath, entry);
    return entry;
  }

  function versionOf(urlPath) {
    const a = asset(urlPath);
    return a ? a.version : null;
  }

  const pages = new Map();
  function html(urlPath) {
    if (!pages.has(urlPath)) {
      const raw = readFile(urlPath);
      pages.set(urlPath, raw ? rewrite(raw.toString('utf8'), versionOf) : null);
    }
    return pages.get(urlPath);
  }

  return { asset, versionOf, html };
}

// Reads urlPath under publicDir, refusing anything outside it or dotfiles
// (express.static's default).
export function publicReader(publicDir) {
  const root = path.resolve(publicDir);
  return (urlPath) => {
    if (urlPath.split('/').some(s => s.startsWith('.'))) return null;
    const file = path.resolve(root, '.' + urlPath);
    if (!file.startsWith(root + path.sep)) return null;
    try {
      return fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
    } catch {
      return null;
    }
  };
}

// Serves HTML pages and JS/CSS from public/ with versioned URLs. Anything
// else falls through to express.static. On Cloud Run (K_SERVICE set) files
// never change, so the table is built once; locally it is rebuilt per
// request so edits show without a restart.
export function staticAssets(publicDir) {
  const read = publicReader(publicDir);
  let table = null;
  const getTable = () => (process.env.K_SERVICE ? (table ||= createAssetVersions(read)) : createAssetVersions(read));

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let urlPath;
    try { urlPath = decodeURIComponent(req.path); } catch { return next(); }
    if (urlPath.endsWith('/')) urlPath += 'index.html';

    const t = getTable();
    if (urlPath.endsWith('.html')) {
      const page = t.html(urlPath);
      if (page == null) return next();
      res.set('Cache-Control', REVALIDATE);
      res.type('html');
      return res.send(page);
    }
    if (isVersioned(urlPath)) {
      const a = t.asset(urlPath);
      if (!a) return next();
      res.set('Cache-Control', req.query.v === a.version ? IMMUTABLE : REVALIDATE);
      // charset explicit: a Buffer body gets none by default (Telugu text).
      res.set('Content-Type', (urlPath.endsWith('.css') ? 'text/css' : 'text/javascript') + '; charset=utf-8');
      return res.send(a.body);
    }
    next();
  };
}
