-- ─── MIGRATION 021 — Form History Enrichment ─────────────────────────────────
-- Adds three categories of precomputed facts to team_form_history that
-- eliminate expensive JOINs in narrative queries:
--
--   is_home              — was this team the home side? Eliminates JOIN to
--                          matches for every venue-split narrative ("won 3
--                          away games in a row", "clean sheets at home").
--
--   half_time_score_for  — goals scored by this team at half-time. Already
--   half_time_score_against  stored in match_results; copied here so HT
--                          narratives ("leads at HT in 6 of last 8",
--                          "trailed at HT, won at FT") don't need a
--                          second JOIN per row.
--
--   btts                 — both teams scored (goals_for > 0 AND
--                          goals_against > 0). The most-used derived
--                          boolean in goal market narratives; cheaper to
--                          store than to recompute on every read.
--
-- All nullable: existing rows pre-migration have NULL in these columns until
-- processFormBackfill is re-run. A re-run of processFormForMatch / backfill
-- will populate them via UPSERT ON CONFLICT (team_id, match_id) — no
-- data loss, no downtime, idempotent.

ALTER TABLE public.team_form_history
  ADD COLUMN IF NOT EXISTS is_home              boolean,
  ADD COLUMN IF NOT EXISTS half_time_score_for  integer,
  ADD COLUMN IF NOT EXISTS half_time_score_against integer,
  ADD COLUMN IF NOT EXISTS btts                 boolean;

COMMENT ON COLUMN public.team_form_history.is_home IS
  'True if this team was the home side in this match. Denormalized from matches to avoid JOIN in venue-split narrative queries.';

COMMENT ON COLUMN public.team_form_history.half_time_score_for IS
  'Goals scored by this team at half-time. Denormalized from match_results to avoid JOIN in HT narrative queries. NULL for pre-migration rows until backfill.';

COMMENT ON COLUMN public.team_form_history.half_time_score_against IS
  'Goals conceded by this team at half-time. Denormalized from match_results. NULL for pre-migration rows until backfill.';

COMMENT ON COLUMN public.team_form_history.btts IS
  'Both teams scored (goals_for > 0 AND goals_against > 0). Precomputed boolean — the most-used derived fact in goal market narratives. NULL for pre-migration rows until backfill.';
