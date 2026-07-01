-- ─── MIGRATION 008 — Tournament Standings ────────────────────────────────────
-- NOTE: this has been folded back into migration 007 (see that file's Part 6
-- and the "PART 6.5 — TOURNAMENT STANDINGS" block / header note) so that 007
-- alone is a complete one-shot fresh-start script. This file is kept for
-- historical reference and is still safe to run on its own — every
-- statement below uses IF NOT EXISTS, so running it after 007 (which
-- already created this table) is a harmless no-op.
--
-- Resolves the league_position gap in team_strength_ratings that's been null
-- since the original build (no standings source existed at the time).
--
-- Source: GET /tournament/{tournamentId}/season/{seasonId}/standings
-- Confirmed PER-TOURNAMENT (not per-team) — one call returns the full table
-- for every team in that competition. 42 tracked tournaments = 42 calls for
-- complete league-position coverage across the whole platform, dramatically
-- cheaper than the per-team statistics endpoints.

CREATE TABLE IF NOT EXISTS tournament_standings (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id       bigint NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id             bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_external_id  bigint NOT NULL,
  standings_type      text NOT NULL DEFAULT 'total', -- 'total' | 'home' | 'away'
  position            integer,
  matches             integer,
  wins                integer,
  draws               integer,
  losses              integer,
  scores_for          integer,
  scores_against      integer,
  points              integer,
  calculated_at       timestamp with time zone DEFAULT now(),
  updated_at          timestamp with time zone DEFAULT now(),
  UNIQUE(team_id, season_external_id, standings_type)
);
CREATE INDEX IF NOT EXISTS idx_tournament_standings_tournament ON tournament_standings(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_standings_team ON tournament_standings(team_id);
