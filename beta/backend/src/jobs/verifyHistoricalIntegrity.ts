import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';

/**
 * Historical Integrity Report — the automated version of
 * scripts/verify-historical-integrity.sql, runnable as a CLI command instead
 * of pasted into a SQL console by hand.
 *
 * Four numbers here are genuinely queryable from the database. One is not,
 * and this function says so rather than fabricate it:
 *
 *   "Historical updates blocked" (trigger violations) cannot be computed by
 *   a fresh query, ever — migration 042/043's trigger works by RAISE
 *   EXCEPTION inside the same transaction as the rejected write, which rolls
 *   the whole transaction back. Postgres does not durably record a rejected
 *   write; that is what "rolled back" means. The only place this number
 *   exists is the calling processor's own logged output at the moment it
 *   happened (processMatchIntelligencePartial's triggerViolations field,
 *   added alongside this report) — this job reports that it must be read
 *   from logs, rather than silently printing a query result of 0 that would
 *   be indistinguishable from "genuinely never happened".
 *
 * "Live intelligence leaks" is a code fact, not a database fact — see the
 * Phase 2 note below rather than a query pretending it's derivable from data.
 */
export async function verifyHistoricalIntegrity(): Promise<{
  completedMatches: number;
  snapshotsFound: number;
  snapshotsMissing: number;
  snapshotsMissingLast7Days: number;
  postKickoffUpdates: number;
  pass: boolean;
}> {
  logger.info('verifyHistoricalIntegrity started');

  const matches = await fetchAllRows<any>(
    db.from('matches').select('id, status, date').neq('status', 'scheduled'),
    2000, 'id', 'verify:matches'
  );
  const completedMatches = matches?.length ?? 0;
  const ids = (matches ?? []).map((m) => m.id);

  const [miRows, rhRows] = await Promise.all([
    ids.length
      ? fetchAllRows<any>(db.from('match_intelligence').select('match_id, updated_at').in('match_id', ids), 2000, 'id', 'verify:mi')
      : Promise.resolve([]),
    ids.length
      ? fetchAllRows<any>(db.from('readiness_history').select('match_id').in('match_id', ids), 2000, 'id', 'verify:rh')
      : Promise.resolve([]),
  ]);

  const snapshottedIds = new Set((rhRows ?? []).map((r) => r.match_id));
  const miByMatch = new Map((miRows ?? []).map((r) => [r.match_id, r]));

  const snapshotsFound = snapshottedIds.size;
  const missing = (matches ?? []).filter((m) => !snapshottedIds.has(m.id));
  const snapshotsMissing = missing.length;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const snapshotsMissingLast7Days = missing.filter((m) => new Date(m.date) > sevenDaysAgo).length;

  // The direct fingerprint of the original bug: a completed match whose
  // match_intelligence was touched AFTER its own kickoff. This is what
  // "PASS" actually certifies — everything else here is context.
  const postKickoffUpdates = (matches ?? []).filter((m) => {
    const mi = miByMatch.get(m.id);
    return mi?.updated_at && new Date(mi.updated_at) > new Date(m.date);
  }).length;

  const pass = postKickoffUpdates === 0;

  const report = {
    completedMatches,
    snapshotsFound,
    snapshotsMissing,
    snapshotsMissingLast7Days,
    postKickoffUpdates,
    // Not a query result — see the docstring. Read from the most recent
    // processMatchIntelligencePartial run's own log line instead.
    historicalUpdatesBlocked: 'see application logs — triggerViolations field, not independently queryable by design',
    // Code fact, not derivable from data. Fixed here, not derived — Phase 2
    // will shrink this count as more surfaces get frozen-snapshot support.
    liveIntelligenceLeaks: {
      count: 2,
      surfaces: ['components/ModuleReport.tsx', 'components/MatchReport.tsx (Evidence Scorecard)'],
      note: 'Deliberately deferred — needs a richer archived snapshot than readiness_history currently stores.',
    },
    pass,
  };

  logger.info(report, `verifyHistoricalIntegrity ${pass ? 'PASS' : 'FAIL'}`);
  return { completedMatches, snapshotsFound, snapshotsMissing, snapshotsMissingLast7Days, postKickoffUpdates, pass };
}
