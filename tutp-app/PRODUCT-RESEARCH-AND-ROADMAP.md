Create a file called PRODUCT-RESEARCH-AND-ROADMAP.md at the repo root with exactly this content:

# Tut-P Product Research & Roadmap — Extracted from Prior Discussion

This document exists because detailed research and design work discussed in 
past conversations was not making it into implementation — Claude was building 
simplified ad-hoc versions under launch time pressure instead of the researched 
designs. This file extracts everything substantive that was discussed, marked 
honestly as BUILT / PARTIALLY BUILT / NOT BUILT, so nothing gets silently lost 
again.

Last updated: 2026-09-05 (Saturday)

---

## 1. Parent Engagement Score — researched design vs. what's built

### Researched design (from deep-research discussion, not yet built)

**Epstein's Six Types of Involvement** (Johns Hopkins framework) — the 
intended structural basis for engagement measurement:
1. Parenting — home environment for learning
2. Communicating — school-home message responsiveness
3. Learning at Home — direct homework help
4. Volunteering — school activity participation
5. Decision Making — involvement in child's education decisions
6. Collaborating with Community — external resource use

**Parent Engagement Intensity (PEI) formula** — a 4-factor composite, not just 
a frequency count:
- Frequency — how often
- Effort — how much work the action took
- Convenience — how easy it was (weighted so low-convenience-but-done-anyway 
  scores higher)
- Invasiveness — how much it intruded on personal time

**Tut-P PIS (Parent Involvement Score) composite formula** as researched:
```
PIS = 0.35 × Consistency Score
    + 0.30 × Quality-of-Support Score
    + 0.20 × Communication Score
    + 0.15 × Emotional-Tone Score
```
- Consistency: days/week checked in, streak length
- Quality-of-Support: supportive vs. intrusive involvement (research finding: 
  autonomy-supportive help correlates with better outcomes; controlling/
  intrusive help correlates with worse outcomes — this distinction was meant 
  to be core to the score, not just presence/absence of involvement)
- Communication: teacher-message responsiveness, meeting attendance
- Emotional-Tone: optional 1-tap mood check-in after homework sessions (😊😐😣) 
  to catch negative-pattern intensity early

**Creative presentation ideas researched**: "Involvement Weather" (☀️/⛅/🌧️ icons 
instead of raw numbers, to avoid feeling judgmental), "Family Streak Garden" 
(gamified visual), Balanced Nudge Engine (nudges in BOTH directions — too little 
AND too intrusive involvement, not just "do more").

### What's actually built (BUILT)

`bonding_scores` table + `/api/bonding-score` — but the score currently 
computed is **only 14-day homework completion rate** (child's homework marked 
done ÷ homework assigned). This is:
- NOT the 4-factor PIS composite formula (no Effort/Convenience/Invasiveness 
  weighting)
- NOT distinguishing supportive vs. intrusive involvement
- NOT using Epstein's six types at all
- NOT including a communication or emotional-tone component
- Arguably measuring child completion, not parent involvement directly

**Gap assessment**: this was a deliberate, explicit scope-down made under 
production-incident + launch-deadline pressure (documented at the time as "V1 
ships fast using only data that already exists, V2 needs new session/login 
tracking"). The tradeoff was reasonable given the circumstances, but it means 
the actual differentiator the founder researched — a scientifically-grounded, 
multi-factor parent involvement measure — does not exist yet. What's live is 
a homework-completion tracker with a "Bonding Score" label on it.

**NOT BUILT, needs real design + build time**: the full PIS formula, 
supportive-vs-intrusive distinction, session/login tracking infrastructure, 
communication component, emotional-tone check-in, Involvement Weather/Streak 
Garden presentation.

---

## 2. Child progress tracking — researched design vs. what's built

### Researched design (NOT BUILT AT ALL)

- **Bayesian Knowledge Tracing (BKT)** for per-topic mastery — a "living 
  mastery score" per subject/topic that updates with each new performance data 
  point (Bayes' theorem, accounting for guess/slip probability), the same 
  approach Khan Academy/iReady use.
- **Baseline diagnostic** at signup + rolling 30-day growth score — track 
  actual improvement over time, not just point-in-time scores.
- **Completion vs. Progress vs. Mastery** — explicitly distinct metrics (a 
  concept from the research: 80% homework completion ≠ 80% concept mastery).
- **Growth-Involvement Correlation Card** — showing the parent how their PIS 
  correlates with their child's actual growth rate, as the single most 
  motivating data visualization researched ("your effort × your child's 
  progress").
- **Mastery Radar Map** — spider/radar chart per subject, before/after overlay.
- Creative presentation ideas: Growth Tree, Rocket Launch dashboard, Hero 
  Journey Map, Heatmap Calendar (GitHub-contribution-style), Before/After Card 
  view.

### What's built: NONE of this exists. No mastery tracking, no baseline 
diagnostic, no growth score, no correlation card, no radar map. This entire 
research area is 100% unbuilt.

---

## 3. Competitive positioning research — status

Researched and documented (in this conversation, not necessarily in code):
- No competitor combines parent-engagement scoring with mastery-based growth 
  tracking — this remains the identified differentiation opportunity.
- SparkSchool AI's "Mentora" (launched ~Sept 5, 2026) is the closest emerging 
  competitor — student-facing, not parent-engagement-scored.
- This positioning claim ("world's first parent-engagement-scored EdTech") is 
  currently NOT fully backed by what's live — the live PIS is a homework-
  completion tracker, not the researched multi-factor model. Marketing/pitch 
  claims should be calibrated to what's actually shipped, not the full 
  research vision, until the gap above is closed.

---

## 4. Honest priority assessment for Monday and after

Given how close Monday's launch is, a full rebuild of PES to the real PIS 
formula, plus BKT mastery tracking, is not realistic before launch — this is 
weeks of work, not a Saturday task. Two honest options:

**Option A**: Launch Monday with what exists (homework-completion-based 
"Bonding Score"), clearly treat the full PIS/mastery research as a post-launch 
V2 roadmap — but don't market it as the full researched model until it's real.

**Option B**: Identify ONE high-value piece of the research that's genuinely 
buildable before Monday (e.g., adding just the supportive-vs-intrusive 
distinction, or just a simple communication-responsiveness component) to move 
the current V1 meaningfully closer to the real design, without attempting the 
full BKT/mastery system.

This document does not make that call — it exists so the founder can make an 
informed decision with the full picture in front of them, instead of the 
research silently not surfacing again.