-- ─── MIGRATION 027 — Starting XI Strength + player_strength_score ──────────
-- Independent overlay metric (per design brief): NOT folded into the
-- weighted readiness formula. Answers "how strong is the specific eleven
-- expected to play today" vs. readiness's "how prepared is the team
-- overall" — a club can be strong while heavily rotated or missing key
-- starters, which readiness alone doesn't currently surface.
--
-- home_xi_strength / away_xi_strength live on match_intelligence (not a
-- new table) because the metric is inherently match-specific — same
-- design as home_readiness/away_readiness already there, and it means the
-- match page's existing query needs zero new joins.

ALTER TABLE public.match_intelligence
  ADD COLUMN IF NOT EXISTS home_xi_strength integer,
  ADD COLUMN IF NOT EXISTS away_xi_strength integer;

COMMENT ON COLUMN public.match_intelligence.home_xi_strength IS
  'Projected starting XI strength vs this team''s own best-available XI, 0-100. 100 = full-strength lineup, lower = key absences/rotation. NULL until a predicted lineup exists for this match (processPredictedLineups horizon: 7 days out). Independent overlay, not a readiness component — see processStartingXIStrength().';
COMMENT ON COLUMN public.match_intelligence.away_xi_strength IS
  'Same as home_xi_strength, away side.';

ALTER TABLE public.player_intelligence
  ADD COLUMN IF NOT EXISTS player_strength_score integer;

COMMENT ON COLUMN public.player_intelligence.player_strength_score IS
  '0-100: 40% normalized avg rating + 30% normalized appearances (vs team max) + 15% goal/assist contribution + 15% position importance. Recomputed weekly by processStartingXIStrength for any player on a team with an upcoming match — not a full-database backfill, see function docstring for the position-multiplier reasoning.';
