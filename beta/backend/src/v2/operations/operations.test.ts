// ─────────────────────────────────────────────────────────────────────────────
// S-2 OPERATIONAL LAYER TESTS
//
// The property under test throughout is the one the whole subsystem exists for:
// OPERATIONAL HISTORY SURVIVES THE ROLLBACK OF THE WORK IT DESCRIBES. Every
// other guarantee here is downstream of that one.
//
// Pure classification and contract tests run everywhere. Persistence tests
// require a V2 database and skip cleanly without one, so V2 work never blocks
// V1 work — with assertCiHasDatabase() ensuring a skipped suite cannot pass for
// a green CI run.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  withRun,
  withConnection,
  requireJobRun,
  isJobLifecycleInstalled,
  resetJobLifecycleForTesting,
  type JobRunRef,
} from '../db/tx';
import { resetPoolsForTesting } from '../db/pool';
import { resetV2ConfigForTesting } from '../config/index';
import { testableRoles, skipReason, assertCiHasDatabase } from '../db/testSupport';

import {
  installOperationalLayer,
  withPipelineRun,
  currentRun,
  codeRevision,
  runCloseCapability,
  recordWrite,
  WriteAccumulator,
  recordFailure,
  appendResolution,
  latestResolution,
  classifyFailure,
  isRetryable,
  buildDiagnostic,
  recordApiUsage,
  ApiUsageWindowBuilder,
  latestQuotaRemaining,
  withScheduledRun,
  recentScheduledExecutions,
  scheduleFired,
  isCronAvailable,
  listSchedules,
  ScheduleStorageUnavailableError,
  type FailureRef,
} from './index';
import { resetCloseCapabilityForTesting } from './run';
import { resetImplicitRunsForTesting } from './jobLifecycle';

// ─────────────────────────────────────────────────────────────────────────────
// Pure logic — always runs
// ─────────────────────────────────────────────────────────────────────────────

describe('failure classification (no database required)', () => {
  test('CI is not silently skipping the persistence halves', () => {
    assertCiHasDatabase();
  });

  test('constraint violations are DATA_QUALITY and never retryable', () => {
    // Phase 8 §8.2 — this class is never retried: retrying repeats it.
    for (const code of ['23502', '23503', '23505', '23514', '23P01']) {
      const cls = classifyFailure(Object.assign(new Error('x'), { code }));
      assert.equal(cls, 'DATA_QUALITY', `SQLSTATE ${code}`);
      assert.equal(isRetryable(cls), false, `SQLSTATE ${code} must not be retryable`);
    }
  });

  test('permission and schema errors are LOGIC and never retryable', () => {
    for (const code of ['42501', '42P01', '42703', '42883']) {
      const cls = classifyFailure(Object.assign(new Error('x'), { code }));
      assert.equal(cls, 'LOGIC', `SQLSTATE ${code}`);
      assert.equal(isRetryable(cls), false);
    }
  });

  test('a guard raise (P0001) is LOGIC — the application attempted the forbidden', () => {
    // Every guard in the design surfaces here: the append guard R-19, the
    // sealing guard R-23, the lifecycle guard.
    const err = Object.assign(
      new Error('append-only relation: UPDATE attempted on feature.feature_value'),
      { code: 'P0001' }
    );
    assert.equal(classifyFailure(err), 'LOGIC');
    assert.equal(isRetryable(classifyFailure(err)), false);
  });

  test('deadlock, serialisation and connection exhaustion are TRANSIENT', () => {
    for (const code of ['40001', '40P01', '53300', '57014', '08006']) {
      const cls = classifyFailure(Object.assign(new Error('x'), { code }));
      assert.equal(cls, 'TRANSIENT', `SQLSTATE ${code}`);
      assert.equal(isRetryable(cls), true);
    }
  });

  test('a driver-level network error is UPSTREAM', () => {
    assert.equal(classifyFailure(new Error('connect ECONNREFUSED 10.0.0.1:5432')), 'UPSTREAM');
    assert.equal(classifyFailure(new Error('socket hang up')), 'UPSTREAM');
  });

  test('an unclassified error defaults to the NON-retryable class', () => {
    // Erring toward non-retryable is deliberate: retrying something nobody has
    // classified burns attempts and can repeat a partial write.
    assert.equal(classifyFailure(new Error('something new')), 'LOGIC');
    assert.equal(classifyFailure(Object.assign(new Error('x'), { code: '99999' })), 'LOGIC');
  });

  test('the diagnostic carries enough to diagnose without the process', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'uq_pipeline_run__run_key',
      schema: 'operations',
      table: 'pipeline_run',
      detail: 'Key (run_key)=(x) already exists.',
    });
    const diagnostic = buildDiagnostic(err);
    assert.match(diagnostic, /SQLSTATE 23505/);
    assert.match(diagnostic, /uq_pipeline_run__run_key/);
    assert.match(diagnostic, /operations\.pipeline_run/);
    assert.match(diagnostic, /already exists/);
  });

  test('code revision falls back visibly rather than silently', () => {
    const saved = process.env.PT_V2_CODE_REVISION;
    delete process.env.PT_V2_CODE_REVISION;
    assert.equal(codeRevision(), 'unknown');
    process.env.PT_V2_CODE_REVISION = 'abc1234';
    assert.equal(codeRevision(), 'abc1234');
    if (saved === undefined) delete process.env.PT_V2_CODE_REVISION;
    else process.env.PT_V2_CODE_REVISION = saved;
  });
});

describe('write accumulation (no database required)', () => {
  test('counts fold per relation, not per statement', () => {
    // A feature calculation writing 30 definitions across 400 teams issues
    // thousands of statements against one relation. One write record per
    // statement would make the telemetry larger than the data.
    const acc = new WriteAccumulator();
    acc.add({ schema: 'feature', relation: 'feature_value' }, { rowsWritten: 100, rowsExamined: 120 });
    acc.add({ schema: 'feature', relation: 'feature_value' }, { rowsWritten: 50, rowsSkipped: 5 });
    acc.add({ schema: 'feature', relation: 'feature_lineage' }, { rowsWritten: 300 });

    assert.equal(acc.size, 2);
    const snapshot = acc.snapshot();
    const values = snapshot.find((s) => s.target.relation === 'feature_value');
    assert.equal(values?.counts.rowsWritten, 150);
    assert.equal(values?.counts.rowsExamined, 120);
    assert.equal(values?.counts.rowsSkipped, 5);
    assert.equal(values?.counts.rowsRejected, 0);
  });
});

describe('lifecycle registration (no database required)', () => {
  beforeEach(() => resetJobLifecycleForTesting());
  after(() => resetJobLifecycleForTesting());

  test('the seam is empty until the operational layer installs', () => {
    assert.equal(isJobLifecycleInstalled(), false);
    installOperationalLayer();
    assert.equal(isJobLifecycleInstalled(), true);
  });

  test('installation is idempotent', () => {
    installOperationalLayer();
    installOperationalLayer();
    assert.equal(isJobLifecycleInstalled(), true);
  });

  test('scheduling storage refuses rather than fabricating (finding M-5)', () => {
    const err = new ScheduleStorageUnavailableError('Listing schedule definitions');
    assert.match(err.message, /operations\.pipeline_schedule/);
    assert.match(err.message, /S-2 may not create them/);
    assert.match(err.message, /pg_cron/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

describe('operational layer (requires a V2 database)', { skip: skipReason() || false }, () => {
  // pt_pipeline_ingestion holds SELECT + INSERT on operations, which is what the
  // layer needs. pt_platform_admin does NOT (finding M-2), so it is deliberately
  // not used here.
  const role = testableRoles().includes('pt_pipeline_ingestion')
    ? ('pt_pipeline_ingestion' as const)
    : testableRoles()[0];

  before(async () => {
    // CONNECTION ARITHMETIC, stated because every future subsystem inherits it.
    //
    // An attributed run inside a pipeline run holds TWO connections at steady
    // state: withRun's control connection and its work connection. (The pipeline
    // run's own connection is acquired only to insert and to close — see the
    // note in run.ts about the deadlock the first implementation caused.)
    //
    // So N concurrent pipelines need 2N connections. The concurrency test below
    // runs four, and the register's default for pt_pipeline_ingestion is four —
    // which would deadlock. The suite therefore sizes its own pool rather than
    // depending on an operator having raised it, and rather than quietly
    // reducing its own concurrency to fit.
    await resetPoolsForTesting();
    resetV2ConfigForTesting();
    process.env.PT_V2_POOL_MAX_INGESTION = '12';
    installOperationalLayer();
    resetCloseCapabilityForTesting();
  });

  beforeEach(() => {
    resetImplicitRunsForTesting();
  });

  after(async () => {
    resetJobLifecycleForTesting();
    await resetPoolsForTesting();
    delete process.env.PT_V2_POOL_MAX_INGESTION;
    resetV2ConfigForTesting();
  });

  async function countJobRuns(jobKey: string): Promise<number> {
    return withConnection(role, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.pipeline_job_run
          WHERE occurred_at >= now() - interval '1 hour' AND job_key = $1`,
        [jobKey]
      );
      return Number(rows[0].n);
    });
  }

  // ── Successful run ────────────────────────────────────────────────────────

  test('a successful attributed run creates a pipeline_run and a pipeline_job_run', async () => {
    const runKey = `test.success.${Date.now()}`;
    let seen: JobRunRef | null = null;

    await withPipelineRun(role, runKey, async () => {
      assert.ok(currentRun(), 'the ambient run must be visible inside withPipelineRun');
      await withRun(role, 'test.job.success', async (_tx, job) => {
        seen = job;
      });
    });

    assert.ok(seen, 'withRun must now supply a real attribution');
    const job = seen as unknown as JobRunRef;
    assert.ok(job.id, 'the job run must carry an id');
    assert.ok(job.occurredAt instanceof Date, 'and its own occurred_at, for the composite key');

    await withConnection(role, async (client) => {
      const { rows } = await client.query<{ run_key: string; code_revision: string; n: string }>(
        `SELECT r.run_key, r.code_revision, count(j.id)::text AS n
           FROM operations.pipeline_run r
           JOIN operations.pipeline_job_run j
             ON j.pipeline_run_id = r.id AND j.run_occurred_at = r.occurred_at
          WHERE r.occurred_at >= now() - interval '1 hour' AND r.run_key = $1
          GROUP BY r.run_key, r.code_revision`,
        [runKey]
      );
      assert.equal(rows.length, 1, 'exactly one pipeline_run for the execution');
      assert.equal(Number(rows[0].n), 1, 'exactly one job run within it');
      assert.ok(rows[0].code_revision.length > 0, 'code_revision is NOT NULL and must be supplied');
    });
  });

  test('requireJobRun now returns a real attribution instead of throwing', async () => {
    // The S-7 unblock. Before installation this threw with the P-04 explanation.
    await withRun(role, 'test.job.require', async (_tx, job) => {
      const attribution = requireJobRun(job, 'Sealing a match snapshot');
      assert.ok(attribution.id);
      assert.ok(attribution.occurredAt instanceof Date);
    });
  });

  test('a stage invoked outside withPipelineRun still gets a run', async () => {
    // pipeline_job_run.pipeline_run_id is NOT NULL — there is no third option.
    const jobKey = `test.implicit.${Date.now()}`;
    await withRun(role, jobKey, async (_tx, job) => {
      assert.ok(job, 'an implicit run must be opened');
    });
    assert.equal(await countJobRuns(jobKey), 1);
  });

  // ── Failed run, and the property the subsystem exists for ─────────────────

  test('ROLLBACK OF THE WORK PRESERVES THE OPERATIONAL HISTORY', async () => {
    const runKey = `test.rollback.${Date.now()}`;
    const jobKey = `test.job.rollback.${Date.now()}`;

    await assert.rejects(
      withPipelineRun(role, runKey, async () => {
        await withRun(role, jobKey, async (tx) => {
          // A real business write, then a real failure. Both inside the work
          // transaction; both rolled back.
          await tx.query('CREATE TEMP TABLE _probe (v int) ON COMMIT DROP');
          await tx.query('INSERT INTO _probe VALUES (1)');
          throw new Error('deliberate business failure after a successful write');
        });
      }),
      /deliberate business failure/
    );

    // The work is gone.
    await withConnection(role, async (client) => {
      const { rows } = await client.query<{ present: boolean }>(
        "SELECT to_regclass('pg_temp._probe') IS NOT NULL AS present"
      );
      assert.equal(rows[0].present, false, 'the business write must have rolled back');
    });

    // The history is not.
    await withConnection(role, async (client) => {
      const run = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.pipeline_run
          WHERE occurred_at >= now() - interval '1 hour' AND run_key = $1`,
        [runKey]
      );
      assert.equal(Number(run.rows[0].n), 1, 'the pipeline_run must survive the rollback');

      const job = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.pipeline_job_run
          WHERE occurred_at >= now() - interval '1 hour' AND job_key = $1`,
        [jobKey]
      );
      assert.equal(Number(job.rows[0].n), 1, 'the pipeline_job_run must survive the rollback');

      const failure = await client.query<{ n: string; cls: string; diagnostic: string }>(
        `SELECT count(*)::text AS n, min(f.failure_class_code) AS cls, min(f.diagnostic) AS diagnostic
           FROM operations.failure f
           JOIN operations.pipeline_job_run j
             ON j.id = f.pipeline_job_run_id AND j.occurred_at = f.job_occurred_at
          WHERE f.occurred_at >= now() - interval '1 hour' AND j.job_key = $1`,
        [jobKey]
      );
      assert.equal(Number(failure.rows[0].n), 1, 'the failure must survive the rollback');
      assert.match(failure.rows[0].diagnostic, /deliberate business failure/);
    });
  });

  test('a constraint violation is recorded as DATA_QUALITY and rethrown', async () => {
    const jobKey = `test.constraint.${Date.now()}`;
    await assert.rejects(
      withRun(role, jobKey, async (tx) => {
        await tx.query('CREATE TEMP TABLE _ck (v int CHECK (v > 0)) ON COMMIT DROP');
        await tx.query('INSERT INTO _ck VALUES (-1)');
      }),
      /violates check constraint/
    );

    await withConnection(role, async (client) => {
      const { rows } = await client.query<{ cls: string }>(
        `SELECT f.failure_class_code AS cls
           FROM operations.failure f
           JOIN operations.pipeline_job_run j
             ON j.id = f.pipeline_job_run_id AND j.occurred_at = f.job_occurred_at
          WHERE f.occurred_at >= now() - interval '1 hour' AND j.job_key = $1`,
        [jobKey]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].cls, 'DATA_QUALITY');
      assert.equal(isRetryable('DATA_QUALITY'), false, 'and it must not be marked retryable');
    });
  });

  test('the failure class vocabulary is the database\'s, and agrees with ours', async () => {
    await withConnection(role, async (client) => {
      const { rows } = await client.query<{ code: string; is_retryable: boolean }>(
        'SELECT code, is_retryable FROM operations.failure_class ORDER BY code'
      );
      const fromDb = Object.fromEntries(rows.map((r) => [r.code, r.is_retryable]));
      assert.deepEqual(Object.keys(fromDb).sort(), [
        'DATA_QUALITY',
        'LOGIC',
        'TRANSIENT',
        'UPSTREAM',
      ]);
      for (const [code, retryable] of Object.entries(fromDb)) {
        assert.equal(
          isRetryable(code as never),
          retryable,
          `isRetryable('${code}') disagrees with operations.failure_class`
        );
      }
    });
  });

  // ── Write records ─────────────────────────────────────────────────────────

  test('write records persist against their job run', async () => {
    const jobKey = `test.writes.${Date.now()}`;
    await withRun(role, jobKey, async (_tx, job) => {
      await withConnection(role, async (control) => {
        const acc = new WriteAccumulator();
        acc.add({ schema: 'football', relation: 'team' }, { rowsExamined: 40, rowsWritten: 38, rowsSkipped: 2 });
        acc.add({ schema: 'football', relation: 'team' }, { rowsWritten: 2 });
        acc.add({ schema: 'football', relation: 'fixture' }, { rowsWritten: 120, rowsRejected: 1 });
        const flushed = await acc.flush(control, job);
        assert.equal(flushed, 2, 'one record per relation, not per statement');
      });
    });

    await withConnection(role, async (client) => {
      const { rows } = await client.query<{
        target_relation_name: string;
        rows_written: string;
        rows_skipped: string;
        rows_rejected: string;
      }>(
        `SELECT w.target_relation_name, w.rows_written::text, w.rows_skipped::text, w.rows_rejected::text
           FROM operations.write_record w
           JOIN operations.pipeline_job_run j
             ON j.id = w.pipeline_job_run_id AND j.occurred_at = w.job_occurred_at
          WHERE w.occurred_at >= now() - interval '1 hour' AND j.job_key = $1
          ORDER BY w.target_relation_name`,
        [jobKey]
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].target_relation_name, 'fixture');
      assert.equal(rows[0].rows_written, '120');
      assert.equal(rows[0].rows_rejected, '1');
      assert.equal(rows[1].target_relation_name, 'team');
      assert.equal(rows[1].rows_written, '40', 'the two team batches must have folded');
      assert.equal(rows[1].rows_skipped, '2');
    });
  });

  test('a write record without a job run is refused, not silently dropped', async () => {
    await withConnection(role, async (control) => {
      const ok = await recordWrite(
        control,
        null,
        { schema: 'football', relation: 'team' },
        { rowsWritten: 1 }
      );
      assert.equal(ok, false, 'write_record.pipeline_job_run_id is NOT NULL');
    });
  });

  // ── Failure resolution ────────────────────────────────────────────────────

  test('resolutions append rather than overwrite, and the latest one wins', async () => {
    const jobKey = `test.resolution.${Date.now()}`;
    let failure: FailureRef | null = null;

    await withRun(role, jobKey, async (_tx, job) => {
      await withConnection(role, async (control) => {
        failure = await recordFailure(control, job, new Error('needs investigation'), 'team:42');
      });
    });
    assert.ok(failure, 'the failure must have been recorded');
    const ref = failure as unknown as FailureRef;

    await withConnection(role, async (control) => {
      assert.equal(await latestResolution(control, ref), null, 'no resolution yet');

      // A failure's history is the SEQUENCE of its resolutions, not a mutable
      // status column — the same shape A.2 uses for snapshot outcome revision.
      await appendResolution(control, ref, 'OPEN', 'triaged');
      await appendResolution(control, ref, 'INVESTIGATING', 'reproduced locally');
      await appendResolution(control, ref, 'RESOLVED', 'upstream feed corrected');

      const latest = await latestResolution(control, ref);
      assert.equal(latest?.state, 'RESOLVED');
      assert.equal(latest?.note, 'upstream feed corrected');

      const { rows } = await control.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.failure_resolution
          WHERE occurred_at >= now() - interval '1 hour'
            AND failure_id = $1 AND failure_occurred_at = $2`,
        [ref.id, ref.occurredAt]
      );
      assert.equal(rows[0].n, '3', 'all three resolutions must remain readable');
    });
  });

  test('an unknown resolution state is refused by the database, not by us', async () => {
    const jobKey = `test.badstate.${Date.now()}`;
    let failure: FailureRef | null = null;
    await withRun(role, jobKey, async (_tx, job) => {
      await withConnection(role, async (control) => {
        failure = await recordFailure(control, job, new Error('x'));
      });
    });
    const ref = failure as unknown as FailureRef;
    await withConnection(role, async (control) => {
      await assert.rejects(
        appendResolution(control, ref, 'MAYBE_LATER' as never),
        /ck_failure_resolution__state_known|violates check constraint/
      );
    });
  });

  // ── API usage ─────────────────────────────────────────────────────────────

  test('api usage persists as a window aggregate (finding M-4)', async () => {
    const endpoint = `test.endpoint.${Date.now()}`;
    await withConnection(role, async (control) => {
      const builder = new ApiUsageWindowBuilder('TESTPROV', endpoint);
      builder.observe({ remaining: 99 });
      builder.observe({ remaining: 98 });
      builder.observe({ throttled: true, remaining: 98 });
      assert.equal(builder.callCount, 3);
      const written = await builder.flush(control);
      assert.ok(written, 'the window must have been written');
    });

    await withConnection(role, async (client) => {
      const { rows } = await client.query<{
        requests_made: number;
        quota_consumed: number;
        quota_remaining: number;
        throttled_count: number;
      }>(
        `SELECT requests_made, quota_consumed, quota_remaining, throttled_count
           FROM operations.api_usage
          WHERE occurred_at >= now() - interval '1 hour' AND endpoint_key = $1`,
        [endpoint]
      );
      assert.equal(rows.length, 1, 'one row per window, not per call');
      assert.equal(rows[0].requests_made, 3);
      assert.equal(rows[0].quota_consumed, 3);
      assert.equal(rows[0].throttled_count, 1);
      assert.equal(rows[0].quota_remaining, 98, 'the latest report governs the next call');
    });

    await withConnection(role, async (control) => {
      assert.equal(await latestQuotaRemaining(control, 'TESTPROV', endpoint), 98);
    });
  });

  test('an empty window writes nothing rather than a rejected row', async () => {
    await withConnection(role, async (control) => {
      const builder = new ApiUsageWindowBuilder('TESTPROV', 'never-called');
      assert.equal(await builder.flush(control), null);
    });
  });

  test('the window ordering CHECK is enforced by the database', async () => {
    await withConnection(role, async (control) => {
      const now = new Date();
      await assert.rejects(
        recordApiUsage(control, {
          providerCode: 'TESTPROV',
          endpointKey: 'inverted',
          windowStart: now,
          windowEnd: new Date(now.getTime() - 1000),
          requestsMade: 1,
          quotaConsumed: 1,
        }),
        /ck_api_usage__window_ordered|violates check constraint/
      );
    });
  });

  // ── Scheduling ────────────────────────────────────────────────────────────

  test('a scheduled execution is recorded through pipeline_run (finding M-5)', async () => {
    const scheduleKey = `test.schedule.${Date.now()}`;
    await withScheduledRun(role, scheduleKey, async () => {
      await withRun(role, 'test.job.scheduled', async () => undefined);
    });

    await withConnection(role, async (control) => {
      const since = new Date(Date.now() - 3_600_000);
      const executions = await recentScheduledExecutions(control, { since, scheduleKey });
      assert.equal(executions.length, 1);
      assert.equal(executions[0].runKey, scheduleKey);
      assert.ok(await scheduleFired(control, scheduleKey, since));
      assert.equal(
        await scheduleFired(control, 'a-schedule-that-never-ran', since),
        false,
        'a schedule that did not fire must be detectable — absences are otherwise silent'
      );
    });
  });

  test('schedule definitions come from pg_cron, or refuse clearly', async () => {
    await withConnection(role, async (control) => {
      if (await isCronAvailable(control)) {
        const schedules = await listSchedules(control);
        assert.ok(Array.isArray(schedules));
      } else {
        await assert.rejects(listSchedules(control), ScheduleStorageUnavailableError);
      }
    });
  });

  // ── Concurrency and isolation ─────────────────────────────────────────────

  test('concurrent runs do not see each other\'s ambient context', async () => {
    // AsyncLocalStorage, not a module global. A module global would have made
    // the second run overwrite the first's context and both jobs would attach to
    // one run.
    const keyA = `test.concurrent.a.${Date.now()}`;
    const keyB = `test.concurrent.b.${Date.now()}`;

    const [idA, idB] = await Promise.all([
      withPipelineRun(role, keyA, async () => {
        await new Promise((r) => setTimeout(r, 25));
        return currentRun()?.runKey;
      }),
      withPipelineRun(role, keyB, async () => {
        return currentRun()?.runKey;
      }),
    ]);

    assert.equal(idA, keyA);
    assert.equal(idB, keyB);
    assert.notEqual(idA, idB);
  });

  test('concurrent attributed runs each produce their own job run', async () => {
    const stamp = Date.now();
    const keys = [0, 1, 2, 3].map((i) => `test.parallel.${stamp}.${i}`);
    await Promise.all(
      keys.map((k) =>
        withPipelineRun(role, k, async () => {
          await withRun(role, k, async (tx) => {
            await tx.query('SELECT pg_sleep(0.02)');
          });
        })
      )
    );
    for (const k of keys) {
      assert.equal(await countJobRuns(k), 1, `${k} must have exactly one job run`);
    }
  });

  test('the lifecycle connection is not the work connection', async () => {
    // The structural guarantee behind rollback survival. If they were the same
    // backend, the lifecycle rows would share the work transaction's fate.
    let workPid: number | undefined;
    let controlPid: number | undefined;

    await withPipelineRun(role, `test.isolation.${Date.now()}`, async () => {
      await withRun(role, 'test.job.isolation', async (tx) => {
        const w = await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        workPid = w.rows[0].pid;
        // The ambient run was opened on the control connection; find the backend
        // that holds it by looking for the other session of this role.
        const others = await tx.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity
            WHERE usename = current_user AND pid <> pg_backend_pid()
              AND application_name = current_setting('application_name')
            LIMIT 1`
        );
        controlPid = others.rows[0]?.pid;
      });
    });

    assert.ok(workPid, 'the work connection must report a backend');
    assert.ok(controlPid, 'a second backend must exist for the lifecycle');
    assert.notEqual(workPid, controlPid, 'lifecycle and work must not share a backend');
  });

  // ── Savepoints under attribution ──────────────────────────────────────────

  test('a nested savepoint failure does not lose the run or the job', async () => {
    const jobKey = `test.savepoint.${Date.now()}`;
    const { withSavepoint } = await import('../db/tx');

    const surviving = await withRun(role, jobKey, async (tx) => {
      await tx.query('CREATE TEMP TABLE _sp (v int) ON COMMIT DROP');
      await tx.query('INSERT INTO _sp VALUES (1)');
      await assert.rejects(
        withSavepoint(tx, 'inner_step', async () => {
          await tx.query('INSERT INTO _sp VALUES (2)');
          throw new Error('inner step failed');
        }),
        /inner step failed/
      );
      const { rows } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM _sp');
      return rows[0].n;
    });

    assert.equal(surviving, '1', 'only the savepoint should have rolled back');
    assert.equal(await countJobRuns(jobKey), 1, 'the job run must exist and be singular');
  });

  // ── Migration finding M-1, asserted rather than assumed ───────────────────

  test('M-1: operations run rows cannot be closed, and the layer detects it', async () => {
    // Documented in docs/db-v2/16-phase8-s2-migration-findings.md. This test
    // ASSERTS the current behaviour so that if the architecture owner corrects
    // the defect, this test fails and the finding gets closed rather than
    // quietly outliving its truth.
    await withRun(role, `test.m1.${Date.now()}`, async () => undefined);
    assert.equal(
      runCloseCapability(),
      false,
      'If this now reports true, M-1 has been fixed — update the findings document ' +
        'and this assertion.'
    );

    await withConnection(role, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.pipeline_job_run
          WHERE occurred_at >= now() - interval '1 hour' AND outcome = 'RUNNING'`
      );
      assert.ok(
        Number(rows[0].n) > 0,
        'job runs remain RUNNING because the outcome cannot be transitioned'
      );
    });
  });

  test('M-2: pt_platform_admin cannot write operations telemetry', async () => {
    if (!testableRoles().includes('pt_platform_admin')) return;
    await withConnection('pt_platform_admin', async (client) => {
      const { rows } = await client.query<{ ins: boolean; sel: boolean }>(
        `SELECT has_table_privilege('operations.failure_resolution','INSERT') AS ins,
                has_table_privilege('operations.failure_resolution','SELECT') AS sel`
      );
      assert.equal(rows[0].sel, true, 'the admin role can read resolutions');
      assert.equal(
        rows[0].ins,
        false,
        'If this now reports true, M-2 has been fixed — update the findings document.'
      );
    });
  });
});
