-- ============================================================================
-- PitchTerminal — precompute scaffolding
-- Run in the Supabase SQL editor.
--
-- WHAT THIS DOES: creates the empty precomputed tables the newer frontend
-- queries are shaped to read (versatility, player-impact, formation, depth,
-- comparison, strength-dashboard, betting-intelligence, playing-style,
-- motivation). All CREATE ... IF NOT EXISTS, so it is safe to re-run and will
-- not touch tables you already have.
--
-- WHAT THIS DOES NOT DO: it does NOT populate them. Empty tables render as
-- empty states in the UI until a warehouse/ETL job fills them. Creating the
-- table is step 1; the pipeline that computes the rows is the real work.
--
-- Tables that ALREADY EXIST live (do not recreate) and already power the app:
--   match_intelligence, match_opportunity, match_risk_intelligence,
--   match_signals, match_weather, match_results, match_predicted_lineups,
--   match_opponent_context, team_intelligence, team_form_quality,
--   team_season_statistics, team_strength_ratings, team_venue_performance,
--   team_goal_dependency, team_injury_impact, team_momentum,
--   team_position_depth, team_fixture_difficulty, team_form_history,
--   tournament_standings, league_intelligence, league_gap_summary,
--   player_intelligence, player_season_statistics.
-- ============================================================================

-- ── Column additions to existing tables ───────────────────────────────────
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS strengths TEXT[];
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS weaknesses TEXT[];
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS recommended_approach TEXT;
ALTER TABLE team_intelligence  ADD COLUMN IF NOT EXISTS overall_rating INTEGER;
ALTER TABLE team_position_depth ADD COLUMN IF NOT EXISTS strength_score INTEGER;
ALTER TABLE team_position_depth ADD COLUMN IF NOT EXISTS quality_rating TEXT;
ALTER TABLE team_position_depth ADD COLUMN IF NOT EXISTS depth_rating TEXT;

-- ── Highest-value: team betting intelligence (makes the performance engine
--    a pure read instead of a runtime derivation) ──────────────────────────
CREATE TABLE IF NOT EXISTS team_betting_intelligence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id),
  season_external_id BIGINT,
  attack_rating INTEGER, defence_rating INTEGER, team_quality_score INTEGER,
  finishing_efficiency NUMERIC, shot_accuracy NUMERIC, shot_conversion_rate NUMERIC,
  big_chance_conversion NUMERIC, goal_creation_score INTEGER, goal_prevention_score INTEGER,
  defensive_fragility_score INTEGER, clean_sheet_reliability NUMERIC,
  attack_sustainability_score INTEGER, consistency_score INTEGER, volatility_score INTEGER,
  predictability_score INTEGER, sustainability_score INTEGER,
  overperformance_score NUMERIC, underperformance_score NUMERIC,
  home_attack_rating INTEGER, home_defence_rating INTEGER,
  away_attack_rating INTEGER, away_defence_rating INTEGER,
  winner_market_score INTEGER, goals_market_score INTEGER, btts_score INTEGER, cards_market_score INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(team_id, season_external_id)
);

-- ── Team identity / motivation ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_playing_style (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL UNIQUE REFERENCES teams(id),
  playing_style TEXT, possession_score INTEGER, passing_style TEXT,
  attacking_style TEXT, defensive_style TEXT, style_confidence INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_motivation (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL UNIQUE REFERENCES teams(id),
  overall_motivation_score INTEGER, motivation_band TEXT,
  momentum_factor INTEGER, quality_factor INTEGER, venue_factor INTEGER,
  fatigue_factor INTEGER, external_motivation INTEGER,
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
CREATE TABLE IF NOT EXISTS player_match_impact (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  player_id BIGINT NOT NULL REFERENCES players(id),
  impact_score INTEGER, importance_score INTEGER, readiness_score INTEGER,
  fatigue_score INTEGER, form_rating INTEGER, goal_threat INTEGER, assist_threat INTEGER,
  defensive_contribution INTEGER, creativity_score INTEGER, experience_score INTEGER,
  big_game_performance INTEGER, matchup_advantage INTEGER, matchup_disadvantage INTEGER,
  impact_band TEXT, expected_contribution TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, player_id)
);
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
CREATE TABLE IF NOT EXISTS match_performance_comparison (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_team_id BIGINT NOT NULL REFERENCES teams(id),
  away_team_id BIGINT NOT NULL REFERENCES teams(id),
  overall_home_score INTEGER, overall_away_score INTEGER, overall_advantage INTEGER,
  overall_advantage_team_id BIGINT REFERENCES teams(id),
  attacking_home_score INTEGER, attacking_away_score INTEGER, attacking_advantage INTEGER,
  defensive_home_score INTEGER, defensive_away_score INTEGER, defensive_advantage INTEGER,
  midfield_home_score INTEGER, midfield_away_score INTEGER, midfield_advantage INTEGER,
  tactical_home_score INTEGER, tactical_away_score INTEGER, tactical_advantage INTEGER,
  set_piece_home_score INTEGER, set_piece_away_score INTEGER, set_piece_advantage INTEGER,
  form_home_score INTEGER, form_away_score INTEGER, form_advantage INTEGER,
  home_win_probability NUMERIC, draw_probability NUMERIC, away_win_probability NUMERIC,
  predicted_winner_id BIGINT REFERENCES teams(id), prediction_confidence INTEGER,
  expected_goal_difference NUMERIC, most_likely_score TEXT, match_significance INTEGER,
  confidence_band TEXT, home_goals INTEGER, away_goals INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);
CREATE TABLE IF NOT EXISTS match_impact_summary (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  significance_score INTEGER, importance_band TEXT, rivalry_score INTEGER, momentum_at_stake INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);

-- ── Versatility / formation / depth suite ─────────────────────────────────
CREATE TABLE IF NOT EXISTS team_versatility (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id), team_id BIGINT NOT NULL REFERENCES teams(id),
  overall_versatility_score INTEGER, tactical_versatility_score INTEGER,
  positional_versatility_score INTEGER, formation_flexibility_score INTEGER,
  player_adaptability_score INTEGER, system_compatibility_score INTEGER,
  versatility_band TEXT, strengths TEXT[], weaknesses TEXT[],
  preferred_formations TEXT[], alternative_formations TEXT[], formation_changes_per_match NUMERIC,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id, team_id)
);
CREATE TABLE IF NOT EXISTS versatility_advantage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  advantage_score INTEGER, advantage_team_id BIGINT REFERENCES teams(id), advantage_margin INTEGER,
  advantage_band TEXT, key_advantages TEXT[], key_disadvantages TEXT[], confidence_score INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);
CREATE TABLE IF NOT EXISTS tactical_flexibility (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_flexibility_score INTEGER, away_flexibility_score INTEGER,
  home_system_count INTEGER, away_system_count INTEGER,
  home_formation_adaptability INTEGER, away_formation_adaptability INTEGER,
  home_in_game_adaptability INTEGER, away_in_game_adaptability INTEGER,
  flexibility_advantage INTEGER, flexibility_notes TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);
CREATE TABLE IF NOT EXISTS position_adaptability (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_position_versatility INTEGER, away_position_versatility INTEGER,
  home_multi_position_players INTEGER, away_multi_position_players INTEGER,
  home_utility_players INTEGER, away_utility_players INTEGER,
  home_specialist_players INTEGER, away_specialist_players INTEGER,
  adaptability_advantage INTEGER, position_coverage_score INTEGER,
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
CREATE TABLE IF NOT EXISTS substitution_impact (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_bench_strength INTEGER, away_bench_strength INTEGER,
  home_substitution_quality INTEGER, away_substitution_quality INTEGER,
  home_tactical_sub_options INTEGER, away_tactical_sub_options INTEGER,
  home_game_changers INTEGER, away_game_changers INTEGER,
  home_depth_score INTEGER, away_depth_score INTEGER, substitution_advantage INTEGER, impact_notes TEXT,
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
CREATE TABLE IF NOT EXISTS match_squad_depth_comparison (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_team_id BIGINT NOT NULL REFERENCES teams(id), away_team_id BIGINT NOT NULL REFERENCES teams(id),
  home_overall_depth_score INTEGER, away_overall_depth_score INTEGER,
  home_depth_rating TEXT, away_depth_rating TEXT,
  home_quality_drop_off INTEGER, away_quality_drop_off INTEGER,
  depth_advantage_score INTEGER, depth_advantage_team_id BIGINT REFERENCES teams(id),
  depth_advantage_margin INTEGER, depth_advantage_band TEXT,
  home_rotation_capability INTEGER, away_rotation_capability INTEGER,
  home_substitution_impact INTEGER, away_substitution_impact INTEGER, rotation_advantage INTEGER,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
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
CREATE TABLE IF NOT EXISTS formation_matchup (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  home_formation_vs_away TEXT, away_formation_vs_home TEXT, matchup_effectiveness INTEGER,
  home_advantages TEXT[], away_advantages TEXT[], neutral_areas TEXT[], key_matchups JSONB[], tactical_notes TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(), UNIQUE(match_id)
);

-- ── Read policies for the anon key ────────────────────────────────────────
-- The frontend reads with the public anon key. Enable RLS and add a
-- read-only (SELECT) policy on each new table. Adjust if you want stricter
-- access. Writes should come from the service-role pipeline only.
DO $$
DECLARE t TEXT;
DECLARE tbls TEXT[] := ARRAY[
  'team_betting_intelligence','team_playing_style','team_motivation',
  'team_strength_dashboard','team_strengths','team_weaknesses',
  'player_match_impact','player_matchup','match_positional_matchups',
  'match_key_battles','match_tactical_advantages','team_match_impact',
  'match_impact_advantage','match_performance_comparison','match_impact_summary',
  'team_versatility','versatility_advantage','tactical_flexibility',
  'position_adaptability','formation_options','substitution_impact',
  'injury_adaptability','player_versatility','position_coverage','squad_depth',
  'match_squad_depth_comparison','position_depth_comparison',
  'team_tactical_variations','formation_analysis','formation_matchup'
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
-- these tables. Until they contain rows, the matching UI sections show their
-- empty state. Priority order for maximum UI payoff:
--   1. team_betting_intelligence  → flips the team Attack/Defence/Betting tabs
--      from runtime-derived to pure reads.
--   2. team_playing_style         → precomputed style identity.
--   3. formation_analysis / formation_matchup → richer lineup/formation views.
-- ============================================================================

-- ── Half-time intelligence (added: match hub Signals → Half-Time tab reads
--    this when populated; the tab degrades gracefully to signals-only
--    without it) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_half_time_intelligence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id BIGINT NOT NULL UNIQUE REFERENCES matches(id),
  home_ht_win_prob NUMERIC, draw_ht_prob NUMERIC, away_ht_win_prob NUMERIC,
  predicted_ht_goals_home NUMERIC, predicted_ht_goals_away NUMERIC,
  hh_prob NUMERIC, hd_prob NUMERIC, ha_prob NUMERIC,
  dh_prob NUMERIC, dd_prob NUMERIC, da_prob NUMERIC,
  ah_prob NUMERIC, ad_prob NUMERIC, aa_prob NUMERIC,
  home_2h_goals NUMERIC, away_2h_goals NUMERIC,
  over_0_5_2h_prob NUMERIC, over_1_5_2h_prob NUMERIC, btts_2h_prob NUMERIC,
  confidence_score NUMERIC, confidence_band TEXT,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE match_half_time_intelligence ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_half_time_intelligence' AND policyname='public_read') THEN
    CREATE POLICY public_read ON match_half_time_intelligence FOR SELECT USING (true);
  END IF;
END $$;
