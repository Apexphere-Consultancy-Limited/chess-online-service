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

-- =====================================================
-- Trigger for Profile Creation
-- =====================================================

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

-- =====================================================
-- Trigger for Realtime Notifications
-- =====================================================

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

-- =====================================================
-- Function to calculate ELO change
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_elo_change(
  p_player_rating INTEGER,
  p_opponent_rating INTEGER,
  p_result NUMERIC -- 1 for win, 0.5 for draw, 0 for loss
)
RETURNS INTEGER AS $$
DECLARE
  v_k_factor INTEGER := 32;
  v_expected_score NUMERIC;
BEGIN
  v_expected_score := 1.0 / (1.0 + POWER(10.0, (p_opponent_rating - p_player_rating) / 400.0));
  RETURN ROUND(v_k_factor * (p_result - v_expected_score));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- Function to handle game completion
-- =====================================================

CREATE OR REPLACE FUNCTION handle_game_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_white_rating INTEGER;
  v_black_rating INTEGER;
  v_white_result NUMERIC;
  v_black_result NUMERIC;
  v_white_elo_change INTEGER;
  v_black_elo_change INTEGER;
BEGIN
  -- Only process when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN

    -- Get current ratings
    SELECT elo_rating INTO v_white_rating FROM profiles WHERE id = NEW.white_player_id;
    SELECT elo_rating INTO v_black_rating FROM profiles WHERE id = NEW.black_player_id;

    -- Determine results (1 = win, 0.5 = draw, 0 = loss)
    IF NEW.result = 'white_win' THEN
      v_white_result := 1;
      v_black_result := 0;
    ELSIF NEW.result = 'black_win' THEN
      v_white_result := 0;
      v_black_result := 1;
    ELSIF NEW.result = 'draw' THEN
      v_white_result := 0.5;
      v_black_result := 0.5;
    ELSE
      -- Abandoned games don't affect ELO
      RETURN NEW;
    END IF;

    -- Calculate ELO changes
    v_white_elo_change := calculate_elo_change(v_white_rating, v_black_rating, v_white_result);
    v_black_elo_change := calculate_elo_change(v_black_rating, v_white_rating, v_black_result);

    -- Update white player stats
    UPDATE profiles
    SET
      elo_rating = elo_rating + v_white_elo_change,
      games_played = games_played + 1,
      games_won = games_won + CASE WHEN v_white_result = 1 THEN 1 ELSE 0 END,
      games_drawn = games_drawn + CASE WHEN v_white_result = 0.5 THEN 1 ELSE 0 END,
      games_lost = games_lost + CASE WHEN v_white_result = 0 THEN 1 ELSE 0 END,
      updated_at = NOW()
    WHERE id = NEW.white_player_id;

    -- Update black player stats
    UPDATE profiles
    SET
      elo_rating = elo_rating + v_black_elo_change,
      games_played = games_played + 1,
      games_won = games_won + CASE WHEN v_black_result = 1 THEN 1 ELSE 0 END,
      games_drawn = games_drawn + CASE WHEN v_black_result = 0.5 THEN 1 ELSE 0 END,
      games_lost = games_lost + CASE WHEN v_black_result = 0 THEN 1 ELSE 0 END,
      updated_at = NOW()
    WHERE id = NEW.black_player_id;

    -- Set completed_at timestamp if not already set
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Trigger for game completion
-- =====================================================

CREATE TRIGGER on_game_completion
  BEFORE UPDATE ON games
  FOR EACH ROW
  EXECUTE FUNCTION handle_game_completion();
