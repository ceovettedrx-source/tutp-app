# Notes design v2: decisions made without asking (2026-10-01)

1. **Fallback shape.** If the model's JSON parses but has no usable structure, the server returns `{ plain: [strings], subject }` (every string value of the JSON, or the old `notes` array) with header `X-Notes-Format: plain` and a `console.warn('notes: plain fallback')`. The page renders that with the old renderer. If nothing readable exists the reply is the same 502 as before.
2. **Heading language.** The card's section headings follow the language the notes are written in when it is English, Telugu or Hindi (so one card is not half English, half Telugu); for other output languages they follow the page's UI language (`tutp_ui_lang`, then browser, then en), same as the chips. te/hi headings are drafts. This is the same `{en, te, hi}` table pattern with English fallback.
3. **Minimum for "structured".** At least a key idea or a method. Everything else is optional and omitted when empty.
4. **Limits (characters).** title 80, key_idea 240, method 5 steps x 170, example problem 220, steps 5 x 170, answer 90, 4 terms (term 40, meaning 150), 3 mistakes x 170, remember 170, 2 quick-check pairs (q 170, a 130), tell_your_child 320. Clamp at a word boundary.
5. **LaTeX and tags** are stripped server side (defence in depth; the page also uses textContent only).
6. **Reuse.** `notes-card.js` has no dependency on the homework modal; round 4's exam prep can call `TutpNotesCard.render(data, { lang })`.
7. **Print.** The existing Save as PDF / Print button prints `#hwModalResults`; the card has its own `@media print` and the quick-check `<details>` are opened on `beforeprint` and restored on `afterprint`. The chip row gets `no-print`.
8. **Before screenshots** were taken from the `sb2` preview (old format, live calls) before the prompt changed; the scratch script is not committed.
