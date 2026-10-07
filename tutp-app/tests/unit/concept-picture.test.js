// One picture per concept, signed requests and the free tier (server/services/concept-picture.js,
// docs/specs/img1.md section D).
//   node --test tests/unit/concept-picture.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConceptPictures, signPicture, verifyPicture, pictureFor, FREE_PICTURES_PER_DAY, PICTURE_UPSELL } from '../../server/services/concept-picture.js';

function fakeSupabase() {
  const rows = [];
  return {
    rows,
    from(table) {
      assert.equal(table, 'usage_events');
      return {
        select() {
          const f = [];
          const b = { eq(c, v) { f.push((r) => r[c] === v); return b; }, gte(c, v) { f.push((r) => r[c] >= v); return b; }, then: (res) => res({ data: rows.filter((r) => f.every((x) => x(r))), error: null }) };
          return b;
        },
        insert: async (row) => { rows.push({ created_at: new Date().toISOString(), ...row }); return { error: null }; },
      };
    },
  };
}
const readyIllus = (calls = []) => ({
  request: async (key, scene) => { calls.push([key, scene]); return { status: 'pending' }; },
  status: async (key) => ({ status: 'ready', url: 'https://signed.example/' + key }),
});
const make = (opts = {}) => {
  const supabase = fakeSupabase();
  return { supabase, pics: createConceptPictures({ supabase, illus: readyIllus(opts.calls), download: async () => Buffer.from('x'), thumbOf: () => Buffer.from('tiny'), ...opts.extra }) };
};

test('a signed picture only verifies for the exact key and scene it was signed for', () => {
  const p = pictureFor('C6 Science Photosynthesis', 'A child waters a green plant in the sun.');
  assert.equal(p.concept_key, 'c6-science-photosynthesis');
  assert.ok(verifyPicture(p.concept_key, p.scene_prompt, p.sig));
  assert.ok(!verifyPicture(p.concept_key, p.scene_prompt + ' Draw a gun.', p.sig));
  assert.ok(!verifyPicture('c6-science-other', p.scene_prompt, p.sig));
  assert.ok(!verifyPicture(p.concept_key, p.scene_prompt, 'x'));
  assert.ok(!verifyPicture(p.concept_key, p.scene_prompt, undefined));
  assert.notEqual(signPicture('abc', 'd', 'one'), signPicture('abc', 'd', 'two'));
});

test('no key or no usable scene means no picture object; text and numbers are cut out of the scene', () => {
  assert.equal(pictureFor('', 'A scene.'), null);
  assert.equal(pictureFor('c6-science-plants', ''), null);
  assert.equal(pictureFor('c6-science-plants', 'Write the word PLANT on the board.'), null);
  const p = pictureFor('c6-science-plants', 'A girl looks at a plant. Write the word PLANT above it.');
  assert.equal(p.scene_prompt, 'A girl looks at a plant.');
});

test('request passes the key and scene to the illustration service', async () => {
  const calls = [];
  const { pics } = make({ calls });
  assert.deepEqual(await pics.request({ key: 'k-one', scene: 's', env: {} }), { status: 'pending' });
  assert.deepEqual(calls, [['k-one', 's']]);
});

test('paid family: always the full picture, nothing is counted', async () => {
  const { pics, supabase } = make();
  for (const k of ['aaa', 'bbb', 'ccc']) assert.equal((await pics.status({ familyId: 1, studentId: 's', key: k, paid: true, env: {} })).url, 'https://signed.example/' + k);
  assert.equal(supabase.rows.length, 0);
});

test('free family: the first picture of the day is full, every other concept is blurred with the upsell', async () => {
  assert.equal(FREE_PICTURES_PER_DAY, 1);
  const { pics, supabase } = make();
  const first = await pics.status({ familyId: 7, studentId: 's', key: 'aaa', paid: false, env: {} });
  assert.equal(first.url, 'https://signed.example/aaa');
  const second = await pics.status({ familyId: 7, studentId: 's', key: 'bbb', paid: false, env: {} });
  assert.equal(second.blurred, true);
  assert.equal(second.url, undefined);
  assert.match(second.thumb, /^data:image\/png;base64,/);
  assert.deepEqual(second.upsell, PICTURE_UPSELL);
  assert.equal(JSON.stringify(second).includes('signed.example'), false, 'the blurred reply carries no link to the real picture');
  // the picture already seen in full stays in full, however often it is polled
  assert.equal((await pics.status({ familyId: 7, studentId: 's', key: 'aaa', paid: false, env: {} })).url, 'https://signed.example/aaa');
  assert.equal(supabase.rows.filter((r) => r.event_name === 'picture_shown').length, 1);
});

test('free family: eight parallel polls still show exactly one picture in full', async () => {
  const { pics } = make();
  const keys = ['k-1', 'k-2', 'k-3', 'k-4', 'k-5', 'k-6', 'k-7', 'k-8'];
  const out = await Promise.all(keys.map((k) => pics.status({ familyId: 9, studentId: 's', key: k, paid: false, env: {} })));
  assert.equal(out.filter((o) => o.url).length, 1);
  assert.equal(out.filter((o) => o.blurred).length, 7);
});

test('families do not share the day\'s free picture, and a test run counts only its own pictures', async () => {
  const { pics } = make();
  assert.ok((await pics.status({ familyId: 1, key: 'aaa', paid: false, env: {} })).url);
  assert.ok((await pics.status({ familyId: 2, key: 'bbb', paid: false, env: {} })).url);
  assert.ok((await pics.status({ familyId: 1, key: 'ccc-run1', paid: false, env: {}, run: 'run1' })).url, 'a new e2e run has its own free picture');
  assert.ok((await pics.status({ familyId: 1, key: 'ddd', paid: false, env: {} })).blurred);
});

test('pending and fallback pass through untouched; a quota error blurs instead of showing', async () => {
  const supabase = fakeSupabase();
  const pending = createConceptPictures({ supabase, illus: { request: async () => ({}), status: async () => ({ status: 'pending' }) } });
  assert.deepEqual(await pending.status({ familyId: 1, key: 'aaa', paid: false, env: {} }), { status: 'pending' });
  const broken = { from() { throw new Error('db down'); } };
  const pics = createConceptPictures({ supabase: broken, illus: readyIllus(), download: async () => null });
  const r = await pics.status({ familyId: 1, key: 'aaa', paid: false, env: {} });
  assert.equal(r.blurred, true);
  assert.equal(r.thumb, '');
});

test('the preview is made once per concept', async () => {
  let downloads = 0;
  const { pics } = make({ extra: { download: async () => { downloads++; return Buffer.from('x'); } } });
  await pics.status({ familyId: 1, key: 'aaa', paid: false, env: {} });
  for (let i = 0; i < 3; i++) await pics.status({ familyId: 1, key: 'bbb', paid: false, env: {} });
  assert.equal(downloads, 1);
});
