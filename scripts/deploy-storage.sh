#!/bin/bash
#
# Deploy Storage: Create bucket and upload animations
#
# Usage:
#   ./scripts/deploy-storage.sh <project-id> <db-password> <service-role-key>

set -e

if [ $# -ne 3 ]; then
    echo "Usage: $0 <project-id> <db-password> <service-role-key>"
    exit 1
fi

PROJECT_ID="$1"
DB_PASSWORD="$2"
SERVICE_ROLE_KEY="$3"
SUPABASE_URL="https://${PROJECT_ID}.supabase.co"

echo "Deploying storage to ${PROJECT_ID}..."
echo ""

# Link to project
echo "→ Linking to project..."
supabase link --project-ref "$PROJECT_ID" --password "$DB_PASSWORD"

# Push migrations (creates bucket)
echo "→ Creating storage bucket..."
supabase db push

# Upload animations
if [ -d "tmp/resources" ]; then
    echo "→ Uploading animations..."
    SUPABASE_URL="$SUPABASE_URL" \
    SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    npm run upload:animations
else
    echo "⚠ No animations found in tmp/resources/"
fi

echo ""
echo "✓ Storage deployed"
