// Runs after tailwindcss in `npm run build` (the Docker image build too): puts the built
// public/css/tailwind.css inside public/index.html as a <style> so the homepage has no
// render-blocking stylesheet request. Homepage only; other pages keep the <link>.
// The committed index.html keeps the <link>, so this is a no-op the second time it runs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.join(ROOT, 'public', 'index.html');
const CSS = path.join(ROOT, 'public', 'css', 'tailwind.css');
const LINK = '<link href="/css/tailwind.css" rel="stylesheet"/>';

const html = fs.readFileSync(HOME, 'utf8');
if (!html.includes(LINK)) {
  console.log('inline-home-css: link not found in public/index.html, nothing to do');
  process.exit(0);
}
const css = fs.readFileSync(CSS, 'utf8').trim();
if (css.includes('</style')) throw new Error('inline-home-css: css contains </style');
// a function replacement, so "$&" and friends inside the css are not read as patterns
fs.writeFileSync(HOME, html.replace(LINK, () => '<style>' + css + '</style>'));
console.log('inline-home-css: inlined ' + css.length + ' bytes of css into public/index.html');
