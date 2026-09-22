# Tracking module

Init once in server.js after the Supabase client is created:
  import { initTracking } from './tracking/tracking.js';
  initTracking(supabase);

Then import and call the track* functions at each hook point below.
No env vars needed beyond what's already configured (Supabase,
Anthropic, Resend clients — this module reuses them, doesn't create
its own).

Hook points (add these to existing handlers):
- /api/homework, /api/quiz, /api/storytelling, /api/experiential,
  /api/game-sessions (play-based): call trackSessionStarted() on
  request received, trackSessionCompleted() on successful response.
- New /api/feedback route (to be created): calls
  trackFeedbackSubmitted(), then if sentiment !== 'positive', calls
  classifyFeedback() -> trackFeedbackClassified() -> either
  autoResolveTooComplex()+trackFeedbackAutoResolved() or
  escalateToFounder()+trackFeedbackEscalated().

Regenerate types/functions here if .telemetry/tracking-plan.yaml
changes — don't hand-edit event names, edit the plan and rerun.
