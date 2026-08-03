// ─────────────────────────────────────────────────────────────────────────────
// WRITE RECORDS — operations.write_record
//
// One row per write batch, attributing rows touched to the job run that touched
// them. Append-only: a write record is a statement about something that already
// happened, and there is nothing to correct later.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SHAPE IS THE SCHEMA'S, NOT THE BRIEF'S  (finding M-3)
//
// The S-2 brief asks write records to capture "operation type, rows inserted,
// rows updated, rows deleted, elapsed duration". The approved relation records
// something different and, on inspection, more coherent for this architecture:
//
//     rows_examined   rows_written   rows_skipped   rows_rejected
//
// There is no operation-type column, no per-operation row counts, and no
// duration column. This is not an oversight. In a write model that is
// append-only by construction, "rows updated" and "rows deleted" are not
// quantities a pipeline can report: an UPDATE against feature.feature_value
// raises (R-19), and DELETE is held by pt_retention alone under the session
// marker (R-20, R-22). A column for them would be permanently zero, and a
// permanently-zero column invites the belief that the operation is available.
//
// The recorded quantities answer the questions this pipeline actually has:
// how much was considered, how much landed, how much was deliberately passed
// over, how much was refused. Duration belongs to the job run
// (started_at/ended_at), not to each batch within it.
//
// The schema is immutable, so this module records what exists. The divergence
// is documented rather than worked around, per the S-2 instruction.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { JobRunRef } from '../db/tx';
import { logger } from '../../utils/logger';

/**
 * Counts for one write batch.
 *
 * All default to 0, matching the column defaults, so a caller reports only what
 * it actually knows. ck_write_record__counts_non_negative rejects negatives —
 * this module does not re-check that, because PostgreSQL already does.
 */
export interface WriteCounts {
  /** Rows the batch considered, including those it chose not to write. */
  readonly rowsExamined?: number;
  /** Rows that landed. */
  readonly rowsWritten?: number;
  /** Rows deliberately passed over — already present, out of window, inactive. */
  readonly rowsSkipped?: number;
  /** Rows refused — failed validation before the database saw them. */
  readonly rowsRejected?: number;
}

export interface WriteTarget {
  readonly schema: string;
  readonly relation: string;
}

/**
 * Persists one write record.
 *
 * Written on the CONTROL connection, not the work connection. A write record
 * inside the business transaction would roll back with it, and the batches most
 * worth recording — the ones that failed partway — would be the ones leaving no
 * trace. Same reasoning as failures, same mechanism.
 *
 * Never throws. Telemetry that can fail a pipeline is worse than telemetry that
 * is occasionally absent.
 */
export async function recordWrite(
  control: PoolClient,
  job: JobRunRef | null,
  target: WriteTarget,
  counts: WriteCounts
): Promise<boolean> {
  if (!job) {
    logger.warn(
      { target: `${target.schema}.${target.relation}` },
      'v2: write record NOT persisted — no job run. ' +
        'operations.write_record.pipeline_job_run_id is NOT NULL.'
    );
    return false;
  }
  try {
    await control.query(
      `INSERT INTO operations.write_record
         (pipeline_job_run_id, job_occurred_at, target_schema_name, target_relation_name,
          rows_examined, rows_written, rows_skipped, rows_rejected)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        job.id,
        job.occurredAt,
        target.schema,
        target.relation,
        counts.rowsExamined ?? 0,
        counts.rowsWritten ?? 0,
        counts.rowsSkipped ?? 0,
        counts.rowsRejected ?? 0,
      ]
    );
    return true;
  } catch (err) {
    logger.error(
      {
        target: `${target.schema}.${target.relation}`,
        jobKey: job.jobKey,
        err: err instanceof Error ? err.message : String(err),
      },
      'v2: could not persist write record'
    );
    return false;
  }
}

/**
 * Accumulates counts across a job, so a pipeline reports one row per relation
 * rather than one per statement.
 *
 * A feature calculation writing 30 definitions across 400 teams issues thousands
 * of statements against one relation. One write record per statement would make
 * the telemetry larger than the data. Accumulate, then flush once.
 */
export class WriteAccumulator {
  private readonly totals = new Map<string, Required<WriteCounts>>();

  add(target: WriteTarget, counts: WriteCounts): void {
    const key = `${target.schema}.${target.relation}`;
    const current = this.totals.get(key) ?? {
      rowsExamined: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
      rowsRejected: 0,
    };
    this.totals.set(key, {
      rowsExamined: current.rowsExamined + (counts.rowsExamined ?? 0),
      rowsWritten: current.rowsWritten + (counts.rowsWritten ?? 0),
      rowsSkipped: current.rowsSkipped + (counts.rowsSkipped ?? 0),
      rowsRejected: current.rowsRejected + (counts.rowsRejected ?? 0),
    });
  }

  /** Current totals, for assertions and for logging without flushing. */
  snapshot(): { target: WriteTarget; counts: Required<WriteCounts> }[] {
    return [...this.totals.entries()].map(([key, counts]) => {
      const [schema, relation] = key.split('.');
      return { target: { schema, relation }, counts };
    });
  }

  /** Writes one record per relation and clears the accumulator. */
  async flush(control: PoolClient, job: JobRunRef | null): Promise<number> {
    const entries = this.snapshot();
    this.totals.clear();
    let written = 0;
    for (const { target, counts } of entries) {
      if (await recordWrite(control, job, target, counts)) written += 1;
    }
    return written;
  }

  get size(): number {
    return this.totals.size;
  }
}
