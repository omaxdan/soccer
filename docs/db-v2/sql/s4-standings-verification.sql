-- ============================================================================
-- S-4 STANDINGS LIVE PROOF — §0–§6 as ONE self-checking script
--
-- Executes doc 46's verification block against runs 52 and 53 and returns one
-- row per assertion with its own PASS / FAIL verdict. READ-ONLY throughout:
-- no INSERT, UPDATE, DELETE, DDL or SET.
--
-- Run as a role holding SELECT on schemas operations and football.
-- Edit the two ids in `runs` if the run numbers differ.
-- ============================================================================

WITH runs AS (
  SELECT r.*
    FROM operations.pipeline_run r
   WHERE r.id IN (52, 53) AND r.run_key = 'v2.ingest.season'
),
first_run AS (SELECT * FROM runs ORDER BY occurred_at LIMIT 1),

-- Terminal outcomes are APPEND-ONLY (migration 019, M-1). pipeline_run.outcome
-- is written once as RUNNING and never updated; the prevailing outcome is the
-- completion row with the highest ordinal. Reading the column directly reports
-- a false failure on a healthy run.
run_outcome AS (
  SELECT DISTINCT ON (c.pipeline_run_id, c.run_occurred_at)
         c.pipeline_run_id AS run_id, c.outcome, c.ordinal, c.ended_at
    FROM operations.pipeline_run_completion c
    JOIN runs r ON r.id = c.pipeline_run_id AND r.occurred_at = c.run_occurred_at
   ORDER BY c.pipeline_run_id, c.run_occurred_at, c.ordinal DESC, c.occurred_at DESC, c.id DESC
),
jobs AS (
  SELECT j.*, r.id AS run_id
    FROM operations.pipeline_job_run j
    JOIN runs r ON r.id = j.pipeline_run_id AND r.occurred_at = j.run_occurred_at
),
job_outcome AS (
  SELECT DISTINCT ON (c.pipeline_job_run_id, c.job_occurred_at)
         c.pipeline_job_run_id AS job_id, c.outcome
    FROM operations.pipeline_job_run_completion c
    JOIN jobs j ON j.id = c.pipeline_job_run_id AND j.occurred_at = c.job_occurred_at
   ORDER BY c.pipeline_job_run_id, c.job_occurred_at, c.ordinal DESC, c.occurred_at DESC, c.id DESC
),
writes AS (
  SELECT j.run_id, w.target_schema_name || '.' || w.target_relation_name AS relation,
         w.rows_examined, w.rows_written, w.rows_skipped, w.rows_rejected
    FROM operations.write_record w
    JOIN jobs j ON j.id = w.pipeline_job_run_id AND j.occurred_at = w.job_occurred_at
),
edition AS (
  SELECT id FROM football.competition_edition WHERE provider_external_id = '87678'
),
standing AS (
  SELECT s.* FROM football.standing s JOIN edition e ON e.id = s.competition_edition_id
),
usage AS (
  SELECT u.* FROM operations.api_usage u
   WHERE u.provider_code = 'SPORTSAPI_API'
     AND u.occurred_at >= (SELECT started_at FROM first_run)
),
checks(ord, assertion, expected, actual) AS (
VALUES
-- §0 runs -------------------------------------------------------------------
 (0, 'both runs exist', '2',
     (SELECT count(*)::text FROM runs)),
 (1, 'both runs SUCCEEDED (prevailing completion)', 'SUCCEEDED,SUCCEEDED',
     (SELECT coalesce(string_agg(outcome, ',' ORDER BY run_id), '(none)') FROM run_outcome)),
 (2, 'one completion each, ordinal 1', '1,1',
     (SELECT coalesce(string_agg(ordinal::text, ',' ORDER BY run_id), '(none)') FROM run_outcome)),
 (3, 'scope_text carries +standings@2026-08-11', '2',
     (SELECT count(*)::text FROM runs WHERE scope_text LIKE '%+standings@2026-08-11%')),
 (4, 'scope_text names competition and season', '2',
     (SELECT count(*)::text FROM runs
       WHERE scope_text LIKE '%competition 325 season 87678 2026-05-31..2026-08-11%')),
-- §1 jobs -------------------------------------------------------------------
 (5, 'exactly one ingest.season job per run', '1,1',
     (SELECT coalesce(string_agg(n::text, ',' ORDER BY run_id), '(none)')
        FROM (SELECT run_id, count(*) AS n FROM jobs WHERE job_key = 'ingest.season'
               GROUP BY run_id) q)),
 (6, 'no job with any other key', '0',
     (SELECT count(*)::text FROM jobs WHERE job_key <> 'ingest.season')),
 (7, 'both jobs SUCCEEDED', '2',
     (SELECT count(*)::text FROM job_outcome WHERE outcome = 'SUCCEEDED')),
-- §2 write records ----------------------------------------------------------
 (8, 'run 52 football.standing examined/written/skipped/rejected', '20/20/0/0',
     (SELECT coalesce(max(rows_examined || '/' || rows_written || '/' || rows_skipped || '/' || rows_rejected), '(missing)')
        FROM writes WHERE relation = 'football.standing' AND run_id = 52)),
 (9, 'run 53 football.standing examined/written/skipped/rejected  <-- IDEMPOTENCY', '20/0/20/0',
     (SELECT coalesce(max(rows_examined || '/' || rows_written || '/' || rows_skipped || '/' || rows_rejected), '(missing)')
        FROM writes WHERE relation = 'football.standing' AND run_id = 53)),
 (10, 'football.result written/skipped, both runs', '43/4,43/4',
     (SELECT coalesce(string_agg(rows_written || '/' || rows_skipped, ',' ORDER BY run_id), '(missing)')
        FROM writes WHERE relation = 'football.result')),
 (11, 'a write_record exists for football.standing on both runs', '2',
     (SELECT count(*)::text FROM writes WHERE relation = 'football.standing')),
-- §3 provider ---------------------------------------------------------------
 (12, 'events_last requests across both runs', '6',
     (SELECT coalesce(sum(requests_made), 0)::text FROM usage
       WHERE endpoint_key = 'tournament_season_events_last')),
 (13, 'events_next requests across both runs', '2',
     (SELECT coalesce(sum(requests_made), 0)::text FROM usage
       WHERE endpoint_key = 'tournament_season_events_next')),
 (14, 'season_standings requests across both runs', '2',
     (SELECT coalesce(sum(requests_made), 0)::text FROM usage
       WHERE endpoint_key = 'season_standings')),
 (15, 'no endpoint beyond the three expected', '',
     (SELECT coalesce(string_agg(DISTINCT endpoint_key, ','), '') FROM usage
       WHERE endpoint_key NOT IN ('tournament_season_events_last',
                                  'tournament_season_events_next','season_standings'))),
 (16, 'throttled_count across both runs', '0',
     (SELECT coalesce(sum(throttled_count), 0)::text FROM usage)),
-- §4 standings state --------------------------------------------------------
 (17, 'standing rows for season 87678', '20',
     (SELECT count(*)::text FROM standing)),
 (18, 'variants present', 'TOTAL',
     (SELECT coalesce(string_agg(DISTINCT standing_variant, ','), '(none)') FROM standing)),
 (19, 'HOME or AWAY rows', '0',
     (SELECT count(*)::text FROM standing WHERE standing_variant <> 'TOTAL')),
 (20, 'distinct as_of_on', '2026-08-11',
     (SELECT coalesce(string_agg(DISTINCT to_char(as_of_on,'YYYY-MM-DD'), ','), '(none)') FROM standing)),
 (21, 'positions min/max/distinct', '1/20/20',
     (SELECT coalesce(min(position) || '/' || max(position) || '/' || count(DISTINCT position), '(none)')
        FROM standing)),
 (22, 'distinct teams', '20',
     (SELECT count(DISTINCT team_id)::text FROM standing)),
 (23, 'duplicate (team, variant, as_of) groups', '0',
     (SELECT count(*)::text FROM (SELECT 1 FROM standing
        GROUP BY team_id, standing_variant, as_of_on HAVING count(*) > 1) d)),
 (24, 'exactly one competition_edition for 87678', '1',
     (SELECT count(*)::text FROM edition)),
-- §5 shell teams ------------------------------------------------------------
 (25, 'teams created during the runs  <-- SHELL TEAMS', '0',
     (SELECT count(*)::text FROM football.team
       WHERE created_at >= (SELECT started_at FROM first_run))),
 (26, 'standings teams with no fixture in this edition', '0',
     (SELECT count(*)::text FROM standing s WHERE NOT EXISTS (
        SELECT 1 FROM football.fixture f
         WHERE f.competition_edition_id = s.competition_edition_id
           AND (f.home_team_id = s.team_id OR f.away_team_id = s.team_id)))),
-- §6 season state and failures ----------------------------------------------
 (27, 'fixtures in edition', '47',
     (SELECT count(*)::text FROM football.fixture f JOIN edition e ON e.id = f.competition_edition_id)),
 (28, 'results in edition', '43',
     (SELECT count(*)::text FROM football.result r
        JOIN football.fixture f ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
        JOIN edition e ON e.id = f.competition_edition_id)),
 (29, 'competition_stages in edition', '6',
     (SELECT count(*)::text FROM football.competition_stage cs JOIN edition e ON e.id = cs.competition_edition_id)),
 (30, 'team_registrations in edition (distinct rows, not the 94 attempts)', '20',
     (SELECT count(*)::text FROM football.team_registration tr JOIN edition e ON e.id = tr.competition_edition_id)),
 (31, 'distinct venues used by the edition''s fixtures', '20',
     (SELECT count(DISTINCT f.venue_id)::text FROM football.fixture f JOIN edition e ON e.id = f.competition_edition_id)),
 (32, 'failure rows attributed to either run', '0',
     (SELECT count(*)::text FROM operations.failure f
        JOIN jobs j ON j.id = f.pipeline_job_run_id AND j.occurred_at = f.job_occurred_at))
)
SELECT ord AS "#",
       assertion,
       expected,
       actual,
       CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS' ELSE '*** FAIL ***' END AS verdict
  FROM checks
 ORDER BY ord;
