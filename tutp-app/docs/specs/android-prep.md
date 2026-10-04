# Spec: android-prep (Google Play closed-test readiness)

Pre-approved by the founder (2026-10-04). Branch `android-prep`, worktree `wt-android`, from origin/main 2b002ee.

1. **PWA/TWA**: `public/manifest.json` gets id, scope, description, categories (icons 192/512/maskable already exist). New `public/sw.js` (precaches only `/offline.html` + one icon; answers failed top-level page loads with it; never touches `/api`, auth, cookies or child data) and `public/js/pwa-register.js`, linked from `/` and `/app/login/`. Installability checked with Chrome's own installability check and Lighthouse on a no-traffic preview.
2. **Digital Asset Links**: `server/android/assetlinks.json` (package `online.tutp.app`, zero-value SHA-256 placeholder) served at `/.well-known/assetlinks.json` as `application/json` by a route in `server.js` (express.static ignores dot folders). `scripts/android/set-fingerprint.mjs` validates and writes the real fingerprint(s).
3. **TWA project**: `android/twa-manifest.json` (Bubblewrap) and `scripts/android/build.ps1` (checks JDK/SDK/Bubblewrap, keystore outside the repo, prompts for passwords itself, never reads or prints them, builds the `.aab`). `.gitignore` blocks keystores and build output.
4. **Policy pages**: `/privacy/`, `/terms/`, `/delete-account/` as plain static pages, marked DRAFT for legal review, `noindex` until reviewed, written only from `docs/play-store/code-audit.md`. A marked placeholder for DPDP consent wording; no consent clauses written. No self-service delete exists in the code, so the page describes the real email process.
5. **docs/play-store/**: code audit, listing text (en/te/hi), Data safety answers, content rating, target-audience recommendation, 5-screen shot list, feature graphic spec.
6. **Tests**: `tests/unit/android-prep.test.js` (manifest, assetlinks, fingerprint tool, service worker rules, pages) and `tests/e2e/android.spec.js` (same against the preview, run by `run.js`). One no-traffic preview, final image without `E2E_REPLAY`, `CHIP_HASH_SALT:2`, tag `anrel`, 0 percent; `scripts/release-an.ps1` written, not run.

**Edge cases**: SW must not cache redirects/auth pages; a SW update must not strand old caches; assetlinks must not redirect; placeholder must never be mistaken for a real fingerprint; package id is permanent.
**Out of scope**: Play Billing (flagged in the founder list), DPDP wording, real fingerprint, Play account.
