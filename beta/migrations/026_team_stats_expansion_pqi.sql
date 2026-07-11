-- ─── MIGRATION 026 — Team Season Statistics Expansion (PQI prerequisite) ────
-- Same story as migration 011 (player stats): syncSeasonStatistics.ts
-- already receives ~80 fields per team-statistics API call and captures
-- only 16 of them. The remaining fields — shots, shots on target, shots
-- against, big chances against, corners, discipline inputs — are the exact
-- inputs Performance Quality Intelligence (Attack/Defense/Discipline
-- sub-scores) needs, and they're being discarded from a call that's
-- ALREADY being made. Zero new API cost, zero new sync job.
--
-- Column selection: not all ~80 fields, only what PQI's four sub-scores
-- (Attack Quality, Defensive Quality, Possession Control, Discipline Risk)
-- consume, plus a few universally-useful context fields (fouls, offsides).
-- Deliberately excludes deep goalkeeper/set-piece breakdowns that no
-- planned metric uses yet — can be added later the same way, at zero cost,
-- when a use case exists.

ALTER TABLE public.team_season_statistics
  -- Attack Quality inputs
  ADD COLUMN IF NOT EXISTS shots                    integer,
  ADD COLUMN IF NOT EXISTS shots_on_target           integer,
  ADD COLUMN IF NOT EXISTS shots_off_target          integer,
  ADD COLUMN IF NOT EXISTS big_chances                integer,
  ADD COLUMN IF NOT EXISTS shots_from_inside_the_box  integer,

  -- Defensive Quality inputs
  ADD COLUMN IF NOT EXISTS shots_against              integer,
  ADD COLUMN IF NOT EXISTS shots_on_target_against     integer,
  ADD COLUMN IF NOT EXISTS big_chances_against         integer,
  ADD COLUMN IF NOT EXISTS corners_against              integer,

  -- Possession Control inputs
  ADD COLUMN IF NOT EXISTS accurate_opposition_half_passes_pct numeric,

  -- Discipline Risk inputs
  ADD COLUMN IF NOT EXISTS fouls                       integer,
  ADD COLUMN IF NOT EXISTS offsides                    integer;

COMMENT ON COLUMN public.team_season_statistics.shots IS
  'Total shots for the season. PQI Attack Quality input. Same API call as existing columns — no new sync cost.';
COMMENT ON COLUMN public.team_season_statistics.shots_against IS
  'Total shots conceded. PQI Defensive Quality input.';
COMMENT ON COLUMN public.team_season_statistics.big_chances_against IS
  'Big chances conceded. PQI Defensive Quality input — chance prevention, distinct from goal prevention (goals_conceded).';
