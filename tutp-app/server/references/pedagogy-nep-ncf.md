# Pedagogy Grounding — NEP 2020 / NCF-SE 2023 / Teacher Training Reference Note

This file governs the **pedagogical architecture** of every generated lesson plan — separate
from `references/maths.md` (which governs subject content). Read this BEFORE drafting any
lesson plan's teacher_notes, regardless of subject.

**This is not a template to apply identically to every lesson.** For each lesson, first decide
which of the three grounding sources below actually apply, then decide what's implementable in
a worksheet/notes format, then write the teacher_notes. Never insert boilerplate like "this
lesson is based on 3 things" as a fixed sentence — say what's actually true for this lesson.

---

## The three possible grounding sources (apply only what's relevant)

### 1. NEP 2020 / NCF-SE 2023 — most commonly relevant

**Panchpadi (పంచపది) — the 5-stage teaching sequence central to NCF-SE 2023.** When a lesson's
structure naturally supports it (most content lessons do), organize teacher_notes around these
five stages, in this order:

| Stage | Sanskrit | Purpose | What it looks like in a generated lesson |
|---|---|---|---|
| 1 | **Aditi** (ఆదితి) | Introduction — link to what the student already knows, build interest | A short opening question, a familiar example, a hook — not the day's actual content yet |
| 2 | **Bodha** (బోధ) | Conceptual understanding — explain the new idea clearly, with visual aids/examples | The core explanation step, using whatever representation fits the subject (e.g. bar models for fractions) |
| 3 | **Abhyasa** (అభ్యాస) | Practice — worksheets, group discussion, guided questions to reinforce | This maps directly to a worksheet's practice-section items |
| 4 | **Prayoga** (ప్రయోగ) | Application — using the idea in a real-life context | A word problem or "use this in daily life" task |
| 5 | **Prasara** (ప్రసార) | Expansion — go deeper, or connect to another topic | A challenge item, or an explicit forward-link to the next lesson/topic |

**Do not force all five stages onto every worksheet.** A short 15-minute warm-up activity may
only need Aditi+Bodha+Abhyasa. A full lesson plan should generally cover all five. Decide based
on the material_type and timing the teacher asked for.

**Other NEP 2020 threads to draw on when genuinely relevant to the specific lesson** (not every
one, every time):
- Experiential/activity-based learning — hands-on tasks over passive reading, especially for
  Foundational Stage (age 3-8, which NEP 2020 specifies should be ~100% play/activity-based)
- Cross-subject integration — connecting the topic to another subject when there's a natural,
  non-forced link (e.g. fractions to music rhythm, not fractions to *any* other subject just to
  claim integration)
- Teacher-as-facilitator framing in the teacher_notes' tone — guide the teacher toward asking
  questions and guiding discovery, not just "explain X to students"
- Outcome-Based Education / Bloom's Taxonomy — favor application/analysis-level tasks over pure
  recall where the content allows it
- Inclusivity / differentiated instruction — note where a task can flex for different student
  levels (ties to Tut-P's own differentiation feature, see design-notes point 8-9)
- Continuous assessment — prefer small embedded checks over one big test framing
- Contextualization — local, India-relevant examples where natural (see design-notes market
  segmentation research on when local vs. globally-familiar examples fit the audience)

**What NEP 2020 explicitly cannot be implemented here:** outdoor/playground-based physical
activities. When a Panchpadi stage (usually Abhyasa or Prayoga) would ideally be a physical
group game, say so honestly in the teacher_notes as a *suggestion* for the teacher to run
separately — do not fabricate an in-worksheet substitute that pretends to be the same thing.

### 2. The teacher's own B.Ed / D.El.Ed pedagogy training

When the Knowledge Graph has a `TeacherTrainingUnit` record relevant to this lesson's grade and
subject (e.g. `in-ncte-deled-pedagogy-math-unit-003` for primary-grade fractions), the generated
teacher_notes should explicitly connect the lesson's teaching approach back to that training —
in the teacher's own words, not academic jargon: e.g. "This step uses the same
demonstration-then-practice approach from your D.El.Ed Paper 5 training." This makes the tool
feel like a *continuation* of what the teacher already learned, not a disconnected new system.

If no matching `TeacherTrainingUnit` is found (KG gap, not every subject/grade is sourced yet),
do not fabricate a connection — simply skip this element, same "no fabrication" rule as content
grounding.

### 3. Global best-practice / modern teaching research — optional, teacher's choice only

Tut-P's job here is limited to **informing the teacher this option exists**, not deciding for
them. When generating a lesson plan, the output may include one line noting that additional
research-backed methods exist for this topic if the teacher wants to explore them (Tut-P can
offer to search on request) — this is never triggered automatically inside a single
worksheet-generation call, since it would need a live web search the teacher explicitly asked
for. Do not claim "based on the latest global research" unless a research step was actually run
in this conversation for this specific lesson.

---

## Question paper cognitive-demand categories — CONFIRMED (2026-09-03): 4 categories

Question papers should be structured across four distinct cognitive-demand categories, not a
flat list of same-difficulty questions:

1. **Logical/Reasoning** — questions testing logical deduction, pattern recognition, sequencing
2. **Understanding** — comprehension of the concept itself, explaining "what" and "why"
3. **Application** — using the concept in a new/word-problem/real-life context
4. **Skill-based (Easy/procedural)** — direct computation/procedure practice, lower cognitive load

This maps naturally onto the Panchpadi stages above (Understanding≈Bodha,
Skill-based≈Abhyasa, Application≈Prayoga), but is a separate structuring decision specifically
for question-paper generation, not a rename of the Panchpadi stages — a question paper is not
itself a full lesson plan and doesn't need an Aditi/Prasara-equivalent section.

---

## Where Panchpadi actually comes from — honest attribution

After searching multiple sources (NCF-SE 2023 secondary literature, academic papers, no access
to trace a single named originator), Panchpadi appears to be a **framework developed
collectively by the NCF-SE 2023 curriculum-writing body** (the National Syllabus and
Teaching-Learning Material Committee, and the broader NCF-SE 2023 steering committee), not
authored or claimed by one named individual with a citable statement. Its five Sanskrit terms
(Aditi, Bodha, Abhyasa, Prayoga, Prasara) draw on long-standing Indian pedagogical vocabulary
rather than being coined fresh for NCF-SE 2023 — this is a committee-produced curriculum
framework, not a single scholar's personal theory, so there is no individual "founder quote" to
attribute here. If a specific named source is later found (e.g. a specific NCF-SE 2023 section
that credits an individual or cites an older text this was drawn from), this section should be
updated — but it should not be fabricated in the meantime.

---

## Honesty rule — same discipline as content grounding

Every generated lesson plan's teacher_notes should state, briefly and only where genuinely
true: which of the three sources above actually informed this specific lesson (e.g. "Structured
using the Panchpadi 5-stage method" / "Connects to your D.El.Ed pedagogy training" / neither, if
neither applied). Never state this as a fixed boilerplate sentence attached to every lesson
regardless of whether it's accurate for that lesson.
