// Writes docs/golden-telugu-review.md: the three Telugu golden cases (g14, g15, g16) as a
// plain page for the founder to review by hand, from the recorded replies (no model spend).
//   node tests/golden/review-telugu.mjs
// The page lists the page text the parent photographed, then what each surface wrote, then
// a checklist. Nothing here is marked correct: the founder (or a Telugu teacher) decides.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CASES } from './cases.js';
import { runCase, checkCase } from './golden.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'golden-telugu-review.md');
const ids = ['g14', 'g15', 'g16'];
const lines = [];
const w = (s = '') => lines.push(s);

w('# Telugu golden cases: for hand review');
w();
w('Three cases, recorded from the real model (prompt version explain-v2.2, the img1 language rule). **Nothing below is marked correct**: it is for you or a Telugu teacher to read. The automatic checks only look at script, structure and bracketed terms, not at whether the Telugu is good.');
w();
w('The rule being tested: the notebook answer the child writes stays in the PAGE language; explanations, idea cards, notes and the parent cards are in Telugu; key terms are bilingual, `Telugu word (English term)`, when the page is English.');
w();
w('The Telugu science term list used by the prompts (`SCIENCE_GLOSSARY` in `server/prompts/notes-glossary.js`) is a starting list in SCERT wording, **unverified**: please correct it in the same pass.');
w();
for (const c of CASES.filter((x) => ids.some((i) => x.id.startsWith(i)))) {
  const run = await runCase(c, { mode: 'replay' });
  const { failures } = checkCase(c, run);
  w(`## ${c.id}`);
  w();
  w(`${c.cls}, ${c.subject}, ${c.board === 'state' ? 'State Board' : c.board}. Page language: ${c.pageScript === 'latin' ? 'English' : 'Telugu'}. Parent language: Telugu. Automatic checks: ${failures.length ? 'FAILED: ' + failures.join('; ') : 'pass'}.`);
  w();
  w('**What the parent photographed**');
  w();
  w('> ' + c.text.replace(/\n/g, '\n> '));
  w();
  const a = run.ans.answer;
  if (a.mode === 'content') {
    w('**Answer please: idea cards** (title and summary are for the parent, so Telugu)');
    w();
    a.questions.forEach((q, i) => { w(`${i + 1}. **${q.q_text}** — ${q.blocks.map((b) => b.text).join(' ')}`); w(); });
  } else {
    w('**Answer please: the notebook answers** (the child writes these, so in the page language) and the notes to the parent');
    w();
    a.questions.forEach((q, i) => {
      w(`${i + 1}. ${q.q_text}`);
      q.blocks.forEach((b) => {
        if (b.type === 'steps') {
          w(`   - given: ${b.given.join('; ')}`); w(`   - find: ${b.find}`);
          b.formula.forEach((f) => w(`   - formula: ${f.text}${f.why_text ? '  (why, for the parent: ' + f.why_text + ')' : ''}`));
          w(`   - substitution: ${b.substitution.join('; ')}`); w(`   - **answer: ${b.final_answer}**`);
        } else if (b.type === 'text') w(`   - ${b.text}`);
        else w(`   - table: ${JSON.stringify(b.rows)}`);
      });
      if (q.unit_direction_note) w(`   - unit note (for the parent): ${q.unit_direction_note}`);
      w();
    });
  }
  const e = run.explain;
  if (e) {
    w('**Explain please** (first question or idea)');
    w();
    w(`- title: ${e.title}`); w(`- in 30 seconds: ${e.quick}`); w(`- the full explanation: ${e.full}`);
    e.traps.forEach((t, i) => w(`- exam trap ${i + 1}: ${t}`));
    w(`- a common mix-up: ${e.misconception.text}`);
    e.parent_questions.forEach((p, i) => w(`- tonight ${i + 1}: ${p.q}  (good answer: ${p.expected_answer_hint})`));
    w(`- check question (for the child): ${e.check_question.q} / ${e.check_question.options.join(' | ')}`);
    w(`- picture labels: ${e.illustration.labels.map((l) => l.text).join(', ')}`);
    w();
  }
  const n = run.notes;
  if (n) {
    w('**Notes please**');
    w();
    w(`- title: ${n.title}`); w(`- key idea: ${n.key_idea}`);
    (n.method || []).forEach((m, i) => w(`- step ${i + 1}: ${m}`));
    if (n.worked_example) w(`- worked example: ${n.worked_example.problem} → ${(n.worked_example.steps || []).join(' / ')} → ${n.worked_example.answer}`);
    (n.key_terms || []).forEach((t) => w(`- key term: ${t.term}: ${t.meaning}`));
    (n.common_mistakes || []).forEach((m) => w(`- common mistake: ${m}`));
    if (n.remember) w(`- remember: ${n.remember}`);
    (n.quick_check || []).forEach((q) => w(`- quick check: ${q.q} → ${q.a}`));
    if (n.tell_your_child) w(`- tell your child: ${n.tell_your_child}`);
    w();
  }
  w('**Your checklist** (tick or write a correction)');
  w();
  w('- [ ] Reads like a school teacher speaking Telugu, not translated English');
  w('- [ ] Technical terms are the standard SCERT words, and the same word every time');
  w('- [ ] Key terms are bilingual where the page is English, Telugu word first');
  w('- [ ] No half-Telugu half-English words, no broken letters, no stray symbols');
  w('- [ ] Numbers are digits, units as on the page');
  w('- [ ] Nothing is wrong or misleading for the class');
  w('- Corrections: ');
  w();
}
fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log('wrote ' + OUT);
