// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION AND CONFIGURATION TESTS
//
// The configuration half runs everywhere and guards the one check that catches a
// pipeline pointed at a transaction pooler — a misconfiguration that does not
// fail loudly and would make retention delete nothing while reporting success.
//
// The connection half requires a database and verifies four things that can each
// be wrong without raising on connect: the authenticated role, the session
// timeouts of A.15, search_path per §5.3.4, and UTC per PD-08.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateConnectionTarget,
  loadV2Config,
  requireCredential,
  isDatabaseConfigured,
  assertDatabaseConfigured,
  resetV2ConfigForTesting,
  DEFAULT_CONNECT_TIMEOUT_MS,
  SESSION_MODE_PORT,
} from '../config/index';
import type { PoolClient } from 'pg';

import { EventEmitter } from 'node:events';

import {
  poolFor,
  checkHealth,
  retryAcquisition,
  isTransientAcquisitionError,
  ACQUIRE_ATTEMPTS,
  ACQUIRE_BACKOFF_MS,
  isEmptySearchPath,
  checkAllConfiguredRoles,
  closeAllPools,
  poolStats,
  isPoolOpen,
  resetPoolsForTesting,
  buildPoolConfig,
  guardCheckedOutClient,
  KEEPALIVE_INITIAL_DELAY_MS,
} from './pool';
import { roleDefinition } from './roles';
import { testableRoles, skipReason, connectionSummary } from './testSupport';

describe('connection target validation (no database required)', () => {
  test('the transaction pooler port is rejected outright', () => {
    assert.throws(
      () => validateConnectionTarget(6543, false),
      /TRANSACTION POOLER/,
      'port 6543 must be refused — a pooler does not preserve the retention marker (R-58)'
    );
    // Rejected even with the escape hatch: a pooler is never correct for a
    // pipeline, whereas an unusual local port legitimately is.
    assert.throws(() => validateConnectionTarget(6543, true), /TRANSACTION POOLER/);
  });

  test('the session-mode port is accepted', () => {
    assert.doesNotThrow(() => validateConnectionTarget(SESSION_MODE_PORT, false));
  });

  test('an unusual port is refused unless explicitly allowed', () => {
    assert.throws(() => validateConnectionTarget(55432, false), /not the expected session-mode port/);
    assert.doesNotThrow(() => validateConnectionTarget(55432, true));
  });
});

describe('configuration loading (no database required)', () => {
  const saved = { ...process.env };

  after(() => {
    process.env = { ...saved };
    resetV2ConfigForTesting();
  });

  test('absent connection parameters fail fast and name what is missing', () => {
    resetV2ConfigForTesting();
    delete process.env.PT_V2_DB_HOST;
    delete process.env.PT_V2_DB_NAME;
    assert.throws(() => loadV2Config(), /Missing: PT_V2_DB_HOST, PT_V2_DB_NAME/);
  });

  test('a missing credential names the one variable to set', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    delete process.env.PT_V2_DB_PASSWORD;
    // ONE credential, not seven. Nothing about running V2 requires provisioning
    // a PT-specific database identity.
    assert.throws(() => requireCredential(), /Set PT_V2_DB_PASSWORD/);
    assert.throws(() => assertDatabaseConfigured(), /Set PT_V2_DB_PASSWORD/);
    assert.equal(isDatabaseConfigured(), false);
  });

  test('the login defaults to the one the project already has', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    delete process.env.PT_V2_DB_USER;
    assert.equal(loadV2Config().database.user, 'postgres');

    resetV2ConfigForTesting();
    process.env.PT_V2_DB_USER = 'something_narrower';
    assert.equal(loadV2Config().database.user, 'something_narrower');
    delete process.env.PT_V2_DB_USER;
  });

  test('one pool maximum, defaulted and overridable', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    delete process.env.PT_V2_POOL_MAX;
    assert.equal(loadV2Config().poolMax, 10);

    resetV2ConfigForTesting();
    process.env.PT_V2_POOL_MAX = '9';
    assert.equal(loadV2Config().poolMax, 9);
    delete process.env.PT_V2_POOL_MAX;
  });

  test('the connect budget defaults to 30s, measured rather than chosen', () => {
    // MEASURED. A staged handshake trace against the deployed Supabase pooler
    // recorded TLS established at 3270ms and the FULL connection — pooler auth
    // plus its own connection to the tenant database — at 14125ms on a cold
    // tenant. The earlier successful connection took 4259ms. A 10s budget killed
    // every attempt before it could finish, so the 3-attempt retry could never
    // succeed; a 15s budget clears the slower observation by 875ms, which is a
    // coin toss. 30s is ~2x the observed worst case.
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    delete process.env.PT_V2_DB_CONNECT_TIMEOUT_MS;

    assert.equal(DEFAULT_CONNECT_TIMEOUT_MS, 30_000);
    assert.equal(loadV2Config().database.connectionTimeoutMs, 30_000);

    // Strictly greater than the slowest connection actually observed, with real
    // margin — not merely greater by a rounding error.
    const OBSERVED_WORST_MS = 14_125;
    assert.ok(
      DEFAULT_CONNECT_TIMEOUT_MS >= OBSERVED_WORST_MS * 2,
      'the budget must be at least twice the slowest connection measured in the field'
    );
  });

  test('a deployment may still override the connect budget', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    process.env.PT_V2_DB_CONNECT_TIMEOUT_MS = '45000';
    assert.equal(loadV2Config().database.connectionTimeoutMs, 45_000);
    delete process.env.PT_V2_DB_CONNECT_TIMEOUT_MS;
    resetV2ConfigForTesting();
  });

  test('the worst case stays bounded, with the retry policy unchanged', () => {
    // 3 attempts at the budget, plus V1's 2s and 5s backoff. Stated as a test so
    // a later change to either number has to face the total it produces.
    const worstCaseMs = ACQUIRE_ATTEMPTS * DEFAULT_CONNECT_TIMEOUT_MS +
      ACQUIRE_BACKOFF_MS.reduce((total, ms) => total + ms, 0);
    assert.equal(worstCaseMs, 97_000, 'three 30s attempts plus 7s of backoff');
    assert.ok(worstCaseMs <= 120_000, 'a CLI must still fail inside two minutes');
  });

  test('a malformed numeric override is rejected rather than silently defaulted', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    process.env.PT_V2_POOL_MAX = 'lots';
    assert.throws(() => loadV2Config(), /must be a positive integer/);
    delete process.env.PT_V2_POOL_MAX;
    resetV2ConfigForTesting();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION ACQUISITION RETRY (no database required)
//
// V2 previously had no retry at all: a single transient blip during acquisition
// ended a run permanently, while V1 absorbed the same blip silently through
// fetchAllRows. These tests pin V1's policy and, more importantly, pin what must
// NEVER be retried.
// ─────────────────────────────────────────────────────────────────────────────

/** Enough of a PoolClient to prove the helper returns what connect() gave it. */
const FAKE_CLIENT = { release: () => undefined } as unknown as PoolClient;

/** No real waiting. The policy itself is asserted from the exported constants. */
const INSTANT: readonly number[] = [0, 0];

function transient(message: string): Error {
  return new Error(message);
}

/** An error as the SERVER produces it: carrying a SQLSTATE. */
function serverError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('connection acquisition retry (no database required)', () => {
  test('the policy is V1s, taken from its implementation not its comment', () => {
    // fetchAllRows.ts:88 loops `attempt <= 3`; :103 sleeps 2000 then 5000, and
    // its 10000 branch is unreachable because attempt 3 throws first. The
    // comment there claims "1s/3s" and is stale.
    assert.equal(ACQUIRE_ATTEMPTS, 3, 'V1 makes three attempts');
    assert.deepEqual([...ACQUIRE_BACKOFF_MS], [2000, 5000], 'V1 waits 2s then 5s');
  });

  test('a transient failure is retried and the connection is returned', async () => {
    let calls = 0;
    const client = await retryAcquisition(
      async () => {
        calls += 1;
        if (calls === 1) throw transient('read ECONNRESET');
        return FAKE_CLIENT;
      },
      'pt_platform_admin',
      INSTANT
    );
    assert.equal(client, FAKE_CLIENT, 'the successful attempt yields its client');
    assert.equal(calls, 2, 'exactly one retry was needed');
  });

  test('it recovers on the LAST permitted attempt', async () => {
    let calls = 0;
    const client = await retryAcquisition(
      async () => {
        calls += 1;
        if (calls < ACQUIRE_ATTEMPTS) throw transient('timeout exceeded when trying to connect');
        return FAKE_CLIENT;
      },
      undefined,
      INSTANT
    );
    assert.equal(client, FAKE_CLIENT);
    assert.equal(calls, ACQUIRE_ATTEMPTS);
  });

  test('exhaustion propagates the FINAL error, unchanged', async () => {
    let calls = 0;
    const last = transient('Connection terminated due to connection timeout');
    await assert.rejects(
      () =>
        retryAcquisition(
          async () => {
            calls += 1;
            throw calls === ACQUIRE_ATTEMPTS ? last : transient('ETIMEDOUT');
          },
          undefined,
          INSTANT
        ),
      (error: Error) => {
        assert.equal(error, last, 'the caller sees the last failure, not a wrapper');
        return true;
      }
    );
    assert.equal(calls, ACQUIRE_ATTEMPTS, 'no attempt beyond the policy');
  });

  test('AUTHENTICATION FAILURE IS NOT RETRIED', async () => {
    // The one that matters most. Three identical rejections take seven seconds
    // to say what the first said immediately, and a wrong password is a decision
    // rather than a blip.
    let calls = 0;
    await assert.rejects(
      () =>
        retryAcquisition(
          async () => {
            calls += 1;
            throw serverError('password authentication failed for user "postgres"', '28P01');
          },
          undefined,
          INSTANT
        ),
      /password authentication failed/
    );
    assert.equal(calls, 1, 'exactly one attempt');
  });

  test('no SQLSTATE-bearing error is retried', async () => {
    const decisions: readonly (readonly [string, string])[] = [
      ['duplicate key value violates unique constraint', '23505'],
      ['new row violates row-level security policy', '42501'],
      ['syntax error at or near "slect"', '42601'],
      ['relation "football.nope" does not exist', '42P01'],
    ];
    for (const [message, code] of decisions) {
      let calls = 0;
      await assert.rejects(
        () =>
          retryAcquisition(
            async () => {
              calls += 1;
              throw serverError(message, code);
            },
            undefined,
            INSTANT
          ),
        (error: Error) => error.message === message
      );
      assert.equal(calls, 1, `${code} must not be retried`);
    }
  });

  test('a SQLSTATE outranks a transient-looking message', () => {
    // Belt and braces: were a server error ever to contain one of V1s network
    // words, the SQLSTATE still disqualifies it.
    assert.equal(
      isTransientAcquisitionError(serverError('network policy violation', '42501')),
      false
    );
    // Node errno codes land on `code` too, and those ARE transient.
    assert.equal(
      isTransientAcquisitionError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      true
    );
  });

  test('every message V1 treats as transient is treated as transient here', () => {
    for (const message of [
      'fetch failed',
      'read ECONNRESET',
      'connect ETIMEDOUT 1.2.3.4:5432',
      'connect ECONNREFUSED 1.2.3.4:5432',
      'getaddrinfo EAI_AGAIN example.invalid',
      'write EPIPE',
      'socket hang up',
      'network error',
      'Connection terminated unexpectedly',
      // pg-pools own acquisition timeouts. V1 cannot produce these because it
      // holds no pool; here they are unambiguously transient.
      'timeout exceeded when trying to connect',
      'Connection terminated due to connection timeout',
    ]) {
      assert.equal(isTransientAcquisitionError(new Error(message)), true, message);
    }
  });

  test('a non-Error rejection is not retried', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retryAcquisition(
          async () => {
            calls += 1;
            throw 'a bare string';
          },
          undefined,
          INSTANT
        )
    );
    assert.equal(calls, 1);
  });

  test('it actually waits between attempts', async () => {
    let calls = 0;
    const startedAt = Date.now();
    await retryAcquisition(
      async () => {
        calls += 1;
        if (calls === 1) throw transient('socket hang up');
        return FAKE_CLIENT;
      },
      undefined,
      [40, 40]
    );
    assert.ok(Date.now() - startedAt >= 35, 'the backoff was observed, not skipped');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECKED-OUT CLIENT ERROR GUARD + TCP KEEPALIVE (no database required)
//
// The England ingestion run died because a checked-out connection's socket was
// dropped while query-idle and pg emitted an 'error' event on a Client with no
// listener — an unhandled event that terminates the Node process. These pin the
// central fix: every checkout is guarded, the guard never leaks a listener, and
// the pool is now configured with TCP keepalive.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fake connection that reproduces the pg-pool 3.14.0 checkout/release contract
 * that matters here: on checkout the idle 'error' listener is absent (the pool
 * removed it), and on release the pool re-attaches exactly one idle listener and
 * refuses a second release. Faithful enough to prove our guard composes with it
 * without a database.
 */
function fakePooledConnection() {
  const client = new EventEmitter() as unknown as PoolClient & EventEmitter;
  const idleListener = (): void => undefined;

  // Emulate pg-pool _acquireClient: caller receives a client with no 'error'
  // listener and a release-once wrapper that re-adds the idle listener.
  function checkout(): void {
    client.removeListener('error', idleListener);
    let released = false;
    (client as unknown as { release: (err?: Error | boolean) => void }).release = (
      _err?: Error | boolean
    ): void => {
      if (released) throw new Error('Release called on client which has already been released to the pool.');
      released = true;
      client.on('error', idleListener); // pg-pool _release re-attaches the idle listener
    };
  }

  return { client, idleListener, checkout };
}

describe('checked-out client error guard (no database required)', () => {
  test('a checked-out client socket error is handled, not thrown as an unhandled event', () => {
    const { client, checkout } = fakePooledConnection();
    checkout();
    // Precondition: pg-pool left the checked-out client with no 'error' listener.
    assert.equal(client.listenerCount('error'), 0);

    guardCheckedOutClient(client, 'pt_pipeline_ingestion');
    assert.equal(client.listenerCount('error'), 1, 'the guard attaches exactly one listener');

    // With a listener present, EventEmitter delivers the event instead of
    // throwing — which is precisely what stops the process from terminating. An
    // unguarded emit('error') with no listener throws.
    assert.doesNotThrow(() =>
      client.emit('error', new Error('Connection terminated unexpectedly'))
    );
  });

  test('the guard removes its listener on release — no leak across checkouts', () => {
    const { client, checkout } = fakePooledConnection();

    // Three full checkout/guard/release cycles on ONE physical connection. If the
    // guard failed to detach, listeners would accumulate; the count must return
    // to exactly one (pg-pool's re-attached idle listener) every time.
    for (let cycle = 0; cycle < 3; cycle++) {
      checkout();
      assert.equal(client.listenerCount('error'), 0, `cycle ${cycle}: checked out, no listener`);
      guardCheckedOutClient(client);
      assert.equal(client.listenerCount('error'), 1, `cycle ${cycle}: guard attached`);
      client.release();
      assert.equal(
        client.listenerCount('error'),
        1,
        `cycle ${cycle}: guard detached, only pg-pool's idle listener remains`
      );
    }
  });

  test('normal checkout, release, and double-release semantics are preserved', () => {
    const { client, checkout } = fakePooledConnection();
    checkout();
    const guarded = guardCheckedOutClient(client);
    assert.equal(guarded, client, 'the same client is returned');

    assert.doesNotThrow(() => guarded.release(), 'a first release succeeds');
    assert.throws(
      () => guarded.release(),
      /already been released/,
      'double release still throws — the pooled release-once wrapper is preserved'
    );
  });
});

describe('TCP keepalive configuration (no database required)', () => {
  const saved = { ...process.env };
  after(() => {
    process.env = { ...saved };
    resetV2ConfigForTesting();
  });

  test('the constructed pool config carries conservative keepalive', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_DB_PASSWORD = 'irrelevant-to-this-assertion';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';

    const config = buildPoolConfig();
    assert.equal(config.keepAlive, true, 'keepAlive must be enabled on the pool');
    assert.equal(
      config.keepAliveInitialDelayMillis,
      KEEPALIVE_INITIAL_DELAY_MS,
      'the initial-delay must be the module default'
    );

    // Conservative, not aggressive: soon enough to keep a pooled socket warm,
    // slow enough to add no meaningful probe traffic.
    assert.ok(
      KEEPALIVE_INITIAL_DELAY_MS >= 5_000 && KEEPALIVE_INITIAL_DELAY_MS <= 30_000,
      `keepalive initial delay ${KEEPALIVE_INITIAL_DELAY_MS}ms is outside the conservative 5s–30s band`
    );
  });
});

describe('pools and health (requires a V2 database)', { skip: skipReason() || false }, () => {
  before(() => {
    // Visible in the runner output so a passing suite states what it connected to.
    console.log(`    v2 target: ${connectionSummary()}`);
  });

  after(async () => {
    await resetPoolsForTesting();
  });

  for (const role of testableRoles()) {
    test(`${role} connects and is healthy`, async () => {
      const report = await checkHealth(role);
      assert.ok(report.healthy, report.error ?? 'unhealthy with no error reported');

      // The role PostgreSQL authenticated must be the role we asked for. Two
      // variables pointed at one credential would otherwise go unnoticed until a
      // write landed under the wrong principal.
      assert.equal(report.currentUser, role);

      // §5.3.4 — no permissive search path. Sessions are pinned to '' so every
      // object reference in application code must be schema-qualified.
      //
      // PostgreSQL renders the empty path as the two-character string `""`, not
      // as an empty string, so the comparison goes through a helper rather than
      // against ''. pt_platform_admin is the role that proves this matters:
      // migration 001 does not set search_path for it, and without the startup
      // option it reports `"$user", public`.
      assert.ok(
        isEmptySearchPath(report.searchPath),
        `${role} has a permissive search_path: ${report.searchPath}`
      );

      // PD-08 — every pipeline session operates in UTC. A session in local time
      // silently shifts date_trunc and every partition key derived from it.
      //
      // 'Etc/UTC' and 'UTC' are the same zone with different spellings; the
      // cluster default is the former. pt_platform_admin reported it before the
      // startup option was added, because migration 001 sets timezone for the
      // other six roles and not for that one.
      assert.ok(
        report.timezone === 'UTC' || report.timezone === 'Etc/UTC',
        `${role} is not in UTC: ${report.timezone}`
      );

      assert.ok(report.serverVersion?.startsWith('16.'), 'expected PostgreSQL 16');
    });
  }

  test('A.15 statement timeouts arrived from ALTER ROLE, not from the client', async () => {
    // Migration 001 sets these per role (R-64). The pool deliberately does NOT
    // set statement_timeout, so a value here proves the role settings applied.
    const expected: Partial<Record<string, string>> = {
      pt_pipeline_ingestion: '30min',
      pt_pipeline_feature: '1h',
      pt_pipeline_module: '1h',
      pt_pipeline_calibration: '2h',
      pt_pipeline_projection: '1h',
      pt_retention: '30min',
    };
    for (const role of testableRoles()) {
      const want = expected[role];
      if (!want) continue;
      const report = await checkHealth(role);
      assert.equal(
        report.statementTimeout,
        want,
        `${role} statement_timeout is '${report.statementTimeout}', expected '${want}' — ` +
          'ALTER ROLE from migration 001 may not have been applied'
      );
    }
  });

  test('an unknown credential fails to connect rather than falling back', async () => {
    const saved = process.env.PT_V2_DB_PASSWORD;
    try {
      await resetPoolsForTesting();
      resetV2ConfigForTesting();
      process.env.PT_V2_DB_PASSWORD = 'definitely-not-the-password';
      const report = await checkHealth('pt_platform_admin');
      assert.ok(!report.healthy, 'a wrong password must not produce a healthy connection');
    } finally {
      if (saved === undefined) delete process.env.PT_V2_DB_PASSWORD;
      else process.env.PT_V2_DB_PASSWORD = saved;
      resetV2ConfigForTesting();
      await resetPoolsForTesting();
    }
  });

  test('the pool is lazy — importing this module opened nothing', async () => {
    await resetPoolsForTesting();
    assert.equal(isPoolOpen(), false);
    poolFor(testableRoles()[0]);
    assert.equal(isPoolOpen(), true);
  });

  test('every layer receives the SAME pool — one connection, one credential', async () => {
    await resetPoolsForTesting();
    const first = poolFor('pt_pipeline_ingestion');
    for (const role of testableRoles()) {
      assert.equal(poolFor(role), first, `${role} must not open a second pool`);
    }
  });

  test('health reporting covers every layer over the one connection', async () => {
    const reports = await checkAllConfiguredRoles(testableRoles());
    assert.equal(reports.length, testableRoles().length);
    assert.ok(reports.every((r) => r.healthy), 'the connection is unhealthy');
  });

  test('poolStats reports occupancy for the R-05 connection budget', async () => {
    await checkHealth(testableRoles()[0]);
    const stats = poolStats();
    const user = loadV2Config().database.user;
    assert.ok(stats[user], 'no statistics for an open pool');
    assert.ok(stats[user].total >= 1);
  });

  test('closeAllPools is graceful and idempotent, and refuses late checkouts', async () => {
    await checkHealth(testableRoles()[0]);
    assert.equal(isPoolOpen(), true);

    await closeAllPools();
    assert.equal(isPoolOpen(), false);

    // Second call is a no-op rather than an error — signal handlers fire twice
    // often enough to matter.
    await closeAllPools();

    // A job started after shutdown would leave an unattributed partial write.
    assert.throws(() => poolFor(testableRoles()[0]), /shutdown is in progress/);

    await resetPoolsForTesting();
  });
});
