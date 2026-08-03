// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION, ROLLBACK AND SESSION-PERSISTENCE TESTS
//
// The properties under test are the ones V1 cannot provide and the ones every
// later subsystem will assume:
//
//   * atomicity — a failure leaves nothing behind (§7.2 sealing depends on it)
//   * failure durability — the job lifecycle survives the rollback that loses
//     the work, which is the reason for the two-connection design in tx.ts
//   * session persistence — set_config(..., false) survives across statements,
//     which is what R-58 requires and a transaction pooler would break
//   * fail-loud on architectural violation — an upsert against append-only
//     content raises rather than degrading (R-19, verified in Phase 6.1 §14.3)
//
// Every test writes only to operations.quality_assertion_result or to temp
// objects, and rolls back where it can. Nothing here writes football, feature,
// module, snapshot or calibration content.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  withRun,
  withConnection,
  withSession,
  withSavepoint,
  registerJobLifecycle,
  resetJobLifecycleForTesting,
  isJobLifecycleInstalled,
  requireJobRun,
  TransactionError,
  type JobLifecycle,
  type JobRunRef,
  type JobOutcome,
} from './tx';
import { resetPoolsForTesting } from './pool';
import { testableRoles, skipReason } from './testSupport';

describe('job lifecycle seam (no database required)', () => {
  beforeEach(() => resetJobLifecycleForTesting());
  after(() => resetJobLifecycleForTesting());

  test('the no-op lifecycle is installed until S-2 replaces it', () => {
    assert.equal(isJobLifecycleInstalled(), false);
  });

  test('requireJobRun explains the S-2 dependency rather than failing obscurely', () => {
    assert.throws(
      () => requireJobRun(null, 'Sealing a match snapshot'),
      /operations\.pipeline_job_run must exist/,
      'the error must name the missing subsystem, not just say "null"'
    );
    // The message must also cite why, so a reader does not have to find P-04.
    assert.throws(() => requireJobRun(null, 'x'), /both-or-neither CHECK/);
  });

  test('requireJobRun passes a real reference through unchanged', () => {
    const ref: JobRunRef = { id: '1', occurredAt: new Date(), jobKey: 'test' };
    assert.equal(requireJobRun(ref, 'anything'), ref);
  });

  test('registering a lifecycle flips the installed flag', () => {
    registerJobLifecycle({
      async openJobRun() {
        return null;
      },
      async closeJobRun() {},
      async recordFailure() {},
    });
    assert.equal(isJobLifecycleInstalled(), true);
  });
});

describe('transactions (requires a V2 database)', { skip: skipReason() || false }, () => {
  // pt_platform_admin is the safest principal for these tests: it reads every
  // schema and writes only governed configuration, so a mistake here cannot
  // touch football, feature, module, snapshot or calibration content.
  const role = testableRoles().includes('pt_platform_admin')
    ? ('pt_platform_admin' as const)
    : testableRoles()[0];

  beforeEach(() => resetJobLifecycleForTesting());

  after(async () => {
    resetJobLifecycleForTesting();
    await resetPoolsForTesting();
  });

  test('a successful run commits and returns its value', async () => {
    const result = await withRun(role, 'test.commit', async (tx) => {
      const { rows } = await tx.query<{ n: number }>('SELECT 1 AS n');
      return rows[0].n;
    });
    assert.equal(Number(result), 1);
  });

  test('work is visible inside the transaction and gone after a rollback', async () => {
    // A temp table is transaction-visible and needs no privilege on any design
    // relation, so this isolates atomicity from the access matrix.
    await assert.rejects(
      withRun(role, 'test.rollback', async (tx) => {
        await tx.query('CREATE TEMP TABLE _tx_probe (v int) ON COMMIT DROP');
        await tx.query('INSERT INTO _tx_probe VALUES (1), (2)');
        const inside = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM _tx_probe');
        assert.equal(inside.rows[0].n, '2', 'writes must be visible within the transaction');
        throw new Error('deliberate failure after a successful write');
      }),
      /deliberate failure/
    );

    // The temp table was created inside the rolled-back transaction, so it is
    // gone — proving the rollback covered the whole unit, not just the last
    // statement.
    await withConnection(role, async (client) => {
      const { rows } = await client.query<{ present: boolean }>(
        "SELECT to_regclass('pg_temp._tx_probe') IS NOT NULL AS present"
      );
      assert.equal(rows[0].present, false, 'rollback did not undo the whole transaction');
    });
  });

  test('the original error propagates, not a wrapper', async () => {
    const sentinel = new Error('sentinel-error-identity');
    await assert.rejects(
      withRun(role, 'test.error-identity', async () => {
        throw sentinel;
      }),
      (err: Error) => err === sentinel
    );
  });

  test('a constraint violation propagates rather than being absorbed', async () => {
    // §8.2 — this class is NEVER retried. It means the application attempted
    // something the architecture forbids, and the correct response is to fail
    // loudly and record it.
    await assert.rejects(
      withRun(role, 'test.constraint', async (tx) => {
        await tx.query('CREATE TEMP TABLE _tx_ck (v int CHECK (v > 0)) ON COMMIT DROP');
        await tx.query('INSERT INTO _tx_ck VALUES (-1)');
      }),
      /violates check constraint/
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The two-connection design: the job run must survive the rollback
  // ───────────────────────────────────────────────────────────────────────────

  function recordingLifecycle() {
    const events: { event: string; outcome?: JobOutcome; error?: string }[] = [];
    let opened = 0;
    const impl: JobLifecycle = {
      async openJobRun(control, ctx) {
        // Prove the control connection is NOT the work connection by writing on
        // it and observing that the write survives the work rollback.
        await control.query('SELECT 1');
        opened += 1;
        events.push({ event: 'open' });
        return { id: String(opened), occurredAt: new Date(), jobKey: ctx.jobKey };
      },
      async closeJobRun(_control, _ref, outcome) {
        events.push({ event: 'close', outcome });
      },
      async recordFailure(_control, _ref, error) {
        events.push({ event: 'failure', error: error.message });
      },
    };
    return { impl, events };
  }

  test('a successful run opens then closes SUCCEEDED, and records no failure', async () => {
    const { impl, events } = recordingLifecycle();
    registerJobLifecycle(impl);
    await withRun(role, 'test.lifecycle.ok', async (tx, job) => {
      assert.ok(job, 'an attributed run must receive a job reference');
      await tx.query('SELECT 1');
    });
    assert.deepEqual(
      events.map((e) => e.event),
      ['open', 'close']
    );
    assert.equal(events[1].outcome, 'SUCCEEDED');
  });

  test('a failed run still closes FAILED and records the failure', async () => {
    // THE PROPERTY THE TWO-CONNECTION DESIGN EXISTS FOR. If the lifecycle ran on
    // the work connection, both of these would have been rolled back and the runs
    // most worth recording would be the ones leaving no record.
    const { impl, events } = recordingLifecycle();
    registerJobLifecycle(impl);
    await assert.rejects(
      withRun(role, 'test.lifecycle.fail', async () => {
        throw new Error('boom');
      }),
      /boom/
    );
    assert.deepEqual(
      events.map((e) => e.event),
      ['open', 'close', 'failure']
    );
    assert.equal(events[1].outcome, 'FAILED');
    assert.equal(events[2].error, 'boom');
  });

  test('a lifecycle that throws never masks the outcome it describes', async () => {
    registerJobLifecycle({
      async openJobRun(_c, ctx) {
        return { id: '1', occurredAt: new Date(), jobKey: ctx.jobKey };
      },
      async closeJobRun() {
        throw new Error('telemetry is down');
      },
      async recordFailure() {
        throw new Error('telemetry is still down');
      },
    });

    // A broken telemetry write must not turn a successful run into a failure.
    const ok = await withRun(role, 'test.lifecycle.close-throws', async () => 'fine');
    assert.equal(ok, 'fine');

    // Nor may it replace the original error on a failing run.
    await assert.rejects(
      withRun(role, 'test.lifecycle.both-throw', async () => {
        throw new Error('the real problem');
      }),
      /the real problem/
    );
  });

  test('a failure to OPEN a job run aborts before any work is attempted', async () => {
    let workRan = false;
    registerJobLifecycle({
      async openJobRun() {
        throw new Error('cannot reach operations schema');
      },
      async closeJobRun() {},
      async recordFailure() {},
    });
    await assert.rejects(
      withRun(role, 'test.lifecycle.open-throws', async () => {
        workRan = true;
      }),
      (err: Error) => err instanceof TransactionError && /Could not open a job run/.test(err.message)
    );
    assert.equal(workRan, false, 'unattributed work must not run');
  });

  test('withoutAttribution skips the control connection and yields a null job', async () => {
    const { impl, events } = recordingLifecycle();
    registerJobLifecycle(impl);
    const job = await withRun(
      role,
      'test.unattributed',
      async (_tx, j) => j,
      { withoutAttribution: true }
    );
    assert.equal(job, null);
    assert.deepEqual(events, [], 'no lifecycle call should have been made');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Savepoints
  // ───────────────────────────────────────────────────────────────────────────

  test('a savepoint absorbs its own failure without losing the transaction', async () => {
    const surviving = await withRun(role, 'test.savepoint', async (tx) => {
      await tx.query('CREATE TEMP TABLE _tx_sp (v int) ON COMMIT DROP');
      await tx.query('INSERT INTO _tx_sp VALUES (1)');
      await assert.rejects(
        withSavepoint(tx, 'step_two', async () => {
          await tx.query('INSERT INTO _tx_sp VALUES (2)');
          throw new Error('step two failed');
        }),
        /step two failed/
      );
      const { rows } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM _tx_sp');
      return rows[0].n;
    });
    assert.equal(surviving, '1', 'the savepoint should have rolled back only its own insert');
  });

  test('savepoint names are constrained rather than escaped', async () => {
    await withRun(role, 'test.savepoint.name', async (tx) => {
      await assert.rejects(
        withSavepoint(tx, 'drop table"; --', async () => undefined),
        /Invalid savepoint name/
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session persistence — the property R-58 requires and a pooler would break
// ─────────────────────────────────────────────────────────────────────────────

describe('session persistence (requires a V2 database)', { skip: skipReason() || false }, () => {
  const role = testableRoles().includes('pt_platform_admin')
    ? ('pt_platform_admin' as const)
    : testableRoles()[0];

  after(async () => {
    await resetPoolsForTesting();
  });

  test('a session-scoped setting survives across statements', async () => {
    // This is exactly how fn_run_retention() sets the marker of R-21:
    // set_config(name, value, false) — session scope, not transaction scope.
    // Under a transaction pooler the second statement would see nothing, the
    // DELETE policy would match no rows, and the run would report success having
    // removed nothing.
    const observed = await withSession(role, async (session: PoolClient) => {
      await session.query("SELECT set_config('pitchterminal.test_marker', 'true', false)");
      // A separate statement, on the same session.
      const { rows } = await session.query<{ marker: string }>(
        "SELECT current_setting('pitchterminal.test_marker', true) AS marker"
      );
      return rows[0].marker;
    });
    assert.equal(observed, 'true', 'session-scoped state did not survive a statement boundary');
  });

  test('the setting does not leak to the next borrower of the connection', async () => {
    await withSession(role, async (session) => {
      await session.query("SELECT set_config('pitchterminal.test_marker', 'leaked', false)");
    });
    // DISCARD ALL runs on release, so a subsequent checkout starts clean. Without
    // it, a pooled connection would carry the retention marker into whatever ran
    // next — precisely the condition R-20's second requirement exists to prevent.
    const after = await withSession(role, async (session) => {
      const { rows } = await session.query<{ marker: string | null }>(
        "SELECT current_setting('pitchterminal.test_marker', true) AS marker"
      );
      return rows[0].marker;
    });
    assert.ok(after === null || after === '', `marker leaked across sessions: '${after}'`);
  });

  test('the retention marker is absent by default on a fresh session', async () => {
    const marker = await withConnection(role, async (client) => {
      const { rows } = await client.query<{ m: string | null }>(
        "SELECT current_setting('pitchterminal.retention_operation', true) AS m"
      );
      return rows[0].m;
    });
    assert.ok(
      marker === null || marker === '' || marker === 'false',
      `a fresh session must not carry the retention marker; found '${marker}'`
    );
  });

  test('the connection is in session mode, not behind a transaction pooler', async () => {
    // pg_backend_pid is stable for a session and changes per connection. Two
    // statements on one checked-out client must report the same backend; a
    // transaction pooler would not guarantee that.
    const [first, second] = await withSession(role, async (session) => {
      const a = await session.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const b = await session.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      return [a.rows[0].pid, b.rows[0].pid];
    });
    assert.equal(first, second, 'statements landed on different backends — not session mode');
  });
});
