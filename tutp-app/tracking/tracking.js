import { EVENTS } from './events.js';
let supabase = null;
export function initTracking(client) { supabase = client; }

function trackEvent(eventName, { familyId, studentId = null, properties = {} }) {
  if (!supabase) { console.error('trackEvent called before initTracking'); return; }
  supabase.from('usage_events').insert({
    event_name: eventName, family_id: familyId, student_id: studentId, properties,
  }).then(({ error }) => { if (error) console.error('trackEvent failed:', eventName, error); });
}

export function trackSessionStarted(familyId, studentId, { feature, language }) {
  trackEvent(EVENTS.SESSION_STARTED, { familyId, studentId, properties: { feature, language } });
}
// extra: more properties for one feature, e.g. Storytelling's { language,
// story_retry (0 | 1), story_format ('ok' | 'fallback'), story_fixed } so the
// founder dashboard can show the retry rate per language.
export function trackSessionCompleted(familyId, studentId, { feature, durationSeconds, extra = {} }) {
  trackEvent(EVENTS.SESSION_COMPLETED, { familyId, studentId, properties: { feature, duration_seconds: durationSeconds, ...extra } });
}
export function trackFeedbackSubmitted(familyId, studentId, { feature, sentiment, explanationClear, freeText }) {
  trackEvent(EVENTS.FEEDBACK_SUBMITTED, { familyId, studentId, properties: { feature, sentiment, explanation_clear: explanationClear, free_text: freeText } });
}
export function trackFeedbackClassified(familyId, studentId, { category, autoResolvable }) {
  trackEvent(EVENTS.FEEDBACK_CLASSIFIED, { familyId, studentId, properties: { category, auto_resolvable: autoResolvable } });
}
export function trackFeedbackAutoResolved(familyId, studentId, { category, resolutionAction }) {
  trackEvent(EVENTS.FEEDBACK_AUTO_RESOLVED, { familyId, studentId, properties: { category, resolution_action: resolutionAction } });
}
export function trackFeedbackEscalated(familyId, studentId, { category, patternCount }) {
  trackEvent(EVENTS.FEEDBACK_ESCALATED, { familyId, studentId, properties: { category, pattern_count: patternCount } });
}
export function trackShareClicked(familyId) {
  trackEvent(EVENTS.SHARE_CLICKED, { familyId });
}
// A parent tapped "Is this picture wrong?" on a story's library picture
// (server/image-library.js hides an image after 3 families in 30 days).
export function trackImageReported(familyId, studentId, { imageId }) {
  trackEvent(EVENTS.IMAGE_REPORTED, { familyId, studentId, properties: { feature: 'storytelling', image_id: imageId } });
}
// A story of a lesson that is not maths got no library picture: the lesson's
// normalized concept (server/image-library.js normalizeConcept: no names, no
// numbers), how many library pictures were offered (0 = none matched) and the
// language. No student id. scripts/imglib/missing-concepts.mjs ranks these.
export function trackStoryImageMissing(familyId, { concept, offered, language }) {
  trackEvent(EVENTS.STORY_IMAGE_MISSING, { familyId, properties: { feature: 'storytelling', concept, offered, language } });
}
// feature is fixed to 'visual_tutor' rather than added to FEATURES: FEATURES
// is also /api/homework's allow-list, which shouldn't accept this value.
export function trackVisualTutorCall(familyId, { mode, outcome, steps, model, inputTokens, outputTokens, stopReason = null }) {
  trackEvent(EVENTS.VISUAL_TUTOR_CALL, { familyId, properties: {
    feature: 'visual_tutor', mode, outcome, steps, model, input_tokens: inputTokens, output_tokens: outputTokens,
    stop_reason: stopReason,
  } });
}
