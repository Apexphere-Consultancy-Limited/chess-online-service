# Player Ready API

Mark player as ready to start the game. When both players are ready, the game automatically transitions from `waiting` to `in_progress`.

## Endpoint

```
POST /functions/v1/player-ready
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
| `gameId` | string (UUID) | Yes | ID of the game to mark ready for |

## Response

### Success Response (200 OK)

**When first player marks ready:**
```json
{
  "success": true,
  "game": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "status": "waiting",
    "whiteReady": true,
    "blackReady": false,
    "bothReady": false
  }
}
```

**When both players are ready:**
```json
{
  "success": true,
  "game": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "status": "in_progress",
    "whiteReady": true,
    "blackReady": true,
    "bothReady": true
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `game.id` | string | Game UUID |
| `game.status` | string | `"waiting"` or `"in_progress"` |
| `game.whiteReady` | boolean | White player ready status |
| `game.blackReady` | boolean | Black player ready status |
| `game.bothReady` | boolean | Whether both players are ready |

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

**Game not in waiting status:**
```json
{
  "error": "Game is not in waiting status"
}
```

**Player already marked ready:**
```json
{
  "error": "You are already ready"
}
```

**Race condition detected:**
```json
{
  "error": "Game state changed. Please retry."
}
```

### 410 Gone

**Ready period expired:**
```json
{
  "error": "Ready period has expired"
}
```

### 500 Internal Server Error

**Database update failed:**
```json
{
  "error": "Failed to update ready state"
}
```

**Generic server error:**
```json
{
  "error": "Internal server error"
}
```

## Side Effects

### When First Player Marks Ready

1. **Updates game record:**
   - `white_ready` or `black_ready` → `true`

2. **Sends notification to opponent:**
   - Type: `player_ready`
   - Payload:
     ```json
     {
       "gameId": "uuid",
       "playerUsername": "player1"
     }
     ```

### When Both Players Are Ready

1. **Updates game record:**
   - `white_ready` → `true`
   - `black_ready` → `true`
   - `status` → `"in_progress"`
   - `started_at` → current timestamp

2. **Sends notification to opponent:**
   - Type: `player_ready`
   - Payload:
     ```json
     {
       "gameId": "uuid",
       "playerUsername": "player2"
     }
     ```

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
| Game status | Must be `waiting` | 409 Game is not in waiting status |
| Ready state | Player not already ready | 409 You are already ready |
| Timeout | `ready_expires_at` not passed | 410 Ready period has expired |

## Usage Examples

### cURL

```bash
curl -X POST https://your-project.supabase.co/functions/v1/player-ready \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId": "123e4567-e89b-12d3-a456-426614174000"}'
```

### JavaScript (Supabase Client)

```javascript
const { data, error } = await supabase.functions.invoke('player-ready', {
  body: {
    gameId: '123e4567-e89b-12d3-a456-426614174000'
  }
})

if (error) {
  console.error('Failed to mark ready:', error)
} else {
  console.log('Ready status:', data.game)
  if (data.game.bothReady) {
    console.log('Game starting!')
    // Navigate to game board
  } else {
    console.log('Waiting for opponent...')
  }
}
```

### TypeScript

```typescript
interface PlayerReadyRequest {
  gameId: string
}

interface PlayerReadyResponse {
  success: true
  game: {
    id: string
    status: 'waiting' | 'in_progress'
    whiteReady: boolean
    blackReady: boolean
    bothReady: boolean
  }
}

const response = await supabase.functions.invoke<PlayerReadyResponse>('player-ready', {
  body: { gameId: 'uuid-here' } as PlayerReadyRequest
})
```

## Flow Diagram

```
Player A clicks "Ready"
  ↓
player-ready API called
  ↓
white_ready = true (or black_ready = true)
  ↓
Notification sent to Player B: "Opponent is ready"
  ↓
Player A sees: "Waiting for opponent..."
  ↓
Player B clicks "Ready"
  ↓
player-ready API called
  ↓
black_ready = true (or white_ready = true)
  ↓
Game status changes to "in_progress"
  ↓
Notification sent to Player A: "Opponent is ready"
  ↓
Both players redirected to game board
  ↓
Game starts!
```

## Timeout Behavior

- **Ready period:** 60 seconds from game creation
- **After timeout:**
  - API returns 410 "Ready period has expired"
  - Game remains in `waiting` status with `abandoned` result
  - No ELO calculation for expired games
  - Scheduled cleanup job removes expired games
  - Players are automatically returned to lobby

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Both players click ready simultaneously | One updates first (atomic), second gets updated state showing both ready |
| Player clicks ready twice | First succeeds, second returns 409 "You are already ready" |
| Game starts while player clicking ready | Returns 409 "Game is not in waiting status" |
| Player clicks ready after timeout | Returns 410 "Ready period has expired" |
| Opponent cancels while clicking ready | Returns 409 (race condition), player should retry or see cancellation notification |

## Performance

- **Expected response time:** 150-400ms
- **Database operations:**
  - 2 parallel SELECTs (game + profile)
  - 1 UPDATE (game ready state)
  - 1 INSERT (notification)

## Security

- **Authentication:** JWT token required
- **Authorization:** Players can only ready their own games
- **Race conditions:** Prevented via atomic update with status check
- **Input validation:** UUID format validation prevents SQL injection
- **CORS:** Enabled for browser requests

## Notes

- Games in `waiting` status that expire do NOT affect player statistics or ELO ratings
- The `handle_game_completion()` trigger only processes games with status `completed`, not `abandoned`
- Frontend should handle timeout by showing appropriate message and allowing player to return to lobby
- No cancel button needed - players can simply close the ready modal and wait for timeout
- Backend scheduled job will clean up expired games automatically

## Related Documentation

- [Respond to Challenge API](../respond-to-challenge/API.md)
- [Resign Game API](../resign-game/API.md)
- [Database Migration](../../migrations/20250118000001_add_player_ready_system.sql)
