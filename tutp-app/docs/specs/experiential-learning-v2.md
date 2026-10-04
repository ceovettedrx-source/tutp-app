# Experiential Learning v2 (Guided Discovery pilot) + shared video service

Branch `experiential-learning-v2`, worktree `C:\Users\user\wt-el-v2`. Founder approved by overnight brief (2026-10-05); this spec was written after reading CLAUDE.md, FEATURE-SPECS.md (section 2), server/references/pedagogy-nep-ncf.md and the knowledge-graph records.

## Market check (idea framing)
- Predict-observe-explain and "productive failure" lessons beat tell-first lessons for science misconceptions (long-standing physics-education research: POE, PhET studies at Colorado).
- Byju's/Vedantu/Khan Kids show passive video plus quizzes; none ask the child to commit to a prediction, run a kitchen experiment with the parent as a coach, or revisit on a spaced schedule. PhET sims are free (CC-BY 4.0) and used by many schools.
- Parents of Class 6-10 children cannot teach science but can run a 10-minute kitchen experiment when given a script. That is the gap.

## Findings that shape the build
1. **Video root cause.** The line "Video matching for this lesson isn't available yet — these are text-only notes." is a hardcoded `<p>` in the four dashboard pages (`public/app/{mother,father,family-member,child}/index.html`, the results block of `#experientialModalResults`). No video search exists anywhere in the code (FEATURE-SPECS.md says "step 2 deferred"). It is not an empty list, a swallowed key or a wrong query field.
2. **No YouTube key.** `gcloud secrets list` has no YouTube Data API key, and `youtube.googleapis.com` is not enabled on the project. Creating a credential and enabling an API in production is outside tonight's guardrails, so the video service reads `YOUTUBE_API_KEY` from the environment (a Cloud Run `secretKeyRef`), logs `video.no_key` when it is missing, and hides the section. Founder to-do: enable the API, create a restricted key, store it as secret `youtube-api-key`, attach it with `--update-secrets=YOUTUBE_API_KEY=youtube-api-key:latest`. No code change needed afterwards.
3. **No CSP anywhere** (`grep` finds no frame-src / Content-Security-Policy / X-Frame), so iframes need no CSP change.
4. KG data today is Maths fractions only. Science LearningOutcomes do not exist; they are created.

## Part 1 - Guided Discovery
**KG** (`server/knowledge-graph-data/data/...`, no DB): per concept one `LearningOutcome` (subject science, own paraphrase), one `Misconception` for the predict question, `StateMapping` for `cbse-ncert` and `telangana` (grade, chapter number/title, source URL on ncert.nic.in or scert.telangana.gov.in). A mapping that cannot be confirmed from the official site is `verification_status: placeholder` with null chapter fields. The loader in `server/services/knowledgeGraph.js` already flattens every `records` array; `getLearningComponent` only matches `LearningComponent` targets so Maths is untouched.

**Content** (`server/el/content/<id>.json`, generated once by `scripts/el/generate.mjs`, committed): predict question (3 options, one from the KG misconception), experiment (household items, steps, adult-does-hot-water marker), parent role card, notice question, 3-level hint ladder (direction, comparison, near-answer), reveal + term, teach-back prompt, 2 revisit questions, PhET slug. English source. Other languages: one translation call per concept+language (sonnet-5 for non-English, as storytelling), cached in memory, same "auto-detect-and-preserve" language rule as the existing prompts.

**Safety gate** (`scripts/el/safety.mjs`, blocking): deterministic pass (forbidden words: flame, fire, match, candle, gas, stove, mains, socket, plug, knife, blade, scissors, boil unless in an "adult does this step" sentence; items must be on the whitelist: vinegar, lemon, baking soda, salt, turmeric, soap, water, ice plus the generic household list in the safety report) then a second Claude pass against whitelist + KG facts. Fail: the home experiment is dropped, the concept stays sim-only. Concept failing mapping verification entirely (no sim, no experiment) is excluded. Report: `docs/specs/el-v2-safety-report.md`.

**PhET**: iframe only, `https://phet.colorado.edu/sims/html/<slug>/latest/<slug>_all.html`; each URL checked for HTTP 200 and `text/html`. Attribution under every sim.

**UI** (`public/app/shared/el-guided.js`, loaded by the four pages like `story-modal.js`): in the existing Experiential Learning modal, a "Guided discovery" chip row (12 concepts) plus typed-topic matching (aliases, no model call). Steps: Predict (guess locks) -> Do/Play -> Notice -> Hint ladder (reveal after correct or 3 hints) -> Name it -> Videos -> Teach-back (typed or `SpeechRecognition` where present; reply = one follow-up question, haiku, max_tokens 300). Print/Save as PDF kept. A topic with no pilot match falls through to the current notes flow unchanged.

**Tracking**: existing `usage_events` only: `predict_correct`, `hints_used`, `teach_back_done`, `sim_opened` (`POST /api/el/event`, own-student check, whitelisted names). `GET /api/el/revisits` computes revisit questions due at day 3/10/30 from the `teach_back_done` timestamps; a dashboard card shows them.

## Part 2 - Shared video service (`server/video/`)
`findVideos({concept, grade, subject, lang})` -> up to 2 in the user's language + 2 English + 1 best-in-world, tutp_hosted first (none exist yet, field and ordering only). YouTube Data API v3 `search.list` with `safeSearch=strict`, `videoEmbeddable=true`, `type=video`, `q = concept + grade + subject`; `videos.list` for duration/description. Second pass (haiku-4-5) rejects off-topic or not child-appropriate. Cache per concept+language (10 min on API error, 24 h otherwise). Fallback: exact concept -> broader topic -> section hidden; no "not available" text anywhere. API/quota errors are logged with status and reason, never swallowed, and are never cached long.
**Segments**: description chapter timestamps for the concept; else Gemini video analysis (key read at runtime from Secret Manager `gemini-api-key` via the metadata-server token; absent or denied = no segment). Valid when `start < end <= duration` and 1-8 min. Up to 3 key-moment chips (seek only).
**Player**: per video "Key part" (default) and "Watch full video"; no segment = full video. `youtube-nocookie.com` embed, no autoplay, player >= 200x200, nothing overlaid, no ad blocking, YouTube title link visible, never labelled ad-free.
**Ad-free library**: spec only, `docs/specs/ad-free-video-library.md`.

## Files touched
New: `server/el/` (concepts, content, match, routes), `server/video/` (service, youtube, segments, safety), `scripts/el/`, `public/app/shared/el-guided.js`, `public/css/el-guided.css`, `tests/unit/{el,video}*.test.js`, `tests/e2e/el.spec.js`, KG json files, specs. Edited: `server.js` (mount routes only), `server/models.js` (+3 keys), `tracking/events.js`, the four dashboard pages (script tags, revisit card, remove hardcoded video line), `tests/e2e/run.js` (add spec), `docs/CHANGES-EXPLAINED.md`.
Not touched: auth, payments, Razorpay, migrations, secrets.

## Edge cases
No session / other family's student -> 401/403. Unknown concept -> 404. Browser without speech -> typed only. Language other than English and translation fails -> English content with a note. Sensor/phone parts are Part 3. YouTube quota 403 -> section hidden, logged. Video removed on YouTube -> hidden by the embeddable filter on the next cache expiry.

## Test list (`tests/e2e/el.spec.js`, replay, run twice)
e1 pages carry no hardcoded "isn't available" line; e2 12 concepts x 2 boards return mapped content (placeholder stays flagged); e3 predict locks the guess; e4 hint ladder reveals only after correct or 3 hints; e5 sim iframe + attribution; e6 teach-back returns one question; e7 events land in usage_events; e8 revisit due calculation (unit); e9 videos: >= 3 embeddable per concept (fixture-backed on preview); e10 >= 1 validated segment per concept; e11 "Watch full video" starts at 0; e12 missing segment falls back to full; e13 quota error renders no "not available"; e14 non-pilot topic runs the old notes flow; e15 360 px layout. Unit tests for matching, safety rules, segment validation, revisit schedule.
**Honest limit:** with no YouTube key, the preview's video tests run on hand-written YouTube fixtures (test families only, `E2E_REPLAY=1`), as the image-library tests did. Live YouTube behaviour is unverified until the key exists.
