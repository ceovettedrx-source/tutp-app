// Image library pipeline: generate -> review -> refine (max 3 rounds) -> store.
//
//   node scripts/imglib/pipeline.mjs import <folder> [--ids a,b] [--model "name"]
//       inbox mode: <folder>/<id>.png for each recipe id; reviewed, anchors set, stored
//   node scripts/imglib/pipeline.mjs generate [--ids a,b] [--only-missing]
//       needs the Gemini key; generates, reviews, refines, stores
//   node scripts/imglib/pipeline.mjs regen <id>
//       a reported image: generate it again (needs the Gemini key)
//   node scripts/imglib/pipeline.mjs review <id>
//       review the stored original again, nothing is changed
//
// Common: --cap <usd> (default 3, the hard spend cap of the run). Approved only
// when Claude vision passes and, with a Gemini key, an independent Gemini pass
// passes too. The Anthropic key comes from ANTHROPIC_API_KEY or Secret Manager
// (anthropic-api-key); the Gemini key from GEMINI_API_KEY or the secret
// gemini-api-key. Secrets are never printed.
import fs from 'fs';
import path from 'path';
import {
  LIB, style, loadRecipes, getSecret, GEMINI_HINT, KEYS_HINT, renderPins, Spend, SpendCapError, geminiImage, generationPrompt,
  reviewImage, processImage, placeAnchors, storeImage, logReview, closeBrowser,
} from './lib.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const flag = (name) => args.includes(name);

const st = style();
const cap = Number(opt('--cap')) || st.spend_cap_usd;
const spend = new Spend(Math.min(cap, st.spend_cap_usd));
const ids = opt('--ids') ? opt('--ids').split(',') : null;

const verdictsFile = opt('--verdicts');
const claudeKey = getSecret('ANTHROPIC_API_KEY');
if (!claudeKey && !verdictsFile) { console.error('No ANTHROPIC_API_KEY in the environment.\n' + KEYS_HINT); process.exit(2); }
const geminiKey = getSecret('GEMINI_API_KEY');
const recipes = loadRecipes().filter((r) => !ids || ids.includes(r.id));
const results = [];

// One image through review, anchors and storage. refine(issues) returns a new
// PNG (generate mode) or null (inbox mode: a failed review is final).
async function processOne(recipe, buf, { provenance, refine }) {
  let rounds = 0;
  for (;;) {
    const img = await processImage(buf);
    let verdict = await reviewImage({ recipe, buf, claudeKey, geminiKey, spend });
    if (!img.cornersWhite) verdict = { ...verdict, pass: false, issues: ['the background is not white at the corners', ...verdict.issues] };
    console.log(`  ${recipe.id}: review round ${rounds + 1}: ${verdict.pass ? 'PASS' : 'FAIL'} (claude ${verdict.claude}, gemini ${verdict.gemini})`);
    if (verdict.pass) {
      const a = await placeAnchors({ recipe, buf, claudeKey, spend });
      if (!a.ok) { logReview({ id: recipe.id, pass: false, issues: ['anchors not verified'] }); return { id: recipe.id, ok: false, why: ['label anchors could not be verified'] }; }
      storeImage({
        recipe, png: buf, webp: img.webp, anchors: a.anchors, provenance,
        review: { date: new Date().toISOString().slice(0, 10), claude: true, gemini: verdict.gemini, rounds: rounds + 1, anchors: a.notes },
      });
      logReview({ id: recipe.id, pass: true, rounds: rounds + 1 });
      return { id: recipe.id, ok: true };
    }
    if (!refine || rounds >= st.max_refine_rounds - 1) {
      logReview({ id: recipe.id, pass: false, issues: verdict.issues });
      return { id: recipe.id, ok: false, why: verdict.issues.slice(0, 6) };
    }
    rounds++;
    buf = await refine(verdict.issues, buf);
  }
}

// Offline variant (no API keys): the review verdict and the anchors were made by
// a Claude Code session looking at the image, written in a --verdicts file
// {"<id>": {"pass": true, "issues": [], "anchors": [{"key","x","y"}], "note": "..."}}.
// The checks that need no model (size, white corners) still run here, the pins
// are rendered to --preview-dir so the anchors can be looked at, and --dry
// stops before storing. The entry is marked method "claude-code-session-vision"
// and needs_api_rereview, so a later run with keys re-checks it (review <id>).
async function processSession(recipe, buf, v, { provenance }) {
  const img = await processImage(buf);
  const issues = [...(v.issues || [])];
  if (!img.cornersWhite) issues.push('the background is not white at the corners');
  const anchors = Array.isArray(v.anchors) ? v.anchors : [];
  const keysOk = recipe.labelKeys.every((k) => anchors.some((a) => a.key === k));
  const previewDir = opt('--preview-dir');
  if (previewDir && anchors.length) {
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(path.join(previewDir, `${recipe.id}-pins.png`), await renderPins(buf, anchors.map((a, i) => ({ n: i + 1, x: a.x, y: a.y }))));
  }
  const pass = v.pass === true && issues.length === 0 && keysOk;
  if (!pass) {
    logReview({ id: recipe.id, pass: false, method: 'session', issues });
    return { id: recipe.id, ok: false, why: issues.length ? issues : [v.pass === true ? 'anchors missing for some label keys' : 'failed the review'] };
  }
  if (flag('--dry')) return { id: recipe.id, ok: true, why: [], dry: true };
  storeImage({
    recipe, png: buf, webp: img.webp, anchors, provenance,
    review: { date: new Date().toISOString().slice(0, 10), method: 'claude-code-session-vision', claude: true, gemini: null, anchors: v.note || 'checked by rendering the pins', needs_api_rereview: true },
  });
  logReview({ id: recipe.id, pass: true, method: 'session' });
  return { id: recipe.id, ok: true };
}

async function main() {
  if (cmd === 'import') {
    const folder = args[1];
    if (!folder || !fs.existsSync(folder)) { console.error('Usage: import <folder>'); process.exit(2); }
    const date = new Date().toISOString().slice(0, 10);
    const verdicts = verdictsFile ? JSON.parse(fs.readFileSync(verdictsFile, 'utf8')) : null;
    for (const recipe of recipes) {
      const file = path.join(folder, `${recipe.id}.png`);
      if (!fs.existsSync(file)) continue;
      console.log(`import ${recipe.id}`);
      const provenance = { source: 'ai-generated', model: opt('--model') || 'unknown (supplied by the founder)', prompt: generationPrompt(recipe), prompt_note: 'the recipe prompt, written to describe the supplied image; the original generation prompt is not known', date, license: opt('--license') || 'owned by Tut-P (generated for it)' };
      const buf = fs.readFileSync(file);
      if (verdicts) {
        if (!verdicts[recipe.id]) { results.push({ id: recipe.id, ok: false, why: ['no verdict given'] }); continue; }
        results.push(await processSession(recipe, buf, verdicts[recipe.id], { provenance }));
      } else {
        results.push(await processOne(recipe, buf, { provenance, refine: null }));
      }
    }
  } else if (cmd === 'generate' || cmd === 'regen') {
    if (!geminiKey) { console.log(GEMINI_HINT); process.exit(3); }
    const list = cmd === 'regen' ? recipes.filter((r) => r.id === args[1]) : recipes;
    const have = new Set(fs.existsSync(path.join(LIB, 'originals')) ? fs.readdirSync(path.join(LIB, 'originals')).map((f) => f.replace(/\.png$/, '')) : []);
    for (const recipe of list) {
      if (cmd === 'generate' && flag('--only-missing') && have.has(recipe.id)) continue;
      console.log(`generate ${recipe.id}`);
      try {
        const base = generationPrompt(recipe);
        const first = await geminiImage({ key: geminiKey, prompt: base, spend, what: `generate ${recipe.id}` });
        const provenance = { source: 'ai-generated', model: st.gemini_image_model, prompt: base, date: new Date().toISOString().slice(0, 10), license: 'owned by Tut-P (generated for it)' };
        const refine = (issues, prev) => geminiImage({ key: geminiKey, prompt: `${base}\n\nRedraw this image fixing these problems and changing nothing else:\n- ${issues.join('\n- ')}`, previous: prev, spend, what: `refine ${recipe.id}` });
        results.push(await processOne(recipe, first, { provenance, refine }));
      } catch (e) {
        if (e instanceof SpendCapError) { results.push({ id: recipe.id, ok: false, why: [e.message] }); console.log('STOP: ' + e.message); break; }
        results.push({ id: recipe.id, ok: false, why: [e.message] });
      }
    }
  } else if (cmd === 'review') {
    const recipe = recipes.find((r) => r.id === args[1]);
    const file = recipe && path.join(LIB, 'originals', `${recipe.id}.png`);
    if (!file || !fs.existsSync(file)) { console.error('No stored original for that id.'); process.exit(2); }
    const v = await reviewImage({ recipe, buf: fs.readFileSync(file), claudeKey, geminiKey, spend });
    results.push({ id: recipe.id, ok: v.pass, why: v.issues });
  } else {
    console.error('Commands: import <folder> | generate | regen <id> | review <id>');
    process.exit(2);
  }
  console.log('\nResults:');
  for (const r of results) console.log(` ${r.ok ? 'APPROVED' : 'FAILED  '} ${r.id}${r.ok ? '' : ': ' + r.why.join(' | ')}`);
  console.log(`Spent this run: ${spend.total.toFixed(4)} USD of ${spend.cap} USD cap (log: scripts/imglib/library/cost-log.jsonl)`);
}

main().catch((e) => { console.error('pipeline error:', e.message); process.exitCode = 1; }).finally(closeBrowser);
