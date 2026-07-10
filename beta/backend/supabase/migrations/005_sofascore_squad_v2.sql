-- Migration 005: NinetyData Engine V2 — SofaScore Squad Intelligence
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- All new tables and columns as per the Harmonized Build Prompt V2 Final

-- ─── PLAYERS — V2 extended fields ────────────────────────────────────────────
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS short_name              text,
  ADD COLUMN IF NOT EXISTS position_detailed       text,
  ADD COLUMN IF NOT EXISTS primary_position        text,
  ADD COLUMN IF NOT EXISTS secondary_position      text,
  ADD COLUMN IF NOT EXISTS tertiary_position       text,
  ADD COLUMN IF NOT EXISTS nationality_code        text,
  ADD COLUMN IF NOT EXISTS preferred_foot          text,
  ADD COLUMN IF NOT EXISTS height_cm               integer,
  ADD COLUMN IF NOT EXISTS jersey_number           integer,
  ADD COLUMN IF NOT EXISTS contract_until          date,
  ADD COLUMN IF NOT EXISTS current_injury          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS injury_status           text,
  ADD COLUMN IF NOT EXISTS injury_reason           text,
  ADD COLUMN IF NOT EXISTS injury_return_days      integer,
  ADD COLUMN IF NOT EXISTS injury_expected_return_days integer,
  ADD COLUMN IF NOT EXISTS injury_start_timestamp  bigint,
  ADD COLUMN IF NOT EXISTS injury_end_timestamp    bigint,
  ADD COLUMN IF NOT EXISTS injury_updated_timestamp bigint,
  ADD COLUMN IF NOT EXISTS injury_severity_score   numeric;

-- ─── TEAM_SQUADS_SNAPSHOT — V2 extended fields ───────────────────────────────
ALTER TABLE team_squads_snapshot
  ADD COLUMN IF NOT EXISTS average_market_value   bigint,
  ADD COLUMN IF NOT EXISTS goalkeeper_count        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defender_count          integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS midfielder_count        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attacker_count          integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS injured_player_count    integer DEFAULT 0;

-- ─── TEAM_INTELLIGENCE — V2 squad fields ─────────────────────────────────────
ALTER TABLE team_intelligence
  ADD COLUMN IF NOT EXISTS squad_market_value         bigint,
  ADD COLUMN IF NOT EXISTS average_squad_age          numeric,
  ADD COLUMN IF NOT EXISTS foreign_player_ratio       numeric,
  ADD COLUMN IF NOT EXISTS national_team_player_ratio numeric,
  ADD COLUMN IF NOT EXISTS injury_burden_score        numeric,
  ADD COLUMN IF NOT EXISTS total_injured_players      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_foreign_players      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_national_players     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS squad_depth_score          numeric,
  ADD COLUMN IF NOT EXISTS squad_stability_score      numeric,
  ADD COLUMN IF NOT EXISTS positional_depth_score     numeric,
  ADD COLUMN IF NOT EXISTS goalkeeper_depth           integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defender_depth             integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS midfielder_depth           integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attacker_depth             integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS injured_market_value       bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_market_value     bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_activity_score    numeric,
  ADD COLUMN IF NOT EXISTS retention_percentage       numeric;

-- ─── MATCH_INTELLIGENCE — V2 fields ──────────────────────────────────────────
ALTER TABLE match_intelligence
  ADD COLUMN IF NOT EXISTS home_injury_score          numeric,
  ADD COLUMN IF NOT EXISTS away_injury_score          numeric,
  ADD COLUMN IF NOT EXISTS home_squad_stability       numeric,
  ADD COLUMN IF NOT EXISTS away_squad_stability       numeric,
  ADD COLUMN IF NOT EXISTS home_strength_rating       numeric,
  ADD COLUMN IF NOT EXISTS away_strength_rating       numeric,
  ADD COLUMN IF NOT EXISTS home_venue_advantage       numeric,
  ADD COLUMN IF NOT EXISTS away_venue_advantage       numeric,
  ADD COLUMN IF NOT EXISTS home_positional_depth      numeric,
  ADD COLUMN IF NOT EXISTS away_positional_depth      numeric,
  ADD COLUMN IF NOT EXISTS home_available_market_value bigint,
  ADD COLUMN IF NOT EXISTS away_available_market_value bigint,
  ADD COLUMN IF NOT EXISTS home_injured_market_value  bigint,
  ADD COLUMN IF NOT EXISTS away_injured_market_value  bigint,
  ADD COLUMN IF NOT EXISTS motivation_gap             numeric;

-- ─── PLAYER_INJURIES — V2 injury tracking table ──────────────────────────────
CREATE TABLE IF NOT EXISTS player_injuries (
  id                    bigint NOT NULL DEFAULT nextval('player_injuries_id_seq'),
  player_id             bigint NOT NULL,
  injury_reason         text,
  injury_status         text,
  expected_return_days  integer,
  start_timestamp       bigint,
  end_timestamp         bigint,
  updated_timestamp     bigint,
  active                boolean DEFAULT true,
  created_at            timestamp with time zone DEFAULT now(),
  days_out              integer,
  injury_severity_score numeric,
  position_at_injury    text,
  market_value_at_injury bigint,
  CONSTRAINT player_injuries_pkey PRIMARY KEY (id),
  CONSTRAINT fk_player_injuries_player FOREIGN KEY (player_id) REFERENCES players(id)
);

-- Sequence if not exists
DO $$ BEGIN
  CREATE SEQUENCE player_injuries_id_seq;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── TEAM_POSITION_DEPTH — NEW V2 table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_position_depth (
  id                bigint NOT NULL DEFAULT nextval('team_position_depth_id_seq'),
  team_id           bigint NOT NULL,
  position_code     text NOT NULL,
  player_count      integer DEFAULT 0,
  injured_count     integer DEFAULT 0,
  available_count   integer DEFAULT 0,
  total_market_value bigint DEFAULT 0,
  updated_at        timestamp with time zone DEFAULT now(),
  CONSTRAINT team_position_depth_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_position_depth_team FOREIGN KEY (team_id) REFERENCES teams(id),
  CONSTRAINT team_position_depth_team_pos_unique UNIQUE (team_id, position_code)
);

DO $$ BEGIN CREATE SEQUENCE team_position_depth_id_seq;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── TEAM_TRANSFER_INTELLIGENCE — NEW V2 table ───────────────────────────────
CREATE TABLE IF NOT EXISTS team_transfer_intelligence (
  id                      bigint NOT NULL DEFAULT nextval('team_transfer_intelligence_id_seq'),
  team_id                 bigint NOT NULL UNIQUE,
  transfers_in            integer DEFAULT 0,
  transfers_out           integer DEFAULT 0,
  retained_players        integer DEFAULT 0,
  retention_percentage    numeric,
  transfer_activity_score numeric,
  calculated_at           timestamp with time zone DEFAULT now(),
  CONSTRAINT team_transfer_intelligence_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_transfer_team FOREIGN KEY (team_id) REFERENCES teams(id)
);

DO $$ BEGIN CREATE SEQUENCE team_transfer_intelligence_id_seq;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── TEAM_STRENGTH_RATINGS — NEW table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_strength_ratings (
  id               bigint NOT NULL DEFAULT nextval('team_strength_ratings_id_seq'),
  team_id          bigint NOT NULL UNIQUE,
  league_position  integer,
  points_per_game  numeric,
  win_percentage   numeric,
  strength_score   numeric,
  market_value_eur bigint,
  calculated_at    timestamp with time zone DEFAULT now(),
  CONSTRAINT team_strength_ratings_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_strength_team FOREIGN KEY (team_id) REFERENCES teams(id)
);

DO $$ BEGIN CREATE SEQUENCE team_strength_ratings_id_seq;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── TEAM_VENUE_PERFORMANCE — NEW table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_venue_performance (
  id                    bigint NOT NULL DEFAULT nextval('team_venue_performance_id_seq'),
  team_id               bigint NOT NULL UNIQUE,
  home_matches          integer DEFAULT 0,
  away_matches          integer DEFAULT 0,
  home_points_per_game  numeric,
  away_points_per_game  numeric,
  home_win_pct          numeric,
  away_win_pct          numeric,
  home_goal_diff        numeric,
  away_goal_diff        numeric,
  venue_advantage_score numeric,
  calculated_at         timestamp with time zone DEFAULT now(),
  CONSTRAINT team_venue_performance_pkey PRIMARY KEY (id),
  CONSTRAINT fk_team_venue_team FOREIGN KEY (team_id) REFERENCES teams(id)
);

DO $$ BEGIN CREATE SEQUENCE team_venue_performance_id_seq;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE player_injuries IS 'Active and historical player injuries — V2 SofaScore squad intelligence';
COMMENT ON TABLE team_position_depth IS 'Per-position availability counts derived from squad sync';
COMMENT ON TABLE team_transfer_intelligence IS 'Transfer activity and retention metrics derived from squad sync';
COMMENT ON TABLE team_strength_ratings IS 'Precomputed team strength from form history and market value';
COMMENT ON TABLE team_venue_performance IS 'Home vs away performance splits from match results';
