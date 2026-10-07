// One picture scene per Experiential Learning concept (docs/specs/img1.md section D).
// Hand-written so the lesson picture costs no model call: one English sentence
// describing a simple, friendly everyday scene, with no words, letters, numbers or
// signs in it (the image provider adds the no-text suffix and the picture service
// cuts any clause that asks for text). The key is the shared concept key, so the
// same picture can appear on Explain, Notes and Story for the same idea.
// Unit tests: tests/unit/el-scenes.test.js.
import { pictureFor } from '../services/concept-picture.js';

export const EL_SCENES = {
  'acids-bases': 'A child in a kitchen squeezes a lemon into a glass of water next to a bar of soap and a glass of plain water, with a red cabbage cut in half on the table.',
  'circuit': 'A child on a table joins a battery, a small bulb and a switch with wires, and the bulb glows bright yellow.',
  'density-floating': 'Children at a pond watch a wooden boat and a leaf float on the water while a stone sinks to the bottom.',
  'force-pressure': 'A girl presses her thumb on a balloon while a boy sits on a wide cushion and another child stands on a sharp pin-board, in a sunny classroom.',
  'friction': 'Two children slide a wooden box over a smooth tiled floor and then over a rough rug, with their shoes and the box shown clearly.',
  'heat-transfer': 'A steel spoon rests in a hot pot on a stove, a hand holds the cool end, and warm air rises above the pot toward a sunny window.',
  'inertia': 'A bus in a village road starts suddenly and the standing passengers lean backward, while a child sits calmly holding a school bag.',
  'magnets': 'A child holds a horseshoe magnet over a table with iron nails, paper clips and a plastic comb, and the nails jump up to the magnet.',
  'refraction': 'A child looks into a glass of water on a table where a straw looks bent, with sunlight coming through a nearby window.',
  'separation': 'A mother in a courtyard sieves rice and pulses from a basket while a child watches tea leaves being strained into a cup.',
  'shadows': 'Children in a playground at sunset stand in a row and their long dark shadows stretch across the ground behind them.',
  'sound': 'A child plucks a stretched rubber band over a box, a drum with tiny grains dancing on top stands beside it, and a friend listens with a hand near her ear.',
};

export const elPicture = (conceptId) => (EL_SCENES[conceptId] ? pictureFor('el-' + conceptId, EL_SCENES[conceptId]) : null);
