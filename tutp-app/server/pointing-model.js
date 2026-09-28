// Model settings for every call that points at a photo: /api/visual-tutor
// (all modes) and /api/homework with a photo that gets boxes.
//
// Thinking is off (founder decision 2026-09-28, rounds B2/C): the model
// otherwise thinks before answering by default, which adds about 3 s of
// hidden output to a photo request. Kept only while the e2e box checks
// (homework p2, p4) hold; the fallback is { output_config: { effort: 'low' } }.
export const POINTING_MODEL = process.env.VISUAL_TUTOR_MODEL || 'claude-sonnet-5';
export const POINTING_SETTINGS = { thinking: { type: 'disabled' } };
