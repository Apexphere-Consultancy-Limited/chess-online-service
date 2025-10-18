# Resign Game - Design & Implementation Plan

## Overview

Design and implementation plan for the `resign-game` Edge Function, allowing players to resign from active chess games.

**Status:** 📋 Design Phase
**Priority:** High
**Complexity:** Low-Medium

---

## 1. Requirements

### Functional Requirements

1. **Authorization**: Only players in the game can resign
2. **Game State Validation**: Only active games (status: `waiting` or `in_progress`) can be resigned
3. **Automatic Result Calculation**: Opponent automatically wins
4. **Database Updates**: Update game status, result, winner, and termination type
5. **Notification**: Opponent receives notification about resignation
6. **ELO Update**: Trigger automatic ELO rating updates (via existing trigger)
7. **Statistics Update**: Trigger automatic player statistics updates (via existing trigger)

### Non-Functional Requirements

1. **Idempotency**: Multiple resign requests should not cause errors
2. **Atomicity**: All database updates must succeed or fail together
3. **Performance**: Response time < 500ms
4. **Security**: Prevent unauthorized resignations
5. **CORS Support**: Support browser requests

---

## 2. API Specification

### Endpoint

```
POST /functions/v1/resign-game
```

### Request

**Headers:**
```
Authorization: Bearer {jwt-token}
Content-Type: application/json
```

**Body:**
```json
{
  "gameId": "123e4567-e89b-12d3-a456-426614174000"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gameId` | string (UUID) | ✅ Yes | ID of the game to resign from |

### Response

#### Success (200)

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

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `game.id` | string | Game UUID |
| `game.status` | string | Always `"completed"` |
| `game.result` | string | `"white_win"` or `"black_win"` |
| `game.winnerId` | string | UUID of the winning player |
| `game.terminationType` | string | Always `"resignation"` |
| `game.resignedBy` | string | `"white"` or `"black"` (who resigned) |

#### Error Responses

**400 Bad Request - Missing gameId**
```json
{
  "error": "gameId is required"
}
```

**400 Bad Request - Invalid UUID**
```json
{
  "error": "Invalid gameId format"
}
```

**401 Unauthorized - No auth header**
```json
{
  "error": "Unauthorized"
}
```

**401 Unauthorized - Invalid token**
```json
{
  "error": "Unauthorized"
}
```

**403 Forbidden - Not a player**
```json
{
  "error": "Not a player in this game"
}
```

**404 Not Found - Game doesn't exist**
```json
{
  "error": "Game not found"
}
```

**409 Conflict - Game already completed**
```json
{
  "error": "Game already completed"
}
```

**409 Conflict - Race condition detected**
```json
{
  "error": "Game state changed. Please retry."
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to resign game" | "Internal server error"
}
```

---

## 3. Implementation Details

### 3.1 File Structure

```
supabase/functions/resign-game/
├── index.ts          # Main Edge Function
└── API.md            # API Documentation
```

### 3.2 Core Logic Flow

```
1. Handle CORS preflight (OPTIONS)
2. Validate HTTP method (POST only)
3. Parse and validate Authorization header
4. Authenticate user via Supabase Auth
5. Parse request body
6. Validate gameId format (UUID)
7. Fetch game and user profile in parallel (optimization)
8. Verify game exists
9. Verify user is a player (white or black)
10. Verify game is active (waiting or in_progress)
11. Determine resigning player's color
12. Calculate result and winner
13. Update game in database (atomic, with race condition detection)
14. Send notification to opponent
15. Return success response
```

### 3.3 Database Operations

#### Game and Profile Fetch (Parallel)
```typescript
// Fetch game and user profile in parallel for better performance
const [gameResult, profileResult] = await Promise.all([
  supabase
    .from('games')
    .select('id, white_player_id, black_player_id, status, result, started_at')
    .eq('id', gameId)
    .single(),
  supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single()
])

const { data: game, error: gameError } = gameResult
const { data: resigningProfile } = profileResult
```

**Note:** Fetching in parallel reduces total query time by ~50-100ms.

#### Game Update Query
```typescript
const { data: updatedGame, error: updateError } = await supabase
  .from('games')
  .update({
    status: 'completed',
    result: resigningColor === 'white' ? 'black_win' : 'white_win',
    winner_id: opponentId,
    termination_type: 'resignation',
    started_at: game.started_at ?? new Date().toISOString()
    // Note: completed_at is set automatically by handle_game_completion() trigger
  })
  .eq('id', gameId)
  .eq('status', game.status) // Prevent race conditions
  .select('id, status, result, winner_id, termination_type')
  .single()
```

**Notes:**
- The `.eq('status', game.status)` ensures we only update if the game is still in the same state, preventing race conditions.
- `started_at` is set if not already present (handles resignation before first move).
- `completed_at` is automatically set by the `handle_game_completion()` trigger.

#### Notification Insert
```typescript
const { error: notificationError } = await supabase
  .from('notifications')
  .insert({
    recipient_id: opponentId,
    type: 'game_resigned', // NEW TYPE - needs schema update
    payload: {
      gameId: gameId,
      resignedBy: resigningColor,
      resignedByUsername: resigningPlayerUsername,
      result: result
    }
  })
```

### 3.4 Validation Rules

| Validation | Check | Error Response |
|------------|-------|----------------|
| Request method | `req.method === 'POST'` | 405 Method not allowed |
| Auth header | `authHeader != null` | 401 Unauthorized |
| User authentication | `user != null` | 401 Unauthorized |
| Request body | Valid JSON | 400 Invalid JSON body |
| gameId presence | `gameId != null && gameId.trim() != ''` | 400 gameId is required |
| gameId format | UUID regex validation | 400 Invalid gameId format |
| Game exists | Game found in DB | 404 Game not found |
| Player authorization | `user.id === white_player_id \|\| user.id === black_player_id` | 403 Not a player in this game |
| Game status | `status === 'waiting' \|\| status === 'in_progress'` | 409 Game already completed |

### 3.5 Edge Cases

| Scenario | Handling |
|----------|----------|
| Player resigns twice (double-click) | Returns 409 "Game already completed" on second attempt |
| Both players resign simultaneously | First request wins (atomic update with status check), second gets 409 |
| Opponent makes winning move while resign in flight | Update will fail due to status check, return 409 with clear error message |
| Game is abandoned | Return 409 "Game already completed" (same as other completed games) |
| Notification fails to send | Log error but still return success (non-critical) |

### 3.6 Side Effects

**Automatic (via existing database trigger `handle_game_completion`):**
- ✅ ELO rating updates for both players
- ✅ Player statistics updates (games_played, games_won, games_lost)
- ✅ `completed_at` timestamp set automatically by trigger

**Manual (in function):**
- ✅ Notification sent to opponent
- ✅ Game status changed to `completed`
- ✅ Result and winner_id set
- ✅ Termination type set to `resignation`
- ✅ `started_at` set if not already present (handles resignation before first move)

---

## 4. Database Schema Changes

### Required Schema Update

Add new notification type to existing constraint:

**File:** `supabase/migrations/YYYYMMDD_add_game_resigned_notification.sql`

```sql
-- Add 'game_resigned' notification type
ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'challenge_received',
    'challenge_accepted',
    'challenge_declined',
    'challenge_cancelled',
    'game_ready',
    'game_resigned'  -- NEW
  )
);
```

**Alternative (if we want more game-end notifications):**
```sql
-- Add multiple game-ending notification types
ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'challenge_received',
    'challenge_accepted',
    'challenge_declined',
    'challenge_cancelled',
    'game_ready',
    'game_resigned',        -- NEW
    'game_completed',       -- NEW (for checkmate, stalemate, etc.)
    'game_draw_offered',    -- NEW (future)
    'game_draw_accepted'    -- NEW (future)
  )
);
```

**Recommendation:** Use the alternative approach to future-proof the schema.

---

## 5. Testing Plan

### 5.1 Unit Tests

Test the Edge Function with various scenarios:

**File:** `supabase/functions/resign-game/index.test.ts`

```typescript
// Test cases to implement:
describe('resign-game', () => {
  describe('Authentication', () => {
    test('Returns 401 when no auth header provided')
    test('Returns 401 when invalid token provided')
  })

  describe('Validation', () => {
    test('Returns 400 when gameId is missing')
    test('Returns 400 when gameId is empty string')
    test('Returns 400 when gameId is invalid UUID format')
    test('Returns 400 when request body is invalid JSON')
  })

  describe('Authorization', () => {
    test('Returns 403 when user is not a player in the game')
    test('Returns 404 when game does not exist')
  })

  describe('Game State', () => {
    test('Returns 409 when game is already completed')
    test('Returns 409 when game is abandoned')
    test('Allows resignation from waiting game')
    test('Allows resignation from in_progress game')
  })

  describe('Resignation Logic', () => {
    test('White player resignation results in black_win')
    test('Black player resignation results in white_win')
    test('Sets correct winner_id to opponent')
    test('Sets termination_type to resignation')
    test('Sets status to completed')
    test('Sets completed_at timestamp')
  })

  describe('Idempotency', () => {
    test('Multiple resign requests return same result')
    test('Resigning already-resigned game returns appropriate error')
  })

  describe('Notifications', () => {
    test('Sends notification to opponent on successful resignation')
    test('Notification contains correct payload data')
    test('Success even if notification fails (logs error)')
  })

  describe('Side Effects', () => {
    test('ELO ratings are updated correctly')
    test('Player statistics are updated correctly')
    test('Winner gains ELO, loser loses ELO')
    test('games_won increments for winner')
    test('games_lost increments for resigner')
  })

  describe('Concurrent Operations', () => {
    test('Race condition: both players try to resign')
    test('Race condition: opponent wins while resign in flight')
  })
})
```

### 5.2 Integration Tests

**File:** `tests/integration/resign-game.test.ts`

```typescript
describe('resign-game integration', () => {
  test('Full flow: create game, make moves, resign, verify updates')
  test('Verify notification appears in opponent\'s notifications list')
  test('Verify game appears as completed in both players\' game history')
  test('Verify ELO changes are reflected in profiles')
})
```

### 5.3 Manual Testing Checklist

- [ ] Create a game between two test users
- [ ] Resign as white player
- [ ] Verify black player wins
- [ ] Verify ELO updates correctly
- [ ] Verify notification sent to black player
- [ ] Create another game
- [ ] Resign as black player
- [ ] Verify white player wins
- [ ] Try to resign from completed game (should fail)
- [ ] Try to resign from opponent's perspective (should fail)
- [ ] Test with invalid gameId
- [ ] Test without authentication
- [ ] Test CORS preflight request

---

## 6. Implementation Checklist

### Phase 1: Database Schema ✅
- [ ] Create migration file for notification type update
- [ ] Test migration on local Supabase instance
- [ ] Verify constraint update works correctly

### Phase 2: Edge Function ✅
- [ ] Create `resign-game` directory
- [ ] Implement `index.ts` with core logic
- [ ] Add CORS headers
- [ ] Add authentication
- [ ] Add validation
- [ ] Add game state checks
- [ ] Add database updates
- [ ] Add notification sending
- [ ] Add error handling
- [ ] Add logging

### Phase 3: Documentation ✅
- [ ] Create `API.md` with endpoint documentation
- [ ] Add examples and error cases
- [ ] Update main functions `README.md`
- [ ] Update `GAME_TERMINATION.md` to mark as implemented

### Phase 4: Testing ✅
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Manual testing
- [ ] Test race conditions
- [ ] Test with real Supabase instance

### Phase 5: Deployment ✅
- [ ] Deploy migration to staging
- [ ] Deploy function to staging
- [ ] Test on staging
- [ ] Deploy to production
- [ ] Monitor for errors

---

## 7. Code Template

### File: `supabase/functions/resign-game/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ResignGameRequest {
  gameId?: string
}

serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // 2. Validate method
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // 3. Check auth header
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  )

  try {
    // 4. Authenticate user
    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 5. Parse request body
    let body: ResignGameRequest
    try {
      body = await req.json()
    } catch (_err) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 6. Validate gameId
    const gameId = body.gameId?.trim()
    if (!gameId) {
      return new Response(JSON.stringify({ error: "gameId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(gameId)) {
      return new Response(JSON.stringify({ error: "Invalid gameId format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 7. Fetch game and user profile in parallel (optimization)
    const [gameResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("games")
        .select("id, white_player_id, black_player_id, status, result, started_at")
        .eq("id", gameId)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single()
    ])

    const { data: game, error: gameError } = gameResult
    const { data: resigningProfile } = profileResult

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 8. Verify user is a player
    const isWhitePlayer = user.id === game.white_player_id
    const isBlackPlayer = user.id === game.black_player_id

    if (!isWhitePlayer && !isBlackPlayer) {
      return new Response(JSON.stringify({ error: "Not a player in this game" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 9. Verify game is active
    if (game.status !== "waiting" && game.status !== "in_progress") {
      return new Response(JSON.stringify({ error: "Game already completed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 10. Determine colors and result
    const resigningColor = isWhitePlayer ? "white" : "black"
    const result = resigningColor === "white" ? "black_win" : "white_win"
    const opponentId = isWhitePlayer ? game.black_player_id : game.white_player_id

    // 11. Update game (atomic)
    const { data: updatedGame, error: updateError } = await supabaseAdmin
      .from("games")
      .update({
        status: "completed",
        result: result,
        winner_id: opponentId,
        termination_type: "resignation",
        started_at: game.started_at ?? new Date().toISOString()
        // Note: completed_at is set automatically by handle_game_completion() trigger
      })
      .eq("id", gameId)
      .eq("status", game.status) // Prevent race conditions
      .select("id, status, result, winner_id, termination_type")
      .single()

    if (updateError || !updatedGame) {
      // Check if it's a race condition (no rows updated) vs actual error
      if (!updatedGame && !updateError) {
        return new Response(JSON.stringify({
          error: "Game state changed. Please retry."
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ error: "Failed to resign game" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 12. Send notification to opponent (non-blocking)
    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert({
        recipient_id: opponentId,
        type: "game_resigned",
        payload: {
          gameId: gameId,
          resignedBy: resigningColor,
          resignedByUsername: resigningProfile?.username ?? null,
          result: result,
        },
      })

    if (notificationError) {
      console.error("resign-game: failed to send notification", notificationError)
      // Don't fail the request - notification is non-critical
    }

    // 13. Return success
    return new Response(
      JSON.stringify({
        success: true,
        game: {
          id: updatedGame.id,
          status: updatedGame.status,
          result: updatedGame.result,
          winnerId: updatedGame.winner_id,
          terminationType: updatedGame.termination_type,
          resignedBy: resigningColor,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    console.error("resign-game error:", error)
    return new Response(
      JSON.stringify({
        error: (error as { message?: string }).message ?? "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }
})
```

---

## 8. Dependencies

**External:**
- `https://deno.land/std@0.168.0/http/server.ts` - HTTP server
- `https://esm.sh/@supabase/supabase-js@2` - Supabase client

**Internal:**
- `profiles` table - For username lookups
- `games` table - For game state and updates
- `notifications` table - For opponent notifications
- `handle_game_completion()` trigger - For automatic ELO/stats updates

---

## 9. Security Considerations

1. **Authentication**: Required via JWT token
2. **Authorization**: Users can only resign games they're playing in
3. **Input Validation**: UUID format validation prevents SQL injection
4. **Race Conditions**: Atomic update with status check prevents double-processing
5. **Service Role Key**: Used to bypass RLS for game updates
6. **CORS**: Configured for browser access

---

## 10. Performance Considerations

1. **Database Queries**:
   - 2 SELECTs in parallel (game + profile fetch) - executed concurrently
   - 1 UPDATE (game update)
   - 1 INSERT (notification)
   - Total: 4 queries (2 parallel, 2 sequential)
   - Trigger adds: 2 SELECTs + 2 UPDATEs (ELO/stats)

2. **Expected Response Time**: 150-400ms (improved via parallel fetching)
3. **Indexing**: Existing indexes on `games(id)` and `profiles(id)` are sufficient
4. **Concurrency**: Atomic update handles concurrent resign attempts
5. **Optimization**: Parallel fetching reduces latency by ~50-100ms compared to sequential

---

## 11. Monitoring & Observability

**Metrics to Track:**
- Total resignations per day
- Resignations by game duration (early vs late game)
- Resignations by ELO bracket
- Failed resignation attempts and reasons
- Notification delivery success rate

**Logging:**
- Log all resignation events with gameId, user, and timestamp
- Log notification failures (console.error)
- Log any database update failures

**Alerts:**
- Alert on high error rate (>5% of requests)
- Alert on slow response times (>1s p95)

---

## 12. Future Enhancements

1. **Resignation Confirmation**: Add client-side confirmation dialog
2. **Resignation Stats**: Track resignation frequency per player
3. **Anti-Rage-Quit**: Penalize players who resign too early/frequently
4. **Undo Resignation**: Brief window to undo accidental resignation (5 seconds?)
5. **Resignation Reason**: Optional reason field (optional message)
6. **Game Analysis**: Link to post-game analysis after resignation

---

## 13. Related Documentation

- [Game Termination Overview](../GAME_TERMINATION.md)
- [Supabase Functions README](../../supabase/functions/README.md)
- [Database Schema](../../supabase/migrations/20240101000000_initial_schema.sql)
- [Notifications Schema](../../supabase/migrations/20240115000000_lobby_and_notifications.sql)

---

## Approval & Sign-off

**Design Review:** ✅ Completed (2025-10-15)
**Technical Review:** ✅ Approved
**Security Review:** ✅ Approved
**Ready for Implementation:** ✅ **APPROVED**

### Review Summary

All critical issues addressed:
- ✅ Added `started_at` field handling for resignations before first move
- ✅ Removed `completed_at` from manual update (handled by trigger)
- ✅ Clarified idempotency behavior (returns 409 on re-resignation)
- ✅ Improved race condition error messaging
- ✅ Optimized with parallel database fetches
- ✅ Simplified abandoned game handling

---

**Document Version:** 1.1
**Last Updated:** 2025-10-15
**Author:** Claude Code
**Reviewers:** Design Review Completed
