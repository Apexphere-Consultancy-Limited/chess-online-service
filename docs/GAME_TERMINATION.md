# Game Termination

This document explains how online chess games end in the Chess Online Service.

## Overview

Games can end through various mechanisms, both automatic (detected during move validation) and manual (player actions). When a game ends, the system automatically updates player statistics and ELO ratings.

## Automatic Termination

### 1. Checkmate

When a player delivers checkmate, the game automatically ends.

**Implemented in:** [validate-move/index.ts:116-120](../supabase/functions/validate-move/index.ts#L116-L120)

**Game Updates:**
- `status`: `completed`
- `result`: `white_win` or `black_win` (winner is the player who made the move)
- `winner_id`: Player ID of the winner
- `termination_type`: `checkmate`

**Example:**
```json
{
  "success": true,
  "move": {
    "from": "f7",
    "to": "e8",
    "san": "Qe8#",
    "fen": "r1bqR1kr/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQ - 0 6"
  },
  "gameStatus": "completed",
  "result": "white_win"
}
```

### 2. Stalemate

When a player has no legal moves but is not in check, the game ends in a draw.

**Implemented in:** [validate-move/index.ts:121-124](../supabase/functions/validate-move/index.ts#L121-L124)

**Game Updates:**
- `status`: `completed`
- `result`: `draw`
- `winner_id`: `null`
- `termination_type`: `stalemate`

### 3. Draw by Insufficient Material

When neither player has sufficient material to deliver checkmate (e.g., King vs King, King + Bishop vs King), the game ends in a draw.

**Implemented in:** [validate-move/index.ts:125-129](../supabase/functions/validate-move/index.ts#L125-L129)

**Game Updates:**
- `status`: `completed`
- `result`: `draw`
- `winner_id`: `null`
- `termination_type`: `insufficient_material`

## Manual Termination (Not Yet Implemented)

The database schema supports these termination types, but Edge Functions need to be created:

### 4. Resignation

A player can resign from the game, immediately ending it and awarding the win to their opponent.

**Database Support:** Yes (schema includes `resignation` termination type)
**Edge Function:** ⚠️ **NEEDS IMPLEMENTATION**

**Suggested Implementation:**
```typescript
// POST /functions/v1/resign-game
{
  "gameId": "uuid"
}
```

**Expected Updates:**
- `status`: `completed`
- `result`: `white_win` or `black_win` (opposite of resigning player)
- `winner_id`: Opponent's player ID
- `termination_type`: `resignation`

### 5. Timeout

If a player exceeds their time limit, they lose the game.

**Database Support:** Yes (schema includes `timeout` termination type)
**Edge Function:** ⚠️ **NEEDS IMPLEMENTATION**

**Implementation Notes:**
- Requires time control system (not yet implemented)
- Needs background job or client-side timer to detect timeouts
- Should handle grace periods and disconnection scenarios

**Expected Updates:**
- `status`: `completed`
- `result`: `white_win` or `black_win` (opposite of player who timed out)
- `winner_id`: Opponent's player ID
- `termination_type`: `timeout`

### 6. Draw Agreement

Both players can agree to a draw at any point during the game.

**Database Support:** Yes (schema includes `draw_agreement` termination type)
**Edge Function:** ⚠️ **NEEDS IMPLEMENTATION**

**Suggested Implementation:**
```typescript
// POST /functions/v1/offer-draw
{
  "gameId": "uuid"
}

// POST /functions/v1/respond-to-draw-offer
{
  "gameId": "uuid",
  "accept": true
}
```

**Expected Updates:**
- `status`: `completed`
- `result`: `draw`
- `winner_id`: `null`
- `termination_type`: `draw_agreement`

### 7. Abandonment

Games can be marked as abandoned if a player disconnects for an extended period.

**Database Support:** Yes (status can be `abandoned`, result can be `abandoned`)
**Edge Function:** ⚠️ **NEEDS IMPLEMENTATION**

**Implementation Notes:**
- Abandoned games do NOT affect ELO ratings (see [schema:239-240](../supabase/migrations/20240101000000_initial_schema.sql#L239-L240))
- Requires background job to detect inactive games
- Should have reasonable timeout period (e.g., 5-10 minutes of inactivity)

**Expected Updates:**
- `status`: `abandoned`
- `result`: `abandoned`
- `winner_id`: `null`
- `termination_type`: `null`

## Automatic Side Effects

When a game transitions to `completed` status, the database trigger `handle_game_completion()` automatically executes:

**Source:** [schema:211-276](../supabase/migrations/20240101000000_initial_schema.sql#L211-L276)

### ELO Rating Updates

Both players' ELO ratings are adjusted based on:
- Current ratings of both players
- Game result (win = 1.0, draw = 0.5, loss = 0.0)
- K-factor of 32

**Formula:**
```
New Rating = Old Rating + K × (Actual Score - Expected Score)

Expected Score = 1 / (1 + 10^((Opponent Rating - Player Rating) / 400))
```

### Player Statistics Updates

For each player:
- `games_played` increments by 1
- `games_won`, `games_drawn`, or `games_lost` increments by 1
- `elo_rating` adjusted by calculated change
- `updated_at` set to current timestamp

### Game Timestamp

- `completed_at` set to current timestamp

**Note:** Abandoned games do NOT trigger ELO or statistics updates.

## Database Schema

### Games Table Constraints

**Status Values:**
```sql
status TEXT CHECK (status IN ('waiting', 'in_progress', 'completed', 'abandoned'))
```

**Result Values:**
```sql
result TEXT CHECK (result IN ('white_win', 'black_win', 'draw', 'abandoned'))
```

**Termination Type Values:**
```sql
termination_type TEXT CHECK (termination_type IN (
  'checkmate',
  'resignation',
  'timeout',
  'draw_agreement',
  'stalemate',
  'insufficient_material'
))
```

**Source:** [schema:28-41](../supabase/migrations/20240101000000_initial_schema.sql#L28-L41)

## Implementation Status

| Termination Type | Database Support | Edge Function | Auto-Detection |
|-----------------|------------------|---------------|----------------|
| Checkmate | ✅ Yes | ✅ Yes | ✅ Yes |
| Stalemate | ✅ Yes | ✅ Yes | ✅ Yes |
| Insufficient Material | ✅ Yes | ✅ Yes | ✅ Yes |
| Resignation | ✅ Yes | ⚠️ **TODO** | N/A |
| Timeout | ✅ Yes | ⚠️ **TODO** | ⚠️ **TODO** |
| Draw Agreement | ✅ Yes | ⚠️ **TODO** | N/A |
| Abandonment | ✅ Yes | ⚠️ **TODO** | ⚠️ **TODO** |

## API Reference

### Current Implementation

**validate-move**
- **Purpose:** Validate and execute moves, automatically detecting game-ending conditions
- **Documentation:** [validate-move/API.md](../supabase/functions/validate-move/API.md)
- **Endpoint:** `POST /functions/v1/validate-move`

### Needed Implementations

The following Edge Functions should be created:

1. **resign-game** - Allow players to resign
2. **offer-draw** - Allow players to offer draws
3. **respond-to-draw-offer** - Accept or decline draw offers
4. **timeout-game** - Mark games as timed out (could be cron job)
5. **abandon-game** - Mark games as abandoned (could be cron job)

## Testing Scenarios

### Automated Tests Should Cover:

1. **Checkmate Detection:**
   - Scholar's mate (4 moves)
   - Fool's mate (2 moves)
   - Back rank mate
   - Smothered mate

2. **Stalemate Detection:**
   - Basic king vs king scenarios
   - Accidental stalemates

3. **Draw Detection:**
   - King vs King
   - King + Bishop vs King
   - King + Knight vs King

4. **ELO Calculations:**
   - Equal rated players
   - Higher rated player wins/loses
   - Draw scenarios

5. **Statistics Updates:**
   - Verify counters increment correctly
   - Verify abandoned games don't affect stats

## Related Documentation

- [Supabase Functions README](../supabase/functions/README.md)
- [Initial Schema Migration](../supabase/migrations/20240101000000_initial_schema.sql)
- [validate-move API](../supabase/functions/validate-move/API.md)
