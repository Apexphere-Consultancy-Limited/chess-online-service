# Chess Online - PvP Architecture

> **Real-time Player vs Player multiplayer chess** with a phased approach from MVP to production scale.

---

## Architecture Evolution

This document outlines a **3-stage architecture** for building PvP chess:

1. **Stage 1: MVP (Supabase Only)** - Ship in 2-3 weeks, $0 cost, <50 concurrent games
2. **Stage 2: Performance (Add Redis)** - Scale to 500 concurrent games, add matchmaking
3. **Stage 3: Production (Add WebSocket Server)** - Handle 1000+ games, <20ms latency

**Start simple, add complexity only when needed.**

---

# Stage 1: MVP (Supabase Only)

## Overview

**Goal:** Launch working PvP chess in 2-3 weeks with minimal complexity.

**Tech Stack:**
- Frontend: React 19 + TypeScript + Vite
- Backend: Supabase (Postgres + Auth + Realtime + Edge Functions)
- Deployment: Vercel (frontend) + Supabase Cloud (backend)

**What You Get:**
- ✅ Player authentication (email/password, OAuth)
- ✅ Real-time PvP gameplay
- ✅ Server-side move validation
- ✅ Game history and replay
- ✅ ELO ratings and stats
- ✅ Shared lobby with online presence + open challenges
- ✅ Challenge by username with in-app notifications

**Limitations:**
- 100-200ms move latency (acceptable for casual chess)
- No auto-matchmaking queue (manual invites only)
- In-app notifications require both players to be online (no push/email yet)
- Supports <50 concurrent games

**Cost:** $0 (Supabase free tier)

---

## System Architecture

```
┌──────────────────────┐
│   React Frontend     │
│   (Vercel Deploy)    │
└──────────┬───────────┘
           │
           │ WebSocket (Supabase Realtime)
           │ HTTP (Edge Functions)
           │
           ▼
┌──────────────────────────────────┐
│      Supabase Cloud              │
│                                  │
│  ┌────────────┐  ┌────────────┐ │
│  │   Auth     │  │  Realtime  │ │
│  │   (JWT)    │  │ (WebSocket)│ │
│  └────────────┘  └──────┬─────┘ │
│                         │        │
│  ┌────────────┐  ┌──────▼─────┐ │
│  │   Edge     │  │  Postgres  │ │
│  │ Functions  │◄─┤  Database  │ │
│  │ (Validate) │  │            │ │
│  └────────────┘  └────────────┘ │
└──────────────────────────────────┘
```

---

## Data Model

### Database Schema (Postgres)

```sql
-- User profiles
profiles (
  id UUID PRIMARY KEY REFERENCES auth.users,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  elo_rating INTEGER DEFAULT 1200,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  games_drawn INTEGER DEFAULT 0,
  games_lost INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

-- Game sessions
games (
  id UUID PRIMARY KEY,
  white_player_id UUID REFERENCES profiles(id),
  black_player_id UUID REFERENCES profiles(id),
  status TEXT CHECK (status IN ('waiting', 'in_progress', 'completed', 'abandoned')),
  current_fen TEXT,  -- Current board position
  current_turn TEXT CHECK (current_turn IN ('white', 'black')),
  result TEXT CHECK (result IN ('white_win', 'black_win', 'draw', 'abandoned')),
  winner_id UUID REFERENCES profiles(id),
  termination_type TEXT,  -- checkmate, resignation, timeout, etc.
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)

-- Move history
moves (
  id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(id),
  player_id UUID REFERENCES profiles(id),
  move_number INTEGER,
  from_square TEXT,  -- e.g., 'e2'
  to_square TEXT,    -- e.g., 'e4'
  piece TEXT,        -- 'pawn', 'knight', etc.
  captured_piece TEXT,
  promotion TEXT,
  san_notation TEXT, -- Standard Algebraic Notation
  fen_after TEXT,    -- Board state after move
  created_at TIMESTAMPTZ
)

-- Lobby sessions (ephemeral presence)
lobby_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES profiles(id),
  status TEXT CHECK (status IN ('available', 'in_game')),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Direct challenges (pending invites)
challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id UUID REFERENCES profiles(id),
  challenged_id UUID REFERENCES profiles(id),
  status TEXT CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TIMESTAMPTZ,
  game_id UUID REFERENCES games(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

-- Notification feed (in-app toasts + unread counter)
notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID REFERENCES profiles(id),
  type TEXT CHECK (type IN ('challenge_received', 'challenge_accepted', 'challenge_declined', 'game_ready')),
  payload JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Indexes:**
- `games(status)` - Query active games
- `games(white_player_id, black_player_id)` - Player's games
- `moves(game_id, move_number)` - Replay games in order
- `lobby_sessions(player_id)` - Presence lookups
- `challenges(challenged_id, status)` - Pending invites per player
- `notifications(recipient_id, created_at)` - Unread feed ordering

---

## Lobby & Notification Flows

### Lobby Presence
```
Player opens /lobby
  ↓
Frontend → inserts/updates lobby_sessions (status='available')
  ↓
Supabase RLS ensures players manage only their row
  ↓
Supabase Realtime (channel: lobby) streams INSERT/UPDATE events
  ↓
Clients render online players + open challenges list
  ↓
Heartbeat: client PATCH last_seen every 20s (supabase.from('lobby_sessions').upsert)
  ↓
Edge Function cron cleans up rows with last_seen older than 60s
```

### Sending a Challenge
```
Player selects opponent in lobby
  ↓
POST /functions/v1/create-challenge
  - Validates players are distinct and available
  - Inserts challenges row (status='pending')
  - Inserts notifications row for challenged player
  ↓
Supabase Realtime broadcasts both table changes
  ↓
Challenged player sees toast + badge count increment
```

### Responding to a Challenge
```
Player taps Accept/Decline
  ↓
Edge Function: update challenges.status
  - On accept: create game record + set status='accepted'
  - Insert notification for challenger (accepted/declined)
  - Remove both players from lobby_sessions (status='in_game')
  ↓
Realtime broadcasts updates
  ↓
Clients route both players to /game/{gameId} when game_ready notification arrives
```

---

## Game Flow

### 1. Game Creation
```
Challenge accepted (manual invite via lobby)
         ↓
Edge Function creates game record + updates challenge status
         ↓
Notifications table adds `game_ready` entries for both players
         ↓
Frontend routes players to /game/{gameId}
         ↓
Both subscribe to Realtime channel
```

### 2. Playing Moves
```
Player A makes move
  ↓
Frontend → HTTP POST /functions/v1/validate-move
  ↓
Edge Function:
  - Authenticate player (JWT)
  - Fetch game state from Postgres
  - Validate: Is it player's turn?
  - Validate: Is move legal? (chess.js)
  - Update game state in Postgres
  - Insert move into moves table
  ↓
Postgres trigger → pg_notify()
  ↓
Supabase Realtime → Broadcasts to both players
  ↓
Player B receives move update via WebSocket
```

### 3. Game Completion
```
Move causes checkmate/stalemate/resignation
  ↓
Edge Function:
  - Update game status = 'completed'
  - Set result and winner
  - Calculate ELO changes
  - Update both players' profiles
  - Reset lobby_sessions.status to 'available'
  ↓
Both players see game over screen with new ratings
```

---

## Security

### Row Level Security (RLS)
- Players can only read their own games
- Players can only read moves from their games
- Players can only upsert/delete their lobby_sessions row
- Only challenger/challenged can see a challenge invite
- Notifications restricted to recipient_id
- All writes go through Edge Functions (service role)

### Move Validation
- All validation server-side (Edge Functions)
- Client validation for UX only (instant feedback)
- chess.js validates move legality
- Turn enforcement prevents out-of-turn moves

### Rate Limiting
- Supabase built-in rate limits (100 requests/second)
- Additional rate limiting in Edge Functions if needed

---

## Key Features

**Authentication:**
- Email/password signup
- Google OAuth (optional)
- Magic link login (optional)
- Profile creation with username and ELO rating

**Lobby & Notifications:**
- Real-time lobby presence (online/playing)
- Open challenge list with accept/decline actions
- In-app notification center + toast alerts
- Optional browser notification prompt (progressive enhancement)

**PvP Gameplay:**
- Launch games from accepted challenges
- Real-time move synchronization
- Optimistic updates (show move immediately)
- Server validates and broadcasts
- Automatic game state persistence

**Game History:**
- View all past games
- Replay games move-by-move
- Track win/loss/draw record
- ELO rating progression

**User Interface:**
- Drag-and-drop chess pieces
- Move history panel
- Captured pieces display
- Player cards (name, rating, clock)
- Game over modal with results

---

## Frontend Routes

- `/` - Home/landing page
- `/login` - Authentication
- `/profile` - User profile and stats
- `/lobby` - Online players, open challenges, notifications
- `/game/:gameId` - Live PvP game
- `/history` - Past games list
- `/replay/:gameId` - Replay a game

---

## Stage 1 Development Checklist

**Week 1: Setup & Core**
- [ ] Create Supabase project
- [ ] Set up database schema (tables, indexes, RLS)
- [ ] Create Edge Function: validate-move
- [ ] Implement chess.js move validation
- [ ] Set up React project with routing

**Week 2: PvP Gameplay & Lobby**
- [ ] Build ChessBoard component
- [ ] Implement drag-and-drop moves
- [ ] Supabase Realtime integration
- [ ] Game creation flow
- [ ] Move synchronization between players
- [ ] Lobby page (online players, open challenges)
- [ ] lobby_sessions upsert + 60s cleanup

**Week 3: Features & Polish**
- [ ] Game history page
- [ ] Replay functionality
- [ ] ELO rating calculation
- [ ] Profile page with stats
- [ ] Game over modal
- [ ] Basic styling and UX
- [ ] Challenge invitation Edge Functions (create/accept/decline)
- [ ] Notifications center + toasts

---

# Stage 2: Performance & Matchmaking

**When to upgrade:** 50+ concurrent games, users want auto-matchmaking

## What Changes

**Add Redis (Upstash) for:**
- Active game state caching (reduce Postgres queries)
- Matchmaking queue (sorted by ELO)
- Live presence tracking (who's online)
- Rate limiting (per-player move throttling)

**New Features:**
- Auto-matchmaking queue layered on lobby sessions
- Skill-based pairing (±100 ELO)
- Live player/presence counts sourced from Redis TTL keys
- Faster move validation (50-100ms vs 100-200ms)
- Optional email/push notifications via Edge Functions scheduler

**Tech Stack:** Supabase + Upstash Redis

**Cost:** Still $0 (both have generous free tiers)

---

## System Architecture

```
┌──────────────────────┐
│   React Frontend     │
└──────────┬───────────┘
           │
           │ WebSocket + HTTP
           ▼
┌──────────────────────────────────┐
│      Supabase Cloud              │
│  ┌────────────┐  ┌────────────┐ │
│  │   Auth     │  │  Realtime  │ │
│  └────────────┘  └────────────┘ │
│         │                 │      │
│  ┌──────▼─────┐    ┌─────▼────┐ │
│  │   Edge     │◄───┤ Postgres │ │
│  │ Functions  │    │          │ │
│  └──────┬─────┘    └──────────┘ │
└─────────┼──────────────────────┘
          │
          ▼
┌──────────────────────┐
│   Upstash Redis      │
│   (Serverless)       │
│                      │
│  - Game state cache  │
│  - Matchmaking queue │
│  - Presence tracking │
│  - Rate limiting     │
└──────────────────────┘
```

---

## Redis Data Structures

```
# Active game cache (HASH)
game:{gameId} {
  white_player_id, black_player_id,
  current_fen, current_turn,
  white_time, black_time,
  move_count, status
}
TTL: 24 hours

# Matchmaking queue (SORTED SET by ELO)
matchmaking:queue:blitz → {playerId: eloRating}

# Player presence (STRING)
presence:{playerId} → "online"
TTL: 30 seconds (heartbeat refresh)

# Rate limiting (STRING counter)
ratelimit:moves:{playerId} → count
TTL: 1 second

# Notification fan-out (STREAM)
notifications:stream:{playerId}
```

---

## New Features

### Matchmaking Flow
```
Player clicks "Find Match"
  ↓
Add to Redis queue (ZADD by ELO rating)
  ↓
Background worker (Edge Function cron):
  - Every 2 seconds, scan queue
  - Find pairs with closest ELO (±100)
  - Create game in Postgres
  - Initialize game state in Redis
  - Remove players from queue
  - Notify both players
  ↓
Players navigate to /game/{gameId}
```

### Move Validation (Optimized)
```
Player makes move
  ↓
Edge Function:
  - Check rate limit (Redis INCR)
  - Fetch game state from Redis (fast!)
  - Validate move (chess.js)
  - Update Redis cache
  - Update Postgres (async)
  - Broadcast via Realtime
```

**Latency improvement:** 100-200ms → 50-100ms

---

## Stage 2 Development Checklist

**Setup:**
- [ ] Create Upstash Redis account
- [ ] Connect Redis to Edge Functions
- [ ] Define Redis key schema

**Matchmaking:**
- [ ] Implement queue join/leave Edge Functions
- [ ] Surface queue state in lobby UI (position, ETA)
- [ ] Create matchmaking worker (cron)
- [ ] Pairing algorithm (ELO-based)
- [ ] Broadcast match-found notifications

**Performance:**
- [ ] Cache game state in Redis
- [ ] Redis-first move validation
- [ ] Async Postgres writes
- [ ] Presence tracking via Redis heartbeat

**Notifications:**
- [ ] Write notifications to Redis Streams for fan-out
- [ ] Trigger email/push (Supabase functions + third-party)
- [ ] Sync unread counts back to Postgres nightly

---

# Stage 3: Production Scale

**When to upgrade:** 500+ concurrent games, users complain about latency

## What Changes

**Add Long-Running WebSocket Server (Railway/Render) for:**
- Direct WebSocket connections (no Edge Function cold starts)
- Ultra-fast move delivery via Redis Pub/Sub (<20ms)
- Advanced presence tracking (heartbeat system)
- Time controls with millisecond precision

**New Features:**
- Spectator mode (watch live games)
- In-game chat
- Tournaments
- Advanced analytics
- Cross-device notifications (push/email/webhook fan-out)

**Tech Stack:** Supabase + Redis + Node.js WebSocket Server

**Cost:** ~$5-10/month (Railway server)

---

## System Architecture

```
┌──────────────────────┐
│   React Frontend     │
└──────────┬───────────┘
           │
           │ WebSocket (direct to game server)
           ▼
┌──────────────────────────────┐
│   Node.js WebSocket Server   │
│   (Railway Deploy)            │
│                               │
│   - JWT verification          │
│   - Move validation           │
│   - Redis Pub/Sub             │
│   - Presence tracking         │
└──────────┬───────────────────┘
           │
           ├─────────────┬──────────────┐
           ▼             ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │  Redis   │  │ Supabase │  │ Postgres │
    │ Pub/Sub  │  │  Auth    │  │ (async)  │
    └──────────┘  └──────────┘  └──────────┘
```

---

## Key Improvements

**Ultra-Low Latency:**
- Move delivery: <20ms (Redis Pub/Sub)
- No cold starts (always-warm server)
- WebSocket connection pooling

**Advanced Features:**
- Redis Streams for reconnection (replay missed moves)
- Live spectators (subscribe to Pub/Sub)
- In-game chat (Redis Streams)
- Tournament brackets
- Multi-channel notifications (push/email/webhooks)

**Scalability:**
- Horizontal scaling (multiple server instances)
- Redis cluster for distributed state
- Load balancer for WebSocket connections

---

## Stage 3 Development Checklist

**Server Setup:**
- [ ] Deploy Node.js server to Railway
- [ ] Implement JWT verification (Supabase)
- [ ] WebSocket connection handling
- [ ] Redis Pub/Sub integration

**Features:**
- [ ] Redis Streams for reconnection
- [ ] Spectator mode
- [ ] In-game chat
- [ ] Tournament system
- [ ] Advanced analytics

---

# Decision Matrix: When to Upgrade

| Metric | Stage 1 | Stage 2 | Stage 3 |
|--------|---------|---------|---------|
| **Concurrent games** | <50 | 50-500 | 500+ |
| **Move latency** | 100-200ms | 50-100ms | 20-50ms |
| **Monthly cost** | $0 | $0 | $5-10 |
| **Setup complexity** | Low | Medium | High |
| **Development time** | 2-3 weeks | +1-2 weeks | +2-3 weeks |
| **Features** | Basic PvP | Auto-match | Spectators |

**Rule of thumb:**
- Launch with Stage 1
- Upgrade to Stage 2 when you have consistent users
- Upgrade to Stage 3 only if latency becomes a problem

---

# Technical Details

## Authentication (All Stages)

**Supabase Auth provides:**
- JWT-based sessions (1 hour expiry)
- Email/password authentication
- OAuth providers (Google, GitHub, etc.)
- Magic link (passwordless)
- Row Level Security (RLS) integration

**Frontend flow:**
```typescript
// Sign up
const { user, error } = await supabase.auth.signUp({
  email, password,
  options: { data: { username } }
})

// Sign in
const { user, error } = await supabase.auth.signInWithPassword({
  email, password
})

// Get session
const { data: { session } } = await supabase.auth.getSession()
```

---

## Move Validation (All Stages)

**Server-side validation with chess.js:**
```typescript
// In Edge Function
import { Chess } from 'chess.js'

const chess = new Chess(game.current_fen)
const move = chess.move({ from, to, promotion })

if (!move) {
  return error('Illegal move')
}

// Check game ending
if (chess.isCheckmate()) {
  // Determine winner
}
if (chess.isStalemate() || chess.isDraw()) {
  // Game is draw
}
```

**Turn enforcement:**
- Verify `userId === white_player_id` or `black_player_id`
- Check `game.current_turn` matches player's color
- Reject move if not player's turn

---

## Real-time Communication

**Stage 1:** Supabase Realtime (Postgres Changes + Broadcast)
```typescript
// Moves channel
supabase.channel(`game:${gameId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'moves',
    filter: `game_id=eq.${gameId}`,
  }, handleMove)
  .subscribe()

// Lobby presence + challenges
supabase.channel('lobby')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'lobby_sessions',
  }, handlePresence)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'challenges',
  }, handleChallenge)
  .subscribe()

// Notification feed
supabase.channel(`notifications:${userId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `recipient_id=eq.${userId}`,
  }, handleNotification)
  .subscribe()
```

**Stage 2:** Supabase Realtime for DB sync + Redis Pub/Sub for lobby/matchmaking
```typescript
// Worker pairs players, publishes to Redis, then notifies Supabase
await redis.zrem('matchmaking:queue', playerA, playerB)
await redis.set(`game:${gameId}`, JSON.stringify(gameState), { EX: 86400 })

const payload = { type: 'match-found', gameId, players: [playerA, playerB] }
await supabase.channel('lobby').send({
  type: 'broadcast',
  event: 'match_found',
  payload,
})
```

**Stage 3:** Direct WebSocket
```typescript
const ws = new WebSocket('wss://game-server.railway.app')
ws.send(JSON.stringify({ type: 'move', from, to }))
ws.onmessage = (event) => {
  const move = JSON.parse(event.data)
  // Update board
}
```

---

## ELO Rating Calculation

**Standard Elo formula:**
```typescript
function calculateEloChange(
  playerRating: number,
  opponentRating: number,
  result: number  // 1 = win, 0.5 = draw, 0 = loss
): number {
  const K = 32  // K-factor
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400))
  return Math.round(K * (result - expectedScore))
}

// Example:
// Player (1450) beats Opponent (1500)
// Change: +18 points
```

**Applied on game completion** in Edge Function

---

# Summary & Next Steps

## Start Here: Stage 1 MVP

**Goal:** Launch in 2-3 weeks

**Steps:**
1. Set up Supabase project
2. Create database schema (copy from above)
3. Implement Edge Function for move validation
4. Build React frontend with Realtime
5. Deploy and test with friends

**What you'll have:**
- Working PvP chess game
- Real-time moves
- Game history
- ELO ratings
- Shared lobby with in-app challenge notifications
- $0 cost

**What you won't have:**
- Auto-matchmaking (manual challenge only)
- Blazing fast latency (100-200ms is fine)
- Spectator mode
- Offline/email/push notifications

## Upgrade Later

**Only upgrade when:**
- You have real users playing regularly
- You hit scale/performance limits
- Users request specific features (matchmaking, tournaments)

**Don't over-engineer!** Stage 1 is sufficient for 90% of chess apps.

---

# Additional Resources

**Supabase Docs:**
- [Database Design](https://supabase.com/docs/guides/database)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Edge Functions](https://supabase.com/docs/guides/functions)
- [Realtime](https://supabase.com/docs/guides/realtime)

**Chess.js:**
- [Documentation](https://github.com/jhlywa/chess.js)
- [Move Validation](https://github.com/jhlywa/chess.js#movemove)

**React Chess Libraries:**
- [react-chessboard](https://www.npmjs.com/package/react-chessboard)
- [chessboardjsx](https://www.npmjs.com/package/chessboardjsx)
