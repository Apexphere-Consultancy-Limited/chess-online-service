#!/bin/bash
#
# Deploy Edge Functions and Cron Job
#
# Usage:
#   ./scripts/deploy-cron.sh <project-id>

set -e

if [ $# -ne 1 ]; then
    echo "Usage: $0 <project-id>"
    exit 1
fi

PROJECT_ID="$1"
CRON_NAME="cleanup-lobby-cron"
CRON_SCHEDULE="*/5 * * * *"

echo "Deploying Edge Functions to ${PROJECT_ID}..."
supabase functions deploy --project-ref "$PROJECT_ID"

echo ""
echo "Setting up cron job..."
if supabase functions schedule create "$CRON_NAME" \
  --function cleanup-lobby-sessions \
  --cron "$CRON_SCHEDULE" \
  --project-ref "$PROJECT_ID" >/dev/null 2>&1; then
  echo "✓ Cron created"
else
  supabase functions schedule update "$CRON_NAME" \
    --function cleanup-lobby-sessions \
    --cron "$CRON_SCHEDULE" \
    --project-ref "$PROJECT_ID"
  echo "✓ Cron updated"
fi

echo ""
echo "✓ Functions deployed"
