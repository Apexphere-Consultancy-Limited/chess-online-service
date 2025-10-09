# cleanup-lobby-sessions

Cron-invoked maintenance function that prunes stale lobby sessions and expires pending challenges.

## Endpoint

```
POST /functions/v1/cleanup-lobby-sessions
```

## Authentication

Requires service-role authorization:
- `Authorization: Bearer {service-role-key}`
- Optional: `Content-Type: application/json` (no body expected)

Typically triggered via Supabase Scheduled Functions with the service role key. Avoid exposing this endpoint to clients.

## Request

No request body is required.

## Response

### Success (200)

```json
{
  "success": true,
  "lobbySessionsRemoved": 3,
  "challengesExpired": 1
}
```

**Fields**
- `lobbySessionsRemoved` (number) — Count of stale lobby sessions deleted (`last_seen` older than 60 s).
- `challengesExpired` (number) — Count of pending challenges marked `expired`.

### Errors

- **401 Unauthorized** – Missing or invalid service-role token.
- **500 Internal Server Error** – Failure during cleanup operations.

## Scheduling

Recommended cron expression: `*/5 * * * *` (every 5 minutes). Configure via Supabase CLI or dashboard to ensure continuous cleanup.

## Example

```bash
curl -X POST https://<project>.supabase.co/functions/v1/cleanup-lobby-sessions \
  -H "Authorization: Bearer {service-role-key}"
```
