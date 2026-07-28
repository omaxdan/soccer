-- ─── MIGRATION 037 — Predicted lineups v2 ───────────────────────────────────
--
-- MOVED, AND RENUMBERED. This shipped as
-- beta/backend/supabase/migrations/025_predicted_lineups_v2.sql, which is the
-- older migration directory, and 025 was already taken there by
-- 025_fix_replace_rpc_safeupdate.sql. Two files numbered 025 in a tree where
-- ordering is the only thing sequencing them is a migration that quietly never
-- runs — which is consistent with the frontend selecting these columns and
-- getting nothing back.
--
-- beta/migrations/ is the authoritative directory. The original is left in
-- place rather than deleted, so an environment that already applied it does
-- not see the file vanish; every statement below is IF NOT EXISTS, so applying
-- this after it is a no-op.
--
-- AFTER APPLYING, verify the columns exist AND that the engine has populated
-- them — an applied migration with a job that has not run leaves every new
-- column null, which the frontend treats exactly like a missing column:
--
--   SELECT count(*) FILTER (WHERE lineup_order IS NOT NULL) AS ordered,
--          count(*) FILTER (WHERE x IS NOT NULL)            AS placed,
--          count(*)                                          AS total
--     FROM public.match_predicted_lineups;

-- ============================================================================
-- 025 — PREDICTED LINEUPS ENGINE v2
-- ============================================================================
--
-- The v1 predicted-lineup writer stored a coarse G/D/M/F slot letter plus a
-- rank, under a hardcoded 1-4-4-2 shape. Everything else a renderer needs —
-- the formation, where on the pitch each player stands, whether the player is
-- in their natural position — had to be re-derived in the browser on every
-- page load (see frontend/src/lib/insights.ts deriveFormation()).
--
-- v2 makes the database the single source of truth: the engine writes the
-- chosen formation, the tactical slot, the natural position, pitch
-- coordinates, per-slot confidence, and the raw inputs behind the decision
-- (weighted_score, suitability) so the result is explainable and debuggable
-- without re-running the job.
--
-- Every statement here is idempotent (IF NOT EXISTS / DO-block guards) — the
-- columns listed below were drafted into "000_Full DB Schema sql file.sql"
-- ahead of this migration, so on some environments they already exist.
--
-- SEMANTIC CHANGE — READ BEFORE DEPLOYING:
--   match_predicted_lineups.position_code changes meaning. It used to hold a
--   broad group letter (G/D/M/F). It now holds the TACTICAL slot code
--   (GK, RB, RCB, LCB, LB, DM, RCM, LW, ST, ...). The broad letter moves to
--   the new position_group column, so anything that bucketed by
--   position_code must read position_group instead. All in-repo consumers
--   are updated in the same change set as this migration.
-- ============================================================================


-- ─── 1. match_predicted_lineups — new columns ───────────────────────────────

ALTER TABLE public.match_predicted_lineups
  -- Formation this row's XI was built under, denormalized onto every player
  -- row for cheap single-query rendering. The authoritative per-team record
  -- lives in match_predicted_formations (section 3).
  ADD COLUMN IF NOT EXISTS formation            text,

  -- Broad zone of the assigned slot: 'G' | 'D' | 'M' | 'F'. This is what
  -- position_code used to contain. Kept as its own column so department-level
  -- aggregations (readiness history, zone strength) stay a single field read
  -- and never have to parse a tactical code.
  ADD COLUMN IF NOT EXISTS position_group       text,

  -- Tactical slot code — the same value as position_code, exposed under an
  -- unambiguous name. position_code is retained for backwards compatibility
  -- with existing queries; new code should read tactical_position.
  ADD COLUMN IF NOT EXISTS tactical_position    text,

  -- The player's own natural position (normalized primary_position), which
  -- may differ from the slot they were assigned to. A CM played at DM has
  -- natural_position='CM', tactical_position='DM' — the frontend shows both.
  ADD COLUMN IF NOT EXISTS natural_position     text,

  -- Render order within the XI, 1..11, back-to-front and right-to-left
  -- (1=GK, 2=RB, 3=RCB, ...). Distinct from rank_in_position, which is the
  -- depth-chart rank WITHIN a position family (CB 1, CB 2, CM 1, CM 2...).
  ADD COLUMN IF NOT EXISTS lineup_order         smallint,

  -- Pitch coordinates for the assigned slot, 0-100 in both axes.
  --   x: 0 = left touchline,  100 = right touchline
  --   y: 0 = opponent goal,   100 = own goal   (so a GK sits at y≈95)
  -- Predefined per formation slot — the frontend only draws circles.
  ADD COLUMN IF NOT EXISTS x                    numeric,
  ADD COLUMN IF NOT EXISTS y                    numeric,

  -- Human-readable slot role ('centre-back', 'holding midfielder', ...).
  ADD COLUMN IF NOT EXISTS role                 text,

  -- Explainability inputs. weighted_score is the 0-100 within-team selection
  -- score; suitability is the 0-1 fit of this player to this slot. The
  -- optimizer maximizes weighted_score × suitability², so storing both makes
  -- any selection reproducible by hand.
  ADD COLUMN IF NOT EXISTS weighted_score       numeric,
  ADD COLUMN IF NOT EXISTS suitability          numeric,

  -- Raw signals behind weighted_score, denormalized so a lineup row is
  -- self-describing without joining player_season_statistics.
  ADD COLUMN IF NOT EXISTS minutes_played       integer,
  ADD COLUMN IF NOT EXISTS recent_starts_score  numeric,

  ADD COLUMN IF NOT EXISTS is_captain           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_vice_captain      boolean DEFAULT false;


-- ─── 2. Uniqueness — one row per player per team per match ──────────────────
--
-- This is what makes the write path an UPSERT rather than DELETE-then-INSERT.
-- A crash partway through a 500-match run leaves every already-processed
-- match intact instead of wiping lineups that will not be rewritten until the
-- next scheduled run.
--
-- v1 upserted on (match_id, player_id) — which is wrong in principle (the
-- same player cannot appear for both teams, but the constraint should express
-- the real grain) and was never actually enforced by a constraint, so the
-- upsert silently degraded to a plain insert.

DO $$
BEGIN
  -- Drop any pre-existing rows that would violate the new constraint before
  -- creating it (duplicates can exist from v1 runs, which had no constraint).
  DELETE FROM public.match_predicted_lineups a
   USING public.match_predicted_lineups b
   WHERE a.id > b.id
     AND a.match_id  = b.match_id
     AND a.team_id   = b.team_id
     AND a.player_id = b.player_id;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'match_predicted_lineups_unique'
       AND conrelid = 'public.match_predicted_lineups'::regclass
  ) THEN
    ALTER TABLE public.match_predicted_lineups
      ADD CONSTRAINT match_predicted_lineups_unique
      UNIQUE (match_id, team_id, player_id);
  END IF;
END $$;


-- ─── 3. match_predicted_formations — team-level prediction ──────────────────
--
-- The formation is a property of (match, team), not of a player. Storing it
-- only on the eleven player rows made "which shape is Arsenal expected to
-- play" an eleven-row scan plus a de-duplication step. This table is the
-- authoritative record; match_predicted_lineups.formation is a denormalized
-- convenience copy written by the same job in the same run.

CREATE TABLE IF NOT EXISTS public.match_predicted_formations (
  match_id                bigint NOT NULL,
  team_id                 bigint NOT NULL,
  formation               text,
  -- 0-1. Mean per-player confidence across the XI, damped by how narrowly
  -- this formation beat the runner-up shape.
  confidence              numeric,
  -- Total optimizer score for the winning shape (Σ weighted_score × suitability²).
  formation_score         numeric,
  -- How many of the XI are filling a slot that is not their natural position.
  out_of_position_count   smallint,
  calculated_at           timestamp with time zone DEFAULT now(),
  CONSTRAINT match_predicted_formations_pkey PRIMARY KEY (match_id, team_id)
);

-- Added separately so environments that already created the table from the
-- 000 schema draft (match_id/team_id/formation/confidence/calculated_at only)
-- pick up the two analytics columns.
ALTER TABLE public.match_predicted_formations
  ADD COLUMN IF NOT EXISTS formation_score       numeric,
  ADD COLUMN IF NOT EXISTS out_of_position_count smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'match_predicted_formations_match_id_fkey'
       AND conrelid = 'public.match_predicted_formations'::regclass
  ) THEN
    ALTER TABLE public.match_predicted_formations
      ADD CONSTRAINT match_predicted_formations_match_id_fkey
      FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'match_predicted_formations_team_id_fkey'
       AND conrelid = 'public.match_predicted_formations'::regclass
  ) THEN
    ALTER TABLE public.match_predicted_formations
      ADD CONSTRAINT match_predicted_formations_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES public.teams(id);
  END IF;
END $$;


-- ─── 4. Indexes ─────────────────────────────────────────────────────────────
--
-- The frontend's hot read is "the XI for this match, in render order", and
-- the stale-row cleanup at the end of each engine run filters on
-- (match_id, calculated_at).

CREATE INDEX IF NOT EXISTS idx_mpl_match_team_order
  ON public.match_predicted_lineups (match_id, team_id, lineup_order);

CREATE INDEX IF NOT EXISTS idx_mpl_match_calculated
  ON public.match_predicted_lineups (match_id, calculated_at);

CREATE INDEX IF NOT EXISTS idx_mpf_team
  ON public.match_predicted_formations (team_id);


-- ─── 5. Backfill guard ──────────────────────────────────────────────────────
--
-- Rows written by v1 carry a broad G/D/M/F letter in position_code and NULL
-- in every v2 column. Rather than fabricate tactical slots and coordinates
-- for them, copy the old letter into position_group so zone-based consumers
-- keep working on historical rows, and leave the v2 columns NULL — the
-- frontend already has to handle "no coordinates yet" for any match the
-- engine has not reached.

UPDATE public.match_predicted_lineups
   SET position_group = position_code
 WHERE position_group IS NULL
   AND position_code IN ('G', 'D', 'M', 'F');

COMMENT ON COLUMN public.match_predicted_lineups.position_code IS
  'Tactical slot code (GK/RB/RCB/DM/RCM/LW/ST/...). Was a broad G/D/M/F letter before migration 025 — that meaning now lives in position_group.';
COMMENT ON COLUMN public.match_predicted_lineups.position_group IS
  'Broad zone of the assigned slot: G | D | M | F.';
COMMENT ON COLUMN public.match_predicted_lineups.y IS
  'Pitch coordinate 0-100. 0 = opponent goal line, 100 = own goal line (GK sits near 95).';
