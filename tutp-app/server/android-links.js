// Digital Asset Links for the Android app (Trusted Web Activity).
//
// Android checks https://tutp.online/.well-known/assetlinks.json to confirm
// that the app online.tutp.app and this domain belong together; without it
// the app opens with a browser address bar. The statement lives in
// server/android/assetlinks.json (edit it with scripts/android/set-fingerprint.mjs)
// and is served from here because express.static skips dot folders.
//
// The file must be served as application/json at this exact path with no
// redirect, so this handler is mounted before the static middleware.
import fs from 'fs';

export const ASSETLINKS_PATH = '/.well-known/assetlinks.json';

// Every fingerprint in this value means "not set yet": it matches no real certificate.
export const PLACEHOLDER_FINGERPRINT = Array(32).fill('00').join(':');

export function loadAssetLinks(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function assetLinksHandler(file) {
  let statement = null;
  try {
    statement = loadAssetLinks(file);
  } catch (err) {
    console.error('assetlinks.json unreadable, route will answer 404:', err.message);
  }
  const body = statement ? JSON.stringify(statement, null, 2) + '\n' : null;
  return (req, res, next) => {
    if (req.path !== ASSETLINKS_PATH || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    if (!body) return res.status(404).end();
    res.set('Content-Type', 'application/json; charset=utf-8');
    // Short cache: the fingerprint is filled in once and Google re-fetches the file when it verifies.
    res.set('Cache-Control', 'public, max-age=300');
    res.send(body);
  };
}
