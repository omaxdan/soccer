-- Migration 004: Add active_competitions to team_intelligence and match_intelligence
-- Computed from COUNT(DISTINCT competition) in matches for each team.
-- Zero API calls — derived from existing matches table.

ALTER TABLE team_intelligence
  ADD COLUMN IF NOT EXISTS active_competitions INTEGER DEFAULT 0;

COMMENT ON COLUMN team_intelligence.active_competitions
  IS 'Number of distinct competitions a team is active in (last 90 days). Computed from matches.competition.';

ALTER TABLE match_intelligence
  ADD COLUMN IF NOT EXISTS home_active_competitions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS away_active_competitions INTEGER DEFAULT 0;

COMMENT ON COLUMN match_intelligence.home_active_competitions
  IS 'Number of competitions the home team is active in — from team_intelligence.active_competitions';
COMMENT ON COLUMN match_intelligence.away_active_competitions
  IS 'Number of competitions the away team is active in — from team_intelligence.active_competitions';
