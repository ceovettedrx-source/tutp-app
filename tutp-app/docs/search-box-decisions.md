# Search box v2: decisions made without asking (2026-10-01)

1. **Migration number 030.** 027 is the last on main, 028 is round 4 (uncommitted), 029 is reserved by the deferred adaptive spec. Rechecked across all branches and worktrees at write time.
2. **Notes before a first result = homework call, then notes call.** The question text has to be extracted first, and "never submit before a result" plus "notes = one call on already-extracted text" leaves no single-call option. Two calls, only when notes is selected up front.
3. **Intent classification is server-side and rules-only.** One source of truth (`server/chips/intent.js`), returned as `X-Chip-Intent` so the client applies the override without a duplicate rules file. Model fallback and caching belong to the deferred engine task.
4. **Phrase stored only when the typed text is <= 6 words after scrubbing and classified `other`.** Longer unclassified text is almost always the homework itself, so it gets intent `other` with no phrase.
5. **Notes do not count as a new free-limit session** and do not fire `session.completed`; they are the same session's extra view. They are rate limited, require the student's own session, and use the cheapest model.
6. **Board** comes from `family_registrations.data.children[].curriculum` (the child matching the student's name, else the first), normalized to state_board / cbse / icse / cambridge / other / unknown. The students table has no board column.
7. **Class band**: 1-2, 3-5, 6-8, 9-10, 11-12, else unknown (parsed from the students.class text).
8. **Family hash** = HMAC-SHA256 of the family id; key = env `CHIP_HASH_SALT` (>= 16 characters), a Secret Manager secret attached with `secretKeyRef`. **No fallback key** (changed on founder review 2026-10-01): without it, chip logging switches itself off, with one warning that names the variable and never a value. Manual step: create the secret and attach it (see the final message). Chips, notes and everything else work without it.
13. **Notes caps**: per family 20 per 10 minutes and 30 per day (in memory, per instance, like the other limiters); a repeat of the same child + language + question text is answered from a 24-hour server cache (300 entries) with no model call and no cap use; the page also keeps notes per language per result.
14. **Chip text follows the auth pattern**: the pages have no general UI i18n; the only mechanism is a plain-script `{en, te, hi}` table with English fallback per key and a language pick of `tutp_ui_lang`, then browser language, then en (`auth-messages.js`). The chip label, "Making notes…", the notes error and "Try again" are in `window.TUTP_CHIP_MESSAGES` the same way (te/hi drafts), not in server config.
15. **Preview tag**: first deploy used `--tag=vtutor` by mistake, which moved that tag off the visual-tutor preview (00291-zeq) to 00321-gup. Traffic did not move. A new tag `sb2` is used from now on; Vet restores `vtutor`.
9. **30-day prune is opportunistic** (hourly throttle per instance, on any insert), so no new Cloud Scheduler job is needed.
10. **Chips only in Homework Help mode**; the modal's Quiz mode has no chips.
11. **Chip row moves** (one DOM node) from the form to the top of the results when a result appears, so it is always "under the input" before a result and always reachable after.
12. **Test families are not logged**, same rule as the admin metrics.
