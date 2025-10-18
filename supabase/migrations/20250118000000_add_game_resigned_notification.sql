-- =====================================================
-- Game Notifications and Player Ready System
-- =====================================================
-- This migration adds:
-- 1. Support for game resignation notifications
-- 2. Player ready state tracking and timeout for game initialization

-- =====================================================
-- 1. Add ready state columns to games table
-- =====================================================
ALTER TABLE games
ADD COLUMN white_ready BOOLEAN DEFAULT false,
ADD COLUMN black_ready BOOLEAN DEFAULT false,
ADD COLUMN ready_expires_at TIMESTAMPTZ;

-- Add index for querying expired games (for cleanup jobs)
CREATE INDEX idx_games_ready_expires_at
ON games(ready_expires_at)
WHERE status = 'waiting' AND ready_expires_at IS NOT NULL;

-- Add comments explaining the ready flow
COMMENT ON COLUMN games.white_ready IS 'Indicates if white player clicked ready button to start game';
COMMENT ON COLUMN games.black_ready IS 'Indicates if black player clicked ready button to start game';
COMMENT ON COLUMN games.ready_expires_at IS 'Timestamp when the ready period expires (60 seconds after game creation). If both players not ready by this time, game can be cancelled.';

-- =====================================================
-- 2. Add new notification types
-- =====================================================
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
    'game_resigned',        -- NEW: When opponent resigns
    'game_completed',       -- NEW: For other game endings (future use)
    'player_ready'          -- NEW: When opponent clicks ready
  )
);
