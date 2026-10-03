# Changes explained

## 2026-10-03 - storytelling visuals v2 release

**What changed**
- Every maths story now gets a picture drawn in code (groups with item icons, number line, bar model, fact family). The picture sits under scene 3 and prints with the story.
- Numbers written in the scenes are recomputed in code and a wrong one triggers the one retry; "try together" stays a new problem.
- x, X or * between two numbers is shown as the real times sign. Fixed today: a digit next to a blank ("4 x __", "6x_") is now left alone; the earlier version changed it too. Telugu and Devanagari digits count as numbers.

**What is live**
- Live now: storytelling quality and the first times-sign fix (revision 00368-zur, main be0cc4f).
- Built and tested, not live: this release (revision 00373-buy, tag sqrel, no E2E_REPLAY; env identical to live; story spec passes in replay). It goes live when the founder runs `scripts/release-sq.ps1`.

**What is next**
- After the switch: main is fast-forwarded by the script. Non-urgent ideas are in docs/BACKLOG.md.
