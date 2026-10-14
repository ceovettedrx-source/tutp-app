// TUT-42: the three dashboards are generated from templates/dashboard.html.
//   node --test tests/unit/dashboards.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { buildAll, render } from '../../scripts/build-dashboards.mjs';

test('the committed dashboards are exactly what the template generates (edit the template, then run node scripts/build-dashboards.mjs)', () => {
  for (const [name, { file, html }] of Object.entries(buildAll())) {
    assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), html, name + ' page differs from templates/dashboard.html');
  }
});

test('each page carries its own role and no other parent page leaks in', () => {
  const pages = buildAll();
  assert.match(pages.mother.html, /<title>Tut-P Mother Dashboard<\/title>/);
  assert.match(pages.father.html, /<title>Tut-P Father Dashboard<\/title>/);
  assert.match(pages['family-member'].html, /<title>Tut-P Family Member View<\/title>/);
  assert.match(pages.mother.html, /data-role="mother"/);
  assert.match(pages.father.html, /data-role="father"/);
  assert.match(pages['family-member'].html, /id="viewerGate"/);
  assert.doesNotMatch(pages.mother.html, /id="viewerGate"/);
  assert.match(pages['family-member'].html, /data-can-pay="false"/);
  assert.match(pages.father.html, /data-can-pay="true"/);
  for (const p of Object.values(pages)) assert.doesNotMatch(p.html, /\{\{\w+\}\}|^@@/m);
});

test('the template parser refuses broken markers', () => {
  assert.throws(() => render('@@template x\n@@if parent\na', { parent: true, self: 'mother', other: 'father' }), /unclosed/);
  assert.throws(() => render('@@template x\n@@else\na', { parent: true, self: 'mother', other: 'father' }), /without/);
  assert.throws(() => render('@@template x\n{{nope}}', { parent: true, self: 'mother', other: 'father' }), /unreplaced/);
  assert.throws(() => render('no header', { parent: true }), /must start/);
});
