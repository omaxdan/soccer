-- ─── MIGRATION 020 — Lineup Versatility Score ────────────────────────────────
-- Adds a lineup_versatility_score column to both team_strength_ratings and
-- team_intelligence, computed from the predicted-XI players' multi-position
-- coverage (players.position_detailed = comma-separated codes like "DR,DC"
-- or "MC,DM,AM").
--
-- Why the PREDICTED XI, not the full squad:
--   Versatility of a bench player helps less than versatility in a starter.
--   A manager's tactical flexibility in-game depends on who's actually
--   expected to play, not the full 25-man roster.
--
-- Score definition (0-100):
--   versatile_pct = (players with 2+ positions in predicted XI) / XI_count × 100
--   cross_group_pct = (players covering 2+ broad groups D/M/F) / XI_count × 100
--   versatility_score = versatile_pct × 0.6 + cross_group_pct × 0.4
--   (weighted: being multi-positional within a group counts for something;
--   spanning two groups is the stronger signal of real tactical adaptability)
--
-- Both columns NULL until processTeamStrengthRatings and
-- processTeamIntelligencePartial run with the new logic.

ALTER TABLE public.team_strength_ratings
  ADD COLUMN IF NOT EXISTS lineup_versatility_score numeric;

ALTER TABLE public.team_intelligence
  ADD COLUMN IF NOT EXISTS lineup_versatility_score numeric;

COMMENT ON COLUMN public.team_strength_ratings.lineup_versatility_score IS
  'Share of predicted-XI players who cover multiple position groups (D/M/F), 0-100. Null when no predicted lineup exists.';

COMMENT ON COLUMN public.team_intelligence.lineup_versatility_score IS
  'Share of predicted-XI players who cover multiple position groups (D/M/F), 0-100. Null when no predicted lineup exists.';
