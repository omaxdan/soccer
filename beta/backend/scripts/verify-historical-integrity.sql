-- ─── Post-fix historical integrity health check ──────────────────────────────
--
-- Written to answer the four checks from the Historical Integrity fix review,
-- not executed — no live database access exists in the environment these
-- changes were built in (no credentials, no network path to Supabase,
-- confirmed repeatedly this session). Run this after applying migrations
-- 041/042 and deploying the processDbOnly.ts fix, ideally once immediately
-- after deploy and again after the next process:all-db run.

-- 1. Count completed matches.
SELECT count(*) AS completed_matches
  FROM matches
 WHERE status != 'scheduled';

-- 2. Count completed matches whose match_intelligence was touched AFTER
--    kickoff — the direct fingerprint of the bug this fix addresses. Before
--    the fix, this number could be large; immediately after deploy it should
--    only include whatever was already corrupted by PAST runs (this fix does
--    not retroactively repair those — see the review's point about existing
--    corruption). Immediately after the NEXT process:all-db run following
--    deploy, this number should not grow.
SELECT count(*) AS finished_with_post_kickoff_update
  FROM matches m
  JOIN match_intelligence mi ON mi.match_id = m.id
 WHERE m.status != 'scheduled'
   AND mi.updated_at > m.date;

-- 3. Count completed matches with no frozen readiness_history snapshot — the
--    set of matches that will show "pre-match record not available" on the
--    match page rather than a frozen number, per the honest-fallback design.
--    A large number here doesn't indicate a bug; it indicates matches that
--    finished before archiveReadinessSnapshot existed, or that the archive
--    job hasn't reached yet.
SELECT count(*) AS finished_without_snapshot
  FROM matches m
  LEFT JOIN readiness_history rh ON rh.match_id = m.id
 WHERE m.status != 'scheduled'
   AND rh.match_id IS NULL;

-- 3b. The same count, but only for RECENT finished matches — this subset
--     matters more: an old match predating the archive job lacking a
--     snapshot is expected, a match that finished yesterday lacking one
--     suggests archiveReadinessSnapshot isn't running on schedule.
SELECT count(*) AS finished_without_snapshot_last_7_days
  FROM matches m
  LEFT JOIN readiness_history rh ON rh.match_id = m.id
 WHERE m.status != 'scheduled'
   AND m.date > now() - interval '7 days'
   AND rh.match_id IS NULL;

-- 4. "Count pages that still render live intelligence for finished fixtures"
--    is not a SQL question — answered directly from the code instead of a
--    query pretending otherwise:
--
--      Fixed (this change): app/match/[slug]/page.tsx's hero card
--        ("Historical advantage" / "Historical confidence") — the exact
--        card named in the original bug report.
--
--      NOT fixed, deliberately deferred (Phase 2, per the review):
--        components/ModuleReport.tsx and components/MatchReport.tsx's
--        Evidence Scorecard / Instant Verdict — these evaluate the full
--        13-module system live against match_intelligence/team_intelligence
--        on every render, with no per-match frozen snapshot to read instead.
--        Freezing them needs a richer snapshot (a full module-evaluation
--        JSON attached to readiness_history, or a new table) that does not
--        exist yet — not a missing filter, a missing table.
