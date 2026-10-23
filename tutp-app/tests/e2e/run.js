// Runs every e2e spec in turn with the same arguments:
//   npm run test:e2e -- <base-url> [login tests, e.g. fgi] [--headless]
//                        [--live] [--record-all] [--replay-only]
// (npm passes the arguments only to the last command of a && chain, so the
// specs can't simply be chained in package.json.)
//
// Result of a run (TUT-47):
//   PASS             every test of the spec passed
//   KNOWN            the spec failed only in tests listed in known-failures.json
//                    (each carries its ticket and date); does not fail the run
//   FAIL             any other failure, a crash, a hang (STALLED), a spec that
//                    prints no result at all
//   MISSING RECORDING  a failure whose reply is `no_recording`: a replayed model
//                    call has no recorded reply (record it, or fix the key)
// Exit code 1 only when something FAILed.
//
// Time limits, for every spec (no spec can hang the run):
//   - 30 s per wait: preload.mjs sets Playwright's default timeout to 30 s on
//     every browser context and page (a wait that names a longer timeout keeps
//     it; the 90 s rule below still ends it).
//   - 90 s per test: a spec that prints nothing for 90 s is killed and counted
//     as FAIL "STALLED after <last test>". E2E_TEST_TIMEOUT_S overrides it.
//
// Model calls (the preview needs E2E_REPLAY=1, see server/model-replay.js):
//   - Every spec runs on recorded model replies (tests/e2e/recordings): no
//     model spend.
//   - Live (paid) calls NEVER start by themselves. --live runs the 4-test live
//     smoke set (homework.spec.js --smoke) recording as it goes; --record-all
//     re-records every spec (about $0.10). When server/prompts/,
//     server/pointing-model.js, server/models.js or server/notes-ground.js
//     changed since the last passing live run (hashes in recordings/LAST_LIVE),
//     the run only prints a warning. --replay-only is accepted and is the default.
//     --live-smoke is the old name of --live.
// Leftover headless test Chrome (Playwright's own) is killed when the run ends.
// The model spend of every spec is printed at the end.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPECS = ['cache.spec.js', 'cron.spec.js', 'login.spec.js', 'family.spec.js', 'uploads.spec.js', 'visual-tutor.spec.js', 'homework.spec.js', 'chips.spec.js', 'story.spec.js', 'library.spec.js', 'el.spec.js', 'inventory.spec.js', 'answer-explain.spec.js', 'img1.spec.js', 'bonding.spec.js', 'max-plan.spec.js', 'image-billing.spec.js','singapore-maths.spec.js', 'dashboard-items.spec.js'];
if (process.env.E2E_ONLY) SPECS.splice(0, SPECS.length, ...process.env.E2E_ONLY.split(',')); // E2E_ONLY=a.spec.js,b.spec.js runs just those (also how run.js itself is tested)
const MODEL_FILES = ['server/prompts', 'server/pointing-model.js', 'server/models.js', 'server/notes-ground.js'];
const LAST_LIVE = path.join(__dirname, 'recordings', 'LAST_LIVE');
const KNOWN_FILE = path.join(__dirname, 'known-failures.json');
const OUT = path.join(__dirname, 'output');
const PRELOAD = pathToFileURL(path.join(__dirname, 'preload.mjs')).href;
const FLAGS = ['--live', '--live-smoke', '--record-all', '--replay-only'];
const TEST_TIMEOUT_S = Number(process.env.E2E_TEST_TIMEOUT_S) || 90;
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

// known-failures.json: [{ spec, id, ticket, since, note }]
const known = fs.existsSync(KNOWN_FILE) ? JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')) : [];
const isKnown = (spec, id) => known.some((k) => k.spec === spec && k.id === id);

// A stalled spec prints nothing for the test that hangs, so name it: the first
// test id in the spec's source order after the last one that reported a result.
// Ids look like k2, c13a, a14. Returns null when it can't tell.
function stalledTest(spec, lastId, failedIds) {
  try {
    const src = fs.readFileSync(path.join(__dirname, spec), 'utf8');
    const ids = [...new Set([...src.matchAll(/['"]([a-z]{1,3}\d{1,3}[a-z]?)['"]/g)].map((m) => m[1]))];
    const from = ids.indexOf(lastId);
    return ids.slice(from + 1).find((id) => !failedIds.has(id)) || null;
  } catch { return null; }
}

// Playwright's own headless Chrome only (its path has ms-playwright), never the
// person's normal Chrome. Windows only; elsewhere pkill with the same pattern.
function killLeftoverChrome() {
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|headless_shell' -and $_.CommandLine -match 'ms-playwright' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' });
    } else {
      execFileSync('pkill', ['-f', 'ms-playwright.*(chrome|headless_shell)'], { stdio: 'ignore' });
    }
  } catch { /* nothing to kill */ }
}

for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) if (f.startsWith('spend-')) fs.unlinkSync(path.join(OUT, f));

const RESULT = /^\[e2e(?:[: ][^\]]*)?\] (\S+) (PASS|FAIL)\b(.*)$/;   // "[e2e:hw] k2 FAIL ...", "[e2e bonding] b PASS", "[e2e] d PASS"
const CACHE_RESULT = /^\[cache\] (PASS|FAIL) (.*)$/;   // cache.spec.js has no test ids: the check text is the id
const rows = [];                               // { spec, status, detail }

// Runs one spec; resolves { status: 'PASS'|'KNOWN'|'FAIL', detail }.
function run(spec, extra = [], mode = 'replay') {
  return new Promise((resolve) => {
    const label = `${spec}${extra.length ? ' ' + extra.join(' ') : ''}`;
    console.log(`\n=== ${spec} ${extra.join(' ')} (${mode})`);
    const child = spawn(process.execPath, ['--import', PRELOAD, path.join(__dirname, spec), ...specArgs, ...extra],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E2E_MODE: mode } });
    const fails = [];                          // { id, line }
    let passes = 0, lastId = '(start)', stalled = false, buf = '';
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { stalled = true; child.kill('SIGKILL'); }, TEST_TIMEOUT_S * 1000);
    };
    const onData = (chunk) => {
      arm();
      process.stdout.write(chunk);
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        let m = RESULT.exec(line);
        if (!m) {
          const c = CACHE_RESULT.exec(line);
          if (!c) continue;
          m = [line, c[2], c[1], ''];
        }
        lastId = m[1];
        if (m[2] === 'PASS') passes++;
        else fails.push({ id: m[1], line });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    arm();
    child.on('close', (code) => {
      clearTimeout(timer);
      killLeftoverChrome();
      let status, detail;
      const missing = fails.filter((f) => /no_recording/.test(f.line));
      if (stalled) {
        const hung = stalledTest(spec, lastId, new Set(fails.map((f) => f.id)));
        const hungKnown = hung && isKnown(spec, hung) && !fails.some((f) => !isKnown(spec, f.id));
        status = hungKnown ? 'KNOWN' : 'FAIL';
        detail = `STALLED after ${lastId} (no output for ${TEST_TIMEOUT_S} s)` + (hung ? `, hung test: ${hung}${isKnown(spec, hung) ? ' (known)' : ''}` : '');
      }
      else if (code === 0) { status = 'PASS'; detail = `${passes} passed`; }
      else if (!fails.length) { status = 'FAIL'; detail = `exit ${code}, no failing test reported (crash?)`; }
      else {
        const unknown = fails.filter((f) => !isKnown(spec, f.id));
        status = unknown.length ? 'FAIL' : 'KNOWN';
        detail = `${passes} passed, failing: ` + fails.map((f) => f.id + (isKnown(spec, f.id) ? ' (known)' : '')).join(' ');
      }
      if (missing.length) detail += ` | MISSING RECORDING: ${missing.map((f) => f.id).join(' ')}`;
      const gone = known.filter((k) => k.spec === spec && !fails.some((f) => f.id === k.id) && code !== null && !stalled);
      if (gone.length && code !== null) detail += ` | now passing, remove from known-failures.json: ${gone.map((k) => k.id).join(' ')}`;
      rows.push({ spec: label, status, detail });
      resolve(status);
    });
  });
}

const recordAll = args.includes('--record-all');
const wantLive = args.includes('--live') || args.includes('--live-smoke');
let liveOk = false;
try {
  if (!recordAll) {
    const changes = (() => { try { return modelChanges(); } catch { return []; } })();
    if (changes.length && !wantLive) console.log(`WARNING: model files changed since the last live run (${changes.join(', ')}). No live calls are made; run with --live for the 4-test live smoke set.`);
  }
  for (const spec of SPECS) await run(spec, [], recordAll ? 'record' : 'replay');
  liveOk = recordAll && !rows.some((r) => r.status === 'FAIL');
  if (!recordAll && wantLive) {
    console.log('\nLive smoke set: forced by --live');
    liveOk = (await run('homework.spec.js', ['--smoke'], 'record')) === 'PASS';
  }
} finally {
  killLeftoverChrome();
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

console.log('\nRESULT');
for (const r of rows) console.log(`  ${r.status.padEnd(5)} ${r.spec}  ${r.detail}`);
const failed = rows.filter((r) => r.status === 'FAIL');
const knownRows = rows.filter((r) => r.status === 'KNOWN');
console.log(failed.length ? `\nFAILED: ${failed.map((r) => r.spec).join(', ')}` : knownRows.length ? `\nALL SPECS PASSED except KNOWN failures (${knownRows.map((r) => r.spec).join(', ')})` : '\nALL SPECS PASSED');
process.exit(failed.length ? 1 : 0);
