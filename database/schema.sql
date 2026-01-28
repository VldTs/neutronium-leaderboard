-- Neutronium Leaderboard Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PLAYERS
-- ============================================
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE,           -- NULL for guests
  display_name VARCHAR(50) NOT NULL,
  is_guest BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for email lookups
CREATE INDEX idx_players_email ON players(email) WHERE email IS NOT NULL;

-- ============================================
-- GAME BOXES (physical copies)
-- ============================================
CREATE TABLE game_boxes (
  box_id VARCHAR(20) PRIMARY KEY,      -- From QR code (e.g., "NE-2026-00001")
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  owner_player_id UUID REFERENCES players(id),
  registration_email VARCHAR(255)       -- Email used for recovery
);

-- ============================================
-- GAME SESSIONS
-- ============================================
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  box_id VARCHAR(20) NOT NULL REFERENCES game_boxes(box_id),
  universe_level INTEGER NOT NULL CHECK (universe_level BETWEEN 1 AND 13),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'pending_end', 'completed', 'abandoned')),
  host_player_id UUID REFERENCES players(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
  -- Note: Only one active session per box is enforced by idx_active_session_per_box below
);

-- Partial index for active sessions lookup
CREATE UNIQUE INDEX idx_active_session_per_box
  ON sessions(box_id)
  WHERE status = 'active';

-- ============================================
-- SESSION PLAYERS (join table)
-- ============================================
CREATE TABLE session_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),

  -- Game data (race stores figure color: gray, pink, purple, green)
  race VARCHAR(20) CHECK (race IN ('gray', 'pink', 'purple', 'green', NULL)),
  starting_nn INTEGER DEFAULT 0,
  final_nn INTEGER,

  -- Session management
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  voted_end BOOLEAN DEFAULT FALSE,

  UNIQUE(session_id, player_id)
);

-- Index for player's sessions
CREATE INDEX idx_session_players_player ON session_players(player_id);

-- ============================================
-- PROGRESS JOURNAL (best scores per level)
-- ============================================
CREATE TABLE progress_journal (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES players(id),
  universe_level INTEGER NOT NULL CHECK (universe_level BETWEEN 1 AND 13),
  best_nn INTEGER NOT NULL,
  achieved_at TIMESTAMPTZ DEFAULT NOW(),
  session_id UUID REFERENCES sessions(id),

  -- One record per player per level
  UNIQUE(player_id, universe_level)
);

-- Index for leaderboard queries
CREATE INDEX idx_progress_journal_level_score
  ON progress_journal(universe_level, best_nn DESC);

-- ============================================
-- MAGIC LINK TOKENS
-- ============================================
CREATE TABLE magic_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  player_id UUID REFERENCES players(id),  -- Link to existing player if upgrading guest
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for token lookup
CREATE INDEX idx_magic_tokens_token ON magic_tokens(token) WHERE used_at IS NULL;

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Update progress journal when session ends (upsert best score)
CREATE OR REPLACE FUNCTION update_progress_journal()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    INSERT INTO progress_journal (player_id, universe_level, best_nn, session_id)
    SELECT
      sp.player_id,
      NEW.universe_level,
      sp.final_nn,
      NEW.id
    FROM session_players sp
    WHERE sp.session_id = NEW.id
      AND sp.final_nn IS NOT NULL
    ON CONFLICT (player_id, universe_level)
    DO UPDATE SET
      best_nn = GREATEST(progress_journal.best_nn, EXCLUDED.best_nn),
      achieved_at = CASE
        WHEN EXCLUDED.best_nn > progress_journal.best_nn THEN NOW()
        ELSE progress_journal.achieved_at
      END,
      session_id = CASE
        WHEN EXCLUDED.best_nn > progress_journal.best_nn THEN EXCLUDED.session_id
        ELSE progress_journal.session_id
      END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_completed_trigger
  AFTER UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_progress_journal();