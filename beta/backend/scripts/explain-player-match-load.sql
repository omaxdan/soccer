-- ─── EXPLAIN ANALYZE for processPlayerMatchLoad's matches query ─────────────
--
-- Not run — no live database access exists in this environment (no
-- credentials, no network path to Supabase, confirmed repeatedly this
-- session). This is the query itself, ready to paste into a SQL console,
-- self-contained rather than requiring you to manually transcribe team_ids
-- out of the new [timing] log lines.
--
-- This reconstructs the SQL Postgres actually plans, not PostgREST's
-- .or()/.in.() string syntax — that dot-notation isn't valid SQL, it's
-- PostgREST's own filter grammar, translated server-side before it ever
-- reaches the query planner.
--
-- WHAT TO LOOK FOR IN THE OUTPUT
--   Seq Scan on matches           -> confirms the OR-across-two-columns
--                                    shape as the actual bottleneck; an
--                                    index on (home_team_id) and
--                                    (away_team_id) separately often can't
--                                    be combined efficiently for an OR by
--                                    the planner the way an AND can.
--   Bitmap Heap Scan + BitmapOr   -> the planner found a way to use both
--                                    indexes and combine them; if this
--                                    still takes seconds, the row count
--                                    itself (not the plan) is the story.
--   Execution Time                -> compare directly against the
--                                    [timing] log's durationMs for the
--                                    matches query once you have a real run.

EXPLAIN ANALYZE
SELECT id, home_team_id, away_team_id, date
FROM matches
WHERE (
    home_team_id IN (SELECT DISTINCT team_id FROM player_season_statistics)
    OR
    away_team_id IN (SELECT DISTINCT team_id FROM player_season_statistics)
  )
  AND date <= now()
ORDER BY date;

-- ── Companion checks — cheap, answer the "did row counts increase" question
--    directly rather than inferring it from the query plan alone ──────────

-- How many distinct teams actually feed the .or() filter right now:
SELECT count(DISTINCT team_id) AS team_count FROM player_season_statistics;

-- How many rows the WHERE clause actually has to consider:
SELECT count(*) AS matches_before_date_filter FROM matches WHERE date <= now();

-- Whether relevant indexes exist at all — if these come back empty, that
-- alone would explain a sequential scan regardless of anything else:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'matches'
  AND (indexdef ILIKE '%home_team_id%' OR indexdef ILIKE '%away_team_id%' OR indexdef ILIKE '%date%');

-- Current configured statement_timeout — confirms whether this is a fixed,
-- known limit or something that could itself have changed (e.g. a plan/tier
-- change), which no amount of code review here could detect:
SHOW statement_timeout;
