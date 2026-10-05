// server/uploads.js (round upload-security): type from bytes, strict paths,
// who may read what, old public urls -> signed urls, registration files.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as u from '../../server/uploads.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const pdf = Buffer.from('%PDF-1.7\n' + 'x'.repeat(20));
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(8)]);
const UUID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

test('type comes from the bytes: the five allowed types', () => {
  assert.equal(u.sniffType(png).mime, 'image/png');
  assert.equal(u.sniffType(jpg).ext, 'jpg');
  assert.equal(u.sniffType(pdf).mime, 'application/pdf');
  assert.equal(u.sniffType(webp).ext, 'webp');
  assert.equal(u.sniffType(heic).ext, 'heic');
});

test('other types are refused whatever the client says', () => {
  assert.equal(u.sniffType(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(u.sniffType(Buffer.from('MZ' + 'x'.repeat(30))), null);
  assert.equal(u.sniffType(Buffer.from('GIF89a' + 'x'.repeat(30))), null);
  assert.equal(u.sniffType(Buffer.alloc(4)), null);
  assert.equal(u.sniffType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypmp42'), Buffer.alloc(8)])), null);
});

test('base64 decoding is strict', () => {
  assert.equal(u.decodeBase64(png.toString('base64')).length, png.length);
  assert.equal(u.decodeBase64('data:image/png;base64,' + png.toString('base64')).length, png.length);
  assert.equal(u.decodeBase64(''), null);
  assert.equal(u.decodeBase64(42), null);
  assert.equal(u.decodeBase64('not base64 !!'), null);
});

test('object paths: random names under the owner folder', () => {
  const p = u.newObjectPath('families', 16, 'jpg');
  assert.match(p, /^families\/16\/[0-9a-f-]{36}\.jpg$/);
  assert.notEqual(p, u.newObjectPath('families', 16, 'jpg'));
  assert.deepEqual(u.parseObjectPath(`families/16/${UUID}.png`), { scope: 'families', owner: '16', name: `${UUID}.png`, path: `families/16/${UUID}.png` });
  assert.equal(u.parseObjectPath(`teachers/${UUID}/${UUID}.pdf`).scope, 'teachers');
  assert.equal(u.parseObjectPath(`registration/${'a'.repeat(24)}/${UUID}.webp`).scope, 'registration');
});

test('a client-sent path is never accepted unless it has exactly that shape', () => {
  for (const bad of [
    '../families/16/' + UUID + '.png', `families/16/../17/${UUID}.png`, `families/16/${UUID}.exe`, `families/16/${UUID}.png/x`,
    `families//${UUID}.png`, `families/abc/${UUID}.png`, 'families/16/evil.png', '1759000000000-abc123-photo.jpg',
    `/families/16/${UUID}.png`, `families/16/${UUID}.png?x=1`, `families/16/%2e%2e/${UUID}.png`, '', null, undefined, 5, {},
  ]) assert.equal(u.parseObjectPath(bad), null, String(bad));
});

test('who may read: only the owner family or teacher; registration files never', () => {
  const fam16 = u.parseObjectPath(`families/16/${UUID}.png`);
  assert.equal(u.canRead({ familyId: 16 }, fam16), true);
  assert.equal(u.canRead({ familyId: '16' }, fam16), true);
  assert.equal(u.canRead({ familyId: 17 }, fam16), false);
  assert.equal(u.canRead({ familyId: null, teacherId: 'x' }, fam16), false);
  assert.equal(u.canRead(null, fam16), false);
  assert.equal(u.canRead({ familyId: 16 }, null), false);
  const teach = u.parseObjectPath(`teachers/${UUID}/${UUID}.pdf`);
  assert.equal(u.canRead({ teacherId: UUID }, teach), true);
  assert.equal(u.canRead({ teacherId: 'other' }, teach), false);
  assert.equal(u.canRead({ familyId: 16 }, teach), false);
  const reg = u.parseObjectPath(`registration/${'b'.repeat(24)}/${UUID}.jpg`);
  assert.equal(u.canRead({ familyId: 16, teacherId: 1 }, reg), false);
});

const SB = 'https://abcd.supabase.co';
const legacy = `${SB}/storage/v1/object/public/family-uploads/1759000000000-k3j9x2-my%20photo.jpg`;

test('old public urls are recognised (same project only) and decoded', () => {
  assert.equal(u.legacyPathFromUrl(legacy, SB), '1759000000000-k3j9x2-my photo.jpg');
  assert.equal(u.legacyPathFromUrl(legacy.replace('abcd', 'evil'), SB), null);
  assert.equal(u.legacyPathFromUrl('https://example.com/a.jpg', SB), null);
  assert.deepEqual(u.storedKind(legacy, SB), { kind: 'legacy', path: '1759000000000-k3j9x2-my photo.jpg' });
  assert.deepEqual(u.storedKind(`families/16/${UUID}.png`, SB), { kind: 'path', path: `families/16/${UUID}.png` });
  assert.deepEqual(u.storedKind(u.OPEN_ROUTE + encodeURIComponent(`families/16/${UUID}.png`), SB), { kind: 'path', path: `families/16/${UUID}.png` });
  assert.equal(u.storedKind('https://example.com/a.jpg', SB).kind, 'other');
  assert.equal(u.storedKind(null, SB).kind, 'none');
});

function fakeSupabase({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    storage: { from: (bucket) => ({
      createSignedUrl: async (p, s) => { calls.push({ bucket, p, s }); return fail ? { error: new Error('nope') } : { data: { signedUrl: `${SB}/storage/v1/object/sign/${bucket}/${p}?token=t` } }; },
      move: async (from, to) => { calls.push({ move: [from, to] }); return from.includes('bad') ? { error: new Error('x') } : { data: {} }; },
    }) },
  };
}

test('old public-url rows and new paths become 15 minute signed urls', async () => {
  const sb = fakeSupabase();
  const a = await u.toReadable(sb, legacy, SB);
  assert.match(a, /\/object\/sign\/family-uploads\/1759000000000-k3j9x2-my photo\.jpg\?token=/);
  const b = await u.toReadable(sb, `teachers/${UUID}/${UUID}.pdf`, SB);
  assert.match(b, /\/object\/sign\//);
  assert.deepEqual(sb.calls.map(c => c.s), [900, 900]);
  assert.equal(await u.toReadable(sb, null, SB), null);
  assert.equal(await u.toReadable(sb, 'https://example.com/a.jpg', SB), 'https://example.com/a.jpg');
});

test('a signing failure keeps an old public url working and hides a new path', async () => {
  const sb = fakeSupabase({ fail: true });
  assert.equal(await u.toReadable(sb, legacy, SB), legacy);
  assert.equal(await u.toReadable(sb, `families/16/${UUID}.png`, SB), null);
});

test('registration files: only this phone\'s uploads survive, then move to the family folder', async () => {
  const mine = u.phoneHash('+919999900001');
  assert.equal(mine, u.phoneHash('9999900001'));
  assert.notEqual(mine, u.phoneHash('9999900002'));
  const own = `registration/${mine}/${UUID}.jpg`;
  const own2 = `registration/${mine}/1b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.png`;
  const others = `registration/${u.phoneHash('9999900002')}/${UUID}.jpg`;
  const payload = {
    children: [{ name: 'A', photoUrl: own }, { name: 'B', photoUrl: others }, { name: 'C' }],
    subjectWorkbooks: { Maths: own2, EVS: `families/99/${UUID}.png`, Social: 'https://evil.example/x.png' },
  };
  const found = u.collectRegistrationFiles(payload, '9999900001');
  assert.deepEqual(found.sort(), [own, own2].sort());
  assert.equal(payload.children[1].photoUrl, null);
  assert.equal('photoUrl' in payload.children[2], false);
  assert.deepEqual(Object.keys(payload.subjectWorkbooks), ['Maths']);

  const sb = fakeSupabase();
  const moved = await u.adoptRegistrationFiles(sb, found, 42);
  assert.equal(moved[own], `families/42/${UUID}.jpg`);
  u.rewriteRegistrationFiles(payload, moved);
  assert.equal(payload.children[0].photoUrl, `families/42/${UUID}.jpg`);
  assert.equal(payload.subjectWorkbooks.Maths, `families/42/1b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.png`);
});
