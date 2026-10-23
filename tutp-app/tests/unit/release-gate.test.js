// TUT-88: unit tests for scripts/lib/release-gate-logic.ps1 (the pure checks of release-gate.ps1).
// The logic runs in PowerShell through tests/unit/release-gate-cases.ps1 with fixture facts.
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const FAKE_ENV_VALUE = 'FAKE-VALUE-MUST-NEVER-PRINT-123'; // in the fixture env, must never reach any output
const COMMIT = 'a'.repeat(40);

const ps = ['powershell', 'pwsh'].find((c) => spawnSync(c, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0);

function run(cases) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rg-')), 'cases.json');
  fs.writeFileSync(f, JSON.stringify(cases));
  const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'release-gate-cases.ps1'), '-CasesFile', f], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  const all = r.stdout + r.stderr;
  assert.ok(!all.includes(FAKE_ENV_VALUE), 'a secret value reached the output');
  return JSON.parse(r.stdout);
}
const failed = (res) => res.results.filter((x) => !x.pass).map((x) => x.n);
const one = (override) => run([override])[0];

// env fixture lines, same shape as gcloud flattened(spec.containers[0].env)
const BASE_LIVE = [
  'env[0].name: ANSWER_V2_ENABLED', 'env[0].value: 1',
  'env[1].name: IMAGE_GEN_ENABLED', 'env[1].value: 1',
  'env[2].name: SOME_TOKEN', `env[2].value: ${FAKE_ENV_VALUE}`,
  'env[3].name: ADMIN_TOKEN', 'env[3].valueFrom.secretKeyRef.name: admin-token', 'env[3].valueFrom.secretKeyRef.key: latest',
  'env[4].name: CRON_TOKEN', 'env[4].valueFrom.secretKeyRef.name: cron-token-v2',
];
const withNew = (...extra) => [...BASE_LIVE, ...extra];

test('release gate: needs PowerShell', { skip: !ps && 'no powershell/pwsh on this machine' }, async (t) => {
  await t.test('all pass prints exactly the one traffic line', () => {
    const r = one({});
    assert.strictEqual(r.allPass, true);
    assert.deepStrictEqual(failed(r), []);
    assert.strictEqual(r.command, 'gcloud.cmd run services update-traffic tutp-demo --region=us-central1 --to-revisions=tutp-demo-00520-new=100 --update-tags=pdftest=tutp-demo-00520-new');
  });

  await t.test('every combination of the 7 checks: command only when nothing failed', () => {
    const breakers = [
      { NewRevision: 'tutp-demo-00512-pov' },                       // 0
      { LiveLabel: null },                                          // 1
      { NewEnvText: BASE_LIVE.slice(0, 9) },                        // 2 (CRON_TOKEN gone)
      { NewEnvText: withNew('env[5].name: E2E_REPLAY', 'env[5].value: 1') }, // 4
      { E2eState: 'failure' },                                      // 5
      { NewLabelFull: 'b'.repeat(40) },                             // 6
    ];
    // check 3 (flags) has its own breaker below; combine through a flag change on the new env
    const flagBreak = { NewEnvText: BASE_LIVE.map((l) => (l === 'env[0].value: 1' ? 'env[0].value: 0' : l)) };
    const all = [breakers[0], breakers[1], breakers[2], flagBreak, breakers[3], breakers[4], breakers[5]];
    const nums = [0, 1, 2, 3, 4, 5, 6];
    const cases = [];
    for (let mask = 0; mask < 128; mask++) {
      const c = {};
      for (let i = 0; i < 7; i++) if (mask & (1 << i)) Object.assign(c, all[i]);
      cases.push(c);
    }
    // breakers 2, 3 and 4 all write NewEnvText, so in a mix the later one wins: mixes only need to fail somewhere
    const res = run(cases);
    res.forEach((r, mask) => {
      if (mask === 0) { assert.strictEqual(r.allPass, true); return; }
      assert.strictEqual(r.allPass, false, `mask ${mask}`);
      assert.strictEqual(r.command, null, `mask ${mask} printed a command`);
      assert.ok(failed(r).length > 0, `mask ${mask}`);
    });
    // single breakers fail exactly their own check
    nums.forEach((n, i) => assert.deepStrictEqual(failed(res[1 << i]).includes(n), true, `breaker ${n}`));
  });

  await t.test('check 0: the new revision already live fails', () => {
    assert.deepStrictEqual(failed(one({ NewRevision: 'tutp-demo-00512-pov' })), [0]);
  });

  await t.test('check 1: missing label, unresolvable commit, not an ancestor all fail', () => {
    assert.deepStrictEqual(failed(one({ LiveLabel: null })), [1]);
    assert.deepStrictEqual(failed(one({ LiveLabel: '' })), [1]);
    assert.deepStrictEqual(failed(one({ LiveIsAncestor: null })), [1]);
    assert.deepStrictEqual(failed(one({ LiveIsAncestor: false })), [1]);
    assert.deepStrictEqual(failed(one({ LiveIsAncestor: true })), []);
  });

  await t.test('check 2: a name only on live fails, names only on new do not, a secret turned plain fails', () => {
    assert.deepStrictEqual(failed(one({ NewEnvText: BASE_LIVE.slice(0, 5) })), [2]);
    assert.deepStrictEqual(failed(one({ NewEnvText: withNew('env[5].name: EXTRA', 'env[5].value: 1') })), []);
    const plain = BASE_LIVE.filter((l) => !l.startsWith('env[4].valueFrom')).concat('env[4].value: abc');
    assert.deepStrictEqual(failed(one({ NewEnvText: plain })), [2]);
    // a secret moved to another secret name is a different secret: fails
    const renamed = BASE_LIVE.map((l) => l.replace('cron-token-v2', 'cron-token-v3'));
    assert.deepStrictEqual(failed(one({ NewEnvText: renamed })), [2]);
    assert.deepStrictEqual(failed(one({ NewEnvText: null })), [2, 3, 4]);
    assert.deepStrictEqual(failed(one({ LiveEnvText: null })), [2, 3]);
  });

  await t.test('check 3: flags equal; 1 vs true, one-sided, or secret-sourced differ; absent on both passes', () => {
    const swap = (from, to) => BASE_LIVE.map((l) => (l === from ? to : l));
    assert.deepStrictEqual(failed(one({ NewEnvText: swap('env[0].value: 1', 'env[0].value: true') })), [3]);
    assert.deepStrictEqual(failed(one({ NewEnvText: swap('env[1].value: 1', 'env[1].value: 0') })), [3]);
    const withoutAnswer = BASE_LIVE.filter((l) => !l.startsWith('env[0]'));
    assert.deepStrictEqual(failed(one({ NewEnvText: withoutAnswer })), [2, 3]);           // absent on new only: the name is also lost (2)
    assert.deepStrictEqual(failed(one({ LiveEnvText: withoutAnswer, NewEnvText: withoutAnswer })), []); // absent on both
  });

  await t.test('check 4: E2E_REPLAY set to anything, even empty, fails', () => {
    assert.deepStrictEqual(failed(one({ NewEnvText: withNew('env[5].name: E2E_REPLAY', 'env[5].value: 1') })), [4]);
    assert.deepStrictEqual(failed(one({ NewEnvText: withNew('env[5].name: E2E_REPLAY') })), [4]);
    assert.deepStrictEqual(failed(one({ NewEnvText: withNew('env[5].name: E2E_REPLAY_OTHER', 'env[5].value: 1') })), []);
  });

  await t.test('check 5: only success passes; failure, pending, none fail', () => {
    for (const s of ['failure', 'pending', 'error', '', null]) assert.deepStrictEqual(failed(one({ E2eState: s })), [5], String(s));
    assert.deepStrictEqual(failed(one({ E2eState: 'success' })), []);
  });

  await t.test('check 6: new revision label must equal the commit (case-insensitive); missing fails', () => {
    assert.deepStrictEqual(failed(one({ NewLabelFull: 'b'.repeat(40) })), [6]);
    assert.deepStrictEqual(failed(one({ NewLabelFull: null })), [6]);
    assert.deepStrictEqual(failed(one({ NewLabelFull: COMMIT.toUpperCase() })), []);
    assert.deepStrictEqual(failed(one({ Commit: null })), [6]);
  });

  await t.test('only env names reach the output: the fake secret value never appears (run() asserts it for every case)', () => {
    const r = one({ NewEnvText: BASE_LIVE.slice(0, 5) });
    assert.ok(r.results.find((x) => x.n === 2).reason.includes('ADMIN_TOKEN'));
  });
});

test('release-gate.ps1 source rules (no powershell needed)', () => {
  const code = (f) => fs.readFileSync(path.join(ROOT, ...f), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // comments may name the banned things
  const src = code(['scripts', 'release-gate.ps1']) + code(['scripts', 'lib', 'release-gate-logic.ps1']);
  assert.ok(!/format\s*=\s*"?json/i.test(src), 'must not use --format=json');
  assert.ok(!/secrets\s+versions\s+access/.test(src), 'must not read a secret value');
  assert.ok(!/\bscheduler\b/.test(src), 'must not touch scheduler jobs');
  assert.ok(/--is-ancestor/.test(src), 'ancestor check must use git merge-base --is-ancestor');
  const lines = src.split('\n').filter((l) => /update-traffic/.test(l) && !/^\s*#/.test(l));
  assert.strictEqual(lines.length, 1, 'update-traffic appears in one place only, as a printed string');
  assert.ok(/\$cmd = "gcloud\.cmd run services update-traffic/.test(lines[0]));
});

test('CLAUDE.md carries the two TUT-88/89 rules', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(/traffic commands? come only from `scripts\/release-gate\.ps1[^`]*`/i.test(md));
  assert.ok(/Never post the e2e commit status by hand; only the e2e workflow posts it\./.test(md));
});
