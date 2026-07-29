-- ─── MIGRATION 039 — Confidence-band analytics: column rename ───────────────
--
-- One rename, part of the readiness-gap -> confidence-band consolidation
-- (backend jobs/archiveReadinessHistory.ts, jobs/backtestConfidenceBands.ts,
-- lib/confidenceBand.ts). No new table — league_gap_summary and
-- league_gap_analytics are reused exactly as they are; only what a nightly
-- job WRITES into them changes (band-keyed cells instead of gap-tier-keyed
-- cells), which needs no schema change at all. This migration covers the one
-- column whose NAME stopped matching its contents.
--
-- SAFETY — checked, not assumed: grepped the entire frontend for
-- `readiness_status` before proposing this. It is typed on LeagueGapSummary
-- and present in demo fixtures, but rendered nowhere — zero consuming JSX,
-- zero conditional branching on its value. The rename has no live blast
-- radius. (The demo fixtures also used values — "calibrated"/"monitoring" —
-- that never matched what the real job has written since before this
-- migration; that drift is corrected in the same frontend change alongside
-- this rename, not left as one more stale thing pointing at a name that no
-- longer exists.)
--
-- gap_tier (league_gap_analytics) is NOT renamed. It has zero consumers of
-- any kind — not even the dormant frontend typing readiness_status had — so
-- there is nothing for a rename to protect against; the column simply starts
-- holding Elite/Strong/Moderate/Risky/Avoid instead of
-- strong/moderate/small/negative, which the previous investigation confirmed
-- and this migration does not need to touch at the schema level.

ALTER TABLE public.league_gap_summary
  RENAME COLUMN readiness_status TO band_status;

COMMENT ON COLUMN public.league_gap_summary.band_status IS
  'consistent / mixed / volatile / insufficient — sample-gated read of how reliably this league''s confidence bands beat the platform baseline. Was readiness_status before the gap-tier -> confidence-band consolidation; renamed because it stopped describing readiness the moment the dimension it summarises changed, not because of any consumer requirement (none existed).';

-- ── Rollback ────────────────────────────────────────────────────────────────
--   ALTER TABLE public.league_gap_summary RENAME COLUMN band_status TO readiness_status;
