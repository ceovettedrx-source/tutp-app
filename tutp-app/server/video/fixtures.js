// Hand-written YouTube answers for the e2e suite (test families on a preview
// with E2E_REPLAY=1 only; see server/routes/el.js). The project has no
// YouTube key yet, so these stand in for the API, as the hand-written model
// replies did for the image library. File: tests/e2e/recordings/yt-fixture.json,
// written by tests/e2e/fixtures/make-yt-fixture.js.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateSegment } from './segments.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'e2e', 'recordings', 'yt-fixture.json');
let cached = null;
const load = () => cached || (cached = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {});

// Same contract as searchVideos(): { videos, error }. `lang` is the language
// code the service asked for (null = best in the world).
export function fixtureSearch(conceptId, lang, { quota = false, log = console } = {}) {
  if (quota) {
    log.error('video.api_error', JSON.stringify({ q: conceptId, status: 403, reason: 'quotaExceeded' }));
    return { videos: [], error: { status: 403, reason: 'quotaExceeded' } };
  }
  const all = load()[conceptId] || [];
  const videos = all.filter((v) => (lang ? v.language === lang : v.best === true)).map(({ best, fixtureSegment: _f, ...v }) => ({ ...v, _fx: all.find((x) => x.id === v.id).fixtureSegment || null }));
  return { videos, error: null };
}

// A segment a fixture video carries for the Gemini path ({ start, end, moments }).
export function fixtureSegment(video) {
  if (!video._fx) return null;
  const segment = validateSegment({ start: video._fx.start, end: video._fx.end }, video.duration);
  return segment ? { segment, moments: video._fx.moments || [], via: 'gemini' } : null;
}
