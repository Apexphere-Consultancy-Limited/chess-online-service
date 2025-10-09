-- =====================================================
-- Lobby Segments, Challenges, and Notifications Schema
-- =====================================================

-- ========================================
-- 1. Lobbies & Membership
-- ========================================
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  min_elo INTEGER,
  max_elo INTEGER,
  time_control TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lobbies_visibility ON lobbies(visibility);
CREATE INDEX idx_lobbies_min_max_elo ON lobbies(min_elo, max_elo);

ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;

CREATE TABLE lobby_members (
  lobby_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('member', 'moderator', 'owner')) DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lobby_id, player_id)
);

ALTER TABLE lobby_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players view own memberships"
  ON lobby_members FOR SELECT
  USING (player_id = auth.uid());

CREATE POLICY "Players can leave memberships"
  ON lobby_members FOR DELETE
  USING (player_id = auth.uid());

CREATE OR REPLACE FUNCTION set_lobby_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lobbies_set_updated_at
  BEFORE UPDATE ON lobbies
  FOR EACH ROW
  EXECUTE FUNCTION set_lobby_updated_at();

CREATE POLICY "View visible lobbies"
  ON lobbies FOR SELECT
  USING (
    visibility = 'public'
    OR EXISTS (
      SELECT 1
      FROM lobby_members
      WHERE lobby_members.lobby_id = lobbies.id
        AND lobby_members.player_id = auth.uid()
    )
  );

-- ========================================
-- 2. Seed Initial Public Lobbies
-- ========================================
INSERT INTO lobbies (slug, title, description, visibility, min_elo, max_elo, time_control)
VALUES
  ('starter', 'Starter Lobby', 'Newcomers and casual games (ELO < 1200)', 'public', NULL, 1199, 'rapid'),
  ('main', 'Main Lobby', 'Regulars with ELO 1200-1499', 'public', 1200, 1499, 'rapid'),
  ('advanced', 'Advanced Lobby', 'Competitive play for ELO 1500+', 'public', 1500, NULL, 'rapid')
ON CONFLICT (slug) DO NOTHING;

-- ========================================
-- 3. Lobby Sessions
-- ========================================
CREATE TABLE lobby_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lobby_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('available', 'in_game')),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_lobby_sessions_lobby_player ON lobby_sessions(lobby_id, player_id);
CREATE UNIQUE INDEX idx_lobby_sessions_player ON lobby_sessions(player_id);
CREATE INDEX idx_lobby_sessions_lobby ON lobby_sessions(lobby_id);
CREATE INDEX idx_lobby_sessions_lobby_status ON lobby_sessions(lobby_id, status);

ALTER TABLE lobby_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View sessions in accessible lobbies"
  ON lobby_sessions FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1
      FROM lobbies
      WHERE lobbies.id = lobby_sessions.lobby_id
        AND (
          lobbies.visibility = 'public'
          OR EXISTS (
            SELECT 1
            FROM lobby_members
            WHERE lobby_members.lobby_id = lobby_sessions.lobby_id
              AND lobby_members.player_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "Players manage their lobby session"
  ON lobby_sessions FOR ALL
  USING (auth.uid() = player_id)
  WITH CHECK (
    auth.uid() = player_id AND
    EXISTS (
      SELECT 1
      FROM lobbies
      WHERE lobbies.id = lobby_sessions.lobby_id
        AND (
          lobbies.visibility = 'public'
          OR EXISTS (
            SELECT 1
            FROM lobby_members
            WHERE lobby_members.lobby_id = lobby_sessions.lobby_id
              AND lobby_members.player_id = auth.uid()
          )
        )
    )
  );

-- ========================================
-- 4. Challenges
-- ========================================
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  challenged_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lobby_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  message TEXT,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes',
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_challenges_challenger_status ON challenges(challenger_id, status);
CREATE INDEX idx_challenges_challenged_status ON challenges(challenged_id, status);
CREATE INDEX idx_challenges_status ON challenges(status);
CREATE INDEX idx_challenges_lobby_status ON challenges(lobby_id, status);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players view their challenges in accessible lobbies"
  ON challenges FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (auth.uid() = challenger_id OR auth.uid() = challenged_id)
    AND EXISTS (
      SELECT 1
      FROM lobbies
      WHERE lobbies.id = challenges.lobby_id
        AND (
          lobbies.visibility = 'public'
          OR EXISTS (
            SELECT 1
            FROM lobby_members
            WHERE lobby_members.lobby_id = challenges.lobby_id
              AND lobby_members.player_id = auth.uid()
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION set_challenge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_challenges_set_updated_at
  BEFORE UPDATE ON challenges
  FOR EACH ROW
  EXECUTE FUNCTION set_challenge_updated_at();

-- ========================================
-- 5. Notifications
-- ========================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'challenge_received',
      'challenge_accepted',
      'challenge_declined',
      'challenge_cancelled',
      'game_ready'
    )
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient_created_at
  ON notifications(recipient_id, created_at DESC);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications(recipient_id)
  WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view their notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = recipient_id);

CREATE POLICY "Players can mark their notifications as read"
  ON notifications FOR UPDATE
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- ========================================
-- 6. Enable Realtime for Tables
-- ========================================
-- Enable Supabase Realtime (postgres_changes) so clients
-- receive instant INSERT/UPDATE/DELETE events without polling

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE challenges;
ALTER PUBLICATION supabase_realtime ADD TABLE lobby_sessions;
