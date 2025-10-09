#!/usr/bin/env bash
#
# Deploy Supabase edge functions and ensure the cleanup cron is scheduled.
# Usage:
#   ./scripts/deploy-supabase.sh <project-ref>
# Example:
#   ./scripts/deploy-supabase.sh codekids-ai-game-center
#
# Requirements:
#   - Supabase CLI v1.147+ installed and authenticated (`supabase login`)
#   - Deno is available (for function bundling)
#   - Run from the repository root
#
# The script deploys all edge functions in supabase/functions/
# and configures a 1-minute cron for cleanup-lobby-sessions.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <project-ref>"
  exit 1
fi

PROJECT_REF="$1"
CRON_NAME="cleanup-lobby-cron"
CRON_SCHEDULE="*/5 * * * *"
FUNCTIONS=(
  "create-game"
  "validate-move"
  "upsert-lobby-session"
  "cleanup-lobby-sessions"
  "create-challenge"
  "cancel-challenge"
  "respond-to-challenge"
  "mark-notification-read"
)

echo "Deploying edge functions to project: ${PROJECT_REF}"

for fn in "${FUNCTIONS[@]}"; do
  echo "→ Deploying ${fn}"
  supabase functions deploy "${fn}" --project-ref "${PROJECT_REF}"
done

echo "Configuring cron schedule '${CRON_NAME}' for cleanup-lobby-sessions"
if supabase functions schedule create "${CRON_NAME}" \
  --function cleanup-lobby-sessions \
  --cron "${CRON_SCHEDULE}" \
  --project-ref "${PROJECT_REF}" >/dev/null 2>&1; then
  echo "→ Created new schedule '${CRON_NAME}'"
else
  supabase functions schedule update "${CRON_NAME}" \
    --function cleanup-lobby-sessions \
    --cron "${CRON_SCHEDULE}" \
    --project-ref "${PROJECT_REF}"
  echo "→ Updated existing schedule '${CRON_NAME}'"
fi

echo "Deployment complete."
