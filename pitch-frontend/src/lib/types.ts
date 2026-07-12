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
  points_vs_top?: number | null;
  points_vs_mid?: number | null;
  points_vs_bottom?: number | null;
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
