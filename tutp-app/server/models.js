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
  // Storytelling (storytelling-quality round): English stays on haiku; any other
  // language goes to sonnet-5, because haiku's Telugu was weak (a Telugu word
  // for "messages" where the story meant laddus). See storyModel().
  story_english: 'claude-haiku-4-5',
  story_other: 'claude-sonnet-5',
  illustrate: 'claude-haiku-4-5',
  // Guided Discovery (experiential-learning-v2): the cheapest model for the
  // teach-back follow-up question and the video review; non-English lesson
  // translation goes to sonnet-5 (haiku's Telugu was weak, see storyModel).
  el_teachback: 'claude-haiku-4-5',
  el_video_review: 'claude-haiku-4-5',
  el_translate: 'claude-sonnet-5',
  game_questions: 'claude-haiku-4-5',
  feedback_classify: 'claude-haiku-4-5',
  // Answer/Explain v2 (docs/specs/answer-explain-v2.md, founder decision 4).
  answer_v2: 'claude-sonnet-5',
  explain_v2: 'claude-sonnet-5',
  // Teacher features: long structured output (up to 16k tokens), and the
  // verifier's job is to catch mistakes.
  question_paper: 'claude-sonnet-5',
  lesson_material: 'claude-sonnet-5',
  lesson_verify: 'claude-sonnet-5',
};

// The Storytelling model for the parent's chosen language ("English" is the
// page's own label, as in HOMEWORK_LANGUAGES).
export function storyModel(lang) {
  return lang === 'English' ? MODELS.story_english : MODELS.story_other;
}

// "Notes please" the same way (img1 Telugu quality pass): haiku's Telugu notes held a
// letter of a wrong script, a nonsense word and repeated phrases in the recorded review
// cases, so any language other than English goes to sonnet-5.
export function notesModel(lang) {
  return lang === 'English' ? MODELS.homework_notes : MODELS.story_other;
}

// Extra request settings per model: sonnet-5 thinks by default, which can
// use up max_tokens before the JSON (round 1), so its text-only calls run at
// low effort, like the photo calls. haiku-4-5 takes no thinking settings.
export function modelSettings(model) {
  return model === 'claude-sonnet-5' ? { output_config: { effort: 'low' } } : {};
}

// Answer Please v2 thinks at this effort. Founder decision 4: low; if any
// golden-set numerical case fails, change it to 'medium' and re-run (the
// release summary says which one passed).
export const ANSWER_V2_EFFORT = 'low';
export function answerSettings() {
  return { output_config: { effort: ANSWER_V2_EFFORT } };
}
