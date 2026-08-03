// ─────────────────────────────────────────────────────────────────────────────
// JOB LIFECYCLE — operations.pipeline_job_run, installed into S-1's seam
//
// This is the implementation S-1's tx.ts declared and left open. Installing it
// with registerJobLifecycle() makes withRun() attributed: every attributed run
// opens a pipeline_run (or joins the ambient one), opens a pipeline_job_run,
// executes the business transaction, and records the outcome.
//
// S-1'S PUBLIC CONTRACT IS UNCHANGED. withRun, withConnection, withSession,
// withSavepoint and requireJobRun keep their signatures and their semantics. The
// only observable difference is that requireJobRun now returns a real
// attribution instead of throwing.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE JOB ROW IS INSERTED AT OPEN, NOT AT COMPLETION
//
// Inserting at completion would be tidier: one row, accurate started_at and
// ended_at, a terminal outcome, and no need to update anything. It is not
// available, and the reason is a hard constraint rather than a preference.
//
// snapshot.match_snapshot.pipeline_job_run_id is NOT NULL and pairs compositely
// with pipeline_job_run_occurred_at (P-04). ck_match_snapshot__job_run_reference_
// complete enforces both-or-neither. A sealing transaction must therefore
// reference a job run that ALREADY EXISTS AND IS COMMITTED at the moment it
// inserts the snapshot — which is during the work, not after it.
//
// So the row is inserted at open, on the control connection, committed
// immediately. The FK resolves. The consequence is finding M-1: the outcome
// cannot subsequently be corrected, because operations.pipeline_job_run carries
// the append-only guard and no role holds UPDATE on it.
//
// What is NOT lost: a failure still produces an operations.failure row, which is
// append-only and works. The terminal state of a failed job is therefore
// recorded — just in `failure` rather than in `outcome`. Success is the absence
// of a failure against the job.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import {
  registerJobLifecycle,
  type JobContext,
  type JobLifecycle,
  type JobOutcome,
  type JobRunRef,
} from '../db/tx';
import {
  ensureImplicitRun,
  noteJobOutcome,
  operationalNow,
  tryCloseRow,
  type PipelineRunRef,
} from './run';
import { recordFailure } from './failure';
import { logger } from '../../utils/logger';

/** Terminal and initial states fixed by ck_pipeline_job_run__outcome_known. */
export type JobRunOutcome =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'PRECONDITION_UNMET';

/**
 * Runs opened implicitly by a stage invoked outside withPipelineRun.
 *
 * Keyed by job run id so the implicit run can be closed when its single stage
 * finishes. A run opened for one stage has no reason to outlive it.
 */
const implicitRuns = new Map<string, PipelineRunRef>();

/**
 * Inserts a pipeline_job_run and returns its composite reference.
 *
 * `formula_versions` is left NULL here. It records the calculation versions in
 * force for the job, and no calculation exists yet — S-5 and S-6 supply it when
 * they land. Writing a placeholder would assert something untrue about which
 * versions produced the work.
 */
async function insertJobRun(
  control: PoolClient,
  run: PipelineRunRef,
  ctx: JobContext
): Promise<JobRunRef> {
  const startedAt = operationalNow();
  // occurred_at supplied explicitly — see operationalNow() for why the column
  // default cannot be used on a relation whose instant is half a foreign key.
  const occurredAt = operationalNow();
  const scopeText =
    ctx.detail && Object.keys(ctx.detail).length > 0 ? JSON.stringify(ctx.detail) : null;
  const { rows } = await control.query<{ id: string }>(
    `INSERT INTO operations.pipeline_job_run
       (occurred_at, pipeline_run_id, run_occurred_at, job_key, scope_text, started_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING')
     RETURNING id::text`,
    [occurredAt, run.id, run.occurredAt, ctx.jobKey, scopeText, startedAt]
  );
  return {
    id: rows[0].id,
    occurredAt,
    jobKey: ctx.jobKey,
    runId: run.id,
  };
}

/**
 * The operational implementation of S-1's JobLifecycle contract.
 *
 * Every method receives the CONTROL connection, which S-1 guarantees is not the
 * work connection. That guarantee is what makes the rows here survive a rollback
 * of the business transaction, and it is enforced structurally by the interface
 * rather than by anyone remembering.
 */
export const operationalJobLifecycle: JobLifecycle = {
  async openJobRun(control: PoolClient, ctx: JobContext): Promise<JobRunRef | null> {
    // Join the ambient run if withPipelineRun established one; open an implicit
    // one otherwise. pipeline_job_run.pipeline_run_id is NOT NULL, so there is
    // no third option.
    const { ref: run, implicit } = await ensureImplicitRun(control, ctx.role, ctx.jobKey);
    const job = await insertJobRun(control, run, ctx);
    if (implicit) implicitRuns.set(job.id, run);
    logger.debug(
      { role: ctx.role, jobKey: ctx.jobKey, runId: run.id, jobRunId: job.id, implicit },
      'v2: job run opened'
    );
    return job;
  },

  async closeJobRun(
    control: PoolClient,
    ref: JobRunRef | null,
    outcome: JobOutcome,
    ctx: JobContext
  ): Promise<void> {
    if (!ref) return;
    noteJobOutcome(outcome);

    // Attempted, not assumed. tryCloseRow probes the capability once and never
    // throws — see finding M-1. If the architecture owner corrects the defect,
    // this begins working with no code change here.
    const closed = await tryCloseRow(
      control,
      'pipeline_job_run',
      ref.id,
      ref.occurredAt,
      outcome
    );

    const implicit = implicitRuns.get(ref.id);
    if (implicit) {
      implicitRuns.delete(ref.id);
      await tryCloseRow(
        control,
        'pipeline_run',
        implicit.id,
        implicit.occurredAt,
        outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED'
      );
    }

    logger.debug(
      { role: ctx.role, jobKey: ctx.jobKey, jobRunId: ref.id, outcome, closed },
      'v2: job run closed'
    );
  },

  async recordFailure(
    control: PoolClient,
    ref: JobRunRef | null,
    error: Error,
    ctx: JobContext
  ): Promise<void> {
    const failure = await recordFailure(control, ref, error, ctx.jobKey);
    if (failure) {
      logger.info(
        { role: ctx.role, jobKey: ctx.jobKey, failureId: failure.id },
        'v2: failure persisted'
      );
    }
  },
};

/**
 * Installs the operational layer into S-1's transaction wrapper.
 *
 * Call once, at process start, before any withRun(). Idempotent — a second call
 * replaces the same implementation with itself.
 *
 * After this, requireJobRun() returns a real attribution rather than throwing,
 * which is what unblocks S-7: nothing can be sealed until job runs exist, and
 * now they do.
 */
export function installOperationalLayer(): void {
  registerJobLifecycle(operationalJobLifecycle);
  logger.info('v2: operational layer installed — runs and jobs are now attributed');
}

/** Test-only. Clears implicit-run bookkeeping between suites. */
export function resetImplicitRunsForTesting(): void {
  implicitRuns.clear();
}
