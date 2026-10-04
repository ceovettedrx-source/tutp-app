// Runs every e2e spec in turn with the same arguments:
//   npm run test:e2e -- <base-url> [login tests, e.g. fgi] [--headless]
//                        [--live-smoke] [--record-all] [--replay-only]
// (npm passes the arguments only to the last command of a && chain, so the
// specs can't simply be chained in package.json.) Exit code 1 if any fails.
//
// Model calls (round 2; the preview needs E2E_REPLAY=1, see
// server/model-replay.js):
//   - Every spec runs on recorded model replies (tests/e2e/recordings): no
//     model spend.
//   - Then a live smoke set (homework.spec.js --smoke: typed, 4-question
//     photo, explain, check mistakes), recording as it goes, only when
//     something under server/prompts/, server/pointing-model.js or
//     server/models.js changed since the last passing live run (file
//     hashes in recordings/LAST_LIVE, via git hash-object, so committed or
//     not). --live-smoke forces it, --replay-only skips it.
//   - --record-all: every spec live, saving all replies (first run, or after
//     a change of a reply's JSON shape).
// The model spend of every spec is printed at the end.
import { spawnSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPECS = ['cache.spec.js', 'cron.spec.js', 'login.spec.js', 'family.spec.js', 'visual-tutor.spec.js', 'homework.spec.js', 'chips.spec.js', 'story.spec.js', 'library.spec.js', 'android.spec.js'];
const MODEL_FILES = ['server/prompts', 'server/pointing-model.js', 'server/models.js', 'server/notes-ground.js'];
const LAST_LIVE = path.join(__dirname, 'recordings', 'LAST_LIVE');
const OUT = path.join(__dirname, 'output');
const FLAGS = ['--live-smoke', '--record-all', '--replay-only'];
const args = process.argv.slice(2);
const specArgs = args.filter((a) => !FLAGS.includes(a));
const git = (...a) => execFileSync('git', a, { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' }).trim();

// The files that decide model behaviour, as "path blob-hash" lines (git's
// hash of the file as it is on disk, committed or not). LAST_LIVE holds the
// lines from the last passing live run, so a commit made after the tests
// doesn't count as a change.
function modelFileHashes() {
  const root = path.join(__dirname, '..', '..');
  const files = MODEL_FILES.flatMap((p) => {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) return [];
    return fs.statSync(abs).isDirectory() ? fs.readdirSync(abs).sort().map((f) => p + '/' + f) : [p];
  });
  return files.map((f) => `${f} ${git('hash-object', f)}`);
}
function modelChanges() {
  const last = fs.existsSync(LAST_LIVE) ? fs.readFileSync(LAST_LIVE, 'utf8').trim().split('\n') : [];
  if (!last.length || !last[0]) return ['(no LAST_LIVE yet)'];
  const now = modelFileHashes();
  const before = new Set(last);
  const gone = last.filter((l) => !now.some((n) => n.split(' ')[0] === l.split(' ')[0])).map((l) => l.split(' ')[0] + ' (removed)');
  return [...now.filter((l) => !before.has(l)).map((l) => l.split(' ')[0]), ...gone];
}

for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) if (f.startsWith('spend-')) fs.unlinkSync(path.join(OUT, f));

const failed = [];
function run(spec, extra = [], mode = 'replay') {
  console.log(`\n=== ${spec} ${extra.join(' ')} (${mode})`);
  const r = spawnSync(process.execPath, [path.join(__dirname, spec), ...specArgs, ...extra], { stdio: 'inherit', env: { ...process.env, E2E_MODE: mode } });
  if (r.status !== 0) failed.push(`${spec}${extra.length ? ' ' + extra.join(' ') : ''} (exit ${r.status})`);
  return r.status === 0;
}

const recordAll = args.includes('--record-all');
for (const spec of SPECS) run(spec, [], recordAll ? 'record' : 'replay');

let liveOk = recordAll && !failed.length;
if (!recordAll && !args.includes('--replay-only')) {
  const changes = modelChanges();
  if (args.includes('--live-smoke') || changes.length) {
    console.log(`\nLive smoke set: ${args.includes('--live-smoke') ? 'forced' : 'changed since the last live run: ' + changes.join(', ')}`);
    liveOk = run('homework.spec.js', ['--smoke'], 'record');
  } else {
    console.log('\nNo prompt or model change since the last live run: no live smoke set.');
  }
}
if (liveOk) {
  fs.mkdirSync(path.dirname(LAST_LIVE), { recursive: true });
  fs.writeFileSync(LAST_LIVE, modelFileHashes().join('\n') + '\n');
  console.log('LAST_LIVE updated (model files as tested live)');
}

// Model spend per spec (X-Model-Usd, test families only).
let total = 0;
console.log('\nMODEL SPEND');
for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.startsWith('spend-')).sort() : []) {
  const s = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  total += s.usd;
  console.log(`  ${s.spec.padEnd(16)} ${s.mode.padEnd(7)} ${String(s.calls).padStart(3)} calls  $${s.usd.toFixed(4)}`);
}
console.log(`  total                             $${total.toFixed(4)}`);

console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : '\nALL SPECS PASSED');
process.exit(failed.length ? 1 : 0);
