-- Migration 003: Add forward-looking fixture windows to team_fixture_load
-- These are computed from existing scheduled matches — zero extra API calls.
-- Populated by processTeamFixtureLoad() in processDbOnly.ts

ALTER TABLE team_fixture_load
  ADD COLUMN IF NOT EXISTS matches_next_7_days  INTEGER,
  ADD COLUMN IF NOT EXISTS matches_next_14_days INTEGER;

-- Update congestion_score comment via index for documentation
COMMENT ON COLUMN team_fixture_load.matches_next_7_days  IS 'Upcoming scheduled matches in next 7 days — derived from matches table, no API needed';
COMMENT ON COLUMN team_fixture_load.matches_next_14_days IS 'Upcoming scheduled matches in next 14 days — derived from matches table, no API needed';
