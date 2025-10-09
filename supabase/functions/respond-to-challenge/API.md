# respond-to-challenge

Accept or decline a pending challenge, optionally creating a game when accepted.

## Endpoint

```
POST /functions/v1/respond-to-challenge
```

## Authentication

Required headers:
- `Authorization: Bearer {jwt-token}`
- `Content-Type: application/json`

## Request

```json
{
  "challengeId": "uuid",
  "action": "accept"
}
```

**Fields**
- `challengeId` (string, required) — Identifier of the pending challenge.
- `action` (string, required) — Either `"accept"` or `"decline"`.

## Response

### Accept Success (200)

```json
{
  "success": true,
  "status": "accepted",
  "game": {
    "id": "uuid",
    "white_player_id": "uuid",
    "black_player_id": "uuid"
  }
}
```

### Decline Success (200)

```json
{
  "success": true,
  "status": "declined"
}
```

### Errors

- **400 Bad Request** – Invalid payload (missing fields or unsupported action).
- **401 Unauthorized** – Missing/invalid JWT.
- **403 Forbidden** – Caller is not the challenged player.
- **404 Not Found** – Challenge ID not found.
- **409 Conflict** – Challenge no longer pending, expired, or lobby/session state invalid (e.g. `"Challenger is not currently in the lobby"`).
- **500 Internal Server Error** – Unexpected failure creating game or updating records.

## Side Effects

On acceptance:
- Creates a new `games` row with status `in_progress`.
- Updates both participants' `lobby_sessions` to `status = "in_game"`.
- Emits notifications to both players:
  - `challenge_accepted` with payload:
    ```json
    {
      "challengeId": "uuid",
      "gameId": "uuid",
      "opponentId": "uuid",
      "opponentUsername": "player2",
      "lobbySlug": "main"
    }
    ```
  - `game_ready` with payload:
    ```json
    {
      "gameId": "uuid",
      "color": "white",
      "lobbySlug": "main"
    }
    ```

On decline:
- Marks challenge as `declined`.
- Sends `challenge_declined` notification to the challenger with payload:
  ```json
  {
    "challengeId": "uuid",
    "opponentId": "uuid",
    "opponentUsername": "player2",
    "lobbySlug": "main"
  }
  ```

## Example

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/respond-to-challenge \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"00000000-0000-0000-0000-000000000000","action":"accept"}'
```
