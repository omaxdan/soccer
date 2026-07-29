-- ─── MIGRATION 040 — Persist the Wilson interval on signal_backtests ────────
--
-- Two new nullable columns on an existing table. No new table.
--
-- WHY THIS EXISTS
-- The admin confidence-band dashboard is required to show a Wilson interval
-- per band, and is explicitly required to never calculate a statistic itself
-- — it must only read precomputed analytics. jobs/backtestConfidenceBands.ts
-- (beta/backend/src/jobs/backtestConfidenceBands.ts) already computes
-- [ciLow, ciHigh] = wilson(hits, n) for every band on every run — it just
-- never persisted the result, because nothing needed it before now. Adding
-- these columns and having the job's existing persist step include two
-- already-computed numbers is the only way to satisfy "show the interval"
-- and "the dashboard calculates nothing" at the same time; the alternative
-- would be the frontend re-implementing wilson() itself, which is exactly
-- the duplicate-logic pattern this migration series exists to eliminate.
--
-- Existing selects (e.g. lib/queries.ts's getBandBacktests(), which lists its
-- columns explicitly) are unaffected — nothing about adding two nullable
-- columns changes what a query that doesn't ask for them returns.

ALTER TABLE public.signal_backtests
  ADD COLUMN IF NOT EXISTS ci_low  numeric,
  ADD COLUMN IF NOT EXISTS ci_high numeric;

COMMENT ON COLUMN public.signal_backtests.ci_low IS
  'Wilson 95% confidence interval lower bound, as a percentage. Computed by lib/confidenceBand.ts wilson(hits, sample_size) at the same time hit_rate is computed; null on any row written before this migration until the next backtest run.';
COMMENT ON COLUMN public.signal_backtests.ci_high IS
  'Wilson 95% confidence interval upper bound, as a percentage. See ci_low.';

-- ── Rollback ────────────────────────────────────────────────────────────────
--   ALTER TABLE public.signal_backtests DROP COLUMN IF EXISTS ci_low, DROP COLUMN IF EXISTS ci_high;
