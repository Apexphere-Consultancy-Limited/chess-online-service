# cancel-challenge

Revoke a pending challenge previously created by the authenticated player.

## Endpoint

```
POST /functions/v1/cancel-challenge
```

## Authentication

Required
- `Authorization: Bearer {jwt-token}`
- `Content-Type: application/json`

## Request

```json
{
  "challengeId": "uuid"
}
```

**Fields**
- `challengeId` (string, required) — Identifier of the pending challenge to cancel.

## Response

### Success (200)

```json
{
  "success": true,
  "status": "cancelled"
}
```

### Errors

- **400 Bad Request** – Missing/invalid payload (`"challengeId is required"`).
- **401 Unauthorized** – Missing or invalid JWT.
- **403 Forbidden** – Caller is not the original challenger.
- **404 Not Found** – Challenge does not exist.
- **409 Conflict** – Challenge already accepted/declined/expired/cancelled.
- **500 Internal Server Error** – Unexpected failure cancelling the challenge.

## Side Effects

- Challenge row status updated to `cancelled`.
- Inserts a `challenge_cancelled` notification for the challenged player with payload:
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
curl -X POST http://127.0.0.1:54321/functions/v1/cancel-challenge \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"00000000-0000-0000-0000-000000000000"}'
```
