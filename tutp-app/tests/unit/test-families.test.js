// Unit tests for server/test-families.js:
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutTestFamilies, isTestFamily, initTestFamilies } from '../../server/test-families.js';

test('withoutTestFamilies drops test family rows, by family_id or id', () => {
  const ids = new Set([16]);
  assert.deepEqual(withoutTestFamilies([{ family_id: 16 }, { family_id: 3 }, { family_id: '16' }], ids), [{ family_id: 3 }]);
  assert.deepEqual(withoutTestFamilies([{ id: 16 }, { id: 7 }], ids, 'id'), [{ id: 7 }]);
  assert.deepEqual(withoutTestFamilies(null, ids), []);
});

test('isTestFamily reads data.is_test through the client, caches, and fails closed to "real"', async () => {
  let queries = 0;
  const client = { from: () => ({ select: () => ({ eq: async () => { queries++; return { data: [{ id: 16 }], error: null }; } }) }) };
  initTestFamilies(client);
  assert.equal(await isTestFamily(16), true);
  assert.equal(await isTestFamily('16'), true);
  assert.equal(await isTestFamily(3), false);
  assert.equal(await isTestFamily(null), false);
  assert.equal(queries, 1);
});
