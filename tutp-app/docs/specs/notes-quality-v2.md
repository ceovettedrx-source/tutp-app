# Notes quality v2 (spec, awaiting founder approval)

Branch `notes-quality-v2` from `origin/main` (1dea79e), worktree `wt-notes-design`. Round 4 checkout untouched. No traffic or tag changes; new preview tag `nq2`. Add the `nq2` host to Firebase Authorized domains before login tests.

## Problem (real Telugu output)

Notes for "6 x 9 = 6 x 3 x __" came back as a generic list of multiplication properties; the quick check reused homework numbers; Telugu used unnatural terms and fragment steps.

## Changes

1. **Skill-specific title and key idea** (`server/prompts/notes-prompts.js`): the prompt first asks the model to name the specific skill the homework practises (e.g. split one factor and keep both sides equal), then write title and key_idea about that skill, not a general list of properties. Worked example may reuse the homework's structure with different numbers.
2. **quick_check uses new numbers**: prompt rule, plus a server check (below) that flags any quick_check q/a containing a number sequence that also appears in the homework text.
3. **te/hi wording**: new `server/prompts/notes-glossary.js` (data + a `glossaryFor(lang)` text block, injected into the prompt for te/hi only). Header marks every entry `UNVERIFIED - teacher review`. Prompt rules: textbook-natural language; every worked-example step and method step is a full sentence, no fragments; banned phrases listed (స్థానిక లక్షణం, సున్న్య, సర్వ కాలం -> ఎల్లప్పుడూ). Seed te: commutative = వినిమయ ధర్మం, associative = సహచర ధర్మం, distributive = విభాజక ధర్మం. Other te/hi terms (zero property, equal sides, factor, product, multiple, fraction, numerator, denominator, equation, remainder...) are my guesses, listed for your review in the final message.
4. **Grounding check + one retry** (`server/notes-ground.js`, pure): extract tokens from the homework text (numbers, operators `+ - x × ÷ = /`, and keywords: Latin words of 4+ letters, plus te/hi words of 3+ chars, minus a small stop list). Pass when title+key_idea share at least one number, operator or keyword with it. Fail -> ONE retry in `server/routes/chips.js` with a correction hint appended to the user message ("Your title and key idea must be about this exact homework: <first tokens>. Do not give generic notes."); use the retry result only if it passes or is no worse, else keep the first. Max 1 retry, never loops. The quick_check number reuse is a soft check: logged (`notes.ground`) and included in the same single retry, not a second one.
5. **Cost**: haiku-4-5, about $0.002 per notes call; a retry doubles that for that call only. I will log `notes.ground` pass/fail/retry and report the retry rate and measured cost from the recorded runs.

## Files touched

Edit: `server/prompts/notes-prompts.js`, `server/routes/chips.js`, `tests/e2e/chips.spec.js` (new notes cases), `tests/e2e/run.js` only if the model-file list needs `notes-glossary.js`/`notes-ground.js` (it must: prompt change triggers the live smoke set), recordings. New: `server/prompts/notes-glossary.js`, `server/notes-ground.js`, `tests/unit/notes-ground.test.js`, `tests/unit/notes-glossary.test.js`. Already edited: te exam_prep chip label -> 'పరీక్ష తయారీ' (`search-chips.js`, `chips-intent.test.js`).

## Edge cases

Homework text with no usable tokens (very short topic): check passes. Typed topic only (no questions): tokens come from it. Retry fails or errors: keep the first valid notes. Cache stores the final result only. Plain fallback format skips the check.

## Tests

Unit: ground check (shared number passes; generic notes fail; operator-only match passes; Telugu keyword; empty homework passes; quick_check reuse detected; stop words ignored); glossary (every entry has te/hi and the UNVERIFIED flag; banned phrases present in the prompt; seed te terms exact). E2E (replay on `nq2`, twice in a row): fresh live recordings of Telugu, Hindi and English for maths ("6 x 9 = 6 x 3 x __"), science and language, asserting title shares a token with the homework, quick_check has no homework numbers, no banned phrases, steps end as sentences; a retry case; screenshots at 360px and print of the Telugu notes in `tests/e2e/output/`. Live recording of these about $0.03-0.05 (9 calls plus retries).

## Release

After e2e x2: commit (`TUTP_AGENT_COMMIT=1`, lowercase, one command per line), push branch, redeploy the tested image without `E2E_REPLAY`, give you the one-line traffic command, verify `status.traffic`, then fast-forward main.

## As built (2026-10-03)

- Founder change: the prompt names the te/hi glossary terms as written (no VERIFIED flag); the founder reviews the list before release. Glossary lives in `server/prompts/notes-glossary.js`.
- Grounding check compares title, key idea and the worked example's problem (a numbers-only homework gets a key idea in words, so the example problem carries the operators). Homework words are compared only in the script the key idea uses. List numbering ("1. ") is not a number.
- The notes user message lists the homework's numbers for quick_check to avoid (cut quick_check reuse in the recorded runs from 1 of 9 cells to 0 before retry).
- `max_tokens` 1500 -> 2500: Telugu science notes were cut off (unparseable) at 1500.
- One retry at most; the retry result is used only if it has fewer problems. Header `X-Notes-Retry` (no / used / kept-first) and log line `notes.ground`.
