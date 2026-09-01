#!/usr/bin/env bash
# Redeploys the live tutp-demo Cloud Run service from local source.
#
# Do NOT add --set-env-vars or any other flags here: tutp-demo is an
# existing production service and --set-env-vars wipes all existing
# env vars/secrets (CRON_TOKEN, RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
# ADMIN_TOKEN, etc). Env var/secret changes must be made deliberately and
# separately, never as part of a routine deploy.
set -euo pipefail

cd "$(dirname "$0")"

gcloud run deploy tutp-demo --source . --region=us-central1
