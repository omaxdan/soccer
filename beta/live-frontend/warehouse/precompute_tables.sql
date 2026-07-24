-- ============================================================================
-- PitchTerminal — precompute scaffolding (frontend-proposed tables)
-- Run in the Supabase SQL editor.
--
-- STATUS UPDATE: the backend team independently built and shipped a real,
-- authoritative migration suite covering most of what this file originally
-- proposed:
--   beta/migrations/028_extended_intelligence_suite.sql
--     → team_betting_intelligence, team_motivation, player_match_impact,
--       match_performance_comparison, match_impact_summary, team_versatility,
--       tactical_flexibility, position_adaptability, substitution_impact,
--       match_squad_depth_comparison, formation_matchup
--       (all populated by beta/backend/src/jobs/processExtendedIntelligence.ts)
--   beta/migrations/029_half_time_intelligence.sql
--     → match_half_time_intelligence
-- Those 12 tables have been REMOVED from this file to avoid two competing
-- schema sources — migrations 028/029 are the source of truth for them. This
-- frontend's types.ts (TeamBettingIntelligence, MatchHalfTimeIntelligence)
-- and queries.ts were checked column-for-column against 028/029 and match.
--
-- WHAT REMAINS BELOW: ~19 tables from the original proposal that migrations
-- 028/029 do NOT cover (player/team-impact detail, formation/versatility
-- detail, strengths/weaknesses, key battles). These are still proposals, not
-- migrations — if the backend team wants to build any of them, they should
-- get proper sequential migration numbers (032+) rather than being run
-- ad hoc from here. Safe to re-run (CREATE ... IF NOT EXISTS).
--
-- WHAT THIS DOES NOT DO: creating a table does not populate it. Empty tables
-- render as empty states in the UI until an ETL job fills them.
--
-- Tables that ALREADY EXIST live and already power the app (do not recreate):
--   match_intelligence, match_opportunity, match_risk_intelligence,
--   match_signals, match_weather, match_results, match_predicted_lineups,
--   match_opponent_context, team_intelligence, team_form_quality,
--   team_season_statistics, team_strength_ratings, team_venue_performance,
--   team_goal_dependency, team_injury_impact, team_momentum,
--   team_position_depth, team_fixture_difficulty, team_form_history,
--   tournament_standings, league_intelligence, league_gap_summary,
--   player_intelligence, player_season_statistics,
--   + everything in migrations 028-031 (extended intelligence, half-time,
--   historical-context, risk-opportunity-backtest).
-- ============================================================================

-- ── Column additions to existing tables ───────────────────────────────────
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS strengths TEXT[];
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS weaknesses TEXT[];
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS recommended_approach TEXT;
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS overall_rating INTEGER;
ALTER TABLE team_position_depth ADD COLUMN IF NOT EXISTS strength_score INTEGER;
ALTER TABLE team_position_depth ADD COLUMN IF NOT EXISTS quality_rating TEXT;
ALTER TABLE team_position_depth ADD COLUMN IF NOT EXISTS depth_rating TEXT;

-- ── Team identity / motivation (motivation itself now covered by 028;
--    playing_style is not, kept here) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_playing_style (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL UNIQUE REFERENCES teams(id),
  playing_style TEXT, possession_score INTEGER, passing_style TEXT,
  attacking_style TEXT, defensive_style TEXT, style_confidence INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Strength dashboard + strengths/weaknesses ─────────────────────────────
CREATE TABLE IF NOT EXISTS team_strength_dashboard (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id),
  overall_rating INTEGER, attack_rating INTEGER, midfield_rating INTEGER,
  defense_rating INTEGER, set_piece_rating INTEGER, tactical_rating INTEGER,
  experience_rating INTEGER, form_trend TEXT, form_rating INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(team_id)
);
CREATE TABLE IF NOT EXISTS team_strengths (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id),
  strength_type TEXT NOT NULL, description TEXT NOT NULL, score INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_weaknesses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id),
  weakness_type TEXT NOT NULL, description TEXT NOT NULL, score INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Player impact + matchups (match-scoped) ───────────────────────────────
CREATE TABLE IF NOT EXISTS player_matchup (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  player_id BIGINT NOT NULL REFERENCES players(id),
  opponent_player_id BIGINT NOT NULL REFERENCES players(id),
  advantage_score INTEGER, advantage_type TEXT, matchup_notes TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(match_id, player_id, opponent_player_id)
);
CREATE TABLE IF NOT EXISTS match_positional_matchups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  position_code TEXT NOT NULL,
  home_player_id BIGINT REFERENCES players(id), away_player_id BIGINT REFERENCES players(id),
  home_impact_score INTEGER, away_impact_score INTEGER, advantage_score INTEGER,
  advantage_team_id BIGINT REFERENCES teams(id), advantage_type TEXT, matchup_description TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, position_code)
);
CREATE TABLE IF NOT EXISTS match_key_battles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  battle_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  home_player_id BIGINT REFERENCES players(id), away_player_id BIGINT REFERENCES players(id),
  home_advantage_score INTEGER, away_advantage_score INTEGER, importance_score INTEGER,
  expected_impact TEXT, battle_outcome_prediction TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, battle_id)
);
CREATE TABLE IF NOT EXISTS match_tactical_advantages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  advantage_type TEXT NOT NULL, description TEXT,
  home_advantage_score INTEGER, away_advantage_score INTEGER, net_advantage INTEGER,
  advantage_team_id BIGINT REFERENCES teams(id), confidence_score INTEGER, tactical_notes TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Match/team impact + performance comparison ────────────────────────────
CREATE TABLE IF NOT EXISTS team_match_impact (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  team_id BIGINT NOT NULL REFERENCES teams(id),
  overall_impact_score INTEGER, attack_strength INTEGER, midfield_control INTEGER,
  defensive_strength INTEGER, set_piece_threat INTEGER, experience_level INTEGER,
  form_trend INTEGER, injury_impact INTEGER, tactical_versatility INTEGER,
  match_specific_boost INTEGER, confidence_level INTEGER, advantage_band TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, team_id)
);
CREATE TABLE IF NOT EXISTS match_impact_advantage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_advantage_score INTEGER, away_advantage_score INTEGER, advantage_margin INTEGER,
  advantage_team_id BIGINT REFERENCES teams(id),
  key_advantages TEXT[], key_disadvantages TEXT[], confidence_score INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);

-- ── Versatility / formation / depth suite ─────────────────────────────────
CREATE TABLE IF NOT EXISTS versatility_advantage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  advantage_score INTEGER, advantage_team_id BIGINT REFERENCES teams(id), advantage_margin INTEGER,
  advantage_band TEXT, key_advantages TEXT[], key_disadvantages TEXT[], confidence_score INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);
CREATE TABLE IF NOT EXISTS formation_options (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_available_formations TEXT[], away_available_formations TEXT[],
  home_primary_formation TEXT, away_primary_formation TEXT,
  home_secondary_formation TEXT, away_secondary_formation TEXT,
  home_tertiary_formation TEXT, away_tertiary_formation TEXT,
  home_formation_confidence INTEGER, away_formation_confidence INTEGER,
  formation_advantage INTEGER, formation_notes TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);
CREATE TABLE IF NOT EXISTS injury_adaptability (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_injury_resilience INTEGER, away_injury_resilience INTEGER,
  home_position_redundancy INTEGER, away_position_redundancy INTEGER,
  home_cover_quality INTEGER, away_cover_quality INTEGER,
  home_system_flexibility_under_injury INTEGER, away_system_flexibility_under_injury INTEGER,
  home_emergency_cover_score INTEGER, away_emergency_cover_score INTEGER,
  adaptability_under_injury INTEGER, resilience_notes TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);
CREATE TABLE IF NOT EXISTS player_versatility (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id),
  positions_played TEXT[], primary_position_rating INTEGER, secondary_position_rating INTEGER,
  tertiary_position_rating INTEGER, versatility_score INTEGER, adaptability_score INTEGER,
  utility_rating INTEGER, games_at_position INTEGER, position_rating INTEGER, overall_versatility INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(player_id)
);
CREATE TABLE IF NOT EXISTS position_coverage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id),
  position_code TEXT NOT NULL, position_name TEXT,
  primary_players TEXT[], secondary_players TEXT[], total_coverage INTEGER,
  coverage_quality INTEGER, depth_rating TEXT, emergency_cover TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(team_id, position_code)
);
CREATE TABLE IF NOT EXISTS squad_depth (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id), team_id BIGINT NOT NULL REFERENCES teams(id),
  overall_depth_score INTEGER, depth_rating TEXT, starting_xi_quality INTEGER,
  bench_quality INTEGER, reserve_quality INTEGER, quality_drop_off INTEGER,
  coverage_completeness INTEGER, position_balance INTEGER,
  experience_distribution JSONB, age_profile JSONB,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, team_id)
);
CREATE TABLE IF NOT EXISTS position_depth_comparison (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id), position_code TEXT NOT NULL, position_name TEXT,
  home_depth_score INTEGER, away_depth_score INTEGER, home_quality INTEGER, away_quality INTEGER,
  home_count INTEGER, away_count INTEGER, advantage_team_id BIGINT REFERENCES teams(id),
  advantage_margin INTEGER, depth_notes TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, position_code)
);
CREATE TABLE IF NOT EXISTS team_tactical_variations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id),
  formation_history JSONB[], tactical_patterns JSONB[], system_effectiveness JSONB[],
  adaptability_score JSONB, game_state_adaptations JSONB[],
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(team_id)
);
CREATE TABLE IF NOT EXISTS formation_analysis (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id), team_id BIGINT NOT NULL REFERENCES teams(id),
  primary_formation TEXT NOT NULL, secondary_formation TEXT, tertiary_formation TEXT,
  formation_confidence INTEGER, formation_variations TEXT[], preferred_style TEXT,
  alternative_styles TEXT[], formation_strengths TEXT[], formation_weaknesses TEXT[],
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, team_id)
);

-- ── Read policies for the anon key ────────────────────────────────────────
-- The frontend reads with the public anon key. Enable RLS and add a
-- read-only (SELECT) policy on each new table. Adjust if you want stricter
-- access. Writes should come from the service-role pipeline only.
DO $$
DECLARE t TEXT;
DECLARE tbls TEXT[] := ARRAY[
  'team_playing_style','team_strength_dashboard','team_strengths','team_weaknesses',
  'player_matchup','match_positional_matchups','match_key_battles',
  'match_tactical_advantages','team_match_impact','match_impact_advantage',
  'versatility_advantage','formation_options','injury_adaptability',
  'player_versatility','position_coverage','squad_depth',
  'position_depth_comparison','team_tactical_variations','formation_analysis'
];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='public_read'
    ) THEN
      EXECUTE format('CREATE POLICY public_read ON %I FOR SELECT USING (true);', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- NEXT STEP (not done by this file): write the ETL/pipeline jobs that POPULATE
-- these ~19 remaining tables. Until they contain rows, the matching UI
-- sections show their empty state.
--
-- Note: team_betting_intelligence, match_half_time_intelligence, and the
-- other 10 tables from migrations 028/029 are ALREADY populated by
-- beta/backend/src/jobs/processExtendedIntelligence.ts — run that job
-- (already wired into process:all-db) rather than anything in this file.
-- Once it has run, the frontend's Attack/Defence/Betting tabs and the match
-- Half-Time signals sub-tab switch from derived reads to precomputed reads
-- automatically — no frontend code change needed.
-- ============================================================================

