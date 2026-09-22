#!/usr/bin/env bash
# Redeploys the live tutp-demo Cloud Run service from local source.
#
# Do NOT add --set-env-vars or any other flags here: tutp-demo is an
# existing production service and --set-env-vars wipes all existing
# env vars/secrets (CRON_TOKEN, RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
# ADMIN_TOKEN, etc). Env var/secret changes must be made deliberately and
# separately, never as part of a routine deploy.
#
# tutp-demo's traffic is pinned to a named revision, not tracking "latest"
# — so `gcloud run deploy` alone builds a new revision but does NOT move
# traffic to it; the service keeps serving whatever revision was last
# explicitly pinned. `gcloud run deploy`'s own final summary line ("revision
# X ... serving 100 percent of traffic") is misleading in this mode: X is
# whichever revision is CURRENTLY serving traffic (unchanged), not the one
# just built — confirmed by two consecutive real deploys (2026-09-09) where
# it falsely named the previous deploy's revision as freshly live. This
# script now identifies the just-created revision independently and pins
# traffic to it, then re-verifies with a fresh describe call before
# reporting success — never trusting gcloud run deploy's own report.
#
# status.latestReadyRevisionName was tried first and found unreliable here
# too: in live testing it stayed stuck on a stale revision even after two
# genuinely new, Ready=True revisions were created (confirmed by directly
# listing revisions sorted by creation time). `revisions list` sorted by
# metadata.creationTimestamp is what actually reflected reality correctly
# every time in manual testing this session, so that's what this script
# uses instead.
set -euo pipefail

cd "$(dirname "$0")"
REGION=us-central1
SERVICE=tutp-demo

gcloud run deploy "$SERVICE" --source . --region="$REGION"

# Identify the revision this deploy actually just created — independently
# of gcloud run deploy's own (unreliable, in pinned-traffic mode) summary,
# and of status.latestReadyRevisionName (also found unreliable — see above).
NEW_REVISION=$(gcloud run revisions list --service="$SERVICE" --region="$REGION" --sort-by="~metadata.creationTimestamp" --limit=1 --format="value(metadata.name)")
NEW_REVISION_STATUS=$(gcloud run revisions describe "$NEW_REVISION" --region="$REGION" --format="value(status.conditions[0].status)")

if [ -z "$NEW_REVISION" ] || [ "$NEW_REVISION_STATUS" != "True" ]; then
  echo "ERROR: could not find a Ready revision after deploying (newest found: '$NEW_REVISION', status: '$NEW_REVISION_STATUS'). Traffic left untouched." >&2
  exit 1
fi

echo "New revision ready: $NEW_REVISION. Pinning traffic to it..."
gcloud run services update-traffic "$SERVICE" --region="$REGION" --to-revisions="$NEW_REVISION=100" --set-tags="pdftest=$NEW_REVISION"

# Independent re-verification — a fresh describe call, not an assumption
# that the update-traffic command above did what it claims.
ACTUAL_REVISION=$(gcloud run services describe "$SERVICE" --region="$REGION" --format="value(status.traffic[0].revisionName)")
ACTUAL_PERCENT=$(gcloud run services describe "$SERVICE" --region="$REGION" --format="value(status.traffic[0].percent)")

if [ "$ACTUAL_REVISION" != "$NEW_REVISION" ] || [ "$ACTUAL_PERCENT" != "100" ]; then
  echo "ERROR: traffic verification failed — expected 100% on $NEW_REVISION, but the service reports ${ACTUAL_PERCENT}% on $ACTUAL_REVISION. Investigate before assuming this deploy is live." >&2
  exit 1
fi

echo "CONFIRMED (independently verified, not just gcloud deploy's own report): $NEW_REVISION is serving 100% of traffic."
