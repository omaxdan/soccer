// Types mirror the NinetyData RIP warehouse (Supabase) derived tables.
// Only fields PitchTerminal actually reads are declared.

export type SignalDirection = "home" | "away" | "neutral" | "avoid";
export type RiskBand = "LOW" | "MEDIUM" | "HIGH";

export interface TeamLite {
  id: number;
  external_id: number;
  name: string;
  short_name: string | null;
  slug: string | null;
  crest_storage_path: string | null;
  country?: string | null;
}

export interface TournamentLite {
  id: number;
  external_id: number;
  name: string;
  slug: string | null;
  country?: string | null;
  category?: string | null;
  logo_storage_path?: string | null;
}

export interface MatchIntelligence {
  match_id: number;
  home_readiness: number | null;
  away_readiness: number | null;
  readiness_gap: number | null;
  home_rest_days: number | null;
  away_rest_days: number | null;
  home_travel_distance_km: number | null;
  away_travel_distance_km: number | null;
  home_injury_score: number | null;
  away_injury_score: number | null;
  home_squad_stability: number | null;
  away_squad_stability: number | null;
  home_strength_rating: number | null;
  away_strength_rating: number | null;
  home_positional_depth: number | null;
  away_positional_depth: number | null;
  predicted_home_goals: number | null;
  predicted_away_goals: number | null;
  predicted_scorelines: ScorelineProb[] | null;
  confidence_score: number | null;
  confidence_band: string | null;
  win_probability_home: number | null;
  win_probability_draw: number | null;
  win_probability_away: number | null;
  net_battle_index: number | null;
  home_xi_strength: number | null;
  away_xi_strength: number | null;
  motivation_gap?: number | null;
  congestion_factor?: number | null;
  home_venue_advantage?: number | null;
  away_venue_advantage?: number | null;
  travel_advantage_score?: number | null;
  home_active_competitions?: number | null;
  away_active_competitions?: number | null;
  home_injured_market_value?: number | null;
  away_injured_market_value?: number | null;
  home_available_market_value?: number | null;
  away_available_market_value?: number | null;
}

export interface ScorelineProb {
  score: string; // "2-1"
  home?: number;
  away?: number;
  probability: number; // 0..1 or 0..100 — normalized on read
}

export interface Headline {
  key: string;
  text: string;
}

export interface MatchOpportunity {
  match_id: number;
  opportunity_score: number;
  executive_brief: string | null;
  signals: Headline[];
  warnings: Headline[];
  score_components: Record<string, number>;
}

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
}

export interface MatchRisk {
  match_id: number;
  risk_score: number;
  risk_band: RiskBand;
  predictability_score: number;
  risk_factors: RiskFactor[];
}

export interface MarketSignal {
  id?: number;
  match_id: number;
  market: string;
  signal_group: string;
  signal_text: string;
  direction: SignalDirection;
  strength: number; // typically 1..6
  drivers: string | null;
  rule_key?: string | null;
  data_source?: string | null;
  locked?: boolean | null;
}

export interface MatchRow {
  id: number;
  external_match_id: number;
  date: string;
  status: string;
  competition: string | null;
  tournament: TournamentLite | null;
  home: TeamLite;
  away: TeamLite;
  home_score?: number | null;
  away_score?: number | null;
  venue?: string | null;
  city?: string | null;
  capacity?: number | null;
  weather?: MatchWeather | null;
  intel?: MatchIntelligence | null;
  opportunity?: MatchOpportunity | null;
  risk?: MatchRisk | null;
  signals?: MarketSignal[];
  home_form?: string | null;
  away_form?: string | null;
  halfTime?: MatchHalfTimeIntelligence | null;
  teamImpact?: { home: TeamMatchImpact | null; away: TeamMatchImpact | null };
  impactAdvantage?: MatchImpactAdvantage | null;
  keyBattles?: MatchKeyBattle[];
  positionalMatchups?: MatchPositionalMatchup[];
  tacticalAdvantages?: MatchTacticalAdvantage[];
  performanceComparison?: MatchPerformanceComparison | null;
  substitutionImpact?: SubstitutionImpact | null;
  squadDepthComparison?: MatchSquadDepthComparison | null;
  // Team context for per-signal "why" evidence — real numbers already
  // fetched for the two teams, not a match-specific derivation.
  homeBetting?: TeamBettingIntelligence | null;
  awayBetting?: TeamBettingIntelligence | null;
  homeIntel?: TeamIntelligence | null;
  awayIntel?: TeamIntelligence | null;
  homeSeasonStats?: import("./performance").TeamSeasonStats | null;
  awaySeasonStats?: import("./performance").TeamSeasonStats | null;
}

export interface TeamMatchImpact {
  match_id: number; team_id: number;
  overall_impact_score: number | null; attack_strength: number | null;
  midfield_control: number | null; defensive_strength: number | null;
  set_piece_threat: number | null; experience_level: number | null;
  form_trend: number | null; injury_impact: number | null;
  tactical_versatility: number | null; match_specific_boost: number | null;
  confidence_level: number | null; advantage_band: string | null;
}

export interface MatchImpactAdvantage {
  match_id: number; home_advantage_score: number | null; away_advantage_score: number | null;
  advantage_margin: number | null; advantage_team_id: number | null;
  key_advantages: string[] | null; key_disadvantages: string[] | null; confidence_score: number | null;
}

export interface MatchKeyBattle {
  match_id: number; battle_id: string; title: string; description: string | null;
  home_player_id: number | null; away_player_id: number | null;
  home_advantage_score: number | null; away_advantage_score: number | null;
  importance_score: number | null; expected_impact: string | null; battle_outcome_prediction: string | null;
  home_player_name?: string | null; away_player_name?: string | null;
}

export interface MatchPositionalMatchup {
  match_id: number; position_code: string;
  home_player_id: number | null; away_player_id: number | null;
  home_impact_score: number | null; away_impact_score: number | null;
  advantage_score: number | null; advantage_team_id: number | null;
  advantage_type: string | null; matchup_description: string | null;
  home_player_name?: string | null; away_player_name?: string | null;
}

export interface MatchTacticalAdvantage {
  match_id: number; advantage_type: string; description: string | null;
  home_advantage_score: number | null; away_advantage_score: number | null;
  net_advantage: number | null; advantage_team_id: number | null;
  confidence_score: number | null; tactical_notes: string | null;
}

export interface MatchPerformanceComparison {
  match_id: number; overall_home_score: number | null; overall_away_score: number | null;
  attacking_home_score: number | null; attacking_away_score: number | null;
  defensive_home_score: number | null; defensive_away_score: number | null;
  midfield_home_score: number | null; midfield_away_score: number | null;
  tactical_home_score: number | null; tactical_away_score: number | null;
  set_piece_home_score: number | null; set_piece_away_score: number | null;
  form_home_score: number | null; form_away_score: number | null;
  home_win_probability: number | null; draw_probability: number | null; away_win_probability: number | null;
  most_likely_score: string | null; confidence_band: string | null;
  match_significance: number | null; prediction_confidence: number | null;
  expected_goal_difference: number | null; predicted_winner_id: number | null;
  overall_advantage: number | null; overall_advantage_team_id: number | null;
  form_advantage: number | null; attacking_advantage: number | null;
  defensive_advantage: number | null; midfield_advantage: number | null;
  tactical_advantage: number | null; set_piece_advantage: number | null;
}

export interface SubstitutionImpact {
  match_id: number; home_bench_strength: number | null; away_bench_strength: number | null;
  home_substitution_quality: number | null; away_substitution_quality: number | null;
  home_game_changers: number | null; away_game_changers: number | null;
  substitution_advantage: number | null; impact_notes: string | null;
  home_depth_score: number | null; away_depth_score: number | null;
  home_tactical_sub_options: number | null; away_tactical_sub_options: number | null;
}

export interface MatchSquadDepthComparison {
  match_id: number; home_overall_depth_score: number | null; away_overall_depth_score: number | null;
  home_depth_rating: string | null; away_depth_rating: string | null;
  depth_advantage_band: string | null; depth_advantage_team_id: number | null;
  home_rotation_capability: number | null; away_rotation_capability: number | null;
}

export interface TeamBettingIntelligence {
  team_id: number; attack_rating: number | null; defence_rating: number | null;
  team_quality_score: number | null; finishing_efficiency: number | null;
  clean_sheet_reliability: number | null; consistency_score: number | null;
  winner_market_score: number | null; goals_market_score: number | null;
  btts_score: number | null;
}

export interface TeamMotivationData {
  team_id: number; overall_motivation_score: number | null; motivation_band: string | null;
  momentum_factor: number | null; quality_factor: number | null;
  venue_factor: number | null; external_motivation: number | null;
}

export interface TeamVersatilityLatest {
  team_id: number; overall_versatility_score: number | null; versatility_band: string | null;
  tactical_versatility_score: number | null; formation_flexibility_score: number | null;
  preferred_formations: string[] | null;
}

export interface MatchWeather {
  temperature_c: number | null;
  humidity: number | null;
  wind_speed_kmh: number | null;
  weather_condition: string | null;
}

export interface TeamIntelligence {
  team_id: number;
  readiness_score: number | null;
  fatigue_index: number | null;
  form_index: number | null;
  last_5_points: number | null;
  last_10_points: number | null;
  last_5_results: string | null;
  congestion_score: number | null;
  rest_days_avg: number | null;
  travel_load_km: number | null;
  squad_stability_score: number | null;
  injury_burden_score: number | null;
  squad_depth_score: number | null;
  active_competitions: number | null;
}

export interface TeamMomentum {
  team_id: number;
  momentum_score: number | null;
  last_5_points: number | null;
  prior_5_points: number | null;
  trend: string | null;
}

export interface TeamGoalDependency {
  team_id: number;
  total_goals: number | null;
  top_scorer_player_id: number | null;
  top_scorer_goals: number | null;
  top_scorer_pct: number | null;
  top_2_scorers_pct: number | null;
  top_scorer_no_backup: boolean | null;
}

export interface TeamInjuryImpact {
  team_id: number;
  injured_count: number | null;
  total_importance_lost: number | null;
  goals_lost: number | null;
  assists_lost: number | null;
  worst_absence_player_id: number | null;
  worst_absence_importance: number | null;
}

export interface TeamFormQuality {
  team_id: number;
  opponent_adjusted_form: number | null;
  strength_of_schedule: number | null;
  giant_killer_score: number | null;
  flat_track_bully_score: number | null;
  expected_points: number | null;
  actual_points: number | null;
  performance_delta: number | null;
  volatility: number | null;
  ppg_vs_top?: number | null;
  ppg_vs_middle?: number | null;
  ppg_vs_bottom?: number | null;
}

export interface TeamVenuePerformance {
  team_id: number;
  home_win_pct: number | null;
  away_win_pct: number | null;
  home_points_per_game: number | null;
  away_points_per_game: number | null;
  venue_advantage_score: number | null;
}

export interface PositionDepth {
  team_id: number;
  position_code: string;
  player_count: number;
  injured_count: number;
  available_count: number;
  total_market_value: number;
}

export interface PredictedLineupPlayer {
  team_id: number;
  player_id: number;
  position_code: string | null;
  secondary_position?: string | null;
  tertiary_position?: string | null;
  rank_in_position: number | null;
  confidence: number | null;
  shirt_number?: number | null;
  player?: PlayerLite;
}

export interface PlayerLite {
  id: number;
  name: string;
  short_name?: string | null;
  position?: string | null;
  current_injury?: boolean | null;
  injury_status?: string | null;
  injury_reason?: string | null;
  injury_return_days?: number | null;
  market_value?: number | null;
  intelligence?: PlayerIntelligence | null;
}

export interface PlayerIntelligence {
  player_id: number;
  readiness_score: number | null;
  fatigue_score: number | null;
  importance_score: number | null;
  load_index: number | null;
  minutes_last_30_days: number | null;
  matches_last_30_days: number | null;
  goal_share_pct: number | null;
  assist_share_pct: number | null;
  player_strength_score: number | null;
}

export interface LeagueIntelligence {
  tournament_id: number;
  team_count: number;
  avg_readiness: number | null;
  avg_form: number | null;
  avg_congestion: number | null;
  avg_travel_14d: number | null;
  avg_rest_days: number | null;
  tournament?: TournamentLite;
}

export interface LeagueGapSummary {
  league_name: string;
  total_picks: number;
  hit_rate_strict: number | null;
  hit_rate_lenient: number | null;
  lift_over_baseline: number | null;
  baseline_rate: number | null;
  readiness_status: string | null;
  meets_sample_gate: boolean;
}

export interface TournamentStanding {
  position: number | null;
  team: TeamLite;
  matches: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  scores_for: number | null;
  scores_against: number | null;
  points: number | null;
}

export interface TeamFixtureDifficulty {
  team_id: number;
  next_5_difficulty: number | null;
  next_10_difficulty: number | null;
  next_5_matches: number | null;
  next_10_matches: number | null;
}

export interface TeamBettingIntelligence {
  team_id: number;
  season_external_id: number | null;
  attack_rating: number | null;
  defence_rating: number | null;
  team_quality_score: number | null;
  finishing_efficiency: number | null;
  shot_accuracy: number | null;
  shot_conversion_rate: number | null;
  big_chance_conversion: number | null;
  goal_creation_score: number | null;
  goal_prevention_score: number | null;
  defensive_fragility_score: number | null;
  clean_sheet_reliability: number | null;
  attack_sustainability_score: number | null;
  consistency_score: number | null;
  volatility_score: number | null;
  predictability_score: number | null;
  sustainability_score: number | null;
  overperformance_score: number | null;
  underperformance_score: number | null;
  home_attack_rating: number | null;
  home_defence_rating: number | null;
  away_attack_rating: number | null;
  away_defence_rating: number | null;
  winner_market_score: number | null;
  goals_market_score: number | null;
  btts_score: number | null;
  cards_market_score: number | null;
  updated_at: string | null;
}

export interface MatchHalfTimeIntelligence {
  match_id: number;
  home_ht_win_prob: number | null;
  draw_ht_prob: number | null;
  away_ht_win_prob: number | null;
  predicted_ht_goals_home: number | null;
  predicted_ht_goals_away: number | null;
  hh_prob: number | null;
  hd_prob: number | null;
  ha_prob: number | null;
  dh_prob: number | null;
  dd_prob: number | null;
  da_prob: number | null;
  ah_prob: number | null;
  ad_prob: number | null;
  aa_prob: number | null;
  home_2h_goals: number | null;
  away_2h_goals: number | null;
  over_0_5_2h_prob: number | null;
  over_1_5_2h_prob: number | null;
  btts_2h_prob: number | null;
  confidence_score: number | null;
  confidence_band: string | null;
}
