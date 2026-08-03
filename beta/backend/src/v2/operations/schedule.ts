// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULING
//
// ─────────────────────────────────────────────────────────────────────────────
// STOP — THE REQUESTED RELATIONS DO NOT EXIST  (finding M-5)
//
// The S-2 brief asks for persistence helpers for `pipeline_schedule` and
// `pipeline_schedule_run`. NEITHER RELATION EXISTS in the approved migration set,
// in any schema. Verified against a deployed database:
//
//     select ... from pg_class where relname like '%schedule%'   -- 0 rows
//
// The `operations` schema contains thirteen relations and none of them is a
// schedule: api_usage, constraint_validation_progress, failure, failure_class,
// failure_resolution, operational_aggregate, pipeline_job_run, pipeline_run,
// quality_assertion_result, quality_check, quality_check_version,
// retention_policy, write_record.
//
// Creating them would be a schema change, which S-2 may not make. So this module
// does not create them, and does not fabricate storage that would have to be
// unwound later.
//
// THIS IS NOT AN OMISSION IN THE SCHEMA. It is a decision the architecture
// already took. Phase 8 §8.3 assigns schedule DEFINITIONS to pg_cron, which
// stores them in its own `cron.job` relation, and schedule EXECUTIONS to
// operations.pipeline_run — which carries trigger_kind = 'SCHEDULED' for exactly
// this purpose. Migration 018 contains the pg_cron entries, commented pending
// the cadence decision. A `pipeline_schedule` relation would be a second home
// for something that already has one, and the two would drift.
//
// WHAT THIS MODULE THEREFORE PROVIDES
//   * schedule EXECUTION recording, through the relation that exists
//   * read access to pg_cron's own catalogue where it is installed
//   * a typed contract that a future migration could satisfy, if the
//     architecture owner decides the pg_cron split is wrong
//
// It provides no invented tables and no silent workaround.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { PipelineRole } from '../db/roles';
import { withPipelineRun, type PipelineRunOptions } from './run';
import { logger } from '../../utils/logger';

/**
 * Raised when a caller asks for storage the approved schema does not provide.
 *
 * Deliberately explicit. A silent no-op here would let a pipeline believe its
 * schedule was persisted, and the absence would surface much later as a schedule
 * that never fired.
 */
export class ScheduleStorageUnavailableError extends Error {
  constructor(what: string) {
    super(
      `${what} requires a relation the approved schema does not contain. ` +
        'Neither operations.pipeline_schedule nor operations.pipeline_schedule_run exists, ' +
        'and S-2 may not create them. Phase 8 §8.3 places schedule definitions in pg_cron ' +
        '(cron.job) and schedule executions in operations.pipeline_run with ' +
        "trigger_kind = 'SCHEDULED'. See finding M-5 in " +
        'docs/db-v2/16-phase8-s2-migration-findings.md.'
    );
    this.name = 'ScheduleStorageUnavailableError';
  }
}

/**
 * Runs `fn` as a SCHEDULED pipeline run.
 *
 * This is schedule-execution persistence using the relation the architecture
 * designated for it. A scheduled execution is distinguishable from a manual one
 * by operations.pipeline_run.trigger_kind, which is what makes
 * "did the nightly job run" answerable.
 */
export async function withScheduledRun<T>(
  role: PipelineRole,
  scheduleKey: string,
  fn: () => Promise<T>,
  options: Omit<PipelineRunOptions, 'triggerKind'> = {}
): Promise<T> {
  return withPipelineRun(role, scheduleKey, fn, { ...options, triggerKind: 'SCHEDULED' });
}

export interface ScheduleDefinition {
  readonly jobName: string;
  readonly schedule: string;
  readonly command: string;
  readonly active: boolean;
}

/** True when pg_cron is installed and its catalogue is readable. */
export async function isCronAvailable(control: PoolClient): Promise<boolean> {
  const { rows } = await control.query<{ present: boolean }>(
    "SELECT to_regclass('cron.job') IS NOT NULL AS present"
  );
  return rows[0].present;
}

/**
 * Lists schedule definitions from pg_cron's own catalogue.
 *
 * READ ONLY. Registering a schedule is a deployment operation performed through
 * cron.schedule() by an operator, not by a pipeline: a process that could
 * schedule itself could also schedule itself twice.
 */
export async function listSchedules(control: PoolClient): Promise<ScheduleDefinition[]> {
  if (!(await isCronAvailable(control))) {
    throw new ScheduleStorageUnavailableError('Listing schedule definitions');
  }
  const { rows } = await control.query<{
    jobname: string;
    schedule: string;
    command: string;
    active: boolean;
  }>('SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobname');
  return rows.map((r) => ({
    jobName: r.jobname,
    schedule: r.schedule,
    command: r.command,
    active: r.active,
  }));
}

export interface ScheduledExecution {
  readonly runId: string;
  readonly runKey: string;
  readonly occurredAt: Date;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly outcome: string;
  readonly scopeText: string | null;
}

/**
 * Recent scheduled executions, from operations.pipeline_run.
 *
 * The partition predicate is mandatory on a partitioned relation (§5.10.6) and
 * F-15 registers a conformance check that detects reads without one — so the
 * lookback window is expressed on occurred_at, which is the partition key, and
 * not merely on started_at.
 */
export async function recentScheduledExecutions(
  control: PoolClient,
  options: { since: Date; scheduleKey?: string; limit?: number } = { since: new Date(Date.now() - 86_400_000) }
): Promise<ScheduledExecution[]> {
  const { rows } = await control.query<{
    id: string;
    run_key: string;
    occurred_at: Date;
    started_at: Date;
    ended_at: Date | null;
    outcome: string;
    scope_text: string | null;
  }>(
    `SELECT id::text, run_key, occurred_at, started_at, ended_at, outcome, scope_text
       FROM operations.pipeline_run
      WHERE occurred_at >= $1
        AND trigger_kind = 'SCHEDULED'
        AND ($2::text IS NULL OR run_key = $2)
      ORDER BY occurred_at DESC, id DESC
      LIMIT $3`,
    [options.since, options.scheduleKey ?? null, options.limit ?? 100]
  );
  return rows.map((r) => ({
    runId: r.id,
    runKey: r.run_key,
    occurredAt: r.occurred_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    outcome: r.outcome,
    scopeText: r.scope_text,
  }));
}

/**
 * Reports whether a schedule produced an execution in the expected window.
 *
 * The operational question a schedule exists to answer. Because calculation is
 * append-only and absences are silent, a schedule that stops firing produces no
 * error anywhere — only a growing hole. This is the check that finds it.
 */
export async function scheduleFired(
  control: PoolClient,
  scheduleKey: string,
  since: Date
): Promise<boolean> {
  const executions = await recentScheduledExecutions(control, { since, scheduleKey, limit: 1 });
  if (executions.length === 0) {
    logger.warn({ scheduleKey, since }, 'v2: schedule produced no execution in window');
    return false;
  }
  return true;
}
