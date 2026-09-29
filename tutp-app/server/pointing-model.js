// Model settings for every call that points at a photo: /api/visual-tutor
// (all modes) and /api/homework with a photo that gets boxes.
//
// Effort low (founder rule 2026-09-29): with thinking off, "Check mistakes"
// marked a wrong answer (56 + 27 = 73) as correct on the e2e worksheet, so
// the photo calls think a little again. Thinking had been turned off
// (2026-09-28, rounds B2/C) because at the default effort it used up
// max_tokens before the JSON on a dense sheet; low effort keeps it short.
export const POINTING_MODEL = process.env.VISUAL_TUTOR_MODEL || 'claude-sonnet-5';
export const POINTING_SETTINGS = { output_config: { effort: 'low' } };
