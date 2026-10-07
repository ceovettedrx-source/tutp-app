// Image provider for the Explain illustration (docs/specs/answer-explain-v2.md
// section D). The interface is one function:
//
//   provider.generate(scenePrompt) -> Promise<{ buffer: Buffer, contentType }>
//
// getProvider(env) picks the implementation from the environment, so a key
// that appears later works with no code change:
//   IMAGE_PROVIDER=mock   a fixed tiny PNG (e2e only; MOCK_IMAGE_DELAY_MS to slow it)
//   otherwise             Gemini, when GEMINI_IMAGE_API_KEY is set
//                         (Cloud Run: secretKeyRef from the Secret Manager
//                         existing secret "gemini-imagelib-key"; no second secret is
//                         ever made); null when there is no key.
// Other env: GEMINI_IMAGE_MODEL (model id), IMAGE_GEN_ENABLED ("1" turns
// generation on), IMAGE_GEN_DAILY_CAP (pictures per day; default 50).
// The prompt always ends with the no-text suffix; labels are only ever an
// HTML overlay on the page.
// Unit tests: tests/unit/image-provider.test.js.
import zlib from 'zlib';
import { IMAGE_SUFFIX } from '../explain-schema.js';

// A valid solid-colour 16x16 PNG, built here so no hand-typed bytes can be wrong.
function solidPng(size, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TINY_PNG = solidPng(16, [234, 242, 252]);

export const DEFAULT_DAILY_CAP = 50;

export function imageGenEnabled(env = process.env) {
  return env.IMAGE_GEN_ENABLED === '1' || env.IMAGE_GEN_ENABLED === 'true';
}

export function dailyCap(env = process.env) {
  const n = Number(env.IMAGE_GEN_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

export function withSuffix(prompt) {
  const p = String(prompt || '').trim();
  return p.includes(IMAGE_SUFFIX) ? p : `${p} ${IMAGE_SUFFIX}`;
}

export function mockProvider(env = process.env) {
  return {
    name: 'mock', model: 'mock-1',
    async generate(scenePrompt) {
      withSuffix(scenePrompt);
      const ms = Number(env.MOCK_IMAGE_DELAY_MS) || 0;
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      return { buffer: TINY_PNG, contentType: 'image/png' };
    },
  };
}

export function geminiProvider(env = process.env, fetchImpl = fetch) {
  const key = env.GEMINI_IMAGE_API_KEY;
  if (!key) return null;
  const model = env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  return {
    name: 'gemini', model,
    async generate(scenePrompt) {
      const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: withSuffix(scenePrompt) }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      });
      if (!r.ok) throw new Error('gemini http ' + r.status);
      const j = await r.json();
      const part = ((j.candidates || [])[0]?.content?.parts || []).find((p) => (p.inlineData || p.inline_data));
      const inline = part && (part.inlineData || part.inline_data);
      if (!inline || !inline.data) throw new Error('gemini returned no image');
      return { buffer: Buffer.from(inline.data, 'base64'), contentType: inline.mimeType || inline.mime_type || 'image/png' };
    },
  };
}

// null = no provider (no key, or not mock): the SVG fallback is used.
export function getProvider(env = process.env, fetchImpl = fetch) {
  if (env.IMAGE_PROVIDER === 'mock') return mockProvider(env);
  return geminiProvider(env, fetchImpl);
}
