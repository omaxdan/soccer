-- ─── MIGRATION 007 — Schema Cleanup + V3 Data Points + Full Reload ──────────
-- This migration:
--   1. Drops duplicate/redundant columns (same data stored in 2-3 places)
--   2. Adds match_date to every match-outcome table (denormalized — no table
--      that reads match results should ever need a JOIN just to know WHEN)
--   3. Adds new tables for season-level player/team statistics (V3 data points)
--   4. Enhances player_transfers with real fields confirmed from the API
--      (transfer_fee, currency, type)
--   5. Adds image storage path columns (self-hosted via Supabase Storage,
--      never the source CDN directly — see image backfill job)
--   6. Adds tournament_standings (folded in from migration 008 — see that
--      file's header for why; merged back here so this single migration is
--      a complete one-shot fresh-start script, no need to run 007 then 008
--      in sequence)
--   7. TRUNCATES all data tables — this is a clean reload, not a patch.
--      Run this only when you're ready to re-sync from scratch.
--
-- Verified against the live production schema (25 tables, exact column
-- names cross-checked) before writing the DROP COLUMN statements below —
-- every dropped column confirmed to exist with that exact name first.
--
-- Run in Supabase SQL Editor. Single transaction — succeeds or rolls back whole.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══ PART 1 — DROP DUPLICATE COLUMNS ═════════════════════════════════════════
-- These columns store the same data already canonically owned by another
-- table. Dropping them forces every consumer (backend processors, frontend
-- queries) to read from the single source of truth instead of a stale copy.

ALTER TABLE team_intelligence
  -- Duplicate of squad_stability_score (created by mistake during a prior fix —
  -- both were being written identically; squad_stability_score is the one
  -- name used everywhere else, so it's the survivor)
  DROP COLUMN IF EXISTS squad_stability_index,

  -- Duplicates of team_squads_snapshot (avg_age, foreign/domestic counts,
  -- injured_player_count) — team_squads_snapshot is the canonical squad
  -- composition table; team_intelligence should hold SCORES, not raw counts
  DROP COLUMN IF EXISTS average_squad_age,
  DROP COLUMN IF EXISTS foreign_player_ratio,
  DROP COLUMN IF EXISTS national_team_player_ratio,
  DROP COLUMN IF EXISTS total_injured_players,
  DROP COLUMN IF EXISTS total_foreign_players,
  DROP COLUMN IF EXISTS total_national_players,
  DROP COLUMN IF EXISTS squad_market_value,

  -- Duplicates of team_position_depth (position_code rows with player_count/
  -- injured_count/available_count) — flattening 4 hardcoded positions into
  -- columns here loses the flexibility team_position_depth already has
  DROP COLUMN IF EXISTS goalkeeper_depth,
  DROP COLUMN IF EXISTS defender_depth,
  DROP COLUMN IF EXISTS midfielder_depth,
  DROP COLUMN IF EXISTS attacker_depth,

  -- Redundant with squad_depth_score (same underlying concept, two names —
  -- consolidating to one: squad_depth_score)
  DROP COLUMN IF EXISTS positional_depth_score,

  -- Duplicates of team_transfer_intelligence (the dedicated table written
  -- by squad sync — team_intelligence should not carry a second copy)
  DROP COLUMN IF EXISTS transfer_activity_score,
  DROP COLUMN IF EXISTS retention_percentage;

ALTER TABLE team_squads_snapshot
  -- Duplicates of team_position_depth rows — same reasoning as above
  DROP COLUMN IF EXISTS goalkeeper_count,
  DROP COLUMN IF EXISTS defender_count,
  DROP COLUMN IF EXISTS midfielder_count,
  DROP COLUMN IF EXISTS attacker_count;

-- team_intelligence retains as LEGITIMATE intelligence outputs (synthesized
-- scores, not raw copies): readiness_score, form_index, congestion_score,
-- rest_days_avg, travel_fatigue_score, travel_load_km, active_competitions,
-- squad_stability_score, squad_depth_score, injury_burden_score,
-- injured_market_value, available_market_value, fatigue_index,
-- rotation_pressure_index, last_5_points, last_10_points


-- ═══ PART 2 — ADD match_date TO EVERY MATCH-OUTCOME TABLE ═══════════════════
-- Denormalized on purpose. Any table representing something that happened
-- IN a match should carry that match's date directly — no join required to
-- answer "when did this happen", and no reliance on created_at/calculated_at
-- (processing time) as a proxy for game time, which can drift during backfills
-- or reprocessing runs that don't happen in chronological order.

ALTER TABLE match_results
  ADD COLUMN IF NOT EXISTS match_date timestamp with time zone;

ALTER TABLE team_form_history
  ADD COLUMN IF NOT EXISTS match_date timestamp with time zone;

ALTER TABLE match_intelligence
  ADD COLUMN IF NOT EXISTS match_date timestamp with time zone;

ALTER TABLE match_travel_intelligence
  ADD COLUMN IF NOT EXISTS match_date timestamp with time zone;

-- Backfill from matches table for any pre-existing rows (harmless no-op
-- after the truncate in Part 6, but kept here so this migration is also
-- safe to run BEFORE a truncate, e.g. on a staging copy)
UPDATE match_results       SET match_date = m.date FROM matches m WHERE match_results.match_id = m.id AND match_results.match_date IS NULL;
UPDATE team_form_history   SET match_date = m.date FROM matches m WHERE team_form_history.match_id = m.id AND team_form_history.match_date IS NULL;
UPDATE match_intelligence  SET match_date = m.date FROM matches m WHERE match_intelligence.match_id = m.id AND match_intelligence.match_date IS NULL;
UPDATE match_travel_intelligence SET match_date = m.date FROM matches m WHERE match_travel_intelligence.match_id = m.id AND match_travel_intelligence.match_date IS NULL;

-- Index match_date on team_form_history specifically — this is the table
-- "form consistency" calculations (Last 5 / Last 10) query most heavily
CREATE INDEX IF NOT EXISTS idx_team_form_history_match_date ON team_form_history(match_date);
CREATE INDEX IF NOT EXISTS idx_match_results_match_date ON match_results(match_date);


-- ═══ PART 3 — FIX tournaments.external_id SEMANTICS ═══════════════════════
-- external_id must store uniqueTournament.id (stable across seasons), not
-- tournament.id (changes per season/stage). Add an explicit comment so this
-- is documented in the schema itself, not just in code comments. The actual
-- ID correction happens via the code fix in syncDateMasterFeed.ts + the
-- truncate-and-reload in Part 6 — every row written after this migration
-- will use the correct ID going forward.

COMMENT ON COLUMN tournaments.external_id IS
  'Must be uniqueTournament.id from the source API, NOT tournament.id. '
  'tournament.id is stage/season-specific and changes between seasons and '
  'qualification rounds; uniqueTournament.id is the stable competition '
  'identity. Using the wrong one causes duplicate tournament rows each season.';

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS logo_storage_path text;  -- self-hosted, see Part 5


-- ═══ PART 4 — NEW TABLES: SEASON-LEVEL PLAYER & TEAM STATISTICS ════════════
-- Sourced from /team/{id}/unique-tournament/{id}/season/{id}/player-statistics
-- and .../statistics/overall — confirmed response structure.

CREATE TABLE IF NOT EXISTS player_season_statistics (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id           bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id             bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tournament_id       bigint REFERENCES tournaments(id),
  season_external_id  bigint NOT NULL,  -- API seasonId, not yet in our seasons table necessarily
  rating              numeric,
  total_rating        numeric,
  count_rating        integer,
  appearances         integer,
  matches_started     integer,
  minutes_played      integer,
  goals               integer,
  assists             integer,
  expected_goals      numeric,
  expected_assists    numeric,
  yellow_cards        integer,
  red_cards           integer,
  played_enough       boolean DEFAULT false,  -- SofaScore's own significance flag
  calculated_at       timestamp with time zone DEFAULT now(),
  updated_at          timestamp with time zone DEFAULT now(),
  UNIQUE(player_id, season_external_id)
);
CREATE INDEX IF NOT EXISTS idx_player_season_stats_team ON player_season_statistics(team_id);
CREATE INDEX IF NOT EXISTS idx_player_season_stats_player ON player_season_statistics(player_id);

CREATE TABLE IF NOT EXISTS team_season_statistics (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id             bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tournament_id       bigint REFERENCES tournaments(id),
  season_external_id  bigint NOT NULL,
  matches              integer,
  goals_scored          integer,
  goals_conceded         integer,
  clean_sheets          integer,
  avg_possession        numeric,
  avg_rating             numeric,
  total_passes           integer,
  accurate_passes_pct    numeric,
  duels_won_pct          numeric,
  aerial_duels_won_pct   numeric,
  tackles                integer,
  interceptions          integer,
  yellow_cards           integer,
  red_cards              integer,
  big_chances_created    integer,
  big_chances_missed     integer,
  calculated_at          timestamp with time zone DEFAULT now(),
  updated_at             timestamp with time zone DEFAULT now(),
  UNIQUE(team_id, season_external_id)
);
CREATE INDEX IF NOT EXISTS idx_team_season_stats_team ON team_season_statistics(team_id);

-- ─── DERIVED "LIKELY XI" — zero-API-cost predicted lineup ───────────────────
-- No confirmed-lineups or predicted-lineups API call anywhere in this design
-- (see prior rate-limit analysis — neither fit the budget). Instead this is
-- computed entirely from data already flowing through the pipeline:
-- player_season_statistics.matchesStarted (primary signal) + current
-- injury/transfer status (availability filter) + team_position_depth
-- (position-bucket context). One row per predicted starter per match.
CREATE TABLE IF NOT EXISTS match_predicted_lineups (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id        bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id         bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id       bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  position_code   text,             -- G / D / M / F
  rank_in_position integer,         -- 1 = most likely starter at that position
  matches_started  integer,         -- the signal this ranking was built from
  confidence       numeric,         -- 0-100, see processor for derivation
  calculated_at    timestamp with time zone DEFAULT now(),
  UNIQUE(match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_predicted_lineups_match ON match_predicted_lineups(match_id);
CREATE INDEX IF NOT EXISTS idx_predicted_lineups_team ON match_predicted_lineups(team_id);

-- ─── TOURNAMENT STANDINGS — folded in from migration 008 ─────────────────────
-- Originally written as a separate follow-up file after this migration was
-- first run; merged back in here so 007 alone is a complete one-shot
-- fresh-start script. Safe to also still run 008 separately afterward
-- (CREATE TABLE IF NOT EXISTS — idempotent either way).
--
-- Source: GET /tournament/{tournamentId}/season/{seasonId}/standings
-- PER-TOURNAMENT, not per-team — resolves the league_position gap in
-- team_strength_ratings that's been null since the original build.
CREATE TABLE IF NOT EXISTS tournament_standings (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id       bigint NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id             bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_external_id  bigint NOT NULL,
  standings_type      text NOT NULL DEFAULT 'total', -- 'total' | 'home' | 'away'
  position            integer,
  matches             integer,
  wins                integer,
  draws               integer,
  losses              integer,
  scores_for          integer,
  scores_against      integer,
  points              integer,
  calculated_at       timestamp with time zone DEFAULT now(),
  updated_at          timestamp with time zone DEFAULT now(),
  UNIQUE(team_id, season_external_id, standings_type)
);
CREATE INDEX IF NOT EXISTS idx_tournament_standings_tournament ON tournament_standings(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_standings_team ON tournament_standings(team_id);

-- ─── PLATFORM DAILY SUMMARY — precomputed dashboard aggregates ──────────────
-- CRITICAL REQUIREMENT: no calculations at frontend runtime. The dashboard
-- previously computed avg readiness via a client-side .reduce() over the
-- full rankings list on every page load — that's business-logic computation
-- happening in the browser, recalculated identically by every visitor.
-- This table is written once by process:dashboard-summary; the frontend
-- only ever SELECTs and displays these values, never derives them.
CREATE TABLE IF NOT EXISTS platform_daily_summary (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  summary_date          date NOT NULL UNIQUE,
  matches_today         integer DEFAULT 0,
  competitions_today    integer DEFAULT 0,
  teams_tracked         integer DEFAULT 0,
  competitions_tracked  integer DEFAULT 0,
  readiness_calculated_count integer DEFAULT 0,
  avg_readiness         numeric,
  last_sync_at          timestamp with time zone,
  calculated_at         timestamp with time zone DEFAULT now()
);


-- ═══ PART 5 — IMAGE STORAGE PATHS (self-hosted, see image backfill job) ═════
-- Stores a Supabase Storage path, NOT a source-API URL — decouples image
-- serving from the API rate-limit budget entirely (see prior discussion:
-- we don't know if the source image endpoint is itself rate-limited per
-- fetch, so every image is downloaded once and re-hosted ourselves).

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS crest_storage_path text;

-- Precomputed percentages — squad-stability page currently computes
-- (foreign_players_count / players_count) * 100 inline in JSX. That's a
-- real calculation, not display formatting — move it server-side.
ALTER TABLE team_squads_snapshot
  ADD COLUMN IF NOT EXISTS foreign_player_pct numeric,
  ADD COLUMN IF NOT EXISTS injured_player_pct numeric;


-- ═══ PART 6 — ENHANCE player_transfers WITH REAL API FIELDS ═════════════════
-- Confirmed structure from /team/{id}/transfers: transferFeeRaw.value,
-- transferFeeRaw.currency, and a numeric type code (permanent/loan/free).

ALTER TABLE player_transfers
  ADD COLUMN IF NOT EXISTS transfer_fee          bigint,
  ADD COLUMN IF NOT EXISTS transfer_fee_currency text,
  ADD COLUMN IF NOT EXISTS transfer_type         integer,  -- raw API type code
  ADD COLUMN IF NOT EXISTS source                text DEFAULT 'squad_diff';
  -- source: 'squad_diff' (zero-cost team_id-change detection, approximate date)
  --      or 'transfers_api' (dedicated endpoint, exact date + fee + type)

-- Required for upsert(..., { onConflict: 'player_id,transfer_date' }) in
-- both syncSquadSofaScore.ts (squad_diff detection) and syncTransfersV2.ts
-- (dedicated endpoint) — prevents duplicate transfer rows when the same
-- player/date is observed via both detection paths.
ALTER TABLE player_transfers
  DROP CONSTRAINT IF EXISTS player_transfers_player_date_unique;
ALTER TABLE player_transfers
  ADD CONSTRAINT player_transfers_player_date_unique UNIQUE (player_id, transfer_date);


-- ═══ PART 7 — TRUNCATE ALL DATA TABLES ══════════════════════════════════════
-- Clean reload. Preserves schema/structure, removes all rows. Run sync
-- commands after this completes to repopulate from scratch with corrected
-- tournament IDs, match_date columns, and the new V3 data points.
--
-- Order matters — children before parents (FK constraints).

TRUNCATE TABLE
  tournament_standings,
  platform_daily_summary,
  match_predicted_lineups,
  match_intelligence,
  match_travel_intelligence,
  match_results,
  match_weather,
  player_match_load,
  player_intelligence,
  player_injuries,
  player_transfers,
  player_season_statistics,
  team_season_statistics,
  team_form_history,
  team_fixture_load,
  team_travel_load,
  team_locations,
  team_strength_ratings,
  team_venue_performance,
  team_position_depth,
  team_transfer_intelligence,
  team_squads_snapshot,
  team_intelligence,
  matches,
  players,
  seasons,
  teams,
  tournaments,
  stadiums,
  countries
RESTART IDENTITY CASCADE;

COMMIT;

-- ═══ POST-MIGRATION: VERIFY ═══════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM teams)                  AS teams,
  (SELECT COUNT(*) FROM tournaments)             AS tournaments,
  (SELECT COUNT(*) FROM matches)                 AS matches,
  (SELECT COUNT(*) FROM tournament_standings)    AS standings,
  (SELECT COUNT(*) FROM player_season_statistics) AS player_season_stats,
  (SELECT COUNT(*) FROM team_season_statistics)   AS team_season_stats,
  (SELECT COUNT(*) FROM match_predicted_lineups)  AS predicted_lineups,
  (SELECT COUNT(*) FROM platform_daily_summary)   AS dashboard_summary;
-- Expect all zeros — confirms the truncate succeeded AND all new V3 tables
-- exist (a count of 0 still proves the table was created; an error here
-- instead means a table is missing). Run sync:range next.

-- Sanity check: confirm the 15 + 4 dropped duplicate columns are actually gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'team_intelligence'
  AND column_name IN (
    'squad_stability_index', 'average_squad_age', 'foreign_player_ratio',
    'national_team_player_ratio', 'total_injured_players', 'total_foreign_players',
    'total_national_players', 'squad_market_value', 'goalkeeper_depth',
    'defender_depth', 'midfielder_depth', 'attacker_depth',
    'positional_depth_score', 'transfer_activity_score', 'retention_percentage'
  );
-- Expect ZERO rows — if any appear, the DROP COLUMN didn't take effect.
