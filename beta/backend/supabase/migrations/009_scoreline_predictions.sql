-- ─── MIGRATION 009 — Scoreline Predictions ───────────────────────────────────
-- Adds expected-goals and likely-scoreline columns to match_intelligence.
-- Computed via an independent Poisson goal model — standard, transparent
-- approach for scoreline markets (real bookmaker models add correlation
-- corrections like Dixon-Coles for low-scoring games; this is the honest
-- simple version, clearly labeled as an estimate in both data and UI).

ALTER TABLE match_intelligence
  ADD COLUMN IF NOT EXISTS predicted_home_goals numeric,
  ADD COLUMN IF NOT EXISTS predicted_away_goals numeric,
  ADD COLUMN IF NOT EXISTS predicted_scorelines jsonb;
  -- predicted_scorelines shape: [{"home":1,"away":0,"probability":14.2}, ...]
  -- top 6 scorelines by probability, normalized to sum ~100%
