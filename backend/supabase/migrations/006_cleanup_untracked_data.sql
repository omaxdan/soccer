-- ─── CLEANUP V3: Remove non-tracked league data ──────────────────────────────
-- Run in Supabase SQL Editor. Execute STEP 1 first (dry run),
-- then STEP 2 after confirming counts look right.
--
-- WHY V3: V1 matched on slug ONLY — many countries share a slug (e.g.
-- 'premier-league' wrongly matched Ethiopia, Lebanon, Kazakhstan, Somalia,
-- Syria, Tanzania, Mongolia alongside the real England/Russia/Egypt entries).
--
-- V2 fixed tournament-level matching by requiring slug+category together,
-- but had a structural gap: the matches table has NO tournament_id FK —
-- only a denormalized 'competition' TEXT column copied from tournament.name.
-- If two DIFFERENT tournaments in DIFFERENT countries happen to share the
-- EXACT SAME name string (which we've directly observed: 'Premier League'
-- exists as the literal tournament name for England, Russia, Egypt, AND
-- Ethiopia, Lebanon, Kazakhstan, Kuwait, Mongolia, Somalia, Syria, Tanzania),
-- then filtering matches by 'competition IN (tracked names)' is ambiguous —
-- it cannot tell which country's match a given row belongs to, and would
-- incorrectly keep ALL of them since the name string is shared.
--
-- V3 fix: disambiguate at the MATCH level using teams.country (every team
-- has a country field populated independently of the competition name).
-- A match is tracked only if its competition name matches a tracked pair
-- AND the home team's country matches that SAME pair's country. This
-- correctly separates England's "Premier League" from Ethiopia's
-- "Premier League" even though both tournaments share the identical name.
--
-- Generated directly from src/config/trackedLeagues.ts (single source of
-- truth, 42 leagues) — not retyped by hand, so it can't drift out of sync.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ STEP 1: DRY RUN — see what will be deleted (no changes) ════════════════

DROP TABLE IF EXISTS _rip_tracked_pairs;
DROP TABLE IF EXISTS _rip_country_aliases;
DROP TABLE IF EXISTS _rip_tracked_resolved;
DROP TABLE IF EXISTS _rip_tracked_match_ids;
DROP TABLE IF EXISTS _rip_tracked_team_ids;

-- Exact slug+country pairs from trackedLeagues.ts (42 leagues)
CREATE TEMP TABLE _rip_tracked_pairs AS
SELECT * FROM (VALUES
    ('premier-league', 'England'),
    ('championship', 'England'),
    ('league-one', 'England'),
    ('league-two', 'England'),
    ('laliga', 'Spain'),
    ('laliga-2', 'Spain'),
    ('bundesliga', 'Germany'),
    ('2-bundesliga', 'Germany'),
    ('serie-a', 'Italy'),
    ('serie-b', 'Italy'),
    ('ligue-1', 'France'),
    ('eredivisie', 'Netherlands'),
    ('liga-portugal-betclic', 'Portugal'),
    ('jupiler-pro-league', 'Belgium'),
    ('super-lig', 'Turkey'),
    ('premiership', 'Scotland'),
    ('premier-league', 'Russia'),
    ('eliteserien', 'Norway'),
    ('allsvenskan', 'Sweden'),
    ('super-league', 'Switzerland'),
    ('bundesliga', 'Austria'),
    ('premier-division', 'Ireland'),
    ('veikkausliiga', 'Finland'),
    ('a-lyga', 'Lithuania'),
    ('brasileirao-serie-a', 'Brazil'),
    ('brasileirao-serie-b', 'Brazil'),
    ('liga-profesional', 'Argentina'),
    ('primera-nacional', 'Argentina'),
    ('primera-a-apertura', 'Colombia'),
    ('primera-division', 'Uruguay'),
    ('ligapro-serie-a', 'Ecuador'),
    ('mls', 'USA'),
    ('liga-mx', 'Mexico'),
    ('premier-league', 'Egypt'),
    ('premiership', 'South Africa'),
    ('j1-league', 'Japan'),
    ('j2-league', 'Japan'),
    ('k-league-1', 'South Korea'),
    ('k-league-2', 'South Korea'),
    ('saudi-pro-league', 'Saudi Arabia'),
    ('indian-super-league', 'India'),
    ('cfa-super-league', 'China')
) AS t(slug, country);

-- Country name aliases — covers cases where the API spells a country
-- differently than our canonical list (mirrors frontend countriesMatch()).
CREATE TEMP TABLE _rip_country_aliases AS
SELECT * FROM (VALUES
    ('turkey', 'türkiye'), ('turkey', 'turkiye'),
    ('south korea', 'korea republic'), ('south korea', 'republic of korea'),
    ('usa', 'united states'), ('usa', 'united states of america'),
    ('netherlands', 'holland'),
    ('russia', 'russian federation')
) AS t(canonical, alias);

CREATE OR REPLACE FUNCTION _rip_countries_match(a text, b text) RETURNS boolean AS $$
  SELECT lower(trim(a)) = lower(trim(b))
    OR EXISTS (
      SELECT 1 FROM _rip_country_aliases al
      WHERE (lower(al.canonical) = lower(trim(a)) AND lower(al.alias) = lower(trim(b)))
         OR (lower(al.canonical) = lower(trim(b)) AND lower(al.alias) = lower(trim(a)))
    );
$$ LANGUAGE sql IMMUTABLE;

-- STAGE 1: Resolve tournament rows that match slug AND category/country.
-- This is correct at the TOURNAMENT level (tournaments DO have a category column).
CREATE TEMP TABLE _rip_tracked_resolved AS
SELECT DISTINCT t.id AS tournament_id, t.name, t.slug, t.category, tp.country AS tracked_country
FROM tournaments t
JOIN _rip_tracked_pairs tp ON t.slug = tp.slug
WHERE _rip_countries_match(t.category, tp.country);

-- STAGE 2: Resolve which MATCHES are truly tracked — disambiguating via
-- team country, since matches.competition is just a name string that can
-- collide across countries (see header comment above). Checks BOTH home
-- and away team country (not just home) — in a domestic league both teams
-- share the same country, so this is more robust against occasional
-- missing/incorrect team.country data on one side without losing precision.
-- Note: if BOTH teams on a match have NULL country, that match will not be
-- matched and will be treated as untracked (safe default — under-keeps
-- rather than risks over-keeping junk data).
CREATE TEMP TABLE _rip_tracked_match_ids AS
SELECT DISTINCT m.id
FROM matches m
JOIN teams ht ON ht.id = m.home_team_id
JOIN teams at ON at.id = m.away_team_id
WHERE EXISTS (
  SELECT 1 FROM _rip_tracked_resolved tr
  WHERE tr.name = m.competition
    AND (
      _rip_countries_match(ht.country, tr.tracked_country)
      OR _rip_countries_match(at.country, tr.tracked_country)
    )
);

-- STAGE 3: Resolve which TEAMS are truly tracked — any team appearing in
-- at least one tracked match (home or away).
CREATE TEMP TABLE _rip_tracked_team_ids AS
SELECT DISTINCT team_id FROM (
  SELECT home_team_id AS team_id FROM matches WHERE id IN (SELECT id FROM _rip_tracked_match_ids)
  UNION
  SELECT away_team_id AS team_id FROM matches WHERE id IN (SELECT id FROM _rip_tracked_match_ids)
) x;

-- Show what's correctly tracked vs what will be cleaned up
SELECT
  (SELECT COUNT(*) FROM _rip_tracked_pairs)                                  AS tracked_pairs_defined,
  (SELECT COUNT(*) FROM _rip_tracked_resolved)                               AS tournaments_matched,
  (SELECT COUNT(*) FROM _rip_tracked_match_ids)                              AS matches_to_keep,
  (SELECT COUNT(*) FROM matches) - (SELECT COUNT(*) FROM _rip_tracked_match_ids) AS matches_to_delete,
  (SELECT COUNT(*) FROM _rip_tracked_team_ids)                               AS teams_to_keep,
  (SELECT COUNT(*) FROM teams) - (SELECT COUNT(*) FROM _rip_tracked_team_ids)    AS teams_to_delete,
  (SELECT COUNT(DISTINCT tournament_id) FROM _rip_tracked_resolved)          AS tournaments_to_keep,
  (SELECT COUNT(*) FROM tournaments) - (SELECT COUNT(DISTINCT tournament_id) FROM _rip_tracked_resolved) AS tournaments_to_delete;

-- Inspect exactly which tournaments matched (by id, not just name — so
-- same-name tournaments in different countries are shown separately)
SELECT t.id, t.name, t.slug, t.category,
       CASE WHEN t.id IN (SELECT tournament_id FROM _rip_tracked_resolved) THEN '✅ KEEP' ELSE '❌ DELETE' END AS action
FROM tournaments t
ORDER BY action DESC, t.name, t.category;

-- Specifically verify name-collision cases are correctly disambiguated
-- (e.g. confirm England's Premier League is kept but Ethiopia's is not)
SELECT t.name, t.category, t.slug,
       CASE WHEN t.id IN (SELECT tournament_id FROM _rip_tracked_resolved) THEN '✅ KEEP' ELSE '❌ DELETE' END AS action
FROM tournaments t
WHERE t.name IN (SELECT name FROM tournaments GROUP BY name HAVING COUNT(DISTINCT category) > 1)
ORDER BY t.name, action DESC;


-- ═══ STEP 2: ACTUAL CLEANUP — run only after reviewing STEP 1 counts ════════
-- Uncomment the block below and run it.

/*

-- 2a. Delete match-dependent intelligence (FK order: children first)
DELETE FROM match_intelligence
WHERE match_id NOT IN (SELECT id FROM _rip_tracked_match_ids);

DELETE FROM match_travel_intelligence
WHERE match_id NOT IN (SELECT id FROM _rip_tracked_match_ids);

DELETE FROM match_results
WHERE match_id NOT IN (SELECT id FROM _rip_tracked_match_ids);

-- 2b. Delete the untracked matches themselves
DELETE FROM matches
WHERE id NOT IN (SELECT id FROM _rip_tracked_match_ids);

-- 2c. Delete dependent team-level intelligence for non-tracked teams
DELETE FROM team_form_history     WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_intelligence     WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_fixture_load     WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_travel_load      WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_locations        WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_strength_ratings WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_venue_performance WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_transfer_intelligence WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_position_depth   WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);
DELETE FROM team_squads_snapshot  WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);

-- 2d. Delete squad-related player data for non-tracked teams
DELETE FROM player_injuries WHERE player_id IN (
  SELECT id FROM players WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids)
);
DELETE FROM player_transfers WHERE player_id IN (
  SELECT id FROM players WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids)
);
DELETE FROM player_intelligence WHERE player_id IN (
  SELECT id FROM players WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids)
);
DELETE FROM players WHERE team_id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);

-- 2e. Delete orphaned teams themselves
DELETE FROM teams WHERE id NOT IN (SELECT team_id FROM _rip_tracked_team_ids);

-- 2f. Delete untracked seasons and tournaments (by id, not name —
--     correctly handles same-name tournaments in different countries)
DELETE FROM seasons
WHERE tournament_id NOT IN (SELECT DISTINCT tournament_id FROM _rip_tracked_resolved);

DELETE FROM tournaments
WHERE id NOT IN (SELECT DISTINCT tournament_id FROM _rip_tracked_resolved);

-- 2g. Verify final state
SELECT
  (SELECT COUNT(*) FROM teams)        AS teams,
  (SELECT COUNT(*) FROM tournaments)  AS tournaments,
  (SELECT COUNT(*) FROM matches)      AS matches,
  (SELECT COUNT(*) FROM players)      AS players,
  (SELECT COUNT(DISTINCT category) FROM tournaments) AS countries_remaining;

*/

-- Cleanup the helper function (optional — harmless to leave it)
-- DROP FUNCTION IF EXISTS _rip_countries_match(text, text);
