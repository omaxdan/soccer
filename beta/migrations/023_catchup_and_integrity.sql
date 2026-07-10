-- ─── MIGRATION 023 — Catch-up + Integrity (Audit Phases 2–3) ─────────────────
-- Restores the migrations chain as the single source of truth.
--
-- PART A captures constraints that exist ONLY in the live DB (added via SQL
--        editor, never migrated — confirmed by pg_constraint dump 2026-07-10).
--        Idempotent: no-ops where the constraint already exists.
-- PART B adds NEW integrity (player_injuries uniqueness, CHECK constraints).
-- PART C links matches to the tournament/season model (new FKs + backfill).
-- PART D adds team_intelligence.last_5_results (kills the frontend's
--        1000-row-truncated form query).
-- PART E reshapes indexes for the hottest query patterns.
--
-- Safe to run on the live DB. CHECKs are added NOT VALID (existing rows
-- untouched); validate them afterwards with the statements at the bottom.

-- ═══ PART A — capture live-only constraints ═════════════════════════════════

DO $$ BEGIN
  ALTER TABLE public.team_form_history
    ADD CONSTRAINT team_form_history_team_id_match_id_key UNIQUE (team_id, match_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.player_season_statistics
    ADD CONSTRAINT player_season_statistics_player_id_season_external_id_key
    UNIQUE (player_id, season_external_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.team_season_statistics
    ADD CONSTRAINT team_season_statistics_team_id_season_external_id_key
    UNIQUE (team_id, season_external_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.match_predicted_lineups
    ADD CONSTRAINT match_predicted_lineups_match_id_player_id_key
    UNIQUE (match_id, player_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- ═══ PART B — new integrity ═════════════════════════════════════════════════

-- B1. player_injuries uniqueness. The repository dedupes in app code
--     (select-then-insert) — safe only with exactly one writer. Enforce at
--     the DB. First remove any duplicates that app-level dedup let through
--     (keep the newest row per key):

DELETE FROM public.player_injuries a
USING public.player_injuries b
WHERE a.player_id = b.player_id
  AND a.start_timestamp IS NOT DISTINCT FROM b.start_timestamp
  AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_player_injuries_player_start
  ON public.player_injuries (player_id, start_timestamp)
  WHERE start_timestamp IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_player_injuries_player_active_nostart
  ON public.player_injuries (player_id)
  WHERE active AND start_timestamp IS NULL;

-- B2. CHECK constraints — NOT VALID so legacy rows can't block the migration.
--     New/updated rows are checked immediately; validate the backlog at the
--     bottom of this file once confirmed clean.

DO $$ BEGIN
  ALTER TABLE public.team_form_history
    ADD CONSTRAINT chk_form_result CHECK (result IN ('W','D','L')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.team_form_history
    ADD CONSTRAINT chk_form_goals CHECK (
      (goals_for IS NULL OR goals_for >= 0) AND
      (goals_against IS NULL OR goals_against >= 0)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.match_results
    ADD CONSTRAINT chk_scores_nonneg CHECK (
      (home_score IS NULL OR home_score >= 0) AND
      (away_score IS NULL OR away_score >= 0) AND
      (half_time_home_score IS NULL OR half_time_home_score >= 0) AND
      (half_time_away_score IS NULL OR half_time_away_score >= 0)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Probabilities: bounded [0,100] — a superset that is correct whether the
-- pipeline writes 0–1 or 0–100 scale. Tighten to [0,1] in a later migration
-- once the scale is confirmed from live rows.
DO $$ BEGIN
  ALTER TABLE public.match_intelligence
    ADD CONSTRAINT chk_win_probs_bounded CHECK (
      (win_probability_home IS NULL OR (win_probability_home >= 0 AND win_probability_home <= 100)) AND
      (win_probability_draw IS NULL OR (win_probability_draw >= 0 AND win_probability_draw <= 100)) AND
      (win_probability_away IS NULL OR (win_probability_away >= 0 AND win_probability_away <= 100))
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══ PART C — matches → tournaments/seasons FKs ═════════════════════════════
-- matches.competition / matches.season are free text today; every league
-- aggregation string-matches. New columns are nullable during transition;
-- the beta master-feed sync writes them directly (it already has both
-- external IDs per event). Text columns stay until the old backend retires.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS tournament_id bigint REFERENCES public.tournaments(id),
  ADD COLUMN IF NOT EXISTS season_id     bigint REFERENCES public.seasons(id);

-- Best-effort backfill by exact name match (covers the tracked leagues,
-- whose names are stable). Rows that don't match stay NULL and are healed
-- by the next beta master-feed run for their date.
UPDATE public.matches m SET tournament_id = t.id
FROM public.tournaments t
WHERE m.tournament_id IS NULL AND m.competition = t.name;

UPDATE public.matches m SET season_id = s.id
FROM public.seasons s
WHERE m.season_id IS NULL
  AND m.tournament_id = s.tournament_id
  AND (m.season = s.name OR m.season = s.year);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON public.matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_season_id     ON public.matches(season_id);

-- ═══ PART D — precomputed form pills ════════════════════════════════════════
-- Replaces the frontend's all-teams form_history query, which PostgREST
-- silently truncates at 1000 rows (live bug: teams without a recent fixture
-- render missing/short form pills). Written by process:team-intelligence.

ALTER TABLE public.team_intelligence
  ADD COLUMN IF NOT EXISTS last_5_results text
  CHECK (last_5_results IS NULL OR last_5_results ~ '^[WDL]{1,5}$');

COMMENT ON COLUMN public.team_intelligence.last_5_results IS
  'Most recent first, e.g. WWDLW. Precomputed by process:team-intelligence from team_form_history — frontend must never derive this at read time (1000-row cap corrupts it).';

-- ═══ PART E — index reshaping ═══════════════════════════════════════════════

-- Hottest pattern: last-N-matches per team, ordered by date.
CREATE INDEX IF NOT EXISTS idx_form_history_team_date
  ON public.team_form_history (team_id, match_date DESC);

-- Match center: date-range + status filtering in one scan.
CREATE INDEX IF NOT EXISTS idx_matches_date_status
  ON public.matches (date, status);

-- Superseded by the composites above (leading columns match):
DROP INDEX IF EXISTS idx_team_form_team_id;
DROP INDEX IF EXISTS idx_matches_date;

-- Low-selectivity write tax, no query depends on them alone:
DROP INDEX IF EXISTS idx_matches_status;
DROP INDEX IF EXISTS idx_players_position;

-- ═══ VALIDATION (run manually after confirming no legacy violations) ════════
-- SELECT count(*) FROM team_form_history WHERE result NOT IN ('W','D','L');
-- ALTER TABLE public.team_form_history  VALIDATE CONSTRAINT chk_form_result;
-- ALTER TABLE public.team_form_history  VALIDATE CONSTRAINT chk_form_goals;
-- ALTER TABLE public.match_results      VALIDATE CONSTRAINT chk_scores_nonneg;
-- ALTER TABLE public.match_intelligence VALIDATE CONSTRAINT chk_win_probs_bounded;
