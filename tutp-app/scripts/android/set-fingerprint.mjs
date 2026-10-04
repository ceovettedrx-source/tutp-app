// Fills the real signing-certificate fingerprint(s) into the Digital Asset Links file.
//
//   node scripts/android/set-fingerprint.mjs <SHA-256> [<SHA-256> ...] [--add] [--file <path>]
//   node scripts/android/set-fingerprint.mjs --check        (is a real fingerprint set? exit 1 if not)
//
// Which fingerprint: with Play App Signing (what scripts/android/build.ps1 builds
// for) Google re-signs the app, so use the "App signing key certificate"
// SHA-256 from Play Console -> your app -> Test and release -> App integrity.
// Add the "Upload key certificate" SHA-256 as well (--add) if you also want to
// test a build installed straight from the .apk file.
//
// Accepted forms: AA:BB:...:FF, aa-bb-..., or 64 plain hex digits. Written as
// upper-case, colon-separated. Without --add the list is replaced; with --add
// the new values are appended (duplicates ignored). The placeholder
// (all zeros) is dropped as soon as a real value is written. After changing
// the file, deploy and open https://tutp.online/.well-known/assetlinks.json.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FILE = path.join(__dirname, '..', '..', 'server', 'android', 'assetlinks.json');
export const PLACEHOLDER = Array(32).fill('00').join(':');

// A fingerprint in the colon form, or null when it is not 32 bytes of hex.
export function normalizeFingerprint(input) {
  const hex = String(input || '').trim().replace(/[:\s-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g).join(':');
}

export function isPlaceholder(fp) {
  return fp === PLACEHOLDER;
}

// statement: the parsed assetlinks.json (an array). Returns a new statement.
export function applyFingerprints(statement, fingerprints, { add = false } = {}) {
  const norm = fingerprints.map((f) => {
    const n = normalizeFingerprint(f);
    if (!n) throw new Error(`not a SHA-256 certificate fingerprint (need 32 hex bytes): ${String(f).slice(0, 12)}...`);
    if (isPlaceholder(n)) throw new Error('that is the placeholder value (all zeros), not a real fingerprint');
    return n;
  });
  if (!norm.length) throw new Error('give at least one fingerprint');
  const next = JSON.parse(JSON.stringify(statement));
  const entry = next.find((s) => s?.target?.namespace === 'android_app');
  if (!entry) throw new Error('no android_app entry in the file');
  const keep = add ? (entry.target.sha256_cert_fingerprints || []).filter((f) => !isPlaceholder(f)) : [];
  entry.target.sha256_cert_fingerprints = [...new Set([...keep, ...norm])];
  return next;
}

export function hasRealFingerprint(statement) {
  const entry = statement.find((s) => s?.target?.namespace === 'android_app');
  const list = entry?.target?.sha256_cert_fingerprints || [];
  return list.some((f) => normalizeFingerprint(f) && !isPlaceholder(f));
}

function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const file = fi >= 0 ? args[fi + 1] : DEFAULT_FILE;
  const values = args.filter((a, i) => !a.startsWith('--') && !(fi >= 0 && i === fi + 1));
  const statement = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (args.includes('--check')) {
    const ok = hasRealFingerprint(statement);
    console.log(ok ? 'A real fingerprint is set.' : 'Only the placeholder is set: run this script with the Play App Signing SHA-256.');
    process.exit(ok ? 0 : 1);
  }
  if (!values.length) {
    console.error('Usage: node scripts/android/set-fingerprint.mjs <SHA-256> [<SHA-256> ...] [--add] [--file <path>]');
    process.exit(2);
  }
  try {
    const next = applyFingerprints(statement, values, { add: args.includes('--add') });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    const entry = next.find((s) => s.target.namespace === 'android_app');
    console.log(`Wrote ${entry.target.sha256_cert_fingerprints.length} fingerprint(s) to ${path.relative(process.cwd(), file) || file}:`);
    for (const f of entry.target.sha256_cert_fingerprints) console.log('  ' + f);
    console.log('Next: commit, deploy, then open https://tutp.online/.well-known/assetlinks.json to check it.');
  } catch (err) {
    console.error('Not changed: ' + err.message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
