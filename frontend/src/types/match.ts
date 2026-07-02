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
  position_code: string;
  rank_in_position: number;
  matches_started: number;
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