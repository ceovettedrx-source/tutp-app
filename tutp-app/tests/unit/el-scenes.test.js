// Every Experiential Learning concept has a picture scene that survives the
// text filter unchanged (server/el/scenes.js, docs/specs/img1.md section D).
//   node --test tests/unit/el-scenes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EL_SCENES, elPicture } from '../../server/el/scenes.js';
import { verifyPicture } from '../../server/services/concept-picture.js';

const CONTENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'el', 'content');
const ids = fs.readdirSync(CONTENT).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

test('every lesson file has a scene, and no scene is left over', () => {
  assert.deepEqual(Object.keys(EL_SCENES).sort(), ids.sort());
});

test('each scene is kept whole by the text filter and gets a verifiable signed picture', () => {
  for (const id of ids) {
    const p = elPicture(id);
    assert.ok(p, id + ' has no picture');
    assert.equal(p.concept_key, 'el-' + id);
    // the filter rejoins its clauses without the comma before with/and/showing/where
    assert.equal(p.scene_prompt.replace(/,/g, ''), EL_SCENES[id].replace(/,/g, ''), id + ': the filter cut part of the scene');
    assert.ok(verifyPicture(p.concept_key, p.scene_prompt, p.sig));
  }
});

test('an unknown concept has no picture', () => {
  assert.equal(elPicture('nope'), null);
});
