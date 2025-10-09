# Edge Functions

Backend API for Chess Online Service.

## Available Functions

- [create-game](create-game/API.md) - Create a new chess game
- [validate-move](validate-move/API.md) - Validate and execute a move
- [upsert-lobby-session](upsert-lobby-session/API.md) - Manage lobby presence heartbeats
- [cleanup-lobby-sessions](cleanup-lobby-sessions/API.md) - Cron cleanup for stale sessions
- [create-challenge](create-challenge/API.md) - Issue lobby challenges
- [cancel-challenge](cancel-challenge/API.md) - Revoke pending challenges
- [respond-to-challenge](respond-to-challenge/API.md) - Accept or decline challenges
- [mark-notification-read](mark-notification-read/API.md) - Mark notifications as read

## Base URL

- **Local**: `http://127.0.0.1:54321/functions/v1`
- **Production**: `https://{project-ref}.supabase.co/functions/v1`

## Authentication

All functions require JWT authentication via `Authorization: Bearer {token}` header.

Get token from Supabase Auth:
```javascript
const { data: { session } } = await supabase.auth.getSession()
const token = session.access_token
```
