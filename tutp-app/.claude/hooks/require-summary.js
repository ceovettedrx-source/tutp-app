#!/usr/bin/env node
// Stop hook: blocks the end of a task until docs/CHANGES-EXPLAINED.md has an
// entry for the current change set. Fingerprint = HEAD sha + hash of the diff
// (summary files excluded), stored in docs/.last-summary. No dependencies.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP = 20;
const SUMMARY = 'docs/CHANGES-EXPLAINED.md';
const ARCHIVE = 'docs/changes-archive.md';
const STAMP = 'docs/.last-summary';
const EXCLUDE = [':(exclude)' + SUMMARY, ':(exclude)' + STAMP];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

// keep the newest KEEP entries (each starts with "## "), move the rest to the archive
function prune(root) {
  const file = path.join(root, SUMMARY);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const parts = text.split(/^(?=## )/m);
  const head = parts[0].startsWith('## ') ? '' : parts.shift();
  if (parts.length <= KEEP) return;
  const old = parts.splice(KEEP).join('');
  const archive = path.join(root, ARCHIVE);
  const prev = fs.existsSync(archive) ? fs.readFileSync(archive, 'utf8') : '# Changes archive\n\nOlder entries moved here from CHANGES-EXPLAINED.md (newest first).\n\n';
  const at = prev.search(/^## /m);
  const merged = at === -1 ? prev.trimEnd() + '\n\n' + old : prev.slice(0, at) + old + prev.slice(at);
  fs.writeFileSync(archive, merged);
  fs.writeFileSync(file, head + parts.join(''));
}

function main(input) {
  let data = {};
  try { data = JSON.parse(input || '{}'); } catch (e) { /* no stdin json */ }
  if (data.stop_hook_active) return 0;

  // the project dir (not the git toplevel, which can be a parent folder) holds docs/
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  process.chdir(root);
  try { git(['rev-parse', '--git-dir']); } catch (e) { return 0; }
  prune(root);

  let head = 'none';
  try { head = git(['rev-parse', 'HEAD']).trim(); } catch (e) { /* no commits yet */ }
  const diff = git(['diff', 'HEAD', '--', '.', ...EXCLUDE]);
  // new files do not show in `git diff HEAD`: add their names and contents
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...EXCLUDE]).split('\0').filter(Boolean);
  const h = crypto.createHash('sha256').update(diff);
  for (const f of untracked) {
    h.update('\0' + f + '\0');
    try { h.update(fs.readFileSync(f)); } catch (e) { /* unreadable: name only */ }
  }
  const clean = diff === '' && untracked.length === 0;
  const fingerprint = head + ':' + h.digest('hex');

  let stored = '';
  try { stored = fs.readFileSync(STAMP, 'utf8').trim(); } catch (e) { /* none yet */ }
  if (clean && stored.split(':')[0] === head) return 0;
  if (stored === fingerprint) return 0;

  process.stderr.write(
    'Before finishing: add an entry at the top of docs/CHANGES-EXPLAINED.md (max 15 lines: date, feature, ' +
    'files touched, what changed, how to test, risks/open items), then write the current fingerprint to ' +
    'docs/.last-summary.\nCurrent fingerprint: ' + fingerprint + '\n'
  );
  return 2;
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => { process.exit(main(buf)); });
process.stdin.on('error', () => { process.exit(main('')); });
