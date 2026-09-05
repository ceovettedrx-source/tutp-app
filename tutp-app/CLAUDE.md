# Working style

- Don't paste large code blocks or long logs/output into chat. Summarize what changed or what a command found instead.
- Small, low-risk decisions (exact class names, styling details, minor wording, which existing pattern to reuse) — use your own judgment and proceed, don't ask.
- Large-scope changes (new pages, rewriting a file's structure/framework, anything touching many files, deploys, deletions) — show a short plan first and wait for confirmation before editing.
- After finishing a task, give a short summary (3-4 lines) of what was done — not a full diff or file dump.

# Backlog

- Discussion Method and Lecture Method are backlogged for the Teacher Module, post-launch — removed from the parent-page search-bar row (which now shows only Storytelling Method, Experiential Learning, Play-Based Learning).
- TODO (founder): test real-device Web Speech API Telugu voice coverage (Android Chrome + iOS Safari at minimum) once Storytelling Method ships — browser TTS support for Telugu is inconsistent and the code falls back to text-only display when no matching voice is found, but that fallback path needs a real-device check.
- Test/Exam mode — a formal, single-child assessment format distinct from Play-Based Learning's multiplayer quiz, for parents who want to conduct a proper exam rather than a quick quiz. Not scoped or designed yet — needs a full spec from the founder before building. The "Online Exam / Test" chip added to `searchAttachChooser` (2026-09-05) is an icon + "Coming soon" placeholder only.
- Unify the two parent-page mode selectors: the top-of-page pill row (`childChipsRow` area — currently 3 chips: Storytelling, Experiential Learning, Play-Based Learning) and the separate `searchAttachChooser` popup (reached via the search-bar "+" attach icon — now 6 chips: Homework Help, Storytelling, Play-Based, Experiential, Quiz, Online Exam placeholder) show different sets of options for the same underlying capabilities. Not scoped yet — needs its own plan (which surface wins, whether the popup step gets removed) before building.
- Play-Based Learning refinements — timer correction, random question order, Player of the Day badge — logged by the founder 2026-09-05, explicitly deferred to the next session after tonight's chip additions. Not started.

# Deploying

- `deploy.sh`'s own success output is not proof the deploy is live: `tutp-demo`'s traffic is pinned to a named revision (not tracking "latest"), so `gcloud run deploy` can build and report success on a new revision while 100% traffic (and the `pdftest` tag) stay on the old one. Every `deploy.sh` run must be followed by checking which revision is actually receiving traffic:

  ```
  gcloud run services describe tutp-demo --region=us-central1 --format="value(status.traffic)"
  ```

  If the revision name shown isn't the one just built, move traffic (and the `pdftest` tag, to keep them unified) to it:

  ```
  gcloud run services update-traffic tutp-demo --region=us-central1 --to-revisions=<new-revision>=100 --set-tags=pdftest=<new-revision>
  ```
