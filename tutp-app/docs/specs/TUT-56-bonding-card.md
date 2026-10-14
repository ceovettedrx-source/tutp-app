# TUT-56: a calm Bonding card, the detail in the full report

Status: built 2026-10-13 (founder: "build without waiting"). Branch `tut-56-bonding-card` from main a0f6b24.

## What the code shows today

- The card (`#bondingReportSection`) is copied by hand into `mother`, `father` and `family-member`; each page has its own copy of the score loader. Title, a "Parent Engagement Score" subtitle, score, a gap line, the answer chips (`#pibStrip`, drawn by `public/js/baseline-survey.js` under the score row), then "View Full Report".
- The chips are the baseline-survey answers: homework days/week, meals ("Most days"), activity icons, trip days/year.
- "View Full Report" opens the homework-completion modal (14 days). Nothing explains an N/A score.
- N/A today means no `bonding_scores` row (the daily cron skips a family with no teacher-posted homework in 14 days). The score is that 14-day completion rate.

## What

1. One shared component `public/js/bonding-card.js` (+ `public/css/bonding-card.css`) renders the card and the full report on all three dashboards. The three pages lose their own card markup copy and score loader; each keeps only the empty `#bondingReportSection` shell (and `data-feature="bonding_report"` on family-member) and loads the script.
2. Card, nothing else: icon + title; the score (`72%`) or the empty state (`N/A`); one line; "View Full Report ->". The subtitle and the chips are gone from the card. Ids `bondingScoreValue` and `bondingGapText` stay (bonding.spec.js uses them).
   - Scored line: the existing "top bonder" / "N points away" line.
   - Empty line (te/en/hi): "Sit with your child for 3 homework sessions this week to see your score." No result claim.
   - Error lines unchanged (sign-in mismatch with link, "did not load").
3. Full report (a dialog built by the component): the score or, when N/A, why and how many more sessions are needed (this week's count from `GET /api/weekly-sessions/:familyId`, target 3); the 14-day homework completion (same data and wording as the old modal, from `GET /api/homework-completion/:familyId`); and the chips ("Your family's starting point"), drawn by baseline-survey.js into the report. Chips show only after the survey is answered, as before.
4. Language: te / en / hi, picked as the chip row does (`tutp_ui_lang`, then browser languages, then English). The chip wording itself (survey answers) stays English for now.
5. No server change, no migration, no AI call.

## Open point for the founder

The brief's copy says the score needs "3 homework sessions this week". The score engine does not work that way: it is the 14-day homework completion rate and is absent when no homework was posted for the child's class. The report counts this week's `session.completed` events (all kinds, the same count as the weekly-goal ring) against a target of 3, and says the score is worked out once a day when the 3 are already done. If the 3-session rule should really gate the score, that is a server change (new spec).

## Files touched

`public/js/bonding-card.js` (new), `public/css/bonding-card.css` (new), `public/js/baseline-survey.js` (strip draws into the report), `public/app/{mother,father,family-member}/index.html`, `tests/e2e/bonding.spec.js` (new tests, header), `docs/CHANGES-EXPLAINED.md`.

## What can go wrong -> test

| What can go wrong | Test (bonding.spec.js) |
|---|---|
| Chips still on the card | h: on all three dashboards with the survey answered, no `.pib-strip` / `#pibStrip` inside `#bondingReportSection`, and the card holds only icon, title, score, one line, one link |
| Chips lost entirely | h: after "View Full Report", the report contains `#pibStrip` with its items (homework days, meal, trip) |
| Card has more than the four parts | h: card text is the title, score, line and link only (no "Parent Engagement Score") |
| Empty state wrong or claims a result | i: forced `hasData:false` -> "N/A" + the exact empty line in en, te, hi; no "%" in the card |
| Report gives no reason for N/A | j: forced `hasData:false` and a forced sessions count of 1 -> report says why and "2 more sessions needed"; count 3 -> the once-a-day line, no "0 more" |
| Sessions count fails and the report breaks | j: forced 500 on weekly-sessions -> report still opens, with the reload line |
| Card overflows on a phone | k: 390 px wide on all three dashboards: card inside the viewport, no horizontal scroll on the page, report dialog inside the viewport and scrollable |
| Old behaviour regresses (icon, score, stale tab, error copies, dark scheme) | bonding.spec.js a-e stay green (the card keeps the same ids and the same chip/icon markup) |
| Report opens twice / stacks dialogs | i: open, close, open -> one dialog in the DOM; Escape and the backdrop close it |
| The script fails to load and the page breaks | the card shell shows "Loading…" only; the rest of the dashboard is separate code; covered by running the whole suite in CI |
| Member whose bonding visibility is off sees the card | unchanged: `data-feature="bonding_report"` stays on the shell; family.spec.js covers the rule |
| Chips shown before the survey is answered | unchanged (baseline-survey.js draws only when the GET says `exists`); the report hides the "starting point" heading until then |
