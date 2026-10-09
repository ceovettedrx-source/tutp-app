// Record and replay of model replies for the e2e suite (round 2). Only on a
// preview revision with E2E_REPLAY=1, and only for test families; the test
// browser picks the mode per request with the X-E2E-Mode header:
//   replay (default)  /api/homework and /api/visual-tutor answer from
//                     tests/e2e/recordings/<key>.json, with no model call. A
//                     missing recording is an error (503 no_recording), never
//                     a live call, so a replay run can't spend money.
//   record            live calls, and each response carries the raw model
//                     replies (_recordings) for the test runner to save.
//   live              live calls, nothing recorded.
// Without E2E_REPLAY (production), or for a real family, every call is live
// whatever the header says.
//
// The key is a hash of the feature and the request's content (the parent's
// text and photos), not of the system prompt, model or settings: a prompt or
// model change is checked by the live smoke set, and the replay suite keeps
// testing the server and page logic without re-recording.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { fileURLToPath } from 'url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'e2e', 'recordings');

// reindex = replay, plus the (exact key, fixture key) pairs handed back like
// recordings, for tests/e2e/e2e-mode.js to write recordings/_index.json.
export function replayMode(isTestFamily, requested) {
  if (!isTestFamily || process.env.E2E_REPLAY !== '1') return 'live';
  return requested === 'record' || requested === 'live' || requested === 'reindex' ? requested : 'replay';
}

// Routes send _recordings back for these modes.
export const returnsRecordings = (mode) => mode === 'record' || mode === 'reindex';

// Photos the browser re-encodes (canvas) come out as different bytes on
// Windows and Linux Chrome, so the exact key differs per platform. The test
// harness names the fixture file(s) in X-E2E-Fixture (preview with
// E2E_REPLAY=1 only); the "fixture key" hashes that name in place of the
// image bytes, and recordings/_index.json maps it to the exact key.
const fixtureStore = new AsyncLocalStorage();
export function fixtureMiddleware(req, res, next) {
  const f = process.env.E2E_REPLAY === '1' ? String(req.get('x-e2e-fixture') || '').slice(0, 300) : '';
  if (!f) return next();
  fixtureStore.run(f, next);
}

// Width x height of a base64 JPEG or PNG ('' when unknown). Pixel sizes are the same on every
// platform, so a call on the whole photo and a call on a crop of it (p8, "Show on photo") keep
// different fixture keys even though both name the same fixture file.
export function imageSize(b64) {
  try {
    const b = Buffer.from(String(b64), 'base64');
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`;
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* unknown size */ }
  return '';
}

export function fixtureKey(feature, body, variant = '', fixture = fixtureStore.getStore()) {
  if (!fixture) return null;
  const content = JSON.stringify([feature, variant, body && body.messages], (k, v) =>
    (v && typeof v === 'object' && v.type === 'image' && v.source && typeof v.source.data === 'string')
      ? { type: 'image', fixture, size: imageSize(v.source.data) } : v);
  return 'fx' + crypto.createHash('sha256').update(content).digest('hex').slice(0, 30);
}

let indexCache = null;
function readIndex(dir = DIR) {
  if (indexCache) return indexCache;
  try { indexCache = JSON.parse(fs.readFileSync(path.join(dir, '_index.json'), 'utf8')); } catch { indexCache = {}; }
  return indexCache;
}

// `variant` carries request settings that live only in the system prompt but
// change the reply (the language), so English and Telugu don't share a key.
export function recordingKey(feature, body, variant = '') {
  const content = JSON.stringify([feature, variant, body && body.messages]);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

// Recorded reply for this key, or null. The attempt number keeps a JSON
// retry's second reply apart from the first.
export function readRecording(key, attempt = 1, dir = DIR) {
  const f = path.join(dir, `${key}${attempt > 1 ? '.' + attempt : ''}.json`);
  if (!/^[0-9a-f]{32}$/.test(key) || !fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// fetch() stand-in for the Anthropic Messages call. Returns { status, data }
// with data the parsed reply (or error body), plus the recording to hand
// back in record mode.
export async function modelFetch({ mode, feature, variant = '', body, attempt = 1, headers, recordings }) {
  const key = recordingKey(feature, body, variant);
  const fx = fixtureKey(feature, body, variant);
  if (mode === 'replay' || mode === 'reindex') {
    let rec = readRecording(key, attempt);
    let used = key;
    if (!rec && fx && readIndex()[fx]) { used = readIndex()[fx]; rec = readRecording(used, attempt); }
    if (mode === 'reindex' && recordings && rec && fx) recordings.push({ key: used, fixtureKey: fx, attempt, status: 0, data: null });
    if (!rec) return { status: 503, data: { error: 'no_recording', key, fixtureKey: fx }, replayed: true };
    return { status: rec.status, data: rec.data, replayed: true };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: 'unparseable_upstream', text: text.slice(0, 500) }; }
  if (mode === 'record' && recordings) recordings.push({ key, fixtureKey: fx, attempt, status: r.status, data });
  return { status: r.status, data, replayed: false };
}
