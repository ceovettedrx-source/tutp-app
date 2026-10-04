// Per-request switches for the e2e suite, honoured ONLY on a preview revision
// that has E2E_REPLAY=1 (production never has it, so every request there
// ignores these headers). They let ONE no-traffic preview serve three jobs
// without three deploys or three Firebase-authorized hosts:
//   X-E2E-Answer-V2: 1   Answer/Explain v2 on, although ANSWER_V2_ENABLED is unset
//                        (the old suites send nothing and so test the flag-off path)
//   X-E2E-Image: mock    the mock image provider with image generation on, slowed
//                        by MOCK_IMAGE_DELAY_MS (default 1500 ms here) so the shimmer shows
//   X-E2E-Key-Suffix: x  appended to the concept_key (a-z, 0-9, up to 8 characters)
//                        so every test run makes its own cache and picture rows
// Unit tests: tests/unit/e2e-overrides.test.js.

export function e2eOverrides(req, env = process.env) {
  const none = { answerV2: false, imageMock: false, keySuffix: '' };
  if (env.E2E_REPLAY !== '1' || !req || typeof req.get !== 'function') return none;
  const suffix = String(req.get('x-e2e-key-suffix') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return {
    answerV2: req.get('x-e2e-answer-v2') === '1',
    imageMock: req.get('x-e2e-image') === 'mock',
    keySuffix: suffix,
  };
}

// The environment an image request runs with: the real one, or the mock
// provider switched on for this request.
export function imageEnv(overrides, env = process.env) {
  return overrides && overrides.imageMock
    ? { ...env, IMAGE_PROVIDER: 'mock', IMAGE_GEN_ENABLED: '1', IMAGE_GEN_DAILY_CAP: '1000', MOCK_IMAGE_DELAY_MS: env.MOCK_IMAGE_DELAY_MS || '1500' }
    : env;
}
