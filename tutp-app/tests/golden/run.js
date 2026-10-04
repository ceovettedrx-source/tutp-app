// Golden set from the command line.
//   node tests/golden/run.js                 replay the recorded replies (no spend)
//   node tests/golden/run.js --record        call the model and save the replies (about $0.03 a case)
//   node tests/golden/run.js --only g7,g9    some cases (id prefix)
// Prints one line per case and the spend; exit 1 if any case fails.
import 'dotenv/config';
import { CASES } from './cases.js';
import { runCase, checkCase } from './golden.js';

const args = process.argv.slice(2);
const mode = args.includes('--record') ? 'record' : 'replay';
const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean) : [];
const list = CASES.filter((c) => !only.length || only.some((o) => c.id.startsWith(o)));
let bad = 0, spend = 0;
for (const c of list) {
  const run = await runCase(c, { mode });
  const { failures } = checkCase(c, run);
  spend += run.usd;
  console.log(`${failures.length ? 'FAIL' : 'PASS'} ${c.id}  $${run.usd.toFixed(4)}`);
  failures.forEach((f) => console.log('   - ' + f));
  if (failures.length) bad++;
}
console.log(`${list.length - bad}/${list.length} passed, model spend $${spend.toFixed(4)} (${mode})`);
process.exit(bad ? 1 : 0);
