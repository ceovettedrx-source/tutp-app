# Changes explained

Newest entry first, max 20 entries (older ones move to docs/changes-archive.md). Each entry: max 15 lines.

## 2026-10-03 — stop hook: change summary after every task
- Files: .claude/hooks/require-summary.js, .claude/settings.json, docs/CHANGES-EXPLAINED.md, CLAUDE.md
- What: a Stop hook blocks the end of a task until this file has an entry for the current change set. The change set is fingerprinted (HEAD sha + hash of the diff, plus untracked files, summary files excluded) and stored in docs/.last-summary. The hook also keeps only the newest 20 entries here and moves older ones to docs/changes-archive.md.
- Test: make a trivial change, end a turn: the hook blocks. Add an entry, write the fingerprint to docs/.last-summary: it passes.
- Risks: a task that only touches the summary files is never blocked. Entries must start with "## " so the 20-entry cut works.
