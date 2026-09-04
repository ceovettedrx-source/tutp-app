import { writeFileSync } from 'fs';
import { generateBarModelSvg } from '../services/barModelSvgGenerator.js';

const cases = [
  { label: 'parts:2 shaded:1 label:"1/2"', input: { parts: 2, shaded: 1, label: '1/2' }, outFile: '/tmp/barmodel-1.svg' },
  { label: 'parts:4 shaded:3 (no label)', input: { parts: 4, shaded: 3 }, outFile: '/tmp/barmodel-2.svg' },
  { label: 'invalid (parts:3 shaded:5)', input: { parts: 3, shaded: 5 }, outFile: null }
];

for (const { label, input, outFile } of cases) {
  try {
    const svg = generateBarModelSvg(input);
    console.log(`${label}: SUCCEEDED`);
    if (outFile) {
      writeFileSync(outFile, svg);
      console.log(`  written to ${outFile}`);
    }
  } catch (err) {
    console.log(`${label}: THREW — ${err.message}`);
  }
}
