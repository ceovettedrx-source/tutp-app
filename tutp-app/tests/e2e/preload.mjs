// Loaded into every spec by run.js (node --import). TUT-47: no wait may hang
// for the default 30 s Playwright applies only when a spec forgets to set
// one, so set 30 s explicitly on every context and page a spec opens. A wait
// that names its own longer timeout keeps it (run.js's 90 s per-test stall
// limit still ends the spec).
import { chromium } from 'playwright';
import { authDir, countOtpRequests, installSessionCache, isCachedSpec } from './auth-cache.mjs';

const WAIT_MS = 30000;
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...a) => {
  const browser = await launch(...a);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...x) => {
    const ctx = await newContext(...x);
    ctx.setDefaultTimeout(WAIT_MS);
    ctx.setDefaultNavigationTimeout(WAIT_MS);
    // TUT-104: count OTP sends; the specs that share a login reuse run.js's session
    const dir = authDir();
    if (dir) {
      countOtpRequests(ctx, dir);
      if (isCachedSpec(process.argv[1])) await installSessionCache(ctx, dir);
    }
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...x) => {
    const page = await newPage(...x);
    page.setDefaultTimeout(WAIT_MS);
    page.setDefaultNavigationTimeout(WAIT_MS);
    return page;
  };
  return browser;
};
