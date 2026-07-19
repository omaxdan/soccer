-- ─── MIGRATION 023 — team_betting_intelligence.sample_confidence ─────────────
-- processTeamBettingIntelligence (processExtendedIntelligence.ts) writes a
-- sample_confidence tier on every row it computes (LOW when a team is below
-- the MIN_MATCHES=8 reliability threshold; ADEQUATE/MODERATE/HIGH otherwise,
-- based on how many matches the season stats are drawn from) — but this
-- column was never migrated in. Every run of processTeamBettingIntelligence
-- therefore: (1) deletes existing rows for the teams in scope, (2) fails the
-- subsequent upsert with "column sample_confidence does not exist" after 3
-- retries, (3) throws, caught by the outer try/catch, logging a failure but
-- never rolling back the delete. Net effect: team_betting_intelligence has
-- been silently emptied by every single run (observed: 0 rows).
--
-- This cascades: processTeamStrengthDashboard, processMatchPerformanceComparison,
-- and processTeamMatchImpact (and several other processors) all gate their
-- per-team/per-match logic on team_betting_intelligence having a row for
-- both sides (`if (!betting) continue`) — with the table empty, they were
-- never broken themselves, they were just permanently starved of data,
-- producing 0 rows / all-skipped with no error of their own.

ALTER TABLE public.team_betting_intelligence
  ADD COLUMN IF NOT EXISTS sample_confidence text
  CHECK (sample_confidence IS NULL OR sample_confidence = ANY (ARRAY['LOW'::text, 'ADEQUATE'::text, 'MODERATE'::text, 'HIGH'::text]));

COMMENT ON COLUMN public.team_betting_intelligence.sample_confidence IS
  'Reliability tier for this row''s ratings, based on team_season_statistics.matches: LOW = below MIN_MATCHES(8) reliability threshold (ratings default to neutral 50s), ADEQUATE = 8-11 matches, MODERATE = 12-19 matches, HIGH = 20+ matches.';
