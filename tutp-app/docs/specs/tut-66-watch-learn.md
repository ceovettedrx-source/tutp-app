# TUT-66 Watch & Learn (YouTube videos under lesson results)

Branch `tut-66-watch-learn` (from main). No extra AI call. Free: 1 video. Pro and above: 5.

## What it does
Under the results of Homework Help (Answer, Explain, Notes) and Storytelling, when a lesson title is known, a card "Watch & Learn" shows up to 5 YouTube videos: 2 in the family's language, 2 in English, 1 most viewed of the rest. Tap loads a youtube-nocookie embed (no iframe before the tap). Each video has "Not right for this lesson".

## Files
- `server/youtube/pick.js` (new, pure): drop > 30 min and Shorts (< 60 s), parse ISO-8601 duration, pick 2+2+1, never the same video twice, never a reported video.
- `server/youtube/watch-learn.js` (new): `createWatchLearn({ supabase, fetchFn, env, now })` -> `get({ board, cls, subject, lessonTitle, lang, tier })`. Cache by key, 2 search.list + 1 videos.list at most, quota guard, report.
- `server/routes/watch-learn.js` (new): `GET /api/watch-learn` (session + own student), `POST /api/watch-learn/report`.
- `server.js`: register routes; `lessonTitle` from the existing output (see below); admin feedback list also reads `video.reported`.
- `public/app/shared/watch-learn.js` (new): card, lazy embed, locked blur, report link; mounted by `answer-cards.js`, `explain-panel.js`, `notes-card.js`, `story-modal.js` (one call each).
- `supabase/migrations/036_watch_learn.sql` (new, run by hand in the Supabase SQL editor): tables `watch_learn_cache`, `watch_learn_reports`.
- `tests/unit/watch-learn.test.js`, `tests/e2e/watch-learn.spec.js` (+ inventory entries).

## Data
- `watch_learn_cache(cache_key text primary key, board, cls, subject, lesson_norm, lang, videos jsonb, created_at)`: the 5-video candidate list, already picked and ordered, stored once per (board, class, subject, lesson, lang). Free shows `videos[0]`, Pro all 5 (the server sends the first 1 plus locked placeholders, never the 4 hidden ids to a Free client).
- `watch_learn_reports(id, cache_key, video_id, student_id, family_id, created_at)`: a report hides that video for that lesson for everyone. Unique (cache_key, video_id).
- Report is also written to `usage_events` as `feedback.video_reported` (there is no `feedback_events` table in this codebase; feedback lives in `usage_events` with `feedback.*` names) and listed in the admin "Parent Feedback" section.

## Query source (no extra call)
Use the lesson/topic the model output already carries: Explain `title`, Story `concept_key`/`title`, Notes `title`; for Answer the question's `topic`. If none exists, the card is not shown. A `lessonTitle` field is added to the prompt output only if one of these surfaces has nothing usable (decided while reading each surface; prompt change means the live-run warning of TUT-47 applies).

## Quota and cost
search.list costs 100 units, videos.list 1. Default quota 10,000/day = about 49 fresh lessons a day (2 searches each). Cache hit = zero calls. On any error or 403 `quotaExceeded` the card is hidden for that request and a 10-minute in-memory "cooldown" stops further calls. YouTube Data API is free within quota: no money spend. Tests mock the API (zero spend).

## Infra steps (need Google Cloud changes, run by Claude with output hidden)
1. Enable `youtube.googleapis.com` on project-66860e46-da22-4178-a59.
   (Already enabled on the project when checked.)
2. API key restricted to YouTube Data API v3 only, stored straight into Secret Manager `youtube-api-key` (never printed), bound with `secretKeyRef` as `WATCH_LEARN_YOUTUBE_KEY`, NOT `YOUTUBE_API_KEY`: the Experiential Learning video service (`server/video/`, `/api/el/videos`, `/api/videos`) reads `YOUTUBE_API_KEY`, which production does not set today, so those videos are off. Binding that name would switch them on for real users as a side effect. The two share the project's quota (10,000 units/day).
3. Migration 036 run by Vet in the Supabase SQL editor (file name given in the release summary).

## What can go wrong (and the test that catches it)
| Risk | How it breaks | Test |
|---|---|---|
| Cache key too coarse | Two lessons ("Fractions" Class 5 vs Class 6) share videos | unit: key differs by board, class, subject, lang; normalised title (case, spaces, punctuation) equal |
| Cache key too fine | Same lesson spelt "Fractions." / "fractions" misses the cache and burns quota | unit: normalisation cases; e2e: second request makes zero API calls |
| Same lesson, different language | Telugu family sees English-only list or vice versa | unit: lang in key; two langs = two cache rows |
| Quota exhausted / API error / bad JSON | Results page breaks or shows an empty box | e2e: mock 403 quotaExceeded -> card absent, results intact, no second call within the cooldown |
| Shorts, long lectures, non-embeddable, live | Wrong videos | unit: 59 s and 61 s, 30:00 and 30:01, missing duration, live (`P0D`) dropped |
| Same video in both language lists | Duplicate in the 2+2+1 | unit: de-dupe by id before picking |
| Fewer than 5 candidates | Card shows holes or errors | unit: 0, 1, 3 candidates |
| Free client can read all 5 | Paywall bypass through the API response | e2e: Free response holds 1 video id + 4 locked counts, no ids |
| Tier from client | Child claims Pro | server reads tier from payments only (`getPaidStatusForStudents`), never from the request |
| Report abused | One parent hides every video | report needs a session of that family, one per (family, video), rate limit; hidden video can be restored by deleting the row (admin lists them) |
| Report hides the wrong lesson | Video hidden everywhere | unit: report is per cache_key; same video under another lesson stays |
| Unsafe content | Not child safe | `safeSearch=strict`, `videoEmbeddable=true`, report link, nocookie embed; limit stated in release summary |
| API key leaks | In logs or a client response | key only in a request header-less server call; never logged; test greps responses and log lines for the secret value |
| Lazy embed loads early | Tracking cookie / data before consent | e2e: no `iframe` and no request to youtube before the tap |
| 360 px layout | Cards overflow | e2e: viewport 360, no horizontal scroll, buttons reachable |
| Existing tests | Inventory, a new surface element | inventory entry for the card on each surface in every language |
| TUT-73 merge | Both touch `server.js` and result panels | build on main; rebase onto the TUT-73 merge after it is released |

## Release (per CLAUDE.md)
Build -> unit -> preview `tut66` (no traffic, E2E_REPLAY=1) -> CI e2e twice -> flag parity -> redeploy same digest without replay, own tag `release66` -> traffic -> verify -> mobile smoke. Traffic: the classifier blocks `update-traffic` in auto mode, so Vet runs the printed command. One session deploys at a time: TUT-73 (run 39815353980) must be cleared first.
