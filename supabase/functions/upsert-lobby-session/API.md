# upsert-lobby-session

Manage lobby presence for a player. Supports heartbeat upserts, lobby switching, and presence removal.

## Endpoints

```
POST /functions/v1/upsert-lobby-session
PATCH /functions/v1/upsert-lobby-session
DELETE /functions/v1/upsert-lobby-session
```

## Authentication

Required for POST/PATCH/DELETE:
- `Authorization: Bearer {jwt-token}`
- `Content-Type: application/json` (POST/PATCH)

## Requests

### POST / PATCH

```json
{
  "status": "available",
  "lobbySlug": "main"
}
```

**Fields**
- `status` (string, optional) — `"available"` or `"in_game"`. Defaults to `"available"`.
- `lobbySlug` (string, optional) — Target lobby to join. If omitted, backend auto-selects a lobby based on the player’s ELO.

### DELETE

No body. Removes the caller’s lobby session, if present.

## Responses

### Success (POST/PATCH, 200)

```json
{
  "success": true,
  "session": {
    "id": "uuid",
    "lobby_id": "uuid",
    "status": "available",
    "last_seen": "2024-01-15T12:00:00.000Z",
    "created_at": "2024-01-15T12:00:00.000Z",
    "lobby": {
      "id": "uuid",
      "slug": "main",
      "title": "Main Lobby",
      "visibility": "public",
      "min_elo": 1200,
      "max_elo": 1499,
      "time_control": "rapid"
    }
  }
}
```

### Success (DELETE, 200)

```json
{
  "success": true
}
```

### Error Payloads

- **400 Bad Request** – Invalid status value or invalid lobby slug.
- **401 Unauthorized** – Missing/invalid JWT.
- **403 Forbidden** – Attempted to join a private lobby without membership.
- **500 Internal Server Error** – Unexpected failure during upsert.

## Notes

- Auto-placement uses ELO bands seeded in the `lobbies` table (Starter/Main/Advanced).
- `status` is updated on heartbeat calls; clients should POST or PATCH every ~20 seconds while online.
- Deleting the session is recommended when leaving the lobby view or after a challenge is accepted.

## Examples

### Heartbeat (auto-placement)

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/upsert-lobby-session \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"status":"available"}'
```

### Switch to specific lobby

```bash
curl -X PATCH http://127.0.0.1:54321/functions/v1/upsert-lobby-session \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"status":"available","lobbySlug":"main"}'
```

### Remove presence

```bash
curl -X DELETE http://127.0.0.1:54321/functions/v1/upsert-lobby-session \
  -H "Authorization: Bearer {token}"
```
