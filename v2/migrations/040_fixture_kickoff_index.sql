-- =============================================================================
-- 040_fixture_kickoff_index.sql
-- REVISION 1
-- PitchTerminal V2 — all-status scheduled_kickoff_at index for the date calendar
-- =============================================================================
-- Depends on      : 005 (football.fixture), 013 (existing fixture indexes)
-- Transactional   : yes
--
-- Purpose
--   Serve GET /api/v2/fixtures/{date}, which filters the CURRENT scheduled
--   kickoff across ALL editions and ALL lifecycle states:
--       scheduled_kickoff_at >= $start AND scheduled_kickoff_at < $end
--
--   The existing fixture indexes cannot serve this cross-edition, all-status
--   date query:
--     • ix_fixture__edition_kickoff (competition_edition_id, scheduled_kickoff_at)
--       leads with the edition, so a query spanning every edition cannot use it
--       to range-scan by kickoff alone.
--     • ix_fixture__forward_window__open (scheduled_kickoff_at) WHERE
--       lifecycle_state_code = 'SCHEDULED' is PARTIAL — it excludes COMPLETED,
--       POSTPONED, CANCELLED, etc., which the calendar must include.
--
--   This adds the smallest sufficient index: a plain B-tree on
--   scheduled_kickoff_at over ALL rows. The filter is on scheduled_kickoff_at
--   (not the partition key fixture_partition_on), so a fixture rescheduled across
--   a year boundary is still found; the planner range-scans each yearly partition
--   through this index instead of sequential-scanning it.
--
--   Created on the partitioned parent, so PostgreSQL propagates a matching index
--   to every existing and future partition — the same convention migration 013
--   uses for ix_fixture__edition_kickoff.
--
-- Rules applied
--   Read-path only. No column, constraint, trigger, privilege, or data change.
--   Idempotent (IF NOT EXISTS). Safe to apply online at current volume.
-- =============================================================================

CREATE INDEX IF NOT EXISTS ix_fixture__kickoff
  ON football.fixture (scheduled_kickoff_at);

COMMENT ON INDEX football.ix_fixture__kickoff IS
  'All-status range index on the current scheduled kickoff. Serves the date-addressed '
  'fixture calendar (GET /api/v2/fixtures/{date}), which spans every edition and every '
  'lifecycle state, so neither ix_fixture__edition_kickoff (edition-led) nor '
  'ix_fixture__forward_window__open (SCHEDULED-only partial) applies.';
