import { writeFileSync } from 'fs';
import { generateTriangleSvg } from '../services/triangleSvgGenerator.js';

const cases = [
  { label: 'equilateral (sides: [5,5,5])', input: { sides: [5, 5, 5] }, outFile: '/tmp/triangle-1.svg' },
  { label: 'right isosceles (angles: [90,45,45])', input: { angles: [90, 45, 45] }, outFile: '/tmp/triangle-2.svg' },
  { label: 'invalid (sides: [3,4,7])', input: { sides: [3, 4, 7] }, outFile: null }
];

for (const { label, input, outFile } of cases) {
  try {
    const svg = generateTriangleSvg(input);
    console.log(`${label}: SUCCEEDED`);
    if (outFile) {
      writeFileSync(outFile, svg);
      console.log(`  written to ${outFile}`);
    }
  } catch (err) {
    console.log(`${label}: THREW — ${err.message}`);
  }
}
