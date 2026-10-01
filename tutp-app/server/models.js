// Which model each feature uses, in one place (round 2, founder plan
// 2026-09-28: typed features off sonnet-4-6 to haiku-4-5, the rest to
// sonnet-5). A change here makes the e2e runner do a live smoke run
// (tests/e2e/run.js). Photo calls (homework with a photo, visual tutor) use
// POINTING_MODEL in server/pointing-model.js.
export const MODELS = {
  homework_typed: 'claude-haiku-4-5',
  homework_explain: 'claude-haiku-4-5',
  homework_notes: 'claude-haiku-4-5',
  homework_demo: 'claude-haiku-4-5',
  illustrate: 'claude-haiku-4-5',
  game_questions: 'claude-haiku-4-5',
  feedback_classify: 'claude-haiku-4-5',
  // Teacher features: long structured output (up to 16k tokens), and the
  // verifier's job is to catch mistakes.
  question_paper: 'claude-sonnet-5',
  lesson_material: 'claude-sonnet-5',
  lesson_verify: 'claude-sonnet-5',
};

// Extra request settings per model: sonnet-5 thinks by default, which can
// use up max_tokens before the JSON (round 1), so its text-only calls run at
// low effort, like the photo calls. haiku-4-5 takes no thinking settings.
export function modelSettings(model) {
  return model === 'claude-sonnet-5' ? { output_config: { effort: 'low' } } : {};
}
