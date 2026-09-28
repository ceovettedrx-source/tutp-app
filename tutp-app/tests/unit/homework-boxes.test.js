// Unit tests for server/homework-boxes.js ("Show on photo" boxes):
//   npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, boxablePhotos, checkBox, checkQuestionBoxes, applyQuestionBoxes, BOX_MAX_EDGE } from '../../server/homework-boxes.js';
import { checkReplyJson } from '../../server/homework-reply.js';

// Minimal JPEG header: SOI, an APP0 segment, then SOF0 with the size.
function jpeg(width, height, { sof = 0xc0, app = true } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (app) parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  const sofSeg = Buffer.from([0xff, sof, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sofSeg.writeUInt16BE(height, 5);
  sofSeg.writeUInt16BE(width, 7);
  parts.push(sofSeg, Buffer.alloc(16));
  return Buffer.concat(parts).toString('base64');
}
function png(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString('base64');
}

test('imageSize: JPEG (baseline and progressive), PNG', () => {
  assert.deepEqual(imageSize('image/jpeg', jpeg(1176, 1568)), { width: 1176, height: 1568 });
  assert.deepEqual(imageSize('image/jpeg', jpeg(960, 1280, { sof: 0xc2, app: false })), { width: 960, height: 1280 });
  assert.deepEqual(imageSize('image/png', png(800, 600)), { width: 800, height: 600 });
});

test('imageSize: wrong type, garbage, empty, PDF', () => {
  assert.equal(imageSize('image/jpeg', png(800, 600)), null);
  assert.equal(imageSize('image/png', jpeg(800, 600)), null);
  assert.equal(imageSize('image/jpeg', Buffer.from('not an image at all').toString('base64')), null);
  assert.equal(imageSize('image/jpeg', ''), null);
  assert.equal(imageSize('application/pdf', jpeg(800, 600)), null);
  assert.equal(imageSize('image/jpeg', jpeg(0, 600)), null);
});

test('boxablePhotos: counts PDFs in the index, skips photos over the max edge', () => {
  const photos = boxablePhotos([
    { mediaType: 'application/pdf', base64: 'JVBERi0=' },
    { mediaType: 'image/jpeg', base64: jpeg(1176, 1568) },
    { mediaType: 'image/jpeg', base64: jpeg(BOX_MAX_EDGE + 1, 1000) },
  ]);
  assert.deepEqual(photos, [{ index: 1, width: 1176, height: 1568 }]);
  assert.deepEqual(boxablePhotos([]), []);
  assert.deepEqual(boxablePhotos(undefined), []);
});

const PHOTO = { index: 0, width: 1000, height: 2000 };

test('checkBox: pixels -> 0..1000', () => {
  assert.deepEqual(checkBox([100, 200, 500, 400], PHOTO), [100, 100, 500, 200]);
});

test('checkBox: swapped corners are put in order; numeric strings accepted', () => {
  assert.deepEqual(checkBox([500, 400, 100, 200], PHOTO), [100, 100, 500, 200]);
  assert.deepEqual(checkBox(['100', '200', '500', '400'], PHOTO), [100, 100, 500, 200]);
});

test('checkBox: clamped to the image', () => {
  assert.deepEqual(checkBox([-50, 1900, 1200, 2500], PHOTO), [0, 950, 1000, 1000]);
});

test('checkBox: too small, non-numbers, wrong length, no photo', () => {
  assert.equal(checkBox([100, 100, 103, 400], PHOTO), null);
  assert.equal(checkBox([100, 100, 500, 102], PHOTO), null);
  assert.equal(checkBox([1200, 100, 1500, 400], PHOTO), null);   // wholly off the right edge
  assert.equal(checkBox([100, 'x', 500, 400], PHOTO), null);
  assert.equal(checkBox([100, null, 500, 400], PHOTO), null);
  assert.equal(checkBox([100, 200, 500], PHOTO), null);
  assert.equal(checkBox('100,200,500,400', PHOTO), null);
  assert.equal(checkBox([100, 200, 500, 400], null), null);
});

test('checkQuestionBoxes: keeps valid pairs, drops bad photo index, PDF index, bad box', () => {
  const photos = [{ index: 1, width: 1000, height: 2000 }];
  const { json, boxed } = checkQuestionBoxes({
    mode: 'questions',
    extracted_questions: [
      { question: 'a', answer: '1', reasoning: 'r', photo: 1, box: [100, 200, 500, 400] },
      { question: 'b', answer: '2', reasoning: 'r', photo: 0, box: [100, 200, 500, 400] },   // 0 is the PDF
      { question: 'c', answer: '3', reasoning: 'r', photo: 5, box: [100, 200, 500, 400] },   // no such attachment
      { question: 'd', answer: '4', reasoning: 'r', photo: '1', box: [100, 200, 500, 400] }, // not an integer
      { question: 'e', answer: '5', reasoning: 'r', photo: 1, box: [100, 200, 101, 400] },   // too small
      { question: 'f', answer: '6', reasoning: 'r' },
    ],
  }, photos);
  assert.equal(boxed, 1);
  assert.deepEqual(json.extracted_questions[0], { question: 'a', answer: '1', reasoning: 'r', photo: 1, box: [100, 100, 500, 200] });
  for (const q of json.extracted_questions.slice(1)) {
    assert.equal('photo' in q, false);
    assert.equal('box' in q, false);
  }
});

test('checkQuestionBoxes: no photos -> every box removed; concept mode untouched', () => {
  const { json, boxed } = checkQuestionBoxes({ mode: 'questions', extracted_questions: [{ question: 'a', photo: 0, box: [1, 2, 300, 400] }] }, []);
  assert.equal(boxed, 0);
  assert.deepEqual(json.extracted_questions, [{ question: 'a' }]);
  const concept = { mode: 'concept', extracted_questions: null, concept_explanation: 'x' };
  assert.deepEqual(checkQuestionBoxes(concept, []).json, concept);
});

test('applyQuestionBoxes: rewrites the reply text; the page can still parse it', () => {
  const data = {
    id: 'msg_1', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Here you go: {"subject":"Math","mode":"questions","extracted_questions":[{"question":"24 + 13 =","answer":"37","reasoning":"r","photo":0,"box":[100,200,500,400]}],"concept_explanation":null,"aditiApplicable":false,"aditiHook":null}' }],
  };
  const { data: out, boxed } = applyQuestionBoxes(data, [PHOTO]);
  assert.equal(boxed, 1);
  assert.equal(out.id, 'msg_1');
  assert.deepEqual(checkReplyJson(out), { ok: true });
  const json = JSON.parse(out.content[0].text);
  assert.deepEqual(json.extracted_questions[0].box, [100, 100, 500, 200]);
  assert.equal(json.subject, 'Math');
});

test('applyQuestionBoxes: no text block or unparseable text -> data unchanged', () => {
  const none = { content: [] };
  assert.equal(applyQuestionBoxes(none, [PHOTO]).data, none);
  const broken = { content: [{ type: 'text', text: '{"mode":' }] };
  assert.equal(applyQuestionBoxes(broken, [PHOTO]).data, broken);
});
