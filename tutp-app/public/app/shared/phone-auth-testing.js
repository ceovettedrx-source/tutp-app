// TUT-59: when may the login skip the reCAPTCHA check? Only for the fixed test
// numbers (+91 99999 0000[1-9], same pattern as isTestPhone in
// server/test-families.js) on a tagged no-traffic preview host
// (<tag>---tutp-demo-...run.app), never on tutp.online. Pure, no imports, so
// phone-auth.js and tests/unit/phone-auth-testing.test.js both load it.
export function shouldDisableAppVerification(phone, hostname) {
  const isTestNumber = /^999990000[1-9]$/.test(String(phone || '').replace(/\D/g, '').slice(-10));
  const isPreviewHost = String(hostname || '').includes('---tutp-demo-');
  return isTestNumber && isPreviewHost;
}
