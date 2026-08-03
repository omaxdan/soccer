// ─────────────────────────────────────────────────────────────────────────────
// FAILURES — operations.failure and operations.failure_resolution
//
// A failure row must survive the rollback of the work that produced it. That is
// the whole reason S-1's withRun holds a control connection separate from the
// work transaction: a failure recorded inside the transaction that failed
// disappears with it. V1 already documents this trap in
// verifyHistoricalIntegrity.ts:15.
//
// CLASSIFICATION IS NOT RETRY POLICY
// operations.failure_class carries is_retryable, and this module maps a
// PostgreSQL error to a class. It does NOT retry anything and does not decide
// whether anything should be retried — Phase 8 §8.2 places retry policy with the
// pipelines. What this module guarantees is that the class recorded is honest,
// so a pipeline asking "is this worth retrying" gets a truthful answer.
//
// THE CLASSES ARE THE DATABASE'S, NOT THIS FILE'S
// operations.failure_class is a governed vocabulary seeded by migration 012 with
// exactly four codes. This module maps onto them; it does not invent a fifth. A
// code absent from the vocabulary would be rejected by the foreign key, which is
// the correct outcome.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';
import type { JobRunRef } from '../db/tx';
import { operationalNow } from './run';
import { logger } from '../../utils/logger';

/** The four codes seeded into operations.failure_class by migration 012. */
export type FailureClass = 'TRANSIENT' | 'UPSTREAM' | 'DATA_QUALITY' | 'LOGIC';

/** States fixed by ck_failure_resolution__state_known. */
export type ResolutionState = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'WONT_FIX';

/** A committed operations.failure row, addressed by its composite key. */
export interface FailureRef {
  readonly id: string;
  readonly occurredAt: Date;
}

/**
 * SQLSTATE classes that indicate a PROGRAMMING OR DATA ERROR, never a transient
 * condition.
 *
 * Phase 8 §8.2: "A constraint violation is never retried. It means the
 * application attempted something the architecture forbids — an upsert against
 * an append-only relation, a snapshot update — and the correct response is to
 * fail loudly and record it."
 *
 * Each of these maps to a non-retryable class, so a pipeline consulting
 * is_retryable gets `false` and does not spend attempts on something that cannot
 * succeed.
 */
const NEVER_RETRYABLE: Readonly<Record<string, FailureClass>> = {
  // Class 23 — integrity constraint violation.
  '23000': 'DATA_QUALITY', // integrity_constraint_violation
  '23001': 'DATA_QUALITY', // restrict_violation
  '23502': 'DATA_QUALITY', // not_null_violation
  '23503': 'DATA_QUALITY', // foreign_key_violation
  '23505': 'DATA_QUALITY', // unique_violation
  '23514': 'DATA_QUALITY', // check_violation
  '23P01': 'DATA_QUALITY', // exclusion_violation
  // Class 42 — syntax or access rule violation. A schema or privilege error is
  // a deployment or code defect; retrying repeats it.
  '42501': 'LOGIC', // insufficient_privilege
  '42601': 'LOGIC', // syntax_error
  '42703': 'LOGIC', // undefined_column
  '42P01': 'LOGIC', // undefined_table
  '42883': 'LOGIC', // undefined_function
  '42P10': 'LOGIC', // invalid_column_reference
  // Class 22 — data exception. Bad data, not a bad moment.
  '22001': 'DATA_QUALITY', // string_data_right_truncation
  '22003': 'DATA_QUALITY', // numeric_value_out_of_range
  '22007': 'DATA_QUALITY', // invalid_datetime_format
  '22P02': 'DATA_QUALITY', // invalid_text_representation
  // Class 21 — cardinality violation.
  '21000': 'LOGIC',
  // P0001 — RAISE EXCEPTION from PL/pgSQL. Every guard in the design surfaces
  // here: the append guard (R-19), the sealing guard (R-23), the lifecycle
  // guard. All mean the application attempted something forbidden.
  P0001: 'LOGIC',
};

/** SQLSTATE classes that genuinely may succeed on a second attempt. */
const RETRYABLE: Readonly<Record<string, FailureClass>> = {
  '40001': 'TRANSIENT', // serialization_failure
  '40P01': 'TRANSIENT', // deadlock_detected
  '53300': 'TRANSIENT', // too_many_connections — R-05's failure mode
  '53200': 'TRANSIENT', // out_of_memory
  '55P03': 'TRANSIENT', // lock_not_available
  '57014': 'TRANSIENT', // query_canceled — statement_timeout of A.15
  '08000': 'TRANSIENT', // connection_exception
  '08003': 'TRANSIENT', // connection_does_not_exist
  '08006': 'TRANSIENT', // connection_failure
};

function sqlState(error: unknown): string | undefined {
  const code = (error as DatabaseError | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Classifies an error into one of the four governed failure classes.
 *
 * Unknown SQLSTATEs and non-database errors classify as LOGIC — the
 * non-retryable default. Erring toward non-retryable is deliberate: retrying an
 * error nobody has classified burns attempts and can repeat a partial write,
 * whereas declining to retry costs one scheduler interval and leaves an accurate
 * record.
 */
export function classifyFailure(error: unknown): FailureClass {
  const state = sqlState(error);
  if (state) {
    if (NEVER_RETRYABLE[state]) return NEVER_RETRYABLE[state];
    if (RETRYABLE[state]) return RETRYABLE[state];
    // Whole-class fallbacks for SQLSTATEs not enumerated above.
    if (state.startsWith('23') || state.startsWith('22')) return 'DATA_QUALITY';
    if (state.startsWith('08') || state.startsWith('40') || state.startsWith('53')) {
      return 'TRANSIENT';
    }
    if (state.startsWith('42')) return 'LOGIC';
  }
  // A network error raised by the driver rather than the server.
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|socket hang up/i.test(message)) {
    return 'UPSTREAM';
  }
  return 'LOGIC';
}

/**
 * True when the class is one the vocabulary marks retryable.
 *
 * Mirrors operations.failure_class.is_retryable as seeded by migration 012. It
 * is a convenience for pipelines, not a second source of truth — the column is
 * authoritative and a pipeline may read it directly.
 */
export function isRetryable(cls: FailureClass): boolean {
  return cls === 'TRANSIENT' || cls === 'UPSTREAM';
}

/**
 * Builds the diagnostic text stored on the failure row.
 *
 * operations.failure.diagnostic is NOT NULL, and a failure nobody can diagnose
 * from its own record is not worth storing. SQLSTATE, message, constraint and
 * relation are included where the driver supplies them; the stack is trimmed
 * because the useful part is the top.
 */
export function buildDiagnostic(error: unknown): string {
  const dbError = error as DatabaseError | undefined;
  const parts: string[] = [];
  if (dbError?.code) parts.push(`SQLSTATE ${dbError.code}`);
  parts.push(error instanceof Error ? error.message : String(error));
  if (dbError?.constraint) parts.push(`constraint=${dbError.constraint}`);
  if (dbError?.table) parts.push(`relation=${dbError.schema ?? '?'}.${dbError.table}`);
  if (dbError?.detail) parts.push(`detail=${dbError.detail}`);
  if (dbError?.hint) parts.push(`hint=${dbError.hint}`);
  if (error instanceof Error && error.stack) {
    parts.push(error.stack.split('\n').slice(0, 6).join('\n'));
  }
  return parts.join('\n');
}

/**
 * Persists a failure against a job run.
 *
 * `control` MUST be outside the failed transaction. `job` must be a real
 * attribution: operations.failure.pipeline_job_run_id is NOT NULL and the
 * composite foreign key admits no exception, so a failure with no job run CANNOT
 * be stored. That is not a limitation this module invented — it is the schema
 * stating that an unattributed failure is not a record of anything.
 *
 * Returns null when no job run is available, having logged loudly. It does not
 * throw: a failure to record a failure must never replace the failure itself.
 */
export async function recordFailure(
  control: PoolClient,
  job: JobRunRef | null,
  error: unknown,
  affectedEntity?: string
): Promise<FailureRef | null> {
  if (!job) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'v2: failure NOT persisted — no job run to attribute it to. ' +
        'operations.failure.pipeline_job_run_id is NOT NULL.'
    );
    return null;
  }
  try {
    // occurred_at supplied explicitly: it is the second half of the composite
    // foreign key failure_resolution uses. See operationalNow().
    const occurredAt = operationalNow();
    const { rows } = await control.query<{ id: string }>(
      `INSERT INTO operations.failure
         (occurred_at, pipeline_job_run_id, job_occurred_at, failure_class_code,
          affected_entity_text, diagnostic)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text`,
      [
        occurredAt,
        job.id,
        job.occurredAt,
        classifyFailure(error),
        affectedEntity ?? null,
        buildDiagnostic(error),
      ]
    );
    return { id: rows[0].id, occurredAt };
  } catch (err) {
    logger.error(
      {
        jobKey: job.jobKey,
        original: error instanceof Error ? error.message : String(error),
        err: err instanceof Error ? err.message : String(err),
      },
      'v2: could not persist failure row'
    );
    return null;
  }
}

/**
 * Appends a resolution to a failure.
 *
 * APPEND-ONLY. A failure's history is the sequence of its resolution rows, not
 * a mutable status column — the same shape A.2 uses for snapshot outcome
 * revision, and for the same reason: the earlier judgement remains readable.
 * Moving a failure OPEN → INVESTIGATING → RESOLVED writes three rows.
 *
 * PRIVILEGE NOTE (finding M-2). pt_platform_admin — the role an operator would
 * naturally use to resolve a failure — holds SELECT only on operations and
 * CANNOT insert here. Resolutions must currently be written by a pipeline role.
 */
export async function appendResolution(
  control: PoolClient,
  failure: FailureRef,
  state: ResolutionState,
  note?: string
): Promise<void> {
  await control.query(
    `INSERT INTO operations.failure_resolution
       (failure_id, failure_occurred_at, resolution_state, note)
     VALUES ($1, $2, $3, $4)`,
    [failure.id, failure.occurredAt, state, note ?? null]
  );
}

/**
 * The latest resolution state of a failure, or null when none has been recorded.
 *
 * Ordered by occurred_at then id: two resolutions can share a timestamp, and id
 * breaks the tie deterministically. Ordering on occurred_at alone would return
 * an arbitrary row of the tied set — the class of defect Phase 7 recorded as
 * DB-04.
 */
export async function latestResolution(
  control: PoolClient,
  failure: FailureRef
): Promise<{ state: ResolutionState; note: string | null; occurredAt: Date } | null> {
  const { rows } = await control.query<{
    resolution_state: ResolutionState;
    note: string | null;
    occurred_at: Date;
  }>(
    `SELECT resolution_state, note, occurred_at
       FROM operations.failure_resolution
      WHERE failure_id = $1 AND failure_occurred_at = $2
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1`,
    [failure.id, failure.occurredAt]
  );
  if (rows.length === 0) return null;
  return { state: rows[0].resolution_state, note: rows[0].note, occurredAt: rows[0].occurred_at };
}
