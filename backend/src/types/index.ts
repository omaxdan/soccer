// SportsAPI Response Types

export interface SportsAPICountry {
  id: number;
  name: string;
  flag?: string;
}

export interface SportsAPITournament {
  id: number;
  name: string;
  logo?: string;
  country?: {
    id: number;
    name: string;
  };
  type?: string;
}

export interface SportsAPISeason {
  id: number;
  year: string;
  start: string;
  end: string;
  isCurrent: boolean;
}

export interface SportsAPITeam {
  id: number;
  name: string;
  shortName?: string;
  logo?: string;
  country?: string;
  founded?: number;
}

export interface SportsAPIPlayer {
  id: number;
  name: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  nationality?: string;
  dateOfBirth?: string;
  height?: number;
  weight?: number;
  photo?: string;
  market_value?: number;
}

export interface SportsAPIMatch {
  id: number;
  fixture?: {
    id: number;
    date: string;
    timestamp: number;
    timezone: string;
    week?: number;
    status: {
      long: string;
      short: string;
      elapsed?: number;
    };
  };
  league?: {
    id: number;
    name: string;
    country: string;
    logo?: string;
    flag?: string;
    season: number;
    round: string;
  };
  teams?: {
    home: SportsAPITeam;
    away: SportsAPITeam;
  };
  goals?: {
    home: number | null;
    away: number | null;
  };
  score?: {
    halftime: {
      home: number | null;
      away: number | null;
    };
    fulltime: {
      home: number | null;
      away: number | null;
    };
    extratime?: {
      home: number | null;
      away: number | null;
    };
    penalty?: {
      home: number | null;
      away: number | null;
    };
  };
}

export interface SportsAPIEvent {
  type: string;
  detail?: string;
  time: {
    elapsed: number;
    extra?: number;
  };
  team: SportsAPITeam;
  player?: SportsAPIPlayer;
  assist?: SportsAPIPlayer;
  comments?: string;
}

// Domain Model Types (for Supabase storage)

export interface Country {
  id: number;
  name: string;
  alpha2: string | null;
  slug: string | null;
  created_at: string;
}

export interface Tournament {
  id: number;
  external_id: number;
  name: string;
  slug: string | null;
  country_id: number | null;
  category: string | null;
  created_at: string;
}

export interface Season {
  id: number;
  external_id: number;
  name: string | null;
  year: string | null;
  tournament_id: number | null;
  created_at: string;
}

export interface Team {
  id: number;
  external_id: number;
  name: string;
  short_name: string | null;
  country: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: number;
  external_id: number;
  name: string;
  position: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  market_value: number | null;
  team_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: number;
  external_match_id: number;
  home_team_id: number;
  away_team_id: number;
  date: string;
  competition: string | null;
  season: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MatchResult {
  id: number;
  match_id: number;
  home_score: number | null;
  away_score: number | null;
  half_time_home_score: number | null;
  half_time_away_score: number | null;
  winner_team_id: number | null;
  status: string;
  updated_at: string;
}

export interface TeamSquadSnapshot {
  id: number;
  team_id: number;
  snapshot_date: string;
  players_count: number | null;
  avg_age: number | null;
  foreign_players_count: number | null;
  domestic_players_count: number | null;
  created_at: string;
}

export interface PlayerTransfer {
  id: number;
  player_id: number;
  from_team_id: number | null;
  to_team_id: number | null;
  transfer_date: string;
  created_at: string;
}

export interface TeamFormHistory {
  id: number;
  team_id: number;
  match_id: number;
  match_date: string;  // denormalized — see migration 007, avoids join for form/recency calcs
  result: string;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  // ── enriched fields added in migration 021 ──
  is_home: boolean | null;             // denormalized from matches — eliminates JOIN for venue-split narratives
  half_time_score_for: number | null;  // denormalized from match_results — eliminates JOIN for HT narratives
  half_time_score_against: number | null;
  btts: boolean | null;                // goals_for > 0 AND goals_against > 0, precomputed
  created_at: string;
}

// Job Status & Tracking

export interface JobRun {
  jobName: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'success' | 'failed';
  error?: string;
  recordsProcessed?: number;
}
