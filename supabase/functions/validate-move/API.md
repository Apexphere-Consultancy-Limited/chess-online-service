# validate-move

Validate and execute a chess move.

## Endpoint

```
POST /functions/v1/validate-move
```

## Authentication

Required headers:
- `Authorization: Bearer {jwt-token}`
- `Content-Type: application/json`

## Request

```json
{
  "gameId": "uuid",
  "from": "e2",
  "to": "e4",
  "promotion": "q"
}
```

**Fields:**
- `gameId` (string, required) - Game identifier
- `from` (string, required) - Source square (e.g., "e2")
- `to` (string, required) - Destination square (e.g., "e4")
- `promotion` (string, optional) - Promotion piece ("q", "r", "b", "n")

## Response

### Success (200)

```json
{
  "success": true,
  "move": {
    "from": "e2",
    "to": "e4",
    "san": "e4",
    "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
  },
  "gameStatus": "in_progress",
  "result": null
}
```

**Fields:**
- `success` (boolean) - Always `true` on success
- `move.from` (string) - Source square
- `move.to` (string) - Destination square
- `move.san` (string) - Standard Algebraic Notation (e.g., "e4", "Nf3", "O-O")
- `move.fen` (string) - Board state after move in FEN notation
- `gameStatus` (string) - Game state: "in_progress" or "completed"
- `result` (string|null) - Game result: "white_win", "black_win", "draw", or null

### Errors

**400 Bad Request**
```json
{
  "error": "Illegal move"
}
```
```json
{
  "error": "Not your turn"
}
```
```json
{
  "error": "Game is not active"
}
```

**401 Unauthorized**
```json
{
  "error": "Unauthorized"
}
```

**403 Forbidden**
```json
{
  "error": "Not a player in this game"
}
```

**404 Not Found**
```json
{
  "error": "Game not found"
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to update game" | "Failed to insert move"
}
```

## Notes

- Move validation enforces all chess rules (legal moves, check, checkmate, stalemate)
- Game status automatically transitions from `waiting` to `in_progress` on first move
- Game status changes to `completed` when checkmate, stalemate, or draw occurs
- ELO ratings are automatically calculated and updated on game completion

## Example

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/validate-move \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"gameId": "123e4567-e89b-12d3-a456-426614174000", "from": "e2", "to": "e4"}'
```
