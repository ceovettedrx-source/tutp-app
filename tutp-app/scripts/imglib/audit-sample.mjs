// Monthly audit: docs/image-audit.html with 20 random approved library images
// (all of them when there are fewer) for a glance. No per-image approval: the
// page only shows each picture with its pins, legend names and review notes so
// a wrong one can be spotted, then reported with the id (hide it by setting its
// status to "hidden" in manifest.json, or regenerate it with pipeline.mjs).
//
//   node scripts/imglib/audit-sample.mjs [--count 20]
import fs from 'fs';
import path from 'path';
import { loadManifest, readJson, GLOSSARY, PUBLIC_IMG, ROOT } from './lib.mjs';

const i = process.argv.indexOf('--count');
const count = i >= 0 ? Number(process.argv[i + 1]) || 20 : 20;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Fisher-Yates on a copy, then the first `count`.
function sample(list, n) {
  const a = list.slice();
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a.slice(0, n);
}

const gloss = readJson(GLOSSARY);
const approved = loadManifest().images.filter((m) => m.status === 'approved');
const picks = sample(approved, count);

const cards = picks.map((m) => {
  const file = path.join(PUBLIC_IMG, m.file);
  const data = fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : '';
  const pins = (m.anchors || []).map((a, n) => `<span class="pin" style="left:${a.x * 100}%;top:${a.y * 100}%">${n + 1}</span>`).join('');
  const legend = (m.anchors || []).map((a, n) => `<li>${n + 1}. ${esc((gloss[a.key] || {}).en || a.key)}${(gloss[a.key] || {}).te ? ' / ' + esc(gloss[a.key].te) : ''}</li>`).join('');
  const r = m.review || {};
  const note = [r.method ? `reviewed: ${r.method}` : '', r.date || '', r.needs_api_rereview ? 'needs a re-review with the API keys' : ''].filter(Boolean).join(' · ');
  return `<article><div class="stage"><img alt="${esc(m.alt)}" src="data:image/webp;base64,${data}">${pins}</div>
<h2>${esc(m.id)}</h2><p>${esc(m.description)}</p><ul>${legend}</ul><p class="small">${esc(note)} · class ${m.classMin}-${m.classMax} · ${esc(m.provenance && m.provenance.model)}</p></article>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Image audit</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px;background:#fff;color:#1b1f24}
h1{font-size:22px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
article{border:1px solid #d5dbe3;border-radius:12px;padding:12px}.stage{position:relative}img{width:100%;height:auto;display:block;border-radius:8px}
.pin{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#d6336c;color:#fff;font:700 12px/22px sans-serif;text-align:center;border:2px solid #fff}
h2{font-size:16px;margin:8px 0 0}ul{padding-left:18px;margin:6px 0}.small{font-size:12px;color:#4f5966}</style></head>
<body><h1>Image audit (${picks.length} of ${approved.length} approved images, ${new Date().toISOString().slice(0, 10)})</h1>
<p>Glance at each picture: is it correct for a school textbook, are the pins on the named parts, is there any text in the picture? Note the id of any wrong one and tell Claude Code (it is hidden or regenerated). Nothing here needs an approval click.</p>
<div class="grid">${cards}</div></body></html>`;

const out = path.join(ROOT, 'docs', 'image-audit.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(ROOT, out)} with ${picks.length} image(s)`);
