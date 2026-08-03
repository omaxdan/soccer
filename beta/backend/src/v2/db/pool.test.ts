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
  configuredRoles,
  assertRolesConfigured,
  resetV2ConfigForTesting,
  SESSION_MODE_PORT,
} from '../config/index';
import {
  poolFor,
  checkHealth,
  isEmptySearchPath,
  checkAllConfiguredRoles,
  closeAllPools,
  poolStats,
  openPoolRoles,
  resetPoolsForTesting,
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

  test('a missing credential names the exact variable to set', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    delete process.env.PT_V2_DB_PASSWORD_MODULE;
    assert.throws(
      () => requireCredential('pt_pipeline_module'),
      /Set PT_V2_DB_PASSWORD_MODULE/
    );
  });

  test('assertRolesConfigured reports every absent role at once', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    delete process.env.PT_V2_DB_PASSWORD_MODULE;
    delete process.env.PT_V2_DB_PASSWORD_FEATURE;
    assert.throws(
      () => assertRolesConfigured(['pt_pipeline_module', 'pt_pipeline_feature']),
      /pt_pipeline_module, pt_pipeline_feature/
    );
  });

  test('pool maxima default from the register and accept an override', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    process.env.PT_V2_POOL_MAX_MODULE = '9';
    const cfg = loadV2Config();
    assert.equal(cfg.poolMax.pt_pipeline_module, 9);
    assert.equal(
      cfg.poolMax.pt_pipeline_feature,
      roleDefinition('pt_pipeline_feature').defaultPoolMax
    );
    delete process.env.PT_V2_POOL_MAX_MODULE;
  });

  test('a malformed numeric override is rejected rather than silently defaulted', () => {
    resetV2ConfigForTesting();
    process.env.PT_V2_DB_HOST = 'localhost';
    process.env.PT_V2_DB_NAME = 'ptv2';
    process.env.PT_V2_ALLOW_NON_SESSION_PORT = 'true';
    process.env.PT_V2_POOL_MAX_MODULE = 'lots';
    assert.throws(() => loadV2Config(), /must be a positive integer/);
    delete process.env.PT_V2_POOL_MAX_MODULE;
    resetV2ConfigForTesting();
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
    const saved = process.env.PT_V2_DB_PASSWORD_ADMIN;
    try {
      await resetPoolsForTesting();
      resetV2ConfigForTesting();
      process.env.PT_V2_DB_PASSWORD_ADMIN = 'definitely-not-the-password';
      const report = await checkHealth('pt_platform_admin');
      assert.ok(!report.healthy, 'a wrong password must not produce a healthy connection');
    } finally {
      if (saved === undefined) delete process.env.PT_V2_DB_PASSWORD_ADMIN;
      else process.env.PT_V2_DB_PASSWORD_ADMIN = saved;
      resetV2ConfigForTesting();
      await resetPoolsForTesting();
    }
  });

  test('pools are lazy — importing this module opened nothing', async () => {
    await resetPoolsForTesting();
    assert.deepEqual(openPoolRoles(), []);
    const role = testableRoles()[0];
    poolFor(role);
    assert.deepEqual(openPoolRoles(), [role]);
  });

  test('health reporting covers every configured role', async () => {
    const reports = await checkAllConfiguredRoles(testableRoles());
    assert.equal(reports.length, testableRoles().length);
    assert.ok(reports.every((r) => r.healthy), 'at least one configured role is unhealthy');
  });

  test('poolStats reports occupancy for the R-05 connection budget', async () => {
    const role = testableRoles()[0];
    await checkHealth(role);
    const stats = poolStats();
    assert.ok(stats[role], 'no statistics for an open pool');
    assert.ok(stats[role].total >= 1);
  });

  test('closeAllPools is graceful and idempotent, and refuses late checkouts', async () => {
    const role = testableRoles()[0];
    await checkHealth(role);
    assert.ok(openPoolRoles().length > 0);

    await closeAllPools();
    assert.deepEqual(openPoolRoles(), []);

    // Second call is a no-op rather than an error — signal handlers fire twice
    // often enough to matter.
    await closeAllPools();

    // A job started after shutdown would leave an unattributed partial write.
    assert.throws(() => poolFor(role), /shutdown is in progress/);

    await resetPoolsForTesting();
  });
});
