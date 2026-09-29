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
import { fileURLToPath } from 'url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'e2e', 'recordings');

export function replayMode(isTestFamily, requested) {
  if (!isTestFamily || process.env.E2E_REPLAY !== '1') return 'live';
  return requested === 'record' || requested === 'live' ? requested : 'replay';
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
  if (mode === 'replay') {
    const rec = readRecording(key, attempt);
    if (!rec) return { status: 503, data: { error: 'no_recording', key }, replayed: true };
    return { status: rec.status, data: rec.data, replayed: true };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: 'unparseable_upstream', text: text.slice(0, 500) }; }
  if (mode === 'record' && recordings) recordings.push({ key, attempt, status: r.status, data });
  return { status: r.status, data, replayed: false };
}
