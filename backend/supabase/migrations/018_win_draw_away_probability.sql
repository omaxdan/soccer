-- ─── MIGRATION 018 — Real Win/Draw/Away Probability ─────────────────────────
-- processScorelinePredictions already computes a FULL 49-cell Poisson
-- probability grid (home goals 0-6 × away goals 0-6) internally, but only
-- ever kept the top 6 cells (renormalized among themselves) for display —
-- the full grid was discarded immediately after. That top-6-renormalized
-- set does NOT represent the true Win/Draw/Away split (it's ~6 of 49
-- cells, renormalized to itself), so it was never a sound basis for a
-- "Win Probability" figure.
--
-- This adds three columns summed correctly from the FULL grid before any
-- truncation: P(home_goals > away_goals), P(home_goals == away_goals),
-- P(home_goals < away_goals). These three always sum to ~100 and are
-- statistically grounded in the same Poisson model already computed —
-- no new assumptions, just capturing a summary of data that was already
-- being computed and then thrown away.

ALTER TABLE public.match_intelligence
  ADD COLUMN IF NOT EXISTS win_probability_home numeric,
  ADD COLUMN IF NOT EXISTS win_probability_draw numeric,
  ADD COLUMN IF NOT EXISTS win_probability_away numeric;
