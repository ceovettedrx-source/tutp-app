// Cron routes refuse anything but the X-Cron-Token header (server/cron-auth.js),
// plain HTTP, no login, never runs a job:
//   node tests/e2e/cron.spec.js <base-url>
//
//   1  no token at all -> 403
//   2  a token in the ?token= query string (the old way) -> 403
//   3  a wrong X-Cron-Token header -> 403
//
// The right token is not tested here (it would run the job for real);
// after a deploy, check that the next Cloud Scheduler run returns 200.
// Exit code 1 if any check fails.
const BASE = (process.argv.slice(2).find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Usage: node tests/e2e/cron.spec.js <base-url>');
  process.exit(2);
}
const ROUTES = ['evening-homework-alerts', 'parent-engagement-score', 'weekly-digest', 'tutor-contact-refund-check'];
const WRONG = 'e2e-wrong-token-' + Date.now();

const failures = [];
function check(ok, msg) {
  if (!ok) failures.push(msg);
  console.log('[cron]', ok ? 'PASS' : 'FAIL', msg);
}

for (const r of ROUTES) {
  const url = `${BASE}/api/cron/${r}`;
  const none = (await fetch(url, { method: 'POST' })).status;
  check(none === 403, `1 ${r} without a token -> ${none}`);
  const query = (await fetch(`${url}?token=${WRONG}`, { method: 'POST' })).status;
  check(query === 403, `2 ${r} with a query token -> ${query}`);
  const header = (await fetch(url, { method: 'POST', headers: { 'X-Cron-Token': WRONG } })).status;
  check(header === 403, `3 ${r} with a wrong header -> ${header}`);
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL CRON CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
