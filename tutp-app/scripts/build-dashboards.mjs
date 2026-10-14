// TUT-42: the mother, father and family-member dashboards are one page.
// templates/dashboard.html holds it once; this script writes
//   public/app/mother/index.html, public/app/father/index.html, public/app/family-member/index.html
// Never edit those three files by hand: edit the template, then run
//   node scripts/build-dashboards.mjs
// tests/unit/dashboards.test.js fails when a committed page differs from the template.
//
// Template syntax (line based, every marker on its own line):
//   @@template ...            first line, a note; not written out
//   @@if parent / @@else / @@end
//                             lines for the mother and father pages / lines for the family-member page
//   {{self}} {{Self}} {{SELF}}    the page's own parent role (mother on the mother page)
//   {{other}} {{Other}} {{OTHER}} the other parent (father on the mother page)
//   {{role}}                  mother | father | family-member (all three pages)
//   {{canPay}}                true on the parent pages, false on the family-member page
//   {{feat:NAME}}             ' data-feature="NAME"' on the family-member page (the parents'
//                             visibility rules hide it), nothing on the parent pages
// Other family-member lines carry their words literally (no tokens).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE = path.join(ROOT, 'templates', 'dashboard.html');
export const PAGES = {
  mother: { file: 'public/app/mother/index.html', parent: true, self: 'mother', other: 'father' },
  father: { file: 'public/app/father/index.html', parent: true, self: 'father', other: 'mother' },
  'family-member': { file: 'public/app/family-member/index.html', parent: false },
};

const cap = (w) => w[0].toUpperCase() + w.slice(1);

export function render(template, page) {
  const lines = template.replace(/\r\n/g, '\n').split('\n');   // a Windows checkout (autocrlf) has CRLF
  if (!lines[0].startsWith('@@template')) throw new Error('template must start with @@template');
  const out = [];
  let mode = 'all';                      // all | parent | member
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l === '@@if parent') { if (mode !== 'all') throw new Error('nested @@if at line ' + (i + 1)); mode = 'parent'; continue; }
    if (l === '@@else') { if (mode !== 'parent') throw new Error('@@else without @@if at line ' + (i + 1)); mode = 'member'; continue; }
    if (l === '@@end') { if (mode === 'all') throw new Error('@@end without @@if at line ' + (i + 1)); mode = 'all'; continue; }
    if (l.startsWith('@@')) throw new Error('unknown marker at line ' + (i + 1) + ': ' + l);
    if (mode === 'parent' && !page.parent) continue;
    if (mode === 'member' && page.parent) continue;
    out.push(l);
  }
  if (mode !== 'all') throw new Error('unclosed @@if');
  let html = out.join('\n');
  const role = page.parent ? page.self : 'family-member';
  html = html.replace(/\{\{role\}\}/g, role).replace(/\{\{canPay\}\}/g, page.parent ? 'true' : 'false')
    .replace(/\{\{feat:([a-z_]+)\}\}/g, (_, f) => (page.parent ? '' : ` data-feature="${f}"`));
  if (page.parent) {
    html = html.replace(/\{\{self\}\}/g, page.self).replace(/\{\{Self\}\}/g, cap(page.self)).replace(/\{\{SELF\}\}/g, page.self.toUpperCase())
      .replace(/\{\{other\}\}/g, page.other).replace(/\{\{Other\}\}/g, cap(page.other)).replace(/\{\{OTHER\}\}/g, page.other.toUpperCase());
  }
  const left = html.match(/\{\{[\w:]+\}\}/);
  if (left) throw new Error(`unreplaced ${left[0]} in the ${page.self || 'family-member'} page`);
  return html;
}

export function buildAll() {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  return Object.fromEntries(Object.entries(PAGES).map(([name, p]) => [name, { file: path.join(ROOT, p.file), html: render(t, p) }]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, { file, html }] of Object.entries(buildAll())) {
    fs.writeFileSync(file, html);
    console.log('wrote', path.relative(ROOT, file), '(' + name + ')');
  }
}
