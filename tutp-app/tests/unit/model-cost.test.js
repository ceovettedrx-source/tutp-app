// Unit tests for server/model-cost.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costUsd, logModelCall } from '../../server/model-cost.js';

test('price per model', () => {
  const u = { input_tokens: 1000, output_tokens: 1000 };
  assert.equal(costUsd('claude-haiku-4-5', u), 0.006);
  assert.equal(costUsd('claude-sonnet-5', u), 0.012);
  assert.equal(costUsd('claude-sonnet-4-6', u), 0.018);
});

test('cache write 1.25x, cache read 0.1x of input', () => {
  const u = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000000, cache_read_input_tokens: 1000000 };
  assert.equal(costUsd('claude-sonnet-5', u), 2.5 + 0.2);
});

test('unknown model or no usage gives null, never throws', () => {
  assert.equal(costUsd('claude-unknown', { input_tokens: 5 }), null);
  assert.equal(costUsd('claude-sonnet-5', undefined), null);
  assert.equal(logModelCall({ feature: 'x', model: 'claude-unknown', usage: null }).usd, null);
});

test('a replayed reply costs nothing', () => {
  assert.equal(logModelCall({ feature: 'x', model: 'claude-sonnet-5', usage: { input_tokens: 9, output_tokens: 9 }, replay: true }).usd, 0);
});
