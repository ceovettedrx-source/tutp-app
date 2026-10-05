# Guided Discovery: safety report

Generated 2026-10-04 by scripts/el/generate.mjs. Gate: deterministic rules (server/el/safety.js) then a second claude-sonnet-5 pass (whitelist, rules, KG facts). A failing experiment is dropped and the lesson stays sim-only; a lesson with no sim and no safe experiment is excluded.

| concept | class | lesson | home experiment | notes |
|---|---|---|---|---|
| separation | 6 | included | pass | - |
| shadows | 7 | included | pass | - |
| magnets | 6 | included | pass | - |
| circuit | 7 | included | none | - |
| acids-bases | 7 | included | pass | - |
| heat-transfer | 7 | included | pass | - |
| force-pressure | 8 | included | dropped | rule: forbidden word "sharp" in: Turn the pencil so the sharp point faces down and press with the same steady for; review: Pressing a sharp pencil point with force risks poking/puncturing a finger if it slips |
| friction | 8 | included | dropped | rule: forbidden word "sharp" in: Make sure the toy car has no small sharp edges and the table area is clear. |
| sound | 9 | included | pass | - |
| density-floating | 8 | included | dropped | facts: A potato actually sinks in plain water since its density is slightly greater than water; the experiment/prediction incorrectly implies it floats or floats more readily than a marble. |
| inertia | 9 | included | pass | - |
| refraction | 10 | included | pass | - |

Included: 12/12. Experiments passed: 8, dropped: 3, none offered: 1.

One-time generation cost: 23 calls, 29175 input and 13237 output tokens, about $0.191.
