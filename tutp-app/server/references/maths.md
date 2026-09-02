# Mathematics — Subject Reference Note (Tut-P)

This file is read by the lesson-material generator BEFORE drafting any math content. It encodes
Tut-P's pedagogy choices and everything currently sourced in the India Learning Commons Knowledge
Graph. Follow it the way `references/math.md` is followed in the US k12-teacher-skills repo — as
mandatory grounding, not optional background.

**Current coverage: Class 4–6 Mathematics, Fractions only.** Every other math topic/grade is
outside this file's sourced knowledge — if asked to generate material for a topic not covered
below, say so plainly in the output's grounding note (per the honesty rule below) rather than
drafting confidently from general knowledge.

---

## 1. Tut-P's pedagogy approach — CPA, grade-banded

Tut-P follows the Concrete–Pictorial–Abstract (CPA) progression (Singapore Math tradition):

| Grade band | Stage | What this means for generated material |
|---|---|---|
| Grades 1–2 | Concrete | Counting objects, physical/countable representations. No bar models yet. |
| Grades 3–6 | Pictorial | **Bar Model** is the default representation for fractions, ratios, and word problems. Generate bar-model descriptions as structured data (matches Tut-P's deterministic SVG generator) — never as freehand prose description of a picture. |
| Grades 7+ | Abstract | Symbolic/algebraic notation becomes primary; pictorial models are a bridge, not the main method. |

A generated worksheet must match its grade's stage. Do not give a grade-5 worksheet only
symbolic fraction notation with no bar model — that skips the stage this grade is in.

### Important honesty note about the bar model specifically
Tut-P's Bar Model is a **product design choice**, not necessarily what the student's own state
textbook shows. Sourced AP/Telangana Class 5 textbook content (Chapter 13: Fractions) teaches
equivalence via paper-folding/area-shading and comparison via number-line placement — not
literally the bar-model format. Same CPA-pictorial stage, same skill, different picture. **Never
claim the generated bar-model worksheet "matches your textbook picture-for-picture"** — it
matches the skill and the grade-appropriate representation type, which is an honest and still
valuable claim, just a narrower one.

---

## 2. Fractions — what's sourced (Class 4–6)

### The national competency this maps to
**NCF-SE 2023, Curricular Goal CG-1, Competency C-1.2** (Preparatory Stage, grades 3–5 as a
block, not a single grade): representing and comparing everyday fractions as parts of a whole,
as points on a number line, and as the result of dividing a whole number by another.

### Grade-by-grade sequence (Tut-P's own operationalization of C-1.2 — this sequencing is our
design choice, not something NCF itself specifies at this granularity)
- **Grade 4** — represent simple fractions (half, third, quarter) using shaded regions / bar
  models.
- **Grade 5** — (a) identify equivalent fractions by comparing bar-model shaded area, and
  generate an equivalent fraction for a target denominator; (b) compare and order fractions with
  unlike denominators using bar models.
- **Grade 6 (Middle Stage, NCF competency C-1.4)** — explore number sets (whole, fraction,
  integer, rational, real) and place them on a number line. This is broader than "fractions"
  specifically — don't narrow it back down to fractions-only material when generating for grade 6.

### State textbook alignment (sourced)
- **Andhra Pradesh & Telangana:** Class 5 Maths, Chapter 13 "Fractions" (same legacy 17-chapter
  structure in both states). No confirmed stable SCF code system exists for either state — don't
  invent one (e.g. don't write "AP-M5-3.2"-style codes; they aren't real).
- Medium: both English and Telugu textbook editions exist for this chapter (Telangana adds Urdu).
  **Default generated student-facing material to English** — AP/Telangana state data shows
  ~90%+ English-medium enrollment even in government schools as of 2025-26. Telugu should be
  offered as an explicit option, not assumed as default, for student-facing content. (This is the
  opposite of parent-facing voice/chat, where Telugu should stay default-available — see Tut-P's
  core "language barrier" thesis: the parent generation's English fluency often lags the child's
  English-medium schooling.)

---

## 3. Documented misconceptions (sourced) — use these for distractor/practice-item design

Do not invent generic "students may struggle with fractions" language. Use these specific,
researcher-documented patterns when writing wrong-answer options or planning a teacher's
in-the-moment response:

1. **Numerator-only scaling** (on-grade confusion, grade 5 equivalence): student scales only the
   numerator when creating an equivalent fraction (e.g. turns 1/2 into 2/2, not 2/4), treating it
   as whole-number arithmetic on the "top number" only. *Teacher move:* have the student count how
   many parts the whole is now split into, before asking how many are shaded — separates the two
   questions that are getting merged.
2. **No fixed-whole concept yet** (prerequisite gap, grade 5 equivalence): student can't judge
   whether two differently-sized bar models represent the same amount, because they don't yet
   treat a fraction as parts of one fixed-size whole. *Teacher move:* step back to same-size-whole
   comparisons (grade 4 level) before reintroducing equivalence.
3. **Larger denominator = larger fraction** (on-grade confusion, grade 5 comparison): student
   compares only denominators and picks the fraction with the larger denominator as bigger (e.g.
   thinks 1/8 > 1/2). *Teacher move:* same-numerator bar models side by side (1/2 vs 1/8) so the
   student sees pieces shrinking as the denominator grows.

When generating a check-for-understanding or question-paper distractor from one of these: the
wrong answer choice must be the one this specific reasoning actually produces (verify with real
numbers, don't guess) — this is Verification Gate B from the design notes; run it before
finalizing any multiple-choice item.

---

## 4. Mandatory language rules

**Asset-based language, always** — describe specific behavior, never label the student. Not "weak
at fractions" or "struggling with denominators" — "treats the denominator as a count of parts
rather than the size of each part." This applies to every teacher-facing note, every chat message,
and any parent-facing Bonding Dashboard text derived from this material.

**Grounding honesty, always** — every generated material must state its grounding status plainly:
- If the Knowledge Graph query returned a sourced match: name the NCF competency code and state
  chapter.
- If it returned `ambiguous`: do not guess between candidates — this should have been resolved
  before generation started (the route layer asks the teacher to pick).
- If it returned `sourced: false` (no match): say so — "Generated without confirmed NCF/state
  standard alignment; based on general mathematics teaching practice." Never fabricate a citation.

**No curriculum/publisher attribution in student-facing output** — NCF competency codes and state
chapter references are fine to show (they're the standard itself, not a third-party publisher's
proprietary material). But don't name or imply any specific external curriculum brand as the
source of an activity design, since Tut-P has no such licensed partnership (see design-notes point
7) — everything here is either NCF/state-textbook-sourced structure or Tut-P's own pedagogy.

## 5. Geometry (Triangles etc.) — NOT YET Knowledge-Graph-sourced, interim rules only

**This section is not backed by a sourced NCF competency or state textbook mapping** — unlike
Section 2 (Fractions), which is. Any material generated for geometry topics should carry the
"ungrounded" badge honestly (see grounding rules in Section 4) until this is properly sourced
(tracked as a separate future task: source NCF-SE 2023 geometry competencies + AP/Telangana
Chapter mapping for triangles, the same way Fractions was sourced).

Until then, apply this general mathematical-correctness rule when generating triangle
classification content — this was caught as a real error in an early generated worksheet, so
it's a rule, not a nice-to-have:

### Triangles can belong to more than one classification category at once
"By sides" (equilateral / isosceles / scalene) and "by angles" (acute / right / obtuse) are two
**independent** classification systems — a single triangle gets one label from each, not one
label overall. When asking a student to "identify the triangle" from given side-lengths or
angle-measures, or when writing an answer key:

- A triangle with angles 90°, 45°, 45° is **both** right-angled (by angles) **and** isosceles
  (by sides — two 45° angles imply two equal sides). An answer key that only says "right-angled"
  is incomplete.
- A triangle with all angles 60° is **both** equilateral (by sides) **and** acute (by angles,
  since all angles are under 90°). Same issue.
- Do not force a single-category answer when the given information genuinely supports two
  labels from the two different systems. If an item is meant to test only one system, say so
  explicitly in the question ("classify this triangle by its sides only") rather than leaving it
  ambiguous and then marking a multi-valid answer wrong.

### Triangle inequality — state the strict form, not "at least"
The sum of any two sides must be **strictly greater than** the third side, not "greater than or
equal to." Sides 3, 4, 7 do NOT form a triangle (3+4 = 7, not > 7) — this is a common point of
confusion worth calling out explicitly in generated key-points, not left implicit.
