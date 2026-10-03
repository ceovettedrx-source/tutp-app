# Storytelling Method redesign — spec (approved by the founder in the task message, 2026-10-03)

Branch `storytelling-redesign` from `origin/main` (1dea79e), worktree `C:\Users\user\wt-storytelling`. Round 4 checkout and the notes-quality-v2 work are untouched.

## Research: 3 patterns adopted
Sources: Khan Academy Kids (recurring original characters in stories and lessons, child-development specialists, social-emotional framing), Prodigy Math (each maths problem moves the story on), Duolingo ABC (700+ bite-sized lessons, small steps, levelled). Epic's read-to-me idea is general knowledge, not checked in this round.
1. **A character carries the whole lesson** (Khan Academy Kids): one named child in a home or festival setting, from hook to wrap-up.
2. **The maths is the plot's conflict** (Prodigy): the problem scene is a real problem for the character; the maths moment resolves it.
3. **Bite-sized, numbered steps** (Duolingo ABC): 4 short scenes, a read time, one try-together question at the end. A parent can stop after any scene.

## Server
- `storytellingPrompt` (server/prompts/homework-prompts.js) returns strict JSON:
  `{title, gradeSubjectTag, readMinutes, scenes:[{label:"hook"|"problem"|"mathMoment"|"wrapUp", text}], visual:{type:"groups", itemNoun, total, groups}|null, equations:[string], tryTogether:{question, answer}, parentPrompt}`.
  Rules: real arc (character, local festival or home context, conflict, resolution); `tryTogether` talks to the CHILD ("you"), not the character; every number computed and self-checked; keep the lesson's own words, names and numbers exactly as in the source (no translation of quoted source text); keep Panchpadi grounding (Bodha + Prayoga).
- `server/story-schema.js` `validateStory(data)`: shape, label order, caps (title 120, scene 600 chars, 4 to 6 scenes, 6 equations, visual total <= 60), then **checks in code**: `visual.total` equals the sum of `groups` (else the visual is dropped), each equation of plain arithmetic is recomputed with `solveArithmetic` (a wrong result is corrected, counted in `x-story-fixed`), `tryTogether.answer` is recomputed when the question is plain arithmetic.
- `/api/homework` for `storytelling`: parse failure -> existing one retry; schema failure -> one more model call with a correction line; still bad -> graceful fallback: the readable strings become scenes (`fallback: true`), and nothing readable gives the existing 502 message. Cost impact reported per call.
- Old shape `{subject, story, abhyasa...}` is no longer returned; the page also renders it if a cached or old reply arrives.

## Frontend
- One shared module `public/app/shared/story-modal.js` (+ `public/css/story-modal.css`) owns the modal markup and logic for all four dashboards (mother, father, family-member, child; their story blocks were byte-identical). Each page keeps only `<link>` and `<script>` tags; the inline markup and JS are removed. `openStorytellingModal`, `closeStoryModal`, `playStory`, `stopStory` and `storyModalAttachInput` stay global for the existing callers (search chooser, chips).
- Result: numbered scenes, equation chips, a visual drawn in code from `visual.groups` (cap 60 items), "Show answer" reveal, amber "Ask your child" card, brand blue #005bbf, no beige or green blocks.
- Fonts: per-language Noto Sans family (Telugu, Devanagari, Tamil, Kannada, Malayalam, Bengali, Gujarati, Gurmukhi, Odia, Arabic) loaded from Google Fonts with `display=swap` only when the language needs it; 17 px body, line-height 1.9 for Indic scripts.
- The "not a verified curriculum record" line goes; a small "Built on NCF-SE 2023 Panchpadi" footnote replaces it. The "No <language> voice" error becomes a "Read aloud together" coach hint; the play button is hidden when no voice exists.
- Print: Save as PDF / Print keeps working; the answer is printed at the bottom whether or not it was revealed.
- 360 px, keyboard focus, aria labels. `usage_events` logging unchanged (the same `callHomeworkApi` path and `trackSessionStarted/Completed`).

## Tests
Unit: `tests/unit/story-schema.test.js`. E2E: new `tests/e2e/story.spec.js` (modal on all four pages, scenes, chips, visual cap, reveal, print, 360 px, no-voice hint, Telugu font and line-height) and the storytelling check in `homework.spec.js` k5 updated to the new shape. Fresh live recordings (en, te, hi) for the story call. e2e twice on a no-traffic preview before commit.

## Added in the same round (founder, 2026-10-03)
- Script-aware font stack: already in `story-modal.css` / `story-modal.js` (one Google Fonts link per chosen language, display=swap, 17 px, line height 1.9 for Indic scripts); e2e s3 now asserts the computed `font-family` STARTS with Noto Sans Telugu.
- Feedback: `showFeedbackPrompt('storytelling', <scene texts joined by a space>)`; e2e s12 clicks through the prompt and checks the `/api/feedback` body (feature storytelling, the joined text) and a 200. The row itself is `usage_events` `feedback.submitted` (there is no `feedback_events` table).
- 360 px: `.dc-stat-row__value` no longer refuses to shrink (the "Not enough data yet" label pushed the dashboards to 370 px); e2e s6 and s6b assert `scrollWidth <= 360` on mother, father and family-member.
- `session.completed` for storytelling carries `language`, `story_retry` (0 or 1), `story_format` (ok or fallback) and `story_fixed`, so the retry rate per language can be shown on the founder dashboard (the dashboard itself is not part of this round).

## Files
New: `server/story-schema.js`, `public/app/shared/story-modal.js`, `public/css/story-modal.css`, `tests/unit/story-schema.test.js`, `tests/e2e/story.spec.js`. Edited: `server/prompts/homework-prompts.js`, `server.js`, the four `public/app/*/index.html`, `tests/e2e/homework.spec.js`, `tests/e2e/run.js`.
