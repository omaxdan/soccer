-- ─── MIGRATION 028 — Extended Intelligence Suite (12 processors) ───────────
-- Tables for the 12 processors actually implemented in
-- processExtendedIntelligence.ts. Scoped to exactly those 12 — the wider
-- scaffolding proposal included ~30 tables; the other ~18 have no writer
-- yet, so creating them now would just be empty-forever schema noise.
-- Add them in a future migration alongside whichever processor is built
-- to populate them (per that proposal's own "next step" note).

CREATE TABLE IF NOT EXISTS public.team_form_quality (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id bigint NOT NULL UNIQUE REFERENCES public.teams(id),
  window_matches integer,
  opponent_adjusted_form numeric,
  strength_of_schedule numeric,
  ppg_vs_top numeric, matches_vs_top integer,
  ppg_vs_middle numeric, matches_vs_middle integer,
  ppg_vs_bottom numeric, matches_vs_bottom integer,
  giant_killer_score numeric,
  flat_track_bully_score numeric,
  expected_points numeric,
  actual_points integer,
  performance_delta numeric,
  volatility numeric,
  calculated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.team_form_quality IS
  'Opponent-adjusted form: how a team performs against top/middle/bottom-tier opposition (tiers from team_strength_ratings.strength_score), vs raw points-based team_intelligence.form_index.';

CREATE TABLE IF NOT EXISTS public.team_betting_intelligence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id bigint NOT NULL REFERENCES public.teams(id),
  season_external_id bigint,
  attack_rating integer, defence_rating integer, team_quality_score integer,
  finishing_efficiency numeric, shot_accuracy numeric, shot_conversion_rate numeric,
  big_chance_conversion numeric, goal_creation_score integer, goal_prevention_score integer,
  defensive_fragility_score integer, clean_sheet_reliability numeric,
  attack_sustainability_score integer, consistency_score integer, volatility_score integer,
  predictability_score integer, sustainability_score integer,
  overperformance_score numeric, underperformance_score numeric,
  home_attack_rating integer, home_defence_rating integer,
  away_attack_rating integer, away_defence_rating integer,
  winner_market_score integer, goals_market_score integer, btts_score integer, cards_market_score integer,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(team_id, season_external_id)
);
COMMENT ON TABLE public.team_betting_intelligence IS
  'Attack/defence ratings and market-confidence scores derived from team_season_statistics (requires migration 026 fields: shots, shots_against, big_chances_against). Formula weights are heuristic/provisional, not backtested — see file header.';

CREATE TABLE IF NOT EXISTS public.player_match_impact (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL REFERENCES public.matches(id),
  player_id bigint NOT NULL REFERENCES public.players(id),
  impact_score integer, importance_score integer, readiness_score integer,
  fatigue_score integer, form_rating integer, goal_threat integer, assist_threat integer,
  defensive_contribution integer, creativity_score integer, experience_score integer,
  big_game_performance integer, matchup_advantage integer, matchup_disadvantage integer,
  impact_band text, expected_contribution text,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE(match_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.match_performance_comparison (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  home_team_id bigint NOT NULL REFERENCES public.teams(id),
  away_team_id bigint NOT NULL REFERENCES public.teams(id),
  overall_home_score integer, overall_away_score integer, overall_advantage integer,
  overall_advantage_team_id bigint REFERENCES public.teams(id),
  attacking_home_score integer, attacking_away_score integer, attacking_advantage integer,
  defensive_home_score integer, defensive_away_score integer, defensive_advantage integer,
  midfield_home_score integer, midfield_away_score integer, midfield_advantage integer,
  tactical_home_score integer, tactical_away_score integer, tactical_advantage integer,
  set_piece_home_score integer, set_piece_away_score integer, set_piece_advantage integer,
  form_home_score integer, form_away_score integer, form_advantage integer,
  home_win_probability numeric, draw_probability numeric, away_win_probability numeric,
  predicted_winner_id bigint REFERENCES public.teams(id), prediction_confidence integer,
  expected_goal_difference numeric, most_likely_score text, match_significance integer,
  confidence_band text, home_goals integer, away_goals integer,
  calculated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.match_performance_comparison IS
  'Head-to-head zone-by-zone comparison (attack/defence/midfield/tactical/set-piece), distinct from match_intelligence.net_battle_index (z-score-normalized) and readiness_history (the accuracy-tracked pick). This is a separate, UI-facing comparison view — its win probabilities are a simplified heuristic, NOT the Poisson-model win_probability_home/draw/away on match_intelligence, which remains the statistically grounded figure.';

CREATE TABLE IF NOT EXISTS public.team_versatility (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL REFERENCES public.matches(id),
  team_id bigint NOT NULL REFERENCES public.teams(id),
  overall_versatility_score integer, tactical_versatility_score integer,
  positional_versatility_score integer, formation_flexibility_score integer,
  player_adaptability_score integer, system_compatibility_score integer,
  versatility_band text, strengths text[], weaknesses text[],
  preferred_formations text[], alternative_formations text[], formation_changes_per_match numeric,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE(match_id, team_id)
);
COMMENT ON TABLE public.team_versatility IS
  'Per-MATCH versatility snapshot from that match''s own predicted_lineups row. Distinct from team_intelligence.lineup_versatility_score (migration 020), which is a team-level rolling scalar from the latest predicted-XI occurrence per player across ALL matches, not scoped to one fixture. Both are legitimate, answering different questions (this match specifically vs. general team character).';

CREATE TABLE IF NOT EXISTS public.formation_matchup (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  home_formation_vs_away text, away_formation_vs_home text, matchup_effectiveness integer,
  home_advantages text[], away_advantages text[], neutral_areas text[], key_matchups jsonb,
  tactical_notes text,
  calculated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.formation_matchup IS
  'CAVEAT: "detected formation" is derived from OUR OWN predicted-lineup sub-slot template (fixed 1-4-4-2 shape, see processPredictedLineups), not the club''s real historical tactical shape — so home_formation_vs_away will cluster near 4-4-2 by construction on most matches. The zone-by-zone quality comparison (advantages/key_matchups) is the meaningful part of this table; the formation label is approximate.';

CREATE TABLE IF NOT EXISTS public.position_adaptability (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  home_position_versatility integer, away_position_versatility integer,
  home_multi_position_players integer, away_multi_position_players integer,
  home_utility_players integer, away_utility_players integer,
  home_specialist_players integer, away_specialist_players integer,
  adaptability_advantage integer, position_coverage_score integer,
  calculated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tactical_flexibility (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  home_flexibility_score integer, away_flexibility_score integer,
  home_system_count integer, away_system_count integer,
  home_formation_adaptability integer, away_formation_adaptability integer,
  home_in_game_adaptability integer, away_in_game_adaptability integer,
  flexibility_advantage integer, flexibility_notes text,
  calculated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.substitution_impact (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  home_bench_strength integer, away_bench_strength integer,
  home_substitution_quality integer, away_substitution_quality integer,
  home_tactical_sub_options integer, away_tactical_sub_options integer,
  home_game_changers integer, away_game_changers integer,
  home_depth_score integer, away_depth_score integer,
  substitution_advantage integer, impact_notes text,
  calculated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.substitution_impact IS
  'Bench = team roster minus THIS MATCH''s real match_predicted_lineups XI (not an arbitrary DB-order slice), bench quality from player_strength_score (migration 027). Requires processStartingXIStrength to have run first for the match.';

CREATE TABLE IF NOT EXISTS public.match_squad_depth_comparison (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  home_team_id bigint NOT NULL REFERENCES public.teams(id),
  away_team_id bigint NOT NULL REFERENCES public.teams(id),
  home_overall_depth_score integer, away_overall_depth_score integer,
  home_depth_rating text, away_depth_rating text,
  home_quality_drop_off integer, away_quality_drop_off integer,
  depth_advantage_score integer, depth_advantage_team_id bigint REFERENCES public.teams(id),
  depth_advantage_margin integer, depth_advantage_band text,
  home_rotation_capability integer, away_rotation_capability integer,
  home_substitution_impact integer, away_substitution_impact integer, rotation_advantage integer,
  calculated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.team_motivation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id bigint NOT NULL UNIQUE REFERENCES public.teams(id),
  overall_motivation_score integer, motivation_band text,
  momentum_factor integer, quality_factor integer, venue_factor integer,
  fatigue_factor integer, external_motivation integer,
  calculated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.team_motivation IS
  'Team-level table-context motivation (title race / relegation battle / mid-table apathy), distinct from match_intelligence.motivation_gap (migration 005), which is a per-FIXTURE heuristic from competition tier + active-competition count. Complementary, not redundant.';

CREATE TABLE IF NOT EXISTS public.match_impact_summary (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  significance_score integer, importance_band text, rivalry_score integer, momentum_at_stake integer,
  calculated_at timestamptz DEFAULT now()
);

-- Read policies for the anon key — writes are service-role (pipeline) only.
DO $$
DECLARE t TEXT;
DECLARE tbls TEXT[] := ARRAY[
  'team_form_quality','team_betting_intelligence','player_match_impact',
  'match_performance_comparison','team_versatility','formation_matchup',
  'position_adaptability','tactical_flexibility','substitution_impact',
  'match_squad_depth_comparison','team_motivation','match_impact_summary'
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
