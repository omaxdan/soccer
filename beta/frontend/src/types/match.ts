// src/types/match.ts

export interface MatchPlayer {
  id: number;
  name: string;
  position: string;
  jersey_number: number;
  primary_position: string;
  current_injury: boolean;
}

export interface PredictedLineupPlayer {
  team_id: number;
  player_id: number;
  /**
   * Tactical slot assigned by the backend lineup engine ('RB', 'RCB', 'LCM',
   * 'LW', ...) since migration 025. Rows written before that hold a broad
   * G/D/M/F letter instead — use positionZone() from lib/insights rather than
   * comparing this field directly.
   */
  position_code: string;
  /** Broad zone: 'G' | 'D' | 'M' | 'F'. Null on pre-025 rows. */
  position_group?: string | null;
  /** Same value as position_code, under an unambiguous name. */
  tactical_position?: string | null;
  /** The player's own natural position, which may differ from the slot. */
  natural_position?: string | null;
  /** Formation the engine selected for this team in this match, e.g. '4-2-3-1'. */
  formation?: string | null;
  /** Render order across the XI, 1..11 (1 = GK). Not a depth-chart rank. */
  lineup_order?: number | null;
  /** Pitch coordinates, 0-100. x: 0 = left touchline. y: 0 = opponent goal. */
  x?: number | null;
  y?: number | null;
  /** Slot role label, e.g. 'centre-back'. */
  role?: string | null;
  /** 0-100 selection score, normalized within the squad. */
  weighted_score?: number | null;
  /** 0-1 fit of this player to this slot. */
  suitability?: number | null;
  is_captain?: boolean | null;
  is_vice_captain?: boolean | null;
  /** Depth-chart rank within the position family (CB 1, CB 2, CM 1, ...). */
  rank_in_position: number;
  matches_started: number;
  minutes_played?: number | null;
  /** 0-1. */
  confidence: number;
  players: MatchPlayer;
}

export interface MatchTeam {
  id: number;
  name: string;
  short_name: string;
  slug: string;
  country: string;
  crest_storage_path: string;
}

export interface MatchIntelligence {
  home_readiness: number;
  away_readiness: number;
  readiness_gap: number;
  congestion_factor: number;
  home_rest_days: number;
  away_rest_days: number;
  home_travel_distance_km: number;
  away_travel_distance_km: number;
  travel_advantage_score: number;
  home_active_competitions: number;
  away_active_competitions: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  predicted_scorelines: Array<{ home: number; away: number; probability: number }>;
}

export interface MatchTravelIntelligence {
  home_team_distance_km: number;
  away_team_distance_km: number;
  travel_advantage_km: number;
  travel_advantage_team_id: number;
}

export interface MatchResult {
  home_score: number;
  away_score: number;
  half_time_home_score: number;
  half_time_away_score: number;
  winner_team_id: number;
  status: string;
}

export interface Match {
  id: number;
  date: string;
  competition: string;
  season: string;
  status: string;
  home_team_id: number;
  away_team_id: number;
  home_team: MatchTeam;
  away_team: MatchTeam;
  venue: {
    id: number;
    name: string;
    city: string;
    country: string;
    latitude: number;
    longitude: number;
    capacity: number;
    timezone: string;
  };
  match_results: MatchResult[];
  match_intelligence: MatchIntelligence[];
  match_travel_intelligence: MatchTravelIntelligence[];
  match_predicted_lineups: PredictedLineupPlayer[];
}