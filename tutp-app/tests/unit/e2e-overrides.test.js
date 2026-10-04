// The e2e-only request switches (server/e2e-overrides.js) and the v2 flag.
//   node --test tests/unit/e2e-overrides.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { e2eOverrides, imageEnv } from '../../server/e2e-overrides.js';
import { answerV2Enabled, signConceptKey, verifyConceptKey } from '../../server/routes/answer-explain.js';

const req = (h) => ({ get: (k) => h[k.toLowerCase()] });
const ALL = { 'x-e2e-answer-v2': '1', 'x-e2e-image': 'mock', 'x-e2e-key-suffix': 'Run-42!!extra-long' };

test('production (no E2E_REPLAY) ignores every header', () => {
  assert.deepEqual(e2eOverrides(req(ALL), {}), { answerV2: false, imageMock: false, keySuffix: '' });
  assert.deepEqual(e2eOverrides(req(ALL), { E2E_REPLAY: '0' }), { answerV2: false, imageMock: false, keySuffix: '' });
  assert.equal(answerV2Enabled(req(ALL), {}), false);
});

test('a preview with E2E_REPLAY=1 honours them, the suffix cleaned and cut', () => {
  const o = e2eOverrides(req(ALL), { E2E_REPLAY: '1' });
  assert.equal(o.answerV2, true);
  assert.equal(o.imageMock, true);
  assert.equal(o.keySuffix, 'run42ext');
  assert.equal(answerV2Enabled(req(ALL), { E2E_REPLAY: '1' }), true);
  assert.equal(answerV2Enabled(req({}), { E2E_REPLAY: '1' }), false);          // old suites send nothing: flag off
  assert.equal(e2eOverrides(null, { E2E_REPLAY: '1' }).answerV2, false);
});

test('the flag turns v2 on for everyone, and off by default', () => {
  assert.equal(answerV2Enabled(req({}), {}), false);
  assert.equal(answerV2Enabled(req({}), { ANSWER_V2_ENABLED: '1' }), true);
  assert.equal(answerV2Enabled(req({}), { ANSWER_V2_ENABLED: 'true' }), true);
  assert.equal(answerV2Enabled(req({}), { ANSWER_V2_ENABLED: '0' }), false);
});

test('the mock image environment is only built when asked', () => {
  const env = { A: 'x' };
  assert.equal(imageEnv({ imageMock: false }, env), env);
  const m = imageEnv({ imageMock: true }, env);
  assert.equal(m.IMAGE_PROVIDER, 'mock');
  assert.equal(m.IMAGE_GEN_ENABLED, '1');
  assert.equal(m.A, 'x');
  assert.ok(Number(m.MOCK_IMAGE_DELAY_MS) > 0);
});

test('a signed concept key verifies; another key, a forged or missing signature does not', () => {
  const sig = signConceptKey('c9-physics-speed', 's3cret');
  assert.equal(verifyConceptKey('c9-physics-speed', sig, 's3cret'), true);
  assert.equal(verifyConceptKey('c9-physics-other', sig, 's3cret'), false);
  assert.equal(verifyConceptKey('c9-physics-speed', sig, 'other-secret'), false);
  assert.equal(verifyConceptKey('c9-physics-speed', 'x', 's3cret'), false);
  assert.equal(verifyConceptKey('c9-physics-speed', undefined, 's3cret'), false);
});
