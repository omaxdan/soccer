-- ─── MIGRATION 044 — Team Timeline: extend, don't rebuild ───────────────────
--
-- Additive only. No new table — team_match_snapshots already IS the "Team
-- Timeline" table described across the last several architecture messages;
-- it's been live since processHistoricalContext.ts was written, just not
-- wired into process:all-db and not yet covering every dimension asked for.
-- Confirmed by reading its own source comment: "pre-kickoff state of each
-- participant."
--
-- WHAT'S ADDED, AND THE PRINCIPLE BEHIND WHICH REQUESTED FIELDS AREN'T
-- Every column below maps onto a calculation that already exists in a live
-- processor — this is capturing state that's currently only ever visible
-- "as of right now" (team_form_quality, team_travel_load, team_fixture_load)
-- into the point-in-time record it was always missing from, not inventing
-- new tracking.
--
-- Deliberately NOT added, and why: manager, formation familiarity, squad
-- continuity, lineup stability, motivation context. None of these are
-- tracked ANYWHERE in the current schema — no sync job, no processor, no
-- table holds this data today. Adding these columns now would create
-- exactly the "column that's always NULL because nothing populates it"
-- problem this whole exercise exists to eliminate — the honest fix is
-- building the data source first, then the column, not the reverse.
--
-- Also deliberately NOT added: "confidence of the current state." The
-- request that proposed this table also states its own governing principle
-- explicitly: "The Team Timeline should store only state. Not opinions."
-- A confidence score IS an opinion about the state, not the state itself —
-- it belongs to whatever engine consumes this snapshot, not the snapshot.
-- Flagging the tension directly rather than silently resolving it either way.

ALTER TABLE public.team_match_snapshots
  ADD COLUMN IF NOT EXISTS opponent_adjusted_form_before numeric,
  ADD COLUMN IF NOT EXISTS strength_of_schedule_before numeric,
  ADD COLUMN IF NOT EXISTS rest_days_before numeric,
  ADD COLUMN IF NOT EXISTS travel_load_before numeric,
  ADD COLUMN IF NOT EXISTS fixture_congestion_before numeric;

COMMENT ON COLUMN public.team_match_snapshots.opponent_adjusted_form_before IS
  'Mirrors team_form_quality.opponent_adjusted_form, captured as of this match rather than read live. Source calculation already exists in processFormQuality.ts / processTeamFormQuality (processExtendedIntelligence.ts) — see the confirmed duplicate-processor finding before choosing which formula this should snapshot from.';
COMMENT ON COLUMN public.team_match_snapshots.strength_of_schedule_before IS
  'Mirrors team_form_quality.strength_of_schedule as of this match.';
COMMENT ON COLUMN public.team_match_snapshots.rest_days_before IS
  'Mirrors team_intelligence.rest_days_avg / team_fixture_load as of this match.';
COMMENT ON COLUMN public.team_match_snapshots.travel_load_before IS
  'Mirrors team_travel_load.travel_fatigue_score as of this match.';
COMMENT ON COLUMN public.team_match_snapshots.fixture_congestion_before IS
  'Mirrors team_fixture_load.congestion_score as of this match.';

-- ── What this migration does NOT do ─────────────────────────────────────────
-- It does not populate these columns for any existing row — that's the
-- chronological rebuild processor, which is real, algorithm-heavy work that
-- needs to run against live data to verify correctness (does the running
-- form calculation actually match team_form_quality's own number when
-- computed the same way; does the chronological walk correctly exclude each
-- match's own result from its own snapshot). Not something to write blind
-- with no database to test it against.
-- It does not wire processHistoricalContext.ts into process:all-db — that
-- decision was already flagged as open two responses ago and stays open.

-- ── Rollback ────────────────────────────────────────────────────────────────
--   ALTER TABLE public.team_match_snapshots
--     DROP COLUMN IF EXISTS opponent_adjusted_form_before,
--     DROP COLUMN IF EXISTS strength_of_schedule_before,
--     DROP COLUMN IF EXISTS rest_days_before,
--     DROP COLUMN IF EXISTS travel_load_before,
--     DROP COLUMN IF EXISTS fixture_congestion_before;
