// Runs every e2e spec in turn with the same arguments:
//   npm run test:e2e -- <base-url> [login tests, e.g. fgi] [--headless]
// (npm passes the arguments only to the last command of a && chain, so the
// specs can't simply be chained in package.json.) Exit code 1 if any fails.
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPECS = ['cache.spec.js', 'login.spec.js','visual-tutor.spec.js', 'homework.spec.js'];
const args = process.argv.slice(2);

let failed = [];
for (const spec of SPECS) {
  console.log(`\n=== ${spec}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, spec), ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(`${spec} (exit ${r.status})`);
}
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : '\nALL SPECS PASSED');
process.exit(failed.length ? 1 : 0);
