# Deployment Scripts

## Deploy Storage

Creates storage bucket and uploads bot animations.

```bash
./scripts/deploy-storage.sh <project-id> <db-password> <service-role-key>
```

**What it does:**
1. Links to Supabase project
2. Pushes migrations (creates `bot-animations` bucket)
3. Uploads all GIFs from `tmp/resources/`

## Deploy Functions

Deploys Edge Functions and sets up cron job.

```bash
./scripts/deploy-cron.sh <project-id>
```

**What it does:**
1. Deploys all Edge Functions
2. Creates/updates cron job for `cleanup-lobby-sessions` (runs every 5 minutes)

## Upload Animations (Standalone)

Upload animations without creating bucket.

```bash
SUPABASE_URL="https://<project-id>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run upload:animations
```

## Get Credentials

Supabase Dashboard → Project Settings:
- **General** → Reference ID = `<project-id>`
- **Database** → Password = `<db-password>`
- **API** → service_role key = `<service-role-key>`
