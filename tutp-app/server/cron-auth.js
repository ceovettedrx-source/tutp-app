// Cloud Scheduler -> /api/cron/* authentication. The shared secret comes in
// the X-Cron-Token header only: a ?token= query string ends up in every
// Cloud Run request log line, headers do not. Compared in constant time.
import crypto from 'crypto';

export const CRON_HEADER = 'x-cron-token';

export function cronAuthorized(headers, expected) {
  const given = headers && headers[CRON_HEADER];
  if (!expected || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}
