-- ─── MIGRATION 022 — Net Battle Superiority Index (NBSI) ─────────────────────
-- A single computed number summarizing how far apart two teams are across
-- all tracked comparison categories, on a genuinely comparable scale.
--
-- METHODOLOGY (deliberately NOT hand-picked category weights):
-- Each category's value is converted to a z-score against the REAL current
-- population of tracked teams (real mean and standard deviation, queried
-- from the database, not assumed) before comparing home vs away. This is
-- the standard, principled way to solve the "Form Index +40 vs Predicted
-- Goals +0.3" scale problem — a metric with naturally wide variance
-- (like Form Index) doesn't automatically dominate the sum just because
-- its raw numbers are big; it's normalized by its OWN real variability.
--
-- Every category counts equally after normalization. No category receives
-- an invented "importance multiplier" (e.g. "Predicted Goals x25", "Venue
-- x0.5") — there is no backtested evidence in this platform establishing
-- that one category matters more than another, so treating them equally
-- post-normalization is the statistically honest default. If/when
-- readiness_history and league_gap_analytics accumulate enough matches to
-- backtest differential category importance, that would be the honest
-- basis for future re-weighting — not intuition.
--
-- net_battle_index = average(z_home - z_away) across every category with
-- valid data on both sides, sign-flipped for "lower is better" categories
-- (Congestion, Goals Conceded, Injury Impact) so positive always means
-- "home team ahead" and negative always means "away team ahead".
--
-- Averaged, not summed, so the scale stays stable and interpretable
-- regardless of how many of the ~12 tracked categories happen to have
-- data for a given match — a match with 8 available categories and one
-- with 12 both produce numbers on the same footing.
--
-- Deliberately informational: this is a NUMBER, not a verdict. No
-- classification label (e.g. "Heavy Dominance") is computed or stored —
-- the platform's principle throughout is to show facts and let the user
-- judge them, not hand back a directional recommendation.

ALTER TABLE public.match_intelligence
  ADD COLUMN IF NOT EXISTS net_battle_index numeric;

COMMENT ON COLUMN public.match_intelligence.net_battle_index IS
  'Average z-score difference (home minus away) across all tracked comparison categories, real-population-normalized. Positive = home ahead, negative = away ahead, magnitude = how many standard deviations apart on average. Informational only — no verdict or classification attached.';
