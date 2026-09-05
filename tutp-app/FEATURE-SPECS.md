# Tut-P Parent-Facing Feature Specs — Source of Truth

This document is the authoritative, up-to-date spec for the 6-option parent 
chooser. It exists because relying on conversation history across long, 
multi-day sessions led to repeated confusion and re-explanation. Update this 
file directly when a feature's design changes — don't just discuss it in chat.

Last updated: 2026-09-05 (Saturday)

---

## The 6 chooser options

1. Storytelling Method — built, working
2. Experiential Learning — built, text-only v1 (video matching deferred)
3. Play-Based Learning — built, refinements pending (see below)
4. Homework Help — built, working, now mode-differentiated from Quiz
5. Quiz — built, working, now mode-differentiated from Homework Help
6. Online Exam / Test — placeholder only, not designed yet

All 6 require an explicit parent selection (chip appears in the attach/input 
box on click) — no silent default. If a parent tries to submit without 
selecting one, a popup shows all 6 as directly clickable buttons inside the 
popup itself.

---

## 1. Storytelling Method

**Purpose**: help a child understand a lesson by hearing it as a memorable 
story before doing homework, especially useful when a child is reluctant to 
start homework.

**Flow**: parent attaches/types the lesson → API generates a story connecting 
the lesson to real-life events a child would recognize → parent presses a 
"speak" control → Web Speech API (browser TTS) reads the story aloud, 
Gemini-voice-mode style.

**Known constraint**: Telugu voice availability on Web Speech API is 
inconsistent across devices/browsers. Current behavior: always show the full 
story text; if no matching TTS voice is available, show "No Telugu voice 
available on this device — read the text above to your child instead" instead 
of a dead/broken speak button. **Founder TODO**: test real coverage on an 
actual Android phone (Chrome) — not yet done as of this writing.

**Pedagogy grounding**: NEP-2020 experiential/activity-based learning — the 
story functions as an experiential hook. Light-touch reference in the prompt, 
not full Panchpadi walkthrough.

---

## 2. Experiential Learning

**Purpose**: help a child understand a lesson practically, since Tut-P can't 
provide physical hands-on experiments — the next best thing is showing what 
real experiments/demonstrations of this lesson look like, plus clear notes.

**Flow**: parent attaches/submits a lesson → API (1) infers what the 
immediately preceding topic in a typical curriculum sequence would have been, 
(2) searches whether this lesson has a real experimental/demonstration video 
on YouTube, (3) if found, generates step-by-step bullet notes based on that 
video's content, shows the actual YouTube video linked as reference below the 
notes. If no good video match is found: fall back to text-only step-by-step 
notes, explicitly say no video reference was found — never fabricate a link.

**Current status**: text-only v1 shipped (steps 1 and 3, no real YouTube 
search yet — step 2 deferred as a fast-follow since it needs new web-search 
capability and relevance verification, which was too risky to rush before 
Monday's launch).

**Pedagogy grounding**: best-fit feature for real Panchpadi grounding — should 
implement Aditi (connect to prior knowledge) as a genuine engagement hook, not 
an informational disclaimer-style callout. Reference Panchpadi explicitly; 
apply Bodha if appropriate; don't force Abhyasa/Prayoga/Prasara into a feature 
that's meant to be quick, per pedagogy-nep-ncf.md's own "not every stage every 
time" rule.

---

## 3. Play-Based Learning

**Purpose**: turn a lesson into a multiplayer family quiz game, so the whole 
family (not just parent+child) engages with the content together, competitively 
and socially, per the founder's own household example (father, mother, 
grandfather all playing with the child).

**Flow**: parent attaches/submits a lesson, picks number of players (2/3/4 — 
real family members present, e.g. father + mother + grandfather + child, 
though the child doesn't "play" a turn themselves, family members take turns 
being quizzed on the child's behalf/quizzing the child together). API 
generates 3 questions per player (so 2 players = 6 questions total). Whoever's 
turn it is gets a question; the family can discuss it together for as long as 
they want; then that person locks in an answer.

**Corrections needed (not yet built, planned for today/Saturday)**:
1. A configurable countdown timer (30s / 45s / 60s, parent's choice) applies 
   ONLY to the decision-to-answer window. Once locked in (correct or wrong, 
   explanation shown), there is NO time limit for the family to discuss/explain 
   further — advances to the next question only when someone presses "Next."
2. Which player gets the next question should be RANDOM, not a fixed 
   round-robin cycle — for a real "game" feel, not a mechanical pattern.
3. Add a "Player of the Day" badge for the session's highest scorer, with a 
   share option (simple shareable text/image for WhatsApp status or family 
   groups).

**Pedagogy grounding**: not yet in scope for grounding pass (lower priority — 
game mechanic, not primarily a content-generation prompt in the same way as 
the other 3).

---

## 4. Homework Help

**Purpose**: plain explanation of school-assigned homework content, to help a 
parent (who may not be fluent in the subject or the school's language) 
understand it well enough to help their child. Explanation only — no quiz.

**Flow**: parent attaches homework (photo/PDF) or types the question → API 
returns a clear explanation in the parent's chosen language. Quiz section not 
shown/generated for this entry point.

**Relationship to Quiz**: shares the same underlying modal and API call as 
Quiz (`/api/homework`, same {explanation, quiz} response shape) — but the UI 
now differentiates: Homework Help shows title "Homework Help," 
homework-focused placeholder text, button "Explain My Homework" (exact wording 
may vary), and displays ONLY the explanation. This was a deliberate "reuse, 
don't duplicate" engineering decision — a future task could fully split them 
if needed, but is not currently planned.

**Pedagogy grounding**: NEP-2020 teacher-as-facilitator/parent-as-guide 
framing — light-touch, since this is meant to be quick.

---

## 5. Quiz

**Purpose**: let a parent assess/quiz their child one-on-one on a lesson's 
content (5-10 questions), without the multiplayer/family-game mechanic of 
Play-Based Learning. Standalone, single-child, no timer.

**Flow**: parent attaches/types the lesson → API returns explanation 
(collapsed/secondary) + 5-10 quiz questions, parent asks child and 
assesses/explains as needed.

**Relationship to Homework Help**: see above — same modal, mode-flag 
differentiates title/placeholder/button/result-ordering. Quiz leads with the 
quiz; explanation is available but secondary.

**Pedagogy grounding**: Bloom's Taxonomy — questions should span cognitive 
levels (recall, understanding, application), not all recall-only. Consistent 
with the Teacher Module's question-paper generator's existing cognitive-demand 
categories (Logical/Reasoning, Understanding, Application, Skill-based).

---

## 6. Online Exam / Test

**Purpose** (not yet fully specified — needs a real design session with the 
founder before building): a formal, single-child assessment format, distinct 
from Play-Based Learning's casual multiplayer quiz — for parents who want to 
conduct something closer to a real exam/test rather than a quick quiz game.

**Current status**: icon + "Coming soon" placeholder only. No API call, no 
real functionality. Do not build without a full spec from the founder first.

---

## Cross-cutting decisions

- **Explicit selection required**: none of the 6 should ever silently default. 
  A parent must always see, unambiguously, which mode is active before and 
  after submitting.
- **Pedagogy grounding**: reuses the Teacher Module's existing infrastructure 
  (`server/references/pedagogy-nep-ncf.md`, read-and-inject pattern in 
  `lessonMaterialGenerator.js`). Each feature gets a targeted, relevant slice 
  of grounding (not a one-size-fits-all full-file injection, to manage token 
  budget) — see each feature's "Pedagogy grounding" note above. Never fabricate 
  grounding claims — if content doesn't genuinely map to a principle, don't 
  force a false claim of alignment.
- **Known token-budget risk**: broad/unspecific lesson content + Telugu output 
  + injected reference text can hit token limits and truncate responses (this 
  happened once already with Quiz/Homework Help — fixed by raising max_tokens 
  to 3000 and enforcing compact JSON). Any prompt changes (including pedagogy 
  grounding injection) must be tested against this same failure mode.

---

## Known backlog (not blocking Monday launch, but tracked)

- **Child View** (`/app/child/`) still has the original dead decorative attach 
  menu — never received any of the parent-page fixes. Needs a product decision 
  on what child-side attach should actually do before fixing.
- **Top-of-page pill row vs. popup chooser**: currently two separate UI 
  surfaces exist (a 3-chip pill row at the top of the page, and a 6-option 
  popup chooser reached via the attach icon). Unifying them into one selector 
  is a legitimate future improvement, not started.
- **Experiential Learning YouTube video matching**: deferred fast-follow, 
  needs real web-search capability + relevance verification before building.
- **Storytelling TTS real-device testing**: founder to test actual Telugu 
  voice coverage on a real Android phone (Chrome) and iOS Safari.
- **Homework Help / Quiz true separation**: currently share a modal with 
  mode-flag differentiation; a full split (genuinely separate code paths) is 
  possible later if the shared-modal approach causes issues.
