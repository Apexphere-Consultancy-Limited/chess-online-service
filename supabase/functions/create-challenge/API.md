# create-challenge

Create a direct challenge for another player currently available in the same lobby.

## Endpoint

```
POST /functions/v1/create-challenge
```

## Authentication

Required headers:
- `Authorization: Bearer {jwt-token}`
- `Content-Type: application/json`

## Request

```json
{
  "challengedId": "uuid",
  "challengedUsername": "opponent",
  "message": "Optional note"
}
```

**Fields**
- `challengedId` (string, optional) — Target player’s profile ID.
- `challengedUsername` (string, optional) — Target player’s username (resolved to ID when provided).
- `message` (string, optional) — Short message displayed with the challenge (max 280 characters in backend).

> Provide either `challengedId` or `challengedUsername`. Supplying both is allowed; `challengedId` takes precedence.

## Response

### Success (200)

```json
{
  "success": true,
  "challenge": {
    "id": "uuid",
    "status": "pending",
    "challenger_id": "uuid",
    "challenged_id": "uuid",
    "lobby": {
      "id": "uuid",
      "slug": "main",
      "title": "Main Lobby",
      "visibility": "public"
    },
    "message": "Optional note",
    "expires_at": "2024-01-15T12:05:00.000Z",
    "created_at": "2024-01-15T12:00:00.000Z"
  }
}
```

### Errors

- **400 Bad Request** – Missing opponent identifier or invalid payload.
- **401 Unauthorized** – Missing/invalid JWT.
- **404 Not Found** – Opponent username not found.
- **409 Conflict** – Various state conflicts:
  - Challenger not in a lobby (`"Join a lobby before challenging players"`).
  - Opponent not in same lobby (`"Opponent is waiting in a different lobby"`).
  - Opponent not available (`"Opponent is busy with another game"`).
  - Duplicate pending challenge (`"You already have a pending challenge for this player"`).
- **500 Internal Server Error** – Unexpected insertion failure.

## Notifications

On success, the backend inserts a `challenge_received` notification for the challenged player with payload:

```json
{
  "challengeId": "uuid",
  "lobbySlug": "main",
  "opponentId": "uuid",
  "opponentUsername": "player1"
}
```

## Example

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/create-challenge \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"challengedUsername":"opponent","message":"Play a match?"}'
```
