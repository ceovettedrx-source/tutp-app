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
export function trackSessionCompleted(familyId, studentId, { feature, durationSeconds }) {
  trackEvent(EVENTS.SESSION_COMPLETED, { familyId, studentId, properties: { feature, duration_seconds: durationSeconds } });
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
