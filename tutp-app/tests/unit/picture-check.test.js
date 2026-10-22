// The vision check of a generated picture (server/services/picture-check.js). No network: the model call is a stub.
//   node --test tests/unit/picture-check.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPicture, parseVerdict, PICTURE_CHECK_MODEL } from '../../server/services/picture-check.js';
import { IMAGE_SUFFIX } from '../../server/explain-schema.js';

const reply = (text, usd = 0.0018) => async () => ({ ok: true, usd, data: { content: [{ type: 'text', text }] } });

test('the check runs on claude-haiku-4-5', () => {
  assert.equal(PICTURE_CHECK_MODEL, 'claude-haiku-4-5');
});

test('parseVerdict reads the JSON, also inside a code fence, and refuses anything else', () => {
  assert.deepEqual(parseVerdict('{"match":false,"reason":"a desert"}'), { match: false, reason: 'a desert' });
  assert.equal(parseVerdict('```json\n{"match":true,"reason":"ok"}\n```').match, true);
  assert.equal(parseVerdict('yes'), null);
  assert.equal(parseVerdict('{"match":"yes"}'), null);
  assert.equal(parseVerdict(''), null);
});

test('the picture and the scene (without the no-text suffix) go to the model; the verdict and cost come back', async () => {
  let sent = null;
  const v = await checkPicture({ buffer: Buffer.from('PNGDATA'), contentType: 'image/png', scene: `A kettle with steam. Flat, warm. ${IMAGE_SUFFIX}`,
    call: async (o) => { sent = o; return reply('{"match":false,"reason":"a cracked desert"}')(); } });
  assert.deepEqual(v, { match: false, reason: 'a cracked desert', usd: 0.0018 });
  assert.equal(sent.feature, 'picture_check');
  assert.equal(sent.body.model, 'claude-haiku-4-5');
  const [image, text] = sent.body.messages[0].content;
  assert.equal(image.type, 'image');
  assert.equal(image.source.data, Buffer.from('PNGDATA').toString('base64'));
  assert.equal(image.source.media_type, 'image/png');
  assert.ok(text.text.includes('A kettle with steam.'));
  assert.ok(!text.text.includes(IMAGE_SUFFIX), 'the suffix is not part of what the picture should show');
});

test('an API error, an unreadable reply or a thrown error gives match null (the caller keeps the picture)', async () => {
  const base = { buffer: Buffer.from('x'), contentType: 'image/png', scene: 's' };
  assert.equal((await checkPicture({ ...base, call: async () => ({ ok: false, status: 529, usd: 0 }) })).match, null);
  assert.equal((await checkPicture({ ...base, call: reply('I think so') })).match, null);
  assert.equal((await checkPicture({ ...base, call: async () => { throw new Error('network'); } })).match, null);
});

test('an unknown content type is sent as png', async () => {
  let type = '';
  await checkPicture({ buffer: Buffer.from('x'), contentType: 'application/octet-stream', scene: 's', call: async (o) => { type = o.body.messages[0].content[0].source.media_type; return reply('{"match":true,"reason":"ok"}')(); } });
  assert.equal(type, 'image/png');
});
