// ─────────────────────────────────────────────────────────────────────────────
// INGESTION PIPELINE
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE ROLE, UNLIKE S-3
//
// S-3 needed four roles because it wrote across four schemas and the privilege
// matrix assigns writes by layer. S-4 writes schema football and nothing else,
// so pt_pipeline_ingestion covers all of it — and unlike pt_platform_admin under
// finding S3-1, it holds S and I on operations, so EVERY STAGE IS ATTRIBUTED.
// There is no unattributed path here and no reason for one.
//
// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE IS NOT CALCULATED HERE, AND CANNOT BE
//
// pt_pipeline_ingestion holds no USAGE on feature, module, snapshot or
// calibration. A statement touching feature.feature_value fails with "permission
// denied for schema feature" before it reaches a policy. The constraint holds
// against a coding mistake, not merely against intent.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUOTA IS FLUSHED ON THE CONTROL CONNECTION
//
// A stage that fails rolls back its writes. It does NOT roll back what it spent
// — the provider charged for those calls whatever happened afterwards. Usage is
// therefore flushed outside the work transaction, so the next run reasons about
// a budget that was really consumed rather than one the rollback pretended back
// into existence.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { withConnection, withRun } from '../db/tx';
import { withPipelineRun } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { recordWrite } from '../operations/writeRecord';
import { buildDiagnostic } from '../operations/failure';
import { assertRolesConfigured } from '../config/index';
import { ProviderClient, ProviderRequestError } from './provider/client';
import { dailyQuota, loadProviderConfig } from './provider/config';
import { IngestionCounts } from './write/index';
import { ingestScheduleDate } from './stages/schedule';
import { utcDateString } from './normalise';
import { logger } from '../../utils/logger';

/** The only role S-4 authenticates as. */
export const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;

export interface IngestionReport {
  readonly datesProcessed: number;
  readonly counts: IngestionCounts;
  readonly apiCalls: number;
  readonly failures: number;
}

export interface ScheduleIngestionOptions {
  /** First UTC date, inclusive. Defaults to today. */
  readonly from?: Date;
  /** Last UTC date, inclusive. Defaults to `from`. */
  readonly to?: Date;
  /**
   * Refuse to start when the range would exceed the daily budget.
   *
   * ON BY DEFAULT. A replay across a season is 300-odd calls against a 200/day
   * budget, and discovering that at call 201 leaves the run half-done with the
   * next day's quota already spent. Historical replay is a deliberate act (D-3),
   * so it passes false and accepts the cost knowingly.
   */
  readonly enforceQuotaBudget?: boolean;
}

/** Every UTC date in an inclusive range. */
function datesInRange(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= last) {
    dates.push(utcDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Ingests the schedule feed for a date range.
 *
 * DATE-RANGE DRIVEN THROUGHOUT (decision D-3). The feed is fetched per day
 * regardless, so a range costs nothing structurally and makes historical replay
 * the same code path rather than a second implementation. Default operation is a
 * single day — forward-only from cut-over — and a replay is an explicit,
 * quota-gated invocation.
 *
 * ONE TRANSACTION PER DATE. A date that fails rolls back entirely and the run
 * continues to the next: a partially ingested day is worse than an absent one,
 * because the next attempt would find some fixtures present. Days are
 * independent, so one bad response does not cost the rest of the range.
 */
export async function ingestSchedule(options: ScheduleIngestionOptions = {}): Promise<IngestionReport> {
  assertRolesConfigured([INGESTION_ROLE]);
  installOperationalLayer();

  const config = loadProviderConfig();
  const from = options.from ?? new Date();
  const to = options.to ?? from;
  const dates = datesInRange(from, to);

  if (options.enforceQuotaBudget !== false && dates.length > dailyQuota(config)) {
    throw new Error(
      `Refusing to ingest ${dates.length} dates against a daily budget of ${dailyQuota(config)} calls. ` +
        'Historical replay is a deliberate act (D-3): pass enforceQuotaBudget: false to accept the cost.'
    );
  }

  const client = new ProviderClient(config);
  const total = new IngestionCounts();
  let failures = 0;
  let apiCalls = 0;

  await withPipelineRun(INGESTION_ROLE, 'v2.ingest.schedule', async () => {
    for (const date of dates) {
      try {
        const counts = await withRun(
          INGESTION_ROLE,
          'ingest.schedule',
          async (tx: PoolClient, job) => {
            const stageCounts = await ingestScheduleDate(tx, client, date);
            await reportWrites(job, stageCounts);
            return stageCounts;
          },
          { detail: { date } }
        );
        total.add(counts.total);
        logger.info(
          { date, written: counts.total.written, skipped: counts.total.skipped, rejected: counts.total.rejected },
          'v2 ingestion: date complete'
        );
      } catch (error) {
        failures += 1;
        const notFound = error instanceof ProviderRequestError && error.isNotFound;
        // NOT recorded here. The S-2 job lifecycle already wrote the
        // operations.failure row when withRun rejected — with the job run
        // attribution this scope no longer has, on the control connection, and
        // outside the transaction that rolled back. Recording it again would
        // duplicate the row, and recording it here without a job run could not
        // work at all: operations.failure.pipeline_job_run_id is NOT NULL.
        logger[notFound ? 'warn' : 'error'](
          { date, error: buildDiagnostic(error) },
          notFound
            ? 'v2 ingestion: provider has no schedule for this date'
            : 'v2 ingestion: date failed, continuing with the range'
        );
      } finally {
        // Flush before the next date, so a crash mid-range still leaves an
        // accurate record of what was spent up to that point.
        apiCalls += client.pendingCallCount;
        await withConnection(INGESTION_ROLE, (control) => client.flushUsage(control));
      }
    }
  });

  return { datesProcessed: dates.length, counts: total, apiCalls, failures };
}

/**
 * Writes one `operations.write_record` per relation touched.
 *
 * Per relation rather than per stage, because `write_record` keys on
 * `(target_schema_name, target_relation_name)` and a single aggregate row would
 * lose the thing the relation exists to reveal: WHICH relation received nothing.
 * "A job completing successfully while writing nothing is among the most
 * dangerous states in a precompute platform and is invisible without this
 * record."
 */
async function reportWrites(
  job: Parameters<typeof recordWrite>[1],
  stage: { readonly byRelation: ReadonlyMap<string, IngestionCounts> }
): Promise<void> {
  await withConnection(INGESTION_ROLE, async (control) => {
    for (const [relation, counts] of stage.byRelation) {
      const [schema, name] = relation.split('.');
      await recordWrite(control, job, { schema, relation: name }, counts.toWriteCounts());
    }
  });
}

