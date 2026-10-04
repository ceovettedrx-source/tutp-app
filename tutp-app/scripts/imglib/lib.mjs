// Shared helpers of the image-library scripts (docs/specs/story-image-library.md).
// Offline only: nothing here runs in the app. Secrets are read into memory,
// never printed or written. Pure helpers (verdicts, spend cap, JSON
// extraction) are exported for tests/unit/imglib-pipeline.test.js.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { costUsd } from '../../server/model-cost.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const LIB = path.join(HERE, 'library');
export const PUBLIC_IMG = path.join(ROOT, 'public', 'imglib');
export const MANIFEST = path.join(LIB, 'manifest.json');
export const GLOSSARY = path.join(LIB, 'glossary.json');
const COST_LOG = path.join(LIB, 'cost-log.jsonl');
const REVIEW_LOG = path.join(LIB, 'review-log.jsonl');

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
export const style = () => readJson(path.join(LIB, 'style.json'));
export function loadRecipes() {
  const dir = path.join(LIB, 'recipes');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(path.join(dir, f)));
}
export function loadManifest() {
  return fs.existsSync(MANIFEST) ? readJson(MANIFEST) : { version: 1, images: [] };
}
export function saveManifest(m) {
  m.images.sort((a, b) => a.id.localeCompare(b.id));
  writeJson(MANIFEST, m);
}

// ---------------------------------------------------------------- spend cap
export class SpendCapError extends Error {}
// One run's budget. canAfford is checked before each paid call with its
// worst-case estimate; add() records what it really cost and logs it.
export class Spend {
  constructor(cap) { this.cap = cap; this.total = 0; }
  canAfford(est) { return this.total + est <= this.cap + 1e-9; }
  need(est, what) {
    if (!this.canAfford(est)) throw new SpendCapError(`spend cap ${this.cap} USD would be exceeded by ${what} (spent ${this.total.toFixed(4)}, needs ${est})`);
  }
  add(usd, entry) {
    const u = Number(usd) || 0;
    this.total = Math.round((this.total + u) * 1e6) / 1e6;
    try { fs.appendFileSync(COST_LOG, JSON.stringify({ at: new Date().toISOString(), usd: u, ...entry }) + '\n'); } catch { /* log only */ }
  }
}
export function logReview(entry) {
  try { fs.appendFileSync(REVIEW_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch { /* log only */ }
}

// ------------------------------------------------------------------ secrets
// Keys come from the environment only (the scripts never read Secret Manager
// themselves). The founder loads them in his own shell, see KEYS_HINT.
export function getSecret(envName) {
  return process.env[envName] ? process.env[envName].trim() : null;
}
export function getWorkspaceId() {
  return process.env.ANTHROPIC_WORKSPACE_ID ? process.env.ANTHROPIC_WORKSPACE_ID.trim() : null;
}
export const KEYS_HINT = 'The Gemini key is ONLY read from the GEMINI_API_KEY environment variable of this shell. Set it yourself from the secret gemini-imagelib-key (never gemini-api-key, that is the production key); the value is not printed:\n'
  + '  $env:GEMINI_API_KEY = (gcloud.cmd secrets versions access latest --secret=gemini-imagelib-key)\n'
  + 'Claude review (optional here): $env:ANTHROPIC_API_KEY and $env:ANTHROPIC_WORKSPACE_ID.';
export const GEMINI_HINT = 'No GEMINI_API_KEY in this shell, so generation is off (use inbox mode: import <folder>).\n' + KEYS_HINT;

// ------------------------------------------------------- JSON from model text
export function extractJson(text) {
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

// ---------------------------------------------------------- model calls
export async function claudeJson({ key, model, system, content, maxTokens = 1500, spend, what }) {
  spend.need(0.05, what);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(getWorkspaceId() ? { 'anthropic-workspace-id': getWorkspaceId() } : {}) },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }], ...(model === 'claude-sonnet-5' ? { output_config: { effort: 'low' } } : {}) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`Claude call failed (${res.status}) for ${what}: ${data && data.error ? String(data.error.message).slice(0, 200) : ''}`);
  const usd = costUsd(model, data.usage) ?? 0.02;
  spend.add(usd, { provider: 'anthropic', model, what });
  const text = ((data.content || []).find((b) => b.type === 'text') || {}).text;
  return extractJson(text);
}
const png = (buf) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') } });

// A Gemini failure that means "no access to this": quota, billing, paid-only, 429.
export class GeminiQuotaError extends Error {}
export const isQuotaStatus = (status, text) => status === 429 || /quota|billing|paid|free tier|RESOURCE_EXHAUSTED/i.test(String(text || ''));
async function geminiCall(key, model, body) {
  // at most 2 attempts in total, and only for a transient 5xx; quota is final
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data) return data;
    const msg = data && data.error ? String(data.error.message || data.error.status || '').slice(0, 160) : '';
    if (isQuotaStatus(res.status, msg)) throw new GeminiQuotaError(`Gemini ${model}: quota/billing limit (${res.status}) ${msg}`);
    if (res.status >= 500 && attempt < 2) continue;
    throw new Error(`Gemini call failed (${res.status}) ${model} ${msg}`);
  }
}
// ListModels with the key: [{ name, methods }]
export async function geminiListModels(key) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': key } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const msg = data && data.error ? String(data.error.message || '').slice(0, 160) : '';
      if (isQuotaStatus(res.status, msg)) throw new GeminiQuotaError(`ListModels: quota/billing limit (${res.status}) ${msg}`);
      throw new Error(`ListModels failed (${res.status}) ${msg}`);
    }
    for (const m of data.models || []) out.push({ name: String(m.name || '').replace(/^models\//, ''), methods: m.supportedGenerationMethods || [] });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}
export const isImageModel = (name) => /image/i.test(name) && !/imagen|embedding/i.test(name);
// prompt (+ optional previous image to refine) -> PNG buffer. model defaults to style.gemini_image_model
export async function geminiImage({ key, prompt, previous, spend, what, model }) {
  const st = style();
  const useModel = model || st.gemini_image_model;
  spend.need(st.gemini_image_usd, what);
  const parts = [{ text: prompt }];
  if (previous) parts.push({ inlineData: { mimeType: 'image/png', data: previous.toString('base64') } });
  const data = await geminiCall(key, useModel, { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } });
  spend.add(st.gemini_image_usd_actual ?? st.gemini_image_usd, { provider: 'gemini', model: useModel, what });
  const part = (((data.candidates || [])[0] || {}).content || {}).parts?.find((p) => p.inlineData && p.inlineData.data);
  if (!part) throw new Error('Gemini returned no image');
  return Buffer.from(part.inlineData.data, 'base64');
}
export async function geminiJson({ key, prompt, image, spend, what, model }) {
  const st = style();
  const useModel = model || st.gemini_review_model;
  spend.need(st.gemini_review_usd * 3, what);
  const parts = [{ text: prompt }];
  if (image) parts.push({ inlineData: { mimeType: 'image/png', data: image.toString('base64') } });
  const data = await geminiCall(key, useModel, { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } });
  spend.add(st.gemini_review_usd, { provider: 'gemini', model: useModel, what });
  const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('');
  return extractJson(text);
}

// ----------------------------------------------------------------- review
export function generationPrompt(recipe) {
  const st = style();
  return `${recipe.prompt}\n\nStyle: ${st.style}\nAvoid: ${st.negative}.`;
}
export function checklistOf(recipe) {
  return [...style().common_checklist, ...(recipe.checklist || []).map((c) => `recipe_specific: ${c}`)];
}
export { reviewPrompt as reviewPromptFor };
function reviewPrompt(recipe) {
  const items = checklistOf(recipe).map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `You are a strict reviewer of children's science textbook illustrations (Class 5 to 12, India). The image should show: ${recipe.description}.
Judge ONLY what you can see. Check every item, and fail an item when in doubt:
${items}
Reply with JSON only: {"checks":[{"item":1,"pass":true,"note":"max 15 words"}, ...one entry per item...],"issues":["each problem to fix, as an instruction for a generator"]}`;
}
// A model's {checks, issues} -> { pass, issues }. Every item must be present
// and true; a missing or malformed answer is a fail, never a pass.
export function evaluateChecks(json, itemCount) {
  if (!json || !Array.isArray(json.checks)) return { pass: false, issues: ['review returned no usable checks'] };
  const byItem = new Map(json.checks.map((c) => [Number(c && c.item), c]));
  const failed = [];
  for (let i = 1; i <= itemCount; i++) {
    const c = byItem.get(i);
    if (!c || c.pass !== true) failed.push(c && c.note ? `check ${i}: ${c.note}` : `check ${i} failed or missing`);
  }
  const extra = Array.isArray(json.issues) ? json.issues.filter((s) => typeof s === 'string').slice(0, 6) : [];
  return { pass: failed.length === 0, issues: [...failed, ...extra.filter(() => failed.length > 0)] };
}
// Approved only when Claude passes and (when a Gemini key exists) Gemini passes.
export function combineVerdicts(claude, gemini) {
  const secondPass = gemini != null;
  const pass = !!(claude && claude.pass) && (!secondPass || !!gemini.pass);
  const issues = [...(claude && claude.issues || []), ...(gemini && gemini.issues || [])];
  return { pass, secondPass, issues: pass ? [] : issues, claude: !!(claude && claude.pass), gemini: secondPass ? !!gemini.pass : null };
}
export async function reviewImage({ recipe, buf, claudeKey, geminiKey, spend }) {
  const st = style();
  const n = checklistOf(recipe).length;
  const prompt = reviewPrompt(recipe);
  const cj = await claudeJson({ key: claudeKey, model: st.claude_review_model, system: 'You review illustrations for correctness and consistency. Output JSON only.', content: [png(buf), { type: 'text', text: prompt }], spend, what: `review ${recipe.id}` });
  const claude = evaluateChecks(cj, n);
  let gemini = null;
  if (geminiKey) {
    const gj = await geminiJson({ key: geminiKey, prompt, image: buf, spend, what: `second review ${recipe.id}` });
    gemini = evaluateChecks(gj, n);
  }
  return combineVerdicts(claude, gemini);
}

// ------------------------------------------------- image processing (Chromium)
let browserP = null;
async function browser() {
  if (!browserP) browserP = import('playwright').then((m) => m.chromium.launch());
  return browserP;
}
export async function closeBrowser() { if (browserP) { const b = await browserP; await b.close(); browserP = null; } }

// PNG -> { width, height, cornersWhite, webp } (a WebP no wider than output_width).
export async function processImage(buf) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent('<canvas id="c"></canvas>');
    const out = await page.evaluate(async ({ b64, maxW }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const w = Math.min(maxW, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
      const c = document.getElementById('c'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
      const m = 6;
      const corners = [px(m, m), px(w - m, m), px(m, h - m), px(w - m, h - m)];
      return { width: img.naturalWidth, height: img.naturalHeight, corners, webp: c.toDataURL('image/webp', 0.86).split(',')[1] };
    }, { b64: buf.toString('base64'), maxW: style().output_width });
    return { width: out.width, height: out.height, cornersWhite: out.corners.every((v) => v >= 235), webp: Buffer.from(out.webp, 'base64') };
  } finally { await page.close(); }
}

// PNG + [{n, x, y}] -> a PNG with numbered pins drawn at the anchors.
export async function renderPins(buf, pins) {
  const b = await browser();
  const page = await b.newPage({ viewport: { width: 900, height: 900 } });
  try {
    const html = `<body style="margin:0;background:#fff"><div id="w" style="position:relative;display:inline-block"><img id="i" style="display:block;max-width:900px" src="data:image/png;base64,${buf.toString('base64')}">`
      + pins.map((p) => `<div style="position:absolute;left:${p.x * 100}%;top:${p.y * 100}%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#d6336c;color:#fff;font:700 15px/26px sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 0 0 1px #d6336c">${p.n}</div>`).join('')
      + '</div></body>';
    await page.setContent(html);
    await page.waitForFunction(() => document.getElementById('i').complete);
    return await (await page.$('#w')).screenshot({ type: 'png' });
  } finally { await page.close(); }
}

// ----------------------------------------------------------------- anchors
export const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));
export function cleanAnchors(json, keys) {
  const out = [];
  for (const k of keys) {
    const a = ((json && json.anchors) || []).find((x) => x && x.key === k);
    if (!a || !Number.isFinite(Number(a.x)) || !Number.isFinite(Number(a.y))) continue;
    out.push({ key: k, x: Math.round(clamp01(a.x) * 1000) / 1000, y: Math.round(clamp01(a.y) * 1000) / 1000 });
  }
  return out;
}
// Claude proposes, the script renders the pins, Claude checks the render; one
// correction round. Returns { ok, anchors, notes }.
export async function placeAnchors({ recipe, buf, claudeKey, spend }) {
  const gloss = readJson(GLOSSARY);
  const keys = recipe.labelKeys;
  const names = keys.map((k) => `${k} = ${(gloss[k] && gloss[k].en) || k}`).join('; ');
  const st = style();
  let feedback = '';
  let anchors = [];
  for (let round = 1; round <= 2; round++) {
    const j = await claudeJson({
      key: claudeKey, model: st.claude_review_model, spend, what: `anchors ${recipe.id} r${round}`,
      system: 'You place label pins on a science diagram. Output JSON only.',
      content: [png(buf), { type: 'text', text: `The image shows: ${recipe.description}. For each label key give the point (x, y), normalised 0..1 from the top-left of the image, where a pin should touch the part it names; put it on the part itself, not on empty background. Keys: ${names}. If a part appears several times, pick the clearest one.${feedback}\nReply: {"anchors":[{"key":"...","x":0.5,"y":0.5}]}` }],
    });
    anchors = cleanAnchors(j, keys);
    if (anchors.length !== keys.length) { feedback = `\nYour last answer missed keys: ${keys.filter((k) => !anchors.some((a) => a.key === k)).join(', ')}.`; continue; }
    const pinned = await renderPins(buf, anchors.map((a, i) => ({ n: i + 1, x: a.x, y: a.y })));
    const v = await claudeJson({
      key: claudeKey, model: st.claude_review_model, spend, what: `anchor check ${recipe.id} r${round}`,
      system: 'You check label pins on a science diagram. Output JSON only.',
      content: [png(pinned), { type: 'text', text: `Numbered pink pins were placed on this image: ${anchors.map((a, i) => `${i + 1} = ${(gloss[a.key] && gloss[a.key].en) || a.key}`).join('; ')}. Does every pin sit on the part it is numbered for (touching it or clearly on it)? Reply: {"ok":true|false,"wrong":[{"n":1,"problem":"...","x":0.5,"y":0.5}]} where x, y (0..1) is where that pin should be.` }],
    });
    if (v && v.ok === true) return { ok: true, anchors, notes: `verified in round ${round}` };
    feedback = `\nA reviewer found: ${JSON.stringify((v && v.wrong) || []).slice(0, 600)}. Place the pins again.`;
  }
  return { ok: false, anchors, notes: 'pins could not be verified' };
}

// ------------------------------------------------------------------- store
export function storeImage({ recipe, png: pngBuf, webp, review, anchors, provenance }) {
  fs.mkdirSync(path.join(LIB, 'originals'), { recursive: true });
  fs.mkdirSync(PUBLIC_IMG, { recursive: true });
  fs.writeFileSync(path.join(LIB, 'originals', `${recipe.id}.png`), pngBuf);
  fs.writeFileSync(path.join(PUBLIC_IMG, `${recipe.id}.webp`), webp);
  const m = loadManifest();
  const entry = {
    id: recipe.id, aliases: recipe.aliases, subject: recipe.subject, classMin: recipe.classMin, classMax: recipe.classMax,
    description: recipe.description, alt: recipe.alt, file: `${recipe.id}.webp`, anchors,
    provenance, review, status: 'approved', stored_at: new Date().toISOString(),
  };
  const i = m.images.findIndex((x) => x.id === recipe.id);
  if (i >= 0) m.images[i] = entry; else m.images.push(entry);
  saveManifest(m);
}
