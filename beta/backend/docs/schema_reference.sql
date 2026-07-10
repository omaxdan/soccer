-- ═══════════════════════════════════════════════════════════════════════════
-- NinetyData RIP — Full Database Schema Reference
-- ═══════════════════════════════════════════════════════════════════════════
-- This file is a REFERENCE SNAPSHOT for developer/AI context — not meant to
-- be executed. It reflects the schema as of the FM-UI redesign session.
-- The actual source of truth is Supabase; this file exists so anyone
-- (human or AI) picking up this project can see the full schema without
-- needing live DB access.
--
-- Actual executable migrations live in backend/supabase/migrations/*.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.countries (
  id bigint NOT NULL DEFAULT nextval('countries_id_seq'::regclass),
  name text NOT NULL UNIQUE,
  alpha2 text,
  slug text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT countries_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tournaments (
  id bigint NOT NULL DEFAULT nextval('tournaments_id_seq'::regclass),
  external_id bigint NOT NULL UNIQUE,
  name text NOT NULL,
  slug text,
  country_id bigint,
  category text,
  created_at timestamp with time zone DEFAULT now(),
  logo_storage_path text,
  CONSTRAINT tournaments_pkey PRIMARY KEY (id),
  CONSTRAINT tournaments_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.countries(id)
);

CREATE TABLE public.seasons (
  id bigint NOT NULL DEFAULT nextval('seasons_id_seq'::regclass),
  external_id bigint NOT NULL UNIQUE,
  name text,
  year text,
  tournament_id bigint,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT seasons_pkey PRIMARY KEY (id),
  CONSTRAINT seasons_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id)
);

CREATE TABLE public.teams (
  id bigint NOT NULL DEFAULT nextval('teams_id_seq'::regclass),
  external_id bigint NOT NULL UNIQUE,
  name text NOT NULL,
  short_name text,
  country text,
  slug text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  stadium_id bigint,
  crest_storage_path text,
  CONSTRAINT teams_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_stadium FOREIGN KEY (stadium_id) REFERENCES public.stadiums(id)
);

CREATE TABLE public.players (
  id bigint NOT NULL DEFAULT nextval('players_id_seq'::regclass),
  external_id bigint NOT NULL UNIQUE,
  name text NOT NULL,
  position text,
  nationality text,
  date_of_birth date,
  market_value bigint,
  team_id bigint,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  preferred_foot text,
  contract_until date,
  height_cm integer,
  jersey_number integer,
  position_detailed text,
  current_injury boolean DEFAULT false,
  injury_status text,
  injury_reason text,
  injury_return_days integer,
  primary_position text,
  secondary_position text,
  tertiary_position text,
  nationality_code text,
  injury_expected_return_days integer,
  injury_end_timestamp bigint,
  injury_start_timestamp bigint,
  injury_updated_timestamp bigint,
  injury_severity_score numeric,
  short_name text,
  CONSTRAINT players_pkey PRIMARY KEY (id),
  CONSTRAINT players_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.matches (
  id bigint NOT NULL DEFAULT nextval('matches_id_seq'::regclass),
  external_match_id bigint NOT NULL UNIQUE,
  home_team_id bigint NOT NULL,
  away_team_id bigint NOT NULL,
  date timestamp with time zone NOT NULL,
  competition text,
  season text,
  status text NOT NULL DEFAULT 'scheduled'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  venue_id bigint,
  CONSTRAINT matches_pkey PRIMARY KEY (id),
  CONSTRAINT matches_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES public.teams(id),
  CONSTRAINT matches_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES public.teams(id),
  CONSTRAINT fk_match_venue FOREIGN KEY (venue_id) REFERENCES public.stadiums(id)
);

CREATE TABLE public.match_results (
  id bigint NOT NULL DEFAULT nextval('match_results_id_seq'::regclass),
  match_id bigint NOT NULL UNIQUE,
  home_score integer,
  away_score integer,
  half_time_home_score integer,
  half_time_away_score integer,
  winner_team_id bigint,
  status text NOT NULL DEFAULT 'scheduled'::text,
  updated_at timestamp with time zone DEFAULT now(),
  match_date timestamp with time zone,
  CONSTRAINT match_results_pkey PRIMARY KEY (id),
  CONSTRAINT match_results_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id),
  CONSTRAINT match_results_winner_team_id_fkey FOREIGN KEY (winner_team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.team_squads_snapshot (
  id bigint NOT NULL DEFAULT nextval('team_squads_snapshot_id_seq'::regclass),
  team_id bigint NOT NULL,
  snapshot_date date NOT NULL,
  players_count integer,
  avg_age numeric,
  foreign_players_count integer,
  domestic_players_count integer,
  created_at timestamp with time zone DEFAULT now(),
  average_market_value bigint,
  injured_player_count integer DEFAULT 0,
  foreign_player_pct numeric,
  injured_player_pct numeric,
  CONSTRAINT team_squads_snapshot_pkey PRIMARY KEY (id),
  CONSTRAINT team_squads_snapshot_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.player_transfers (
  id bigint NOT NULL DEFAULT nextval('player_transfers_id_seq'::regclass),
  player_id bigint NOT NULL,
  from_team_id bigint,
  to_team_id bigint,
  transfer_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  transfer_fee bigint,
  transfer_fee_currency text,
  transfer_type integer,
  source text DEFAULT 'squad_diff'::text,
  CONSTRAINT player_transfers_pkey PRIMARY KEY (id),
  CONSTRAINT player_transfers_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id),
  CONSTRAINT player_transfers_from_team_id_fkey FOREIGN KEY (from_team_id) REFERENCES public.teams(id),
  CONSTRAINT player_transfers_to_team_id_fkey FOREIGN KEY (to_team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.team_form_history (
  id bigint NOT NULL DEFAULT nextval('team_form_history_id_seq'::regclass),
  team_id bigint NOT NULL,
  match_id bigint NOT NULL,
  result character NOT NULL,
  goals_for integer,
  goals_against integer,
  points integer,
  created_at timestamp with time zone DEFAULT now(),
  match_date timestamp with time zone,
  CONSTRAINT team_form_history_pkey PRIMARY KEY (id),
  CONSTRAINT team_form_history_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_form_history_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id)
);

CREATE TABLE public.team_intelligence (
  id bigint NOT NULL DEFAULT nextval('team_intelligence_id_seq'::regclass),
  team_id bigint NOT NULL UNIQUE,
  readiness_score numeric,
  fatigue_index numeric,
  rotation_pressure_index numeric,
  form_index numeric,
  last_5_points integer,
  last_10_points integer,
  congestion_score numeric,
  rest_days_avg numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  travel_fatigue_score numeric,
  travel_load_km numeric,
  active_competitions integer DEFAULT 0,
  squad_stability_score numeric,
  injury_burden_score numeric,
  squad_depth_score numeric,
  injured_market_value bigint DEFAULT 0,
  available_market_value bigint DEFAULT 0,
  CONSTRAINT team_intelligence_pkey PRIMARY KEY (id),
  CONSTRAINT team_intelligence_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);
-- NOTE: single row per team — CURRENT snapshot only, no history. See
-- SCHEMA_GAP_ANALYSIS.md for why this blocks the "Trend (Last 14 Days)"
-- chart shown in the Team Detail and League Detail mockups.

CREATE TABLE public.player_intelligence (
  id bigint NOT NULL DEFAULT nextval('player_intelligence_id_seq'::regclass),
  player_id bigint NOT NULL UNIQUE,
  load_index numeric,
  fatigue_score numeric,
  matches_last_7_days integer,
  matches_last_30_days integer,
  minutes_last_7_days integer,
  minutes_last_30_days integer,
  transfers_last_12_months integer,
  avg_minutes_per_match numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT player_intelligence_pkey PRIMARY KEY (id),
  CONSTRAINT player_intelligence_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id)
);
-- NOTE: no composite "readiness_score" column — see SCHEMA_GAP_ANALYSIS.md.
-- Team Detail mockup's "Key Players" table shows a per-player READINESS
-- column that has no direct source here.

CREATE TABLE public.match_intelligence (
  id bigint NOT NULL DEFAULT nextval('match_intelligence_id_seq'::regclass),
  match_id bigint NOT NULL UNIQUE,
  home_readiness numeric,
  away_readiness numeric,
  readiness_gap numeric,
  congestion_factor numeric,
  home_rest_days numeric,
  away_rest_days numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  home_travel_distance_km numeric,
  away_travel_distance_km numeric,
  travel_advantage_score numeric,
  home_active_competitions integer DEFAULT 0,
  away_active_competitions integer DEFAULT 0,
  home_injury_score numeric,
  away_injury_score numeric,
  home_squad_stability numeric,
  away_squad_stability numeric,
  home_strength_rating numeric,
  away_strength_rating numeric,
  home_venue_advantage numeric,
  away_venue_advantage numeric,
  home_positional_depth numeric,
  away_positional_depth numeric,
  home_available_market_value bigint,
  away_available_market_value bigint,
  home_injured_market_value bigint,
  away_injured_market_value bigint,
  motivation_gap numeric,
  match_date timestamp with time zone,
  predicted_home_goals numeric,
  predicted_away_goals numeric,
  predicted_scorelines jsonb,
  CONSTRAINT match_intelligence_pkey PRIMARY KEY (id),
  CONSTRAINT match_intelligence_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id)
);

CREATE TABLE public.team_fixture_load (
  id bigint NOT NULL DEFAULT nextval('team_fixture_load_id_seq'::regclass),
  team_id bigint NOT NULL,
  matches_last_7_days integer,
  matches_last_14_days integer,
  matches_last_30_days integer,
  avg_rest_days numeric,
  min_rest_days integer,
  congestion_score numeric,
  snapshot_date date NOT NULL,
  calculated_at timestamp with time zone DEFAULT now(),
  matches_next_7_days integer,
  matches_next_14_days integer,
  CONSTRAINT team_fixture_load_pkey PRIMARY KEY (id),
  CONSTRAINT team_fixture_load_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.stadiums (
  id bigint NOT NULL DEFAULT nextval('stadiums_id_seq'::regclass),
  external_id bigint UNIQUE,
  name text NOT NULL,
  city text,
  state_region text,
  country text NOT NULL,
  latitude numeric,
  longitude numeric,
  elevation_meters integer,
  timezone text,
  capacity integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stadiums_pkey PRIMARY KEY (id)
);
-- NOTE: no `surface` column. Mockup's Match Quick Facts shows "Surface: Grass".

CREATE TABLE public.team_locations (
  team_id bigint NOT NULL,
  stadium_id bigint,
  city text,
  country text,
  latitude numeric,
  longitude numeric,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_locations_pkey PRIMARY KEY (team_id),
  CONSTRAINT fk_team_locations_team FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT fk_team_locations_stadium FOREIGN KEY (stadium_id) REFERENCES public.stadiums(id)
);

CREATE TABLE public.team_travel_load (
  id bigint NOT NULL DEFAULT nextval('team_travel_load_id_seq'::regclass),
  team_id bigint NOT NULL,
  snapshot_date date NOT NULL,
  km_last_7_days numeric DEFAULT 0,
  km_last_14_days numeric DEFAULT 0,
  km_last_30_days numeric DEFAULT 0,
  away_matches_last_7_days integer DEFAULT 0,
  away_matches_last_14_days integer DEFAULT 0,
  away_matches_last_30_days integer DEFAULT 0,
  avg_trip_distance_km numeric,
  travel_fatigue_score numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_travel_load_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_travel_load_team FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.match_travel_intelligence (
  id bigint NOT NULL DEFAULT nextval('match_travel_intelligence_id_seq'::regclass),
  match_id bigint NOT NULL UNIQUE,
  home_team_distance_km numeric,
  away_team_distance_km numeric,
  travel_advantage_km numeric,
  travel_advantage_team_id bigint,
  calculated_at timestamp with time zone DEFAULT now(),
  match_date timestamp with time zone,
  CONSTRAINT match_travel_intelligence_pkey PRIMARY KEY (id),
  CONSTRAINT fk_match_travel_match FOREIGN KEY (match_id) REFERENCES public.matches(id)
);

CREATE TABLE public.player_injuries (
  id bigint NOT NULL DEFAULT nextval('player_injuries_id_seq'::regclass),
  player_id bigint NOT NULL,
  injury_reason text,
  injury_status text,
  expected_return_days integer,
  start_timestamp bigint,
  end_timestamp bigint,
  updated_timestamp bigint,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  days_out integer,
  injury_severity_score numeric,
  position_at_injury text,
  market_value_at_injury bigint,
  CONSTRAINT player_injuries_pkey PRIMARY KEY (id),
  CONSTRAINT fk_player_injuries_player FOREIGN KEY (player_id) REFERENCES public.players(id)
);

CREATE TABLE public.player_match_load (
  id bigint NOT NULL DEFAULT nextval('player_match_load_id_seq'::regclass),
  player_id bigint NOT NULL,
  match_id bigint,
  match_date date NOT NULL,
  minutes_played integer,
  started boolean DEFAULT false,
  substitute boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT player_match_load_pkey PRIMARY KEY (id),
  CONSTRAINT fk_player_match_load_player FOREIGN KEY (player_id) REFERENCES public.players(id),
  CONSTRAINT fk_player_match_load_match FOREIGN KEY (match_id) REFERENCES public.matches(id)
);

CREATE TABLE public.team_strength_ratings (
  id bigint NOT NULL DEFAULT nextval('team_strength_ratings_id_seq'::regclass),
  team_id bigint NOT NULL UNIQUE,
  league_position integer,
  points_per_game numeric,
  win_percentage numeric,
  strength_score numeric,
  market_value_eur bigint,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_strength_ratings_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_strength_team FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.team_venue_performance (
  id bigint NOT NULL DEFAULT nextval('team_venue_performance_id_seq'::regclass),
  team_id bigint NOT NULL UNIQUE,
  home_matches integer DEFAULT 0,
  away_matches integer DEFAULT 0,
  home_points_per_game numeric,
  away_points_per_game numeric,
  home_win_pct numeric,
  away_win_pct numeric,
  home_goal_diff numeric,
  away_goal_diff numeric,
  venue_advantage_score numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_venue_performance_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_venue_team FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.match_weather (
  id bigint NOT NULL DEFAULT nextval('match_weather_id_seq'::regclass),
  match_id bigint UNIQUE,
  temperature_c numeric,
  humidity numeric,
  wind_speed_kmh numeric,
  weather_condition text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT match_weather_pkey PRIMARY KEY (id),
  CONSTRAINT fk_match_weather_match FOREIGN KEY (match_id) REFERENCES public.matches(id)
);
-- NOTE: table exists but is EMPTY (0 rows) as of last DB check — no sync
-- job currently populates it. Match Quick Facts mockup shows weather/wind.

CREATE TABLE public.team_position_depth (
  id bigint NOT NULL DEFAULT nextval('team_position_depth_id_seq'::regclass),
  team_id bigint NOT NULL,
  position_code text NOT NULL,
  player_count integer DEFAULT 0,
  injured_count integer DEFAULT 0,
  available_count integer DEFAULT 0,
  total_market_value bigint DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_position_depth_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_position_depth_team FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.team_transfer_intelligence (
  id bigint NOT NULL DEFAULT nextval('team_transfer_intelligence_id_seq'::regclass),
  team_id bigint NOT NULL UNIQUE,
  transfers_in integer DEFAULT 0,
  transfers_out integer DEFAULT 0,
  retained_players integer DEFAULT 0,
  retention_percentage numeric,
  transfer_activity_score numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_transfer_intelligence_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_transfer_team FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE public.player_season_statistics (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  player_id bigint NOT NULL,
  team_id bigint NOT NULL,
  tournament_id bigint,
  season_external_id bigint NOT NULL,
  rating numeric,
  total_rating numeric,
  count_rating integer,
  appearances integer,
  matches_started integer,
  minutes_played integer,
  goals integer,
  assists integer,
  expected_goals numeric,
  expected_assists numeric,
  yellow_cards integer,
  red_cards integer,
  played_enough boolean DEFAULT false,
  calculated_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT player_season_statistics_pkey PRIMARY KEY (id),
  CONSTRAINT player_season_statistics_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id),
  CONSTRAINT player_season_statistics_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT player_season_statistics_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id)
);

CREATE TABLE public.team_season_statistics (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  team_id bigint NOT NULL,
  tournament_id bigint,
  season_external_id bigint NOT NULL,
  matches integer,
  goals_scored integer,
  goals_conceded integer,
  clean_sheets integer,
  avg_possession numeric,
  avg_rating numeric,
  total_passes integer,
  accurate_passes_pct numeric,
  duels_won_pct numeric,
  aerial_duels_won_pct numeric,
  tackles integer,
  interceptions integer,
  yellow_cards integer,
  red_cards integer,
  big_chances_created integer,
  big_chances_missed integer,
  calculated_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_season_statistics_pkey PRIMARY KEY (id),
  CONSTRAINT team_season_statistics_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_season_statistics_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id)
);

CREATE TABLE public.match_predicted_lineups (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  match_id bigint NOT NULL,
  team_id bigint NOT NULL,
  player_id bigint NOT NULL,
  position_code text,
  rank_in_position integer,
  matches_started integer,
  confidence numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT match_predicted_lineups_pkey PRIMARY KEY (id),
  CONSTRAINT match_predicted_lineups_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id),
  CONSTRAINT match_predicted_lineups_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT match_predicted_lineups_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id)
);

CREATE TABLE public.tournament_standings (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tournament_id bigint NOT NULL,
  team_id bigint NOT NULL,
  season_external_id bigint NOT NULL,
  standings_type text NOT NULL DEFAULT 'total'::text,
  position integer,
  matches integer,
  wins integer,
  draws integer,
  losses integer,
  scores_for integer,
  scores_against integer,
  points integer,
  calculated_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tournament_standings_pkey PRIMARY KEY (id),
  CONSTRAINT tournament_standings_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id),
  CONSTRAINT tournament_standings_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);
-- KEY JOIN PATH: this is the ONLY table linking teams to tournaments with
-- a season context. "Readiness by league" (Leagues Overview mockup) is
-- built by joining team_intelligence -> tournament_standings -> tournaments,
-- NOT via any direct tournament_id on team_intelligence itself.

CREATE TABLE public.platform_daily_summary (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  summary_date date NOT NULL UNIQUE,
  matches_today integer DEFAULT 0,
  competitions_today integer DEFAULT 0,
  teams_tracked integer DEFAULT 0,
  competitions_tracked integer DEFAULT 0,
  readiness_calculated_count integer DEFAULT 0,
  avg_readiness numeric,
  last_sync_at timestamp with time zone,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT platform_daily_summary_pkey PRIMARY KEY (id)
);
