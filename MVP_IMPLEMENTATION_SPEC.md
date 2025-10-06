# MVP Implementation Specification (Stage 1)

This document provides concrete implementation details for **Stage 1: Supabase-only MVP**.

> **Reference:** See [ARCHITECTURE.md](ARCHITECTURE.md) for the overall architecture and stages.

---

## Table of Contents

1. [Backend Setup (Supabase)](#backend-setup-supabase)
2. [Frontend Setup (React)](#frontend-setup-react)
3. [Integration](#integration)
4. [Testing](#testing)

---

# Backend Setup (Supabase)

## 1. Project Setup

### Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose organization and region
4. Set database password (save this!)
5. Wait for project initialization

### Get API Credentials

From Supabase Dashboard → Settings → API:
- `SUPABASE_URL` (e.g., `https://xxxxx.supabase.co`)
- `SUPABASE_ANON_KEY` (public key for client)
- `SUPABASE_SERVICE_ROLE_KEY` (secret key for Edge Functions)

---

## 2. Database Schema

### SQL Setup

Go to Supabase Dashboard → SQL Editor → New Query

```sql
-- =====================================================
-- 1. Enable UUID Extension
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 2. Profiles Table
-- =====================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  elo_rating INTEGER DEFAULT 1200,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  games_drawn INTEGER DEFAULT 0,
  games_lost INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for username lookups
CREATE INDEX idx_profiles_username ON profiles(username);

-- =====================================================
-- 3. Games Table
-- =====================================================
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  white_player_id UUID REFERENCES profiles(id) NOT NULL,
  black_player_id UUID REFERENCES profiles(id) NOT NULL,
  status TEXT CHECK (status IN ('waiting', 'in_progress', 'completed', 'abandoned')) DEFAULT 'waiting',
  current_fen TEXT DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  current_turn TEXT CHECK (current_turn IN ('white', 'black')) DEFAULT 'white',
  result TEXT CHECK (result IN ('white_win', 'black_win', 'draw', 'abandoned')),
  winner_id UUID REFERENCES profiles(id),
  termination_type TEXT CHECK (termination_type IN ('checkmate', 'resignation', 'timeout', 'draw_agreement', 'stalemate', 'insufficient_material')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for queries
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_white_player ON games(white_player_id);
CREATE INDEX idx_games_black_player ON games(black_player_id);
CREATE INDEX idx_games_completed ON games(completed_at DESC) WHERE status = 'completed';

-- =====================================================
-- 4. Moves Table
-- =====================================================
CREATE TABLE moves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES profiles(id) NOT NULL,
  move_number INTEGER NOT NULL,
  from_square TEXT NOT NULL,
  to_square TEXT NOT NULL,
  piece TEXT NOT NULL,
  captured_piece TEXT,
  promotion TEXT,
  san_notation TEXT,
  fen_after TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for move queries
CREATE INDEX idx_moves_game_id ON moves(game_id);
CREATE INDEX idx_moves_game_number ON moves(game_id, move_number);
CREATE UNIQUE INDEX idx_moves_unique ON moves(game_id, move_number);
```

---

## 3. Row Level Security (RLS)

```sql
-- =====================================================
-- Enable RLS
-- =====================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Profiles Policies
-- =====================================================

-- Anyone can view profiles (for finding opponents)
CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Users can insert their own profile (on signup)
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- =====================================================
-- Games Policies
-- =====================================================

-- Players can view games they're part of
CREATE POLICY "Players can view their games"
  ON games FOR SELECT
  USING (
    auth.uid() = white_player_id OR
    auth.uid() = black_player_id
  );

-- Players can create games (for challenge feature)
CREATE POLICY "Players can create games"
  ON games FOR INSERT
  WITH CHECK (
    auth.uid() = white_player_id OR
    auth.uid() = black_player_id
  );

-- Note: Game updates (moves) are handled by Edge Functions with service role

-- =====================================================
-- Moves Policies
-- =====================================================

-- Players can view moves from their games
CREATE POLICY "Players can view moves from their games"
  ON moves FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM games
      WHERE games.id = moves.game_id
      AND (games.white_player_id = auth.uid() OR games.black_player_id = auth.uid())
    )
  );

-- Note: Move inserts handled by Edge Functions with service role
```

---

## 4. Database Triggers

### Trigger for Profile Creation

```sql
-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### Trigger for Realtime Notifications

```sql
-- Notify clients when a move is inserted
CREATE OR REPLACE FUNCTION public.notify_move_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'game_moves',
    json_build_object(
      'game_id', NEW.game_id,
      'move_number', NEW.move_number,
      'from_square', NEW.from_square,
      'to_square', NEW.to_square,
      'san_notation', NEW.san_notation,
      'fen_after', NEW.fen_after,
      'player_id', NEW.player_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_move_insert
  AFTER INSERT ON moves
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_move_insert();
```

---

## 5. Edge Functions

### Setup Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Create functions directory structure
mkdir -p supabase/functions
```

### Edge Function: validate-move

**File:** `supabase/functions/validate-move/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Chess } from 'https://esm.sh/chess.js@1.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MoveRequest {
  gameId: string
  from: string
  to: string
  promotion?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Parse request
    const { gameId, from, to, promotion }: MoveRequest = await req.json()

    // 2. Authenticate user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Fetch game state
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single()

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: 'Game not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Verify player and turn
    const isWhitePlayer = user.id === game.white_player_id
    const isBlackPlayer = user.id === game.black_player_id

    if (!isWhitePlayer && !isBlackPlayer) {
      return new Response(JSON.stringify({ error: 'Not a player in this game' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const playerColor = isWhitePlayer ? 'white' : 'black'
    if (game.current_turn !== playerColor) {
      return new Response(JSON.stringify({ error: 'Not your turn' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (game.status !== 'in_progress' && game.status !== 'waiting') {
      return new Response(JSON.stringify({ error: 'Game is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 5. Validate move with chess.js
    const chess = new Chess(game.current_fen)
    const move = chess.move({ from, to, promotion })

    if (!move) {
      return new Response(JSON.stringify({ error: 'Illegal move' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 6. Determine game status
    let status = 'in_progress'
    let result = null
    let winnerId = null
    let terminationType = null

    if (chess.isCheckmate()) {
      status = 'completed'
      result = playerColor === 'white' ? 'white_win' : 'black_win'
      winnerId = user.id
      terminationType = 'checkmate'
    } else if (chess.isStalemate()) {
      status = 'completed'
      result = 'draw'
      terminationType = 'stalemate'
    } else if (chess.isDraw()) {
      status = 'completed'
      result = 'draw'
      terminationType = 'insufficient_material'
    }

    // 7. Get move number
    const { count } = await supabase
      .from('moves')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', gameId)

    const moveNumber = (count ?? 0) + 1

    // 8. Update game state
    const { error: updateError } = await supabase
      .from('games')
      .update({
        current_fen: chess.fen(),
        current_turn: chess.turn() === 'w' ? 'white' : 'black',
        status,
        result,
        winner_id: winnerId,
        termination_type: terminationType,
        started_at: game.started_at ?? new Date().toISOString(),
        completed_at: status === 'completed' ? new Date().toISOString() : null
      })
      .eq('id', gameId)

    if (updateError) {
      throw new Error('Failed to update game: ' + updateError.message)
    }

    // 9. Insert move
    const { error: moveError } = await supabase
      .from('moves')
      .insert({
        game_id: gameId,
        player_id: user.id,
        move_number: moveNumber,
        from_square: from,
        to_square: to,
        piece: move.piece,
        captured_piece: move.captured,
        promotion: promotion,
        san_notation: move.san,
        fen_after: chess.fen()
      })

    if (moveError) {
      throw new Error('Failed to insert move: ' + moveError.message)
    }

    // 10. If game completed, update player stats
    if (status === 'completed') {
      await updatePlayerStats(supabase, game, result!, winnerId)
    }

    // 11. Return success
    return new Response(JSON.stringify({
      success: true,
      move: {
        from,
        to,
        san: move.san,
        fen: chess.fen()
      },
      gameStatus: status,
      result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in validate-move:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Helper function to update player stats
async function updatePlayerStats(
  supabase: any,
  game: any,
  result: string,
  winnerId: string | null
) {
  const whitePlayerId = game.white_player_id
  const blackPlayerId = game.black_player_id

  // Fetch current ratings
  const { data: players } = await supabase
    .from('profiles')
    .select('id, elo_rating')
    .in('id', [whitePlayerId, blackPlayerId])

  const whitePlayer = players.find((p: any) => p.id === whitePlayerId)
  const blackPlayer = players.find((p: any) => p.id === blackPlayerId)

  // Calculate ELO changes
  const whiteResult = result === 'white_win' ? 1 : result === 'draw' ? 0.5 : 0
  const blackResult = result === 'black_win' ? 1 : result === 'draw' ? 0.5 : 0

  const whiteEloChange = calculateEloChange(
    whitePlayer.elo_rating,
    blackPlayer.elo_rating,
    whiteResult
  )
  const blackEloChange = calculateEloChange(
    blackPlayer.elo_rating,
    whitePlayer.elo_rating,
    blackResult
  )

  // Update white player
  await supabase.rpc('increment_player_stats', {
    p_player_id: whitePlayerId,
    p_elo_change: whiteEloChange,
    p_won: result === 'white_win' ? 1 : 0,
    p_drawn: result === 'draw' ? 1 : 0,
    p_lost: result === 'black_win' ? 1 : 0
  })

  // Update black player
  await supabase.rpc('increment_player_stats', {
    p_player_id: blackPlayerId,
    p_elo_change: blackEloChange,
    p_won: result === 'black_win' ? 1 : 0,
    p_drawn: result === 'draw' ? 1 : 0,
    p_lost: result === 'white_win' ? 1 : 0
  })
}

function calculateEloChange(
  playerRating: number,
  opponentRating: number,
  result: number
): number {
  const K = 32
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400))
  return Math.round(K * (result - expectedScore))
}
```

### Create Stats Update Function (SQL)

```sql
-- Function to increment player stats atomically
CREATE OR REPLACE FUNCTION increment_player_stats(
  p_player_id UUID,
  p_elo_change INTEGER,
  p_won INTEGER,
  p_drawn INTEGER,
  p_lost INTEGER
)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET
    elo_rating = elo_rating + p_elo_change,
    games_played = games_played + 1,
    games_won = games_won + p_won,
    games_drawn = games_drawn + p_drawn,
    games_lost = games_lost + p_lost,
    updated_at = NOW()
  WHERE id = p_player_id;
END;
$$ LANGUAGE plpgsql;
```

### Edge Function: create-game

**File:** `supabase/functions/create-game/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateGameRequest {
  opponentUsername: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { opponentUsername }: CreateGameRequest = await req.json()

    // Authenticate
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Find opponent by username
    const { data: opponent, error: opponentError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', opponentUsername)
      .single()

    if (opponentError || !opponent) {
      return new Response(JSON.stringify({ error: 'Opponent not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Randomly assign colors
    const isCreatorWhite = Math.random() > 0.5

    // Create game
    const { data: game, error: gameError } = await supabase
      .from('games')
      .insert({
        white_player_id: isCreatorWhite ? user.id : opponent.id,
        black_player_id: isCreatorWhite ? opponent.id : user.id,
        status: 'waiting'
      })
      .select()
      .single()

    if (gameError) {
      throw new Error('Failed to create game: ' + gameError.message)
    }

    return new Response(JSON.stringify({
      success: true,
      game: {
        id: game.id,
        yourColor: isCreatorWhite ? 'white' : 'black'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in create-game:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
```

### Deploy Edge Functions

```bash
# Deploy validate-move function
supabase functions deploy validate-move

# Deploy create-game function
supabase functions deploy create-game
```

---

## Backend Checklist

- [x] Create Supabase project
- [x] Run database schema SQL
- [x] Set up RLS policies
- [x] Create database triggers
- [x] Create Edge Function: validate-move
- [x] Create Edge Function: create-game
- [x] Deploy Edge Functions
- [x] Test Edge Functions (18 comprehensive tests passing)

---

# Frontend Setup (React)

## 1. Project Setup

### Create React Project

```bash
# Create Vite + React + TypeScript project
npm create vite@latest chess-online -- --template react-ts
cd chess-online
npm install

# Install dependencies
npm install @supabase/supabase-js
npm install react-router-dom
npm install chess.js
npm install react-chessboard
```

### Environment Variables

Create `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## 2. Supabase Client Setup

**File:** `src/lib/supabaseClient.ts`

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Profile = {
  id: string
  username: string
  avatar_url?: string
  elo_rating: number
  games_played: number
  games_won: number
  games_drawn: number
  games_lost: number
  created_at: string
  updated_at: string
}

export type Game = {
  id: string
  white_player_id: string
  black_player_id: string
  status: 'waiting' | 'in_progress' | 'completed' | 'abandoned'
  current_fen: string
  current_turn: 'white' | 'black'
  result?: 'white_win' | 'black_win' | 'draw' | 'abandoned'
  winner_id?: string
  termination_type?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export type Move = {
  id: string
  game_id: string
  player_id: string
  move_number: number
  from_square: string
  to_square: string
  piece: string
  captured_piece?: string
  promotion?: string
  san_notation: string
  fen_after: string
  created_at: string
}
```

---

## 3. Authentication

### Auth Context

**File:** `src/context/AuthContext.tsx`

```typescript
import { createContext, useContext, useEffect, useState } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

type AuthContextType = {
  session: Session | null
  user: User | null
  loading: boolean
  signUp: (email: string, password: string, username: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, username: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    })
    if (error) throw error
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signUp,
        signIn,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
```

---

## 4. Game Hooks

### useGameRealtime Hook

**File:** `src/hooks/useGameRealtime.ts`

```typescript
import { useEffect } from 'react'
import { supabase, Move } from '../lib/supabaseClient'

export function useGameRealtime(
  gameId: string,
  onMove: (move: Move) => void
) {
  useEffect(() => {
    // Subscribe to move inserts via Postgres Changes
    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'moves',
          filter: `game_id=eq.${gameId}`
        },
        (payload) => {
          console.log('New move received:', payload.new)
          onMove(payload.new as Move)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, onMove])
}
```

### useMakeMove Hook

**File:** `src/hooks/useMakeMove.ts`

```typescript
import { supabase } from '../lib/supabaseClient'

export async function makeMove(
  gameId: string,
  from: string,
  to: string,
  promotion?: string
) {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    throw new Error('Not authenticated')
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  const response = await fetch(
    `${supabaseUrl}/functions/v1/validate-move`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ gameId, from, to, promotion })
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to make move')
  }

  return response.json()
}
```

### useCreateGame Hook

**File:** `src/hooks/useCreateGame.ts`

```typescript
import { supabase } from '../lib/supabaseClient'

export async function createGame(opponentUsername: string) {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    throw new Error('Not authenticated')
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  const response = await fetch(
    `${supabaseUrl}/functions/v1/create-game`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ opponentUsername })
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create game')
  }

  return response.json()
}
```

---

## 5. Components

### Game Component

**File:** `src/pages/Game.tsx`

```typescript
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { supabase, Game as GameType } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useGameRealtime } from '../hooks/useGameRealtime'
import { makeMove } from '../hooks/useMakeMove'

export function Game() {
  const { gameId } = useParams<{ gameId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [game, setGame] = useState<GameType | null>(null)
  const [chess] = useState(new Chess())
  const [fen, setFen] = useState(chess.fen())
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white')

  // Load game data
  useEffect(() => {
    if (!gameId || !user) return

    async function loadGame() {
      const { data, error } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .single()

      if (error || !data) {
        console.error('Failed to load game:', error)
        navigate('/')
        return
      }

      setGame(data)
      chess.load(data.current_fen)
      setFen(data.current_fen)

      // Determine player's color
      const color = data.white_player_id === user.id ? 'white' : 'black'
      setPlayerColor(color)
    }

    loadGame()
  }, [gameId, user, navigate])

  // Subscribe to move updates
  useGameRealtime(gameId!, (move) => {
    chess.load(move.fen_after)
    setFen(move.fen_after)

    // Reload game data to get updated status
    supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single()
      .then(({ data }) => {
        if (data) setGame(data)
      })
  })

  // Handle player making a move
  async function onDrop(sourceSquare: string, targetSquare: string) {
    if (!game || !user) return false

    // Check if it's player's turn
    if (game.current_turn !== playerColor) {
      return false
    }

    // Try move locally first (optimistic update)
    const move = chess.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q' // always promote to queen for now
    })

    if (!move) {
      return false // Illegal move
    }

    // Update UI immediately
    setFen(chess.fen())

    // Send to server
    try {
      await makeMove(gameId!, sourceSquare, targetSquare, 'q')
    } catch (error) {
      console.error('Move rejected:', error)
      alert('Move rejected: ' + (error as Error).message)
      // Rollback
      chess.undo()
      setFen(chess.fen())
      return false
    }

    return true
  }

  if (!game) {
    return <div>Loading game...</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px' }}>
      <h1>Game</h1>
      <p>You are playing as: {playerColor}</p>
      <p>Current turn: {game.current_turn}</p>
      {game.status === 'completed' && (
        <div>
          <h2>Game Over!</h2>
          <p>Result: {game.result}</p>
        </div>
      )}
      <div style={{ width: '500px', marginTop: '20px' }}>
        <Chessboard
          position={fen}
          onPieceDrop={onDrop}
          boardOrientation={playerColor}
        />
      </div>
    </div>
  )
}
```

### Login Component

**File:** `src/pages/Login.tsx`

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Login() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    try {
      if (isSignUp) {
        await signUp(email, password, username)
      } else {
        await signIn(email, password)
      }
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div style={{ maxWidth: '400px', margin: '50px auto', padding: '20px' }}>
      <h1>{isSignUp ? 'Sign Up' : 'Sign In'}</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        {isSignUp && (
          <div>
            <label>Username:</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
          </div>
        )}
        <div>
          <label>Email:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
        </div>
        <div>
          <label>Password:</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
        </div>
        <button type="submit" style={{ width: '100%', padding: '10px' }}>
          {isSignUp ? 'Sign Up' : 'Sign In'}
        </button>
      </form>
      <p style={{ marginTop: '20px', textAlign: 'center' }}>
        {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
        <button
          onClick={() => setIsSignUp(!isSignUp)}
          style={{ background: 'none', border: 'none', color: 'blue', cursor: 'pointer' }}
        >
          {isSignUp ? 'Sign In' : 'Sign Up'}
        </button>
      </p>
    </div>
  )
}
```

### Home Component

**File:** `src/pages/Home.tsx`

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createGame } from '../hooks/useCreateGame'

export function Home() {
  const { user, signOut } = useAuth()
  const [opponentUsername, setOpponentUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleCreateGame(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await createGame(opponentUsername)
      navigate(`/game/${result.game.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return null
  }

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Chess Online</h1>
        <button onClick={signOut}>Sign Out</button>
      </div>

      <div style={{ marginTop: '30px' }}>
        <h2>Challenge a Player</h2>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <form onSubmit={handleCreateGame}>
          <div>
            <label>Opponent Username:</label>
            <input
              type="text"
              value={opponentUsername}
              onChange={(e) => setOpponentUsername(e.target.value)}
              required
              placeholder="Enter username"
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: '10px', padding: '10px 20px' }}
          >
            {loading ? 'Creating game...' : 'Create Game'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

---

## 6. App Setup

### Main App

**File:** `src/App.tsx`

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Game } from './pages/Game'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return <Navigate to="/login" />
  }

  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/game/:gameId"
            element={
              <ProtectedRoute>
                <Game />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
```

**File:** `src/main.tsx`

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

---

## Frontend Checklist

- [ ] Create Vite React project
- [ ] Install dependencies
- [ ] Set up environment variables
- [ ] Create Supabase client
- [ ] Implement Auth context
- [ ] Create game hooks (Realtime, makeMove, createGame)
- [ ] Build Login component
- [ ] Build Home component
- [ ] Build Game component
- [ ] Set up routing
- [ ] Test locally

---

# Integration

## Testing Flow

1. **Sign Up:**
   - Create two accounts (e.g., player1@test.com, player2@test.com)
   - Set usernames (player1, player2)

2. **Create Game:**
   - Sign in as player1
   - Challenge player2 by username
   - Note the game ID

3. **Play Game:**
   - Sign in as player2 in a different browser/incognito
   - Navigate to the game URL
   - Players alternate making moves
   - Verify moves sync in real-time

4. **Game Completion:**
   - Play until checkmate or stalemate
   - Verify game status updates
   - Check that ELO ratings update

---

## Deployment

### Frontend (Vercel)

```bash
# Build
npm run build

# Deploy to Vercel
npx vercel

# Set environment variables in Vercel dashboard:
# VITE_SUPABASE_URL
# VITE_SUPABASE_ANON_KEY
```

### Backend (Already deployed on Supabase)

- Database and Edge Functions are already live
- No additional deployment needed

---

## Troubleshooting

### Common Issues

**RLS Policies Blocking Queries:**
- Check RLS policies in Supabase Dashboard → Authentication → Policies
- Verify user is authenticated

**Edge Functions Failing:**
- Check function logs in Supabase Dashboard → Edge Functions → Logs
- Verify environment variables are set

**Realtime Not Working:**
- Ensure Realtime is enabled for tables in Supabase Dashboard → Database → Replication
- Check browser console for WebSocket errors

**Moves Not Validating:**
- Check Edge Function logs
- Verify chess.js is importing correctly
- Test with simple moves first (e.g., e2-e4)

---

# Summary

This spec provides complete implementation details for **Stage 1 MVP**:

**Backend (Supabase):**
- ✅ Database schema with RLS
- ✅ Edge Functions for move validation
- ✅ Realtime triggers

**Frontend (React):**
- ✅ Authentication flow
- ✅ Game creation
- ✅ Real-time gameplay
- ✅ Move validation

**Total implementation time:** 2-3 weeks

**Next steps:** Follow the checklists above sequentially, starting with backend setup.
