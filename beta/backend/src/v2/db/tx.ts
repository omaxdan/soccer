// ─────────────────────────────────────────────────────────────────────────────
// V2 TRANSACTION WRAPPER — run-attributed, atomic, failure-durable
//
// WHAT THIS EXISTS TO MAKE POSSIBLE
// Two things V1 cannot do, both structural rather than incidental:
//
//   1. ATOMICITY. Snapshot sealing writes a header, a version manifest, feature
//      states, module readings, a verdict and a completeness record. They commit
//      together or not at all (Phase 8 §7.2). PostgREST issues one statement per
//      request and cannot express that.
//   2. ATTRIBUTION. snapshot.match_snapshot references operations.pipeline_job_run
//      compositely on (pipeline_job_run_id, pipeline_job_run_occurred_at), and
//      ck_match_snapshot__job_run_reference_complete enforces both-or-neither
//      (P-04). NOTHING CAN BE SEALED UNTIL JOB RUNS EXIST. That is why S-2
//      precedes S-7 in the dependency graph, and requireJobRun() below makes the
//      dependency fail loudly rather than mysteriously.
//
// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURAL DECISION — TWO CONNECTIONS PER RUN, AND WHY
//
// The illustrative sketch in Phase 8 §3.1 opens the job run INSIDE the work
// transaction and records failures on a separate connection. Implementing it
// exposed a flaw in that shape, and this file departs from it deliberately.
//
// The sketch's own justification for the separate failure connection is: "A
// failure recorded inside the rolled-back transaction disappears with it — the
// exact trap verifyHistoricalIntegrity.ts:15 already documents for V1."
//
// That argument applies IDENTICALLY to the job run. If the job run is opened
// inside the work transaction, a failed run rolls it back too, and the surviving
// failure row references a job run that no longer exists — or, worse, cannot
// reference one at all. The operational record of the very runs most worth
// recording would be the record that vanishes.
//
// So the LIFECYCLE gets its own connection (the "control" connection), operating
// in autocommit outside the work transaction:
//
//     control ──▶  open job run  ─── committed immediately, survives anything
//        │
//     work    ──▶  BEGIN … work … COMMIT / ROLLBACK
//        │
//     control ──▶  close job run (SUCCEEDED | FAILED)  +  record failure
//
// The composite foreign key still resolves: the job run is COMMITTED before the
// work transaction references it, which is exactly what a foreign key requires.
//
// COST: two connections per run rather than one. That interacts with the
// connection budget of R-05, so withRun() refuses to start on a pool sized below
// two rather than deadlocking on itself — a self-deadlock presents as a
// connection timeout minutes later and is genuinely hard to read.
//
// ORPHANED RUNS: a process killed between open and close leaves a job run with
// no outcome. Reaping those is S-2's responsibility, not this file's; the shape
// above is what makes reaping possible at all.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { loadV2Config } from '../config/index';
import { poolFor } from './pool';
import type { PipelineRole } from './roles';
import { logger } from '../../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Job lifecycle contract — the S-2 seam
// ─────────────────────────────────────────────────────────────────────────────
// S-1 defines the shape; S-2 supplies the implementation that writes
// operations.pipeline_run, pipeline_job_run, write_record and failure. Until
// then the no-op below logs and attributes nothing, which lets every V2
// subsystem be built and tested against the real transaction semantics without
// waiting for the operational layer.

/**
 * A reference to a committed `operations.pipeline_job_run` row.
 *
 * Carries BOTH components of the composite key. `occurredAt` is the job run's
 * OWN instant — P-04 corrected an earlier form that paired on the snapshot's
 * sealed_at, which required two independently stamped instants to agree to the
 * microsecond.
 */
export interface JobRunRef {
  readonly id: string;
  readonly occurredAt: Date;
  readonly jobKey: string;
  readonly runId?: string;
}

export type JobOutcome = 'SUCCEEDED' | 'FAILED';

export interface JobContext {
  readonly role: PipelineRole;
  readonly jobKey: string;
  /** Free-form detail an implementation may record alongside the run. */
  readonly detail?: Record<string, unknown>;
}

/**
 * The operational-layer seam.
 *
 * Every method receives the CONTROL connection, not the work connection. That is
 * not a convenience — it is how the durability property above is enforced
 * structurally rather than by convention. An implementation that opened its own
 * connection could not be prevented from using the work one instead.
 */
export interface JobLifecycle {
  /** Opens and COMMITS a job run. Returns null when attribution is unavailable. */
  openJobRun(control: PoolClient, ctx: JobContext): Promise<JobRunRef | null>;

  /** Closes a job run with its outcome. Must not throw — see safeClose(). */
  closeJobRun(
    control: PoolClient,
    ref: JobRunRef | null,
    outcome: JobOutcome,
    ctx: JobContext
  ): Promise<void>;

  /** Records a failure. Must not throw — see safeRecord(). */
  recordFailure(
    control: PoolClient,
    ref: JobRunRef | null,
    error: Error,
    ctx: JobContext
  ): Promise<void>;
}

/**
 * The default until S-2 lands.
 *
 * Returns null from openJobRun deliberately. A synthetic identifier would look
 * like attribution and would violate the composite foreign key the moment a
 * sealing writer used it; null makes the absence explicit and lets
 * requireJobRun() fail with an actionable message.
 */
const NOOP_LIFECYCLE: JobLifecycle = {
  async openJobRun(_control, ctx) {
    logger.debug({ ...ctx }, 'v2: job run not recorded — operational layer (S-2) not installed');
    return null;
  },
  async closeJobRun(_control, _ref, outcome, ctx) {
    logger.debug({ ...ctx, outcome }, 'v2: job outcome not recorded — S-2 not installed');
  },
  async recordFailure(_control, _ref, error, ctx) {
    logger.error({ ...ctx, err: error.message }, 'v2: failure not persisted — S-2 not installed');
  },
};

let lifecycle: JobLifecycle = NOOP_LIFECYCLE;

/** Installs the operational layer. Called once, by S-2, at process start. */
export function registerJobLifecycle(impl: JobLifecycle): void {
  lifecycle = impl;
  logger.info('v2: job lifecycle registered');
}

/** Test-only. Restores the no-op lifecycle. */
export function resetJobLifecycleForTesting(): void {
  lifecycle = NOOP_LIFECYCLE;
}

/** True once a real operational layer is installed. */
export function isJobLifecycleInstalled(): boolean {
  return lifecycle !== NOOP_LIFECYCLE;
}

/**
 * Asserts that job attribution is available.
 *
 * Call this from any writer whose target carries a job-run foreign key — every
 * snapshot relation, and calibration_run. It converts the S-2-before-S-7
 * dependency from a note in a document into a runtime failure with a message
 * that names the missing subsystem.
 */
export function requireJobRun(ref: JobRunRef | null, what: string): JobRunRef {
  if (!ref) {
    throw new Error(
      `${what} requires job attribution, and no job run is available. ` +
        'operations.pipeline_job_run must exist before anything referencing it can be ' +
        'written: snapshot.match_snapshot pairs compositely on ' +
        '(pipeline_job_run_id, pipeline_job_run_occurred_at) and the both-or-neither CHECK ' +
        'rejects a partial reference (P-04). Install the S-2 operational layer with ' +
        'registerJobLifecycle() before running this pipeline.'
    );
  }
  return ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution wrappers
// ─────────────────────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Recorded alongside the job run by the operational layer. */
  readonly detail?: Record<string, unknown>;
  /**
   * Skip the control connection entirely.
   *
   * For work that neither needs nor deserves a job run — a health probe, a
   * conformance assertion. It halves connection use, and the callback receives a
   * null job ref, so anything requiring attribution still fails loudly.
   */
  readonly withoutAttribution?: boolean;
}

/** Errors raised by this module rather than by PostgreSQL. */
export class TransactionError extends Error {
  constructor(message: string, readonly role: PipelineRole, readonly jobKey: string) {
    super(message);
    this.name = 'TransactionError';
  }
}

async function safeClose(
  control: PoolClient | undefined,
  ref: JobRunRef | null,
  outcome: JobOutcome,
  ctx: JobContext
): Promise<void> {
  if (!control) return;
  try {
    await lifecycle.closeJobRun(control, ref, outcome, ctx);
  } catch (err) {
    // Never let telemetry failure mask the outcome it is describing. A failed
    // close on a successful run must not turn it into a failed run, and a failed
    // close on a failed run must not replace the original error.
    logger.error(
      { ...ctx, outcome, err: err instanceof Error ? err.message : String(err) },
      'v2: could not close job run'
    );
  }
}

async function safeRecord(
  control: PoolClient | undefined,
  ref: JobRunRef | null,
  error: Error,
  ctx: JobContext
): Promise<void> {
  if (!control) return;
  try {
    await lifecycle.recordFailure(control, ref, error, ctx);
  } catch (err) {
    logger.error(
      { ...ctx, original: error.message, err: err instanceof Error ? err.message : String(err) },
      'v2: could not record failure'
    );
  }
}

/**
 * Runs `fn` inside one transaction as `role`, attributed to a job run.
 *
 * The unit of work for every V2 write. `fn` receives the WORK connection and the
 * job reference; every statement it issues is in the same transaction, and
 * throwing rolls all of them back.
 *
 * WHAT IS NOT CAUGHT HERE, ON PURPOSE
 * A constraint violation propagates. It means the application attempted
 * something the architecture forbids — an upsert against an append-only
 * relation, an update to sealed content — and Phase 8 §8.2 is explicit that this
 * class is never retried: retrying repeats it. The correct response is to fail
 * loudly and record it, which is what happens.
 */
export async function withRun<T>(
  role: PipelineRole,
  jobKey: string,
  fn: (tx: PoolClient, job: JobRunRef | null) => Promise<T>,
  options: RunOptions = {}
): Promise<T> {
  const ctx: JobContext = { role, jobKey, detail: options.detail };
  const attributed = !options.withoutAttribution;

  if (attributed && loadV2Config().poolMax[role] < 2) {
    // Refuse rather than deadlock. With max=1 the control connection takes the
    // only slot and the work connection waits until connectionTimeoutMillis —
    // which presents as an unrelated timeout minutes later.
    throw new TransactionError(
      `Role '${role}' has a pool maximum of 1, and an attributed run needs two ` +
        'connections: one for the transaction and one for the job lifecycle, which must ' +
        'commit outside it so a failed run still leaves a record. Raise ' +
        `PT_V2_POOL_MAX_* for this role to at least 2, or pass { withoutAttribution: true }.`,
      role,
      jobKey
    );
  }

  const pool = poolFor(role);
  let control: PoolClient | undefined;
  let job: JobRunRef | null = null;

  if (attributed) {
    control = await pool.connect();
    try {
      job = await lifecycle.openJobRun(control, ctx);
    } catch (err) {
      control.release();
      throw new TransactionError(
        `Could not open a job run for '${jobKey}': ${
          err instanceof Error ? err.message : String(err)
        }`,
        role,
        jobKey
      );
    }
  }

  const work = await pool.connect();
  const startedAt = Date.now();
  try {
    await work.query('BEGIN');
    const result = await fn(work, job);
    await work.query('COMMIT');
    logger.info({ role, jobKey, ms: Date.now() - startedAt }, 'v2: run committed');
    await safeClose(control, job, 'SUCCEEDED', ctx);
    return result;
  } catch (err) {
    // ROLLBACK can itself fail if the connection died. Swallow that specific
    // failure — the transaction is already lost and the original error is the
    // one worth propagating.
    try {
      await work.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error(
        { role, jobKey, err: String(rollbackErr) },
        'v2: rollback failed — connection is likely gone'
      );
    }
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ role, jobKey, ms: Date.now() - startedAt, err: error.message }, 'v2: run rolled back');
    await safeClose(control, job, 'FAILED', ctx);
    await safeRecord(control, job, error, ctx);
    throw error;
  } finally {
    work.release();
    control?.release();
  }
}

/**
 * Runs `fn` on one connection with NO transaction and NO job run.
 *
 * For reads and for statements that must not be in a transaction block. Use it
 * for conformance assertions, health probes and the freeze enumeration — the
 * freeze pass in particular MUST be outside a transaction, because VACUUM cannot
 * run inside one (B-05), which is why fn_partitions_requiring_freeze enumerates
 * rather than vacuums and the caller issues the VACUUM itself.
 */
export async function withConnection<T>(
  role: PipelineRole,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await poolFor(role).connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` on one connection held for the whole callback, without a
 * transaction, so SESSION-scoped state survives across statements.
 *
 * THE RETENTION PATH. operations.fn_run_retention() sets the marker of R-21 with
 * set_config(..., false) — session scope, not transaction scope — and R-58 names
 * that marker as a reason pipeline connections operate in session mode. The
 * function manages the marker itself, including clearing it on every exit path;
 * this wrapper's only job is to guarantee the marker and the deletes share one
 * session.
 *
 * The callback must not open a transaction if it depends on session state
 * surviving a rollback: session-level SET is reverted when a transaction aborts.
 */
export async function withSession<T>(
  role: PipelineRole,
  fn: (session: PoolClient) => Promise<T>
): Promise<T> {
  const client = await poolFor(role).connect();
  try {
    return await fn(client);
  } finally {
    // Returning a session-scoped setting to the pool would leak it to the next
    // borrower. DISCARD ALL resets settings, temp tables and prepared statements
    // without dropping the physical connection.
    try {
      await client.query('DISCARD ALL');
    } catch (err) {
      logger.warn({ role, err: String(err) }, 'v2: DISCARD ALL failed; releasing anyway');
    }
    client.release();
  }
}

/**
 * Runs `fn` in a SAVEPOINT nested inside an existing transaction.
 *
 * For a step whose failure should not abandon the whole run — a per-competition
 * batch, say. Use sparingly: a savepoint per row is a well-known way to make a
 * bulk load slow, and the append-only model means most failures are constraint
 * violations that should propagate rather than be absorbed.
 */
export async function withSavepoint<T>(
  tx: PoolClient,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    // Savepoint names cannot be parameterised, so the identifier is constrained
    // rather than escaped.
    throw new Error(`Invalid savepoint name '${name}'; use lowercase [a-z][a-z0-9_]*.`);
  }
  await tx.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await tx.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw err;
  }
}
