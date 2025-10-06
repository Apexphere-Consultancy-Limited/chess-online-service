# create-game

Create a new chess game with an opponent by username.

## Endpoint

```
POST /functions/v1/create-game
```

## Authentication

Required headers:
- `Authorization: Bearer {jwt-token}`
- `Content-Type: application/json`

## Request

```json
{
  "opponentUsername": "string"
}
```

**Fields:**
- `opponentUsername` (string, required) - Username of the opponent

## Response

### Success (200)

```json
{
  "success": true,
  "game": {
    "id": "uuid",
    "yourColor": "white" | "black"
  }
}
```

**Fields:**
- `success` (boolean) - Always `true` on success
- `game.id` (string) - Unique game identifier
- `game.yourColor` (string) - Your assigned color ("white" or "black")

### Errors

**400 Bad Request**
```json
{
  "error": "Cannot create game against yourself"
}
```

**401 Unauthorized**
```json
{
  "error": "Unauthorized"
}
```

**404 Not Found**
```json
{
  "error": "Opponent not found"
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to create game"
}
```

## Notes

- Colors are randomly assigned to both players
- Game is created with status `waiting` and transitions to `in_progress` on first move
- Both players must be registered users

## Example

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/create-game \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"opponentUsername": "player2"}'
```
