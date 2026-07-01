-- RIP Phase 1 Database Schema
-- Run this migration on your Supabase project

-- countries table
CREATE TABLE IF NOT EXISTS countries (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  alpha2 TEXT,
  slug TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_countries_name ON countries(name);
CREATE INDEX IF NOT EXISTS idx_countries_alpha2 ON countries(alpha2);

-- tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id BIGSERIAL PRIMARY KEY,
  external_id BIGINT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  country_id BIGINT REFERENCES countries(id) ON DELETE SET NULL,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_external_id ON tournaments(external_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_country_id ON tournaments(country_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_name ON tournaments(name);

-- seasons table
CREATE TABLE IF NOT EXISTS seasons (
  id BIGSERIAL PRIMARY KEY,
  external_id BIGINT UNIQUE NOT NULL,
  name TEXT,
  year TEXT,
  tournament_id BIGINT REFERENCES tournaments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seasons_external_id ON seasons(external_id);
CREATE INDEX IF NOT EXISTS idx_seasons_tournament_id ON seasons(tournament_id);
CREATE INDEX IF NOT EXISTS idx_seasons_year ON seasons(year);

-- teams table
CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  external_id BIGINT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  country TEXT,
  slug TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_external_id ON teams(external_id);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);
CREATE INDEX IF NOT EXISTS idx_teams_country ON teams(country);

-- players table
CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  external_id BIGINT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  position TEXT,
  nationality TEXT,
  date_of_birth DATE,
  market_value BIGINT,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_external_id ON players(external_id);
CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);

-- matches table
CREATE TABLE IF NOT EXISTS matches (
  id BIGSERIAL PRIMARY KEY,
  external_match_id BIGINT UNIQUE NOT NULL,
  home_team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  away_team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL,
  competition TEXT,
  season TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_external_id ON matches(external_match_id);
CREATE INDEX IF NOT EXISTS idx_matches_home_team_id ON matches(home_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_team_id ON matches(away_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(competition);

-- match_results table - The Truth Layer for Match Outcomes
CREATE TABLE IF NOT EXISTS match_results (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT UNIQUE NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home_score INTEGER,
  away_score INTEGER,
  half_time_home_score INTEGER,
  half_time_away_score INTEGER,
  winner_team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_results_match_id ON match_results(match_id);
CREATE INDEX IF NOT EXISTS idx_match_results_winner ON match_results(winner_team_id);
CREATE INDEX IF NOT EXISTS idx_match_results_status ON match_results(status);

-- team_squads_snapshot table
CREATE TABLE IF NOT EXISTS team_squads_snapshot (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  players_count INTEGER,
  avg_age NUMERIC(6, 2),
  foreign_players_count INTEGER,
  domestic_players_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_team_squads_team_id ON team_squads_snapshot(team_id);
CREATE INDEX IF NOT EXISTS idx_team_squads_snapshot_date ON team_squads_snapshot(snapshot_date);

-- player_transfers table
CREATE TABLE IF NOT EXISTS player_transfers (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  to_team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  transfer_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_transfers_player_id ON player_transfers(player_id);
CREATE INDEX IF NOT EXISTS idx_player_transfers_from_team ON player_transfers(from_team_id);
CREATE INDEX IF NOT EXISTS idx_player_transfers_to_team ON player_transfers(to_team_id);
CREATE INDEX IF NOT EXISTS idx_player_transfers_date ON player_transfers(transfer_date);

-- team_form_history table - Precomputed form data (Phase 1 intelligence)
CREATE TABLE IF NOT EXISTS team_form_history (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  result CHAR(1) NOT NULL,
  goals_for INTEGER,
  goals_against INTEGER,
  points INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_team_form_team_id ON team_form_history(team_id);
CREATE INDEX IF NOT EXISTS idx_team_form_match_id ON team_form_history(match_id);
CREATE INDEX IF NOT EXISTS idx_team_form_created_at ON team_form_history(created_at);

-- ============================================================================
-- PHASE 2+ PRECOMPUTED INTELLIGENCE TABLES
-- These tables enforce "no runtime calculations" - all values are precomputed
-- by background jobs and stored here. Frontend reads only.
-- ============================================================================

-- team_intelligence table - Precomputed team readiness & performance metrics
-- Populated by: Phase 2 Intelligence Processor
-- Updated: After every match completion + daily recalculation
-- Used by: Frontend (readiness dashboard, team comparison)
CREATE TABLE IF NOT EXISTS team_intelligence (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT UNIQUE NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Core readiness components (0-100 scale)
  readiness_score NUMERIC(5, 2),           -- Overall readiness (0-100)
  fatigue_index NUMERIC(5, 2),              -- Inverse: low = fresh (0-100)
  squad_stability_index NUMERIC(5, 2),      -- Squad consistency (0-100)
  rotation_pressure_index NUMERIC(5, 2),    -- Inverse: low = good depth (0-100)
  form_index NUMERIC(5, 2),                 -- Recent form (0-100)
  
  -- Tactical metrics
  last_5_points INTEGER,                    -- Points from last 5 matches (0-15)
  last_10_points INTEGER,                   -- Points from last 10 matches (0-30)
  congestion_score NUMERIC(5, 2),           -- Fixture density penalty (0-100)
  rest_days_avg NUMERIC(5, 2),              -- Average days between matches
  
  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_intelligence_team_id ON team_intelligence(team_id);
CREATE INDEX IF NOT EXISTS idx_team_intelligence_readiness ON team_intelligence(readiness_score DESC);
CREATE INDEX IF NOT EXISTS idx_team_intelligence_updated_at ON team_intelligence(updated_at);

-- player_intelligence table - Precomputed player load & fatigue metrics
-- Populated by: Phase 2 Player Intelligence Processor
-- Updated: After every match + weekly recalculation
-- Used by: Frontend (player availability, rotation tracking)
CREATE TABLE IF NOT EXISTS player_intelligence (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT UNIQUE NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  
  -- Load metrics
  load_index NUMERIC(5, 2),                 -- Cumulative load (0-100)
  fatigue_score NUMERIC(5, 2),              -- Player fatigue (0-100)
  
  -- Activity metrics
  matches_last_7_days INTEGER,              -- Matches played
  matches_last_30_days INTEGER,             -- Matches played
  minutes_last_7_days INTEGER,              -- Total minutes
  minutes_last_30_days INTEGER,             -- Total minutes
  
  -- Stability
  transfers_last_12_months INTEGER,         -- Transfer churn
  avg_minutes_per_match NUMERIC(5, 2),      -- Playing time consistency
  
  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_intelligence_player_id ON player_intelligence(player_id);
CREATE INDEX IF NOT EXISTS idx_player_intelligence_fatigue ON player_intelligence(fatigue_score DESC);
CREATE INDEX IF NOT EXISTS idx_player_intelligence_load ON player_intelligence(load_index DESC);

-- match_intelligence table - Precomputed match context & readiness gap
-- Populated by: Phase 2 Match Intelligence Processor
-- Calculated: When match is scheduled or shortly after
-- Used by: Frontend (match preview, readiness comparison)
CREATE TABLE IF NOT EXISTS match_intelligence (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT UNIQUE NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  
  -- Readiness at match time
  home_readiness NUMERIC(5, 2),             -- Home team readiness (0-100)
  away_readiness NUMERIC(5, 2),             -- Away team readiness (0-100)
  readiness_gap NUMERIC(5, 2),              -- Absolute difference (0-100)
  
  -- Match context
  congestion_factor NUMERIC(5, 2),          -- Combined fixture density impact
  home_rest_days NUMERIC(5, 2),             -- Days since home team's last match
  away_rest_days NUMERIC(5, 2),             -- Days since away team's last match
  
  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_intelligence_match_id ON match_intelligence(match_id);
CREATE INDEX IF NOT EXISTS idx_match_intelligence_readiness_gap ON match_intelligence(readiness_gap DESC);
CREATE INDEX IF NOT EXISTS idx_match_intelligence_calculated_at ON match_intelligence(calculated_at);

-- team_fixture_load table - Precomputed fixture congestion tracking
-- Populated by: Phase 2 Fixture Load Calculator
-- Updated: Daily (rolling window)
-- Used by: Readiness engine (congestion penalty), frontend (fixture density viz)
CREATE TABLE IF NOT EXISTS team_fixture_load (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Fixture density (rolling windows)
  matches_last_7_days INTEGER,              -- Matches in last 7 days
  matches_last_14_days INTEGER,             -- Matches in last 14 days
  matches_last_30_days INTEGER,             -- Matches in last 30 days
  
  -- Rest analysis
  avg_rest_days NUMERIC(5, 2),              -- Average rest between matches
  min_rest_days INTEGER,                    -- Minimum rest (tight schedule indicator)
  
  -- Congestion calculation (0-100)
  congestion_score NUMERIC(5, 2),           -- Overall fixture congestion
  
  -- Metadata
  snapshot_date DATE NOT NULL,              -- Date of calculation
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_team_fixture_load_team_id ON team_fixture_load(team_id);
CREATE INDEX IF NOT EXISTS idx_team_fixture_load_snapshot_date ON team_fixture_load(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_team_fixture_load_congestion ON team_fixture_load(congestion_score DESC);

-- ============================================================================
-- ARCHITECTURE ENFORCEMENT
-- 
-- The tables above (team_intelligence, player_intelligence, match_intelligence,
-- team_fixture_load) ensure that:
--
-- ✅ NO calculations happen at request time
-- ✅ ALL intelligence is precomputed by background jobs
-- ✅ FRONTEND reads only from these tables
-- ✅ VALUES persist in the database (not volatile)
-- ✅ PHASE 2 processing jobs populate these tables
--
-- Flow:
--   SportsAPI Pro
--        ↓
--   Raw Tables (matches, teams, players, results)
--        ↓
--   Processing Jobs (cron, background)
--        ↓
--   Intelligence Tables (team_intelligence, player_intelligence, etc.)
--        ↓
--   Frontend API (READ-ONLY selects from intelligence tables)
--
-- ============================================================================

-- Enable RLS if needed (disabled for service role access during Phase 1)
-- ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
-- ... etc
