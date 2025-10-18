# Resign Game API

Allow players to resign from active chess games, immediately ending the game and awarding the win to their opponent.

## Endpoint

```
POST /functions/v1/resign-game
```

## Authentication

**Required:** Yes

Include a valid JWT token in the Authorization header.

## Request

### Headers

```
Authorization: Bearer {jwt-token}
Content-Type: application/json
```

### Body

```json
{
  "gameId": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gameId` | string (UUID) | Yes | ID of the game to resign from |

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "game": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "status": "completed",
    "result": "black_win",
    "winnerId": "opponent-uuid",
    "terminationType": "resignation",
    "resignedBy": "white"
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `game.id` | string | Game UUID |
| `game.status` | string | Always `"completed"` |
| `game.result` | string | `"white_win"` or `"black_win"` |
| `game.winnerId` | string | UUID of the winning player |
| `game.terminationType` | string | Always `"resignation"` |
| `game.resignedBy` | string | `"white"` or `"black"` (who resigned) |

## Error Responses

### 400 Bad Request

**Missing gameId:**
```json
{
  "error": "gameId is required"
}
```

**Invalid UUID format:**
```json
{
  "error": "Invalid gameId format"
}
```

**Invalid JSON body:**
```json
{
  "error": "Invalid JSON body"
}
```

### 401 Unauthorized

**No auth header or invalid token:**
```json
{
  "error": "Unauthorized"
}
```

### 403 Forbidden

**User is not a player in the game:**
```json
{
  "error": "Not a player in this game"
}
```

### 404 Not Found

**Game doesn't exist:**
```json
{
  "error": "Game not found"
}
```

### 405 Method Not Allowed

**Wrong HTTP method:**
```json
{
  "error": "Method not allowed"
}
```

### 409 Conflict

**Game already completed:**
```json
{
  "error": "Game already completed"
}
```

**Race condition detected:**
```json
{
  "error": "Game state changed. Please retry."
}
```

### 500 Internal Server Error

**Database update failed:**
```json
{
  "error": "Failed to resign game"
}
```

**Generic server error:**
```json
{
  "error": "Internal server error"
}
```

## Side Effects

### Automatic (via database trigger)

When a game is resigned, the `handle_game_completion()` trigger automatically:

1. **Sets completed_at timestamp** - Marks when the game ended
2. **Updates ELO ratings** - Both players' ratings adjusted using standard ELO formula (K=32)
3. **Updates player statistics:**
   - Winner: `games_played++`, `games_won++`
   - Loser: `games_played++`, `games_lost++`

### Manual (in function)

The Edge Function also:

1. **Sends notification** - Opponent receives `game_resigned` notification with:
   - `gameId` - The completed game ID
   - `resignedBy` - Color that resigned (`"white"` or `"black"`)
   - `resignedByUsername` - Username of resigning player
   - `result` - Game result (`"white_win"` or `"black_win"`)

2. **Updates game record:**
   - `status` → `"completed"`
   - `result` → `"white_win"` or `"black_win"`
   - `winner_id` → Opponent's UUID
   - `termination_type` → `"resignation"`
   - `started_at` → Current timestamp (if not already set)

## Validation Rules

| Check | Validation | Error |
|-------|------------|-------|
| HTTP method | Must be `POST` | 405 Method not allowed |
| Authorization | Valid JWT in header | 401 Unauthorized |
| Request body | Valid JSON | 400 Invalid JSON body |
| gameId presence | Not null/empty | 400 gameId is required |
| gameId format | Valid UUID | 400 Invalid gameId format |
| Game exists | Found in database | 404 Game not found |
| Player authorization | User is white or black player | 403 Not a player in this game |
| Game status | `waiting` or `in_progress` | 409 Game already completed |

## Usage Examples

### cURL

```bash
curl -X POST https://your-project.supabase.co/functions/v1/resign-game \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId": "123e4567-e89b-12d3-a456-426614174000"}'
```

### JavaScript (Supabase Client)

```javascript
const { data, error } = await supabase.functions.invoke('resign-game', {
  body: {
    gameId: '123e4567-e89b-12d3-a456-426614174000'
  }
})

if (error) {
  console.error('Failed to resign:', error)
} else {
  console.log('Game resigned:', data.game)
}
```

### TypeScript

```typescript
interface ResignGameRequest {
  gameId: string
}

interface ResignGameResponse {
  success: true
  game: {
    id: string
    status: 'completed'
    result: 'white_win' | 'black_win'
    winnerId: string
    terminationType: 'resignation'
    resignedBy: 'white' | 'black'
  }
}

const response = await supabase.functions.invoke<ResignGameResponse>('resign-game', {
  body: { gameId: 'uuid-here' } as ResignGameRequest
})
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Player resigns twice (double-click) | First request succeeds, second returns 409 "Game already completed" |
| Both players resign simultaneously | First request wins (atomic update), second gets 409 error |
| Opponent makes winning move while resign in flight | Update fails due to status check, returns 409 with retry message |
| Game is abandoned | Returns 409 "Game already completed" |
| Notification fails to send | Game still completes successfully, error logged |
| Player resigns before first move | Works correctly, `started_at` set to current timestamp |

## Performance

- **Expected response time:** 150-400ms
- **Database operations:**
  - 2 parallel SELECTs (game + profile)
  - 1 UPDATE (game)
  - 1 INSERT (notification)
  - Plus trigger operations (2 UPDATEs for ELO/stats)

## Security

- **Authentication:** JWT token required
- **Authorization:** Players can only resign their own games
- **Race conditions:** Prevented via atomic update with status check
- **Input validation:** UUID format validation prevents SQL injection
- **CORS:** Enabled for browser requests

## Related Documentation

- [Game Termination Overview](../../../docs/GAME_TERMINATION.md)
- [Design Document](../../../docs/design/RESIGN_GAME_DESIGN.md)
- [Database Schema](../../migrations/20240101000000_initial_schema.sql)
- [Notification Migration](../../migrations/20250118000000_add_game_resigned_notification.sql)
