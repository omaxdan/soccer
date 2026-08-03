// ─────────────────────────────────────────────────────────────────────────────
// ROLE REGISTER AND PERMISSION VERIFICATION
//
// Two halves with different guarantees.
//
// The first needs no database: it checks the register in roles.ts is internally
// consistent and covers the architecture's seven principals. It always runs.
//
// The second connects and asserts the register against pg_class.relacl — the
// grants actually deployed. THIS IS THE HALF THAT MATTERS. roles.ts is
// documentation, and documentation drifts; this test is what makes a drift fail
// a build rather than surface later as a silent denial in production, which is
// the failure class B-03 and B-11 both took.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  PIPELINE_ROLES,
  DESIGN_SCHEMAS,
  ROLE_DEFINITIONS,
  isPipelineRole,
  roleDefinition,
  rolesWithAccessTo,
  expectedModes,
  passwordEnvVar,
  poolMaxEnvVar,
  type AccessMode,
  type DesignSchema,
} from './roles';
import { withConnection } from './tx';
import { resetPoolsForTesting } from './pool';
import { testableRoles, skipReason, assertCiHasDatabase } from './testSupport';

describe('role register (no database required)', () => {
  test('CI is not silently skipping the integration halves', () => {
    assertCiHasDatabase();
  });

  test('exactly the seven principals of §B.7.1 are registered', () => {
    assert.equal(PIPELINE_ROLES.length, 7);
    // pt_owner and pt_migration are deliberately absent — neither is an
    // application principal (see the header of roles.ts).
    assert.ok(!(PIPELINE_ROLES as readonly string[]).includes('pt_owner'));
    assert.ok(!(PIPELINE_ROLES as readonly string[]).includes('pt_migration'));
  });

  test('every role has a definition whose `role` matches its key', () => {
    for (const role of PIPELINE_ROLES) {
      const def = roleDefinition(role);
      assert.equal(def.role, role, `${role} definition is keyed inconsistently`);
      assert.ok(def.purpose.length > 0, `${role} has no purpose`);
      assert.ok(def.envSuffix.length > 0, `${role} has no env suffix`);
    }
  });

  test('env suffixes are unique, so two roles cannot share a secret', () => {
    const suffixes = PIPELINE_ROLES.map((r) => roleDefinition(r).envSuffix);
    assert.equal(new Set(suffixes).size, suffixes.length);
  });

  test('pool maxima are at least 2 wherever attributed runs are expected', () => {
    // withRun() holds a control connection alongside the work connection so the
    // job run survives a rollback. A maximum of 1 self-deadlocks.
    for (const role of PIPELINE_ROLES) {
      assert.ok(
        roleDefinition(role).defaultPoolMax >= 2,
        `${role} has defaultPoolMax < 2, which self-deadlocks in withRun()`
      );
    }
  });

  test('access entries name only design schemas and valid modes', () => {
    const validModes: readonly AccessMode[] = ['S', 'I', 'U', 'D'];
    for (const role of PIPELINE_ROLES) {
      for (const [schema, modes] of Object.entries(roleDefinition(role).access)) {
        assert.ok(
          (DESIGN_SCHEMAS as readonly string[]).includes(schema),
          `${role} names unknown schema '${schema}'`
        );
        for (const mode of modes as readonly AccessMode[]) {
          assert.ok(validModes.includes(mode), `${role}.${schema} has invalid mode '${mode}'`);
        }
      }
    }
  });

  test('relation exceptions are schema-qualified and carry a stated reason', () => {
    for (const role of PIPELINE_ROLES) {
      for (const exception of roleDefinition(role).relationExceptions ?? []) {
        assert.match(
          exception.relation,
          /^[a-z_]+\.[a-z_]+$/,
          `${role} exception '${exception.relation}' is not schema-qualified`
        );
        assert.ok(
          exception.reason.length > 20,
          `${role} exception '${exception.relation}' has no substantive reason`
        );
      }
    }
  });

  test('R-69 — no role is registered with UPDATE or DELETE on snapshot', () => {
    // The single most important line in the register. R-23: sealed content is
    // never modified, by any principal, without exception.
    for (const role of PIPELINE_ROLES) {
      const modes = roleDefinition(role).access.snapshot ?? [];
      assert.ok(!modes.includes('U'), `${role} claims UPDATE on snapshot`);
      assert.ok(!modes.includes('D'), `${role} claims DELETE on snapshot`);
    }
  });

  test('R-22 — only pt_retention is registered with DELETE on thinnable content', () => {
    for (const role of PIPELINE_ROLES) {
      const def = roleDefinition(role);
      for (const schema of ['feature', 'module'] as const) {
        if ((def.access[schema] ?? []).includes('D')) {
          assert.equal(role, 'pt_retention', `${role} claims DELETE on ${schema}`);
        }
      }
    }
  });

  test('R-67 — calibration is not registered to create snapshots', () => {
    const exception = roleDefinition('pt_pipeline_calibration').relationExceptions?.find(
      (e) => e.relation === 'snapshot.match_snapshot'
    );
    assert.ok(exception, 'the R-67 narrowing on match_snapshot is missing');
    assert.ok(!exception.modes.includes('I'), 'calibration must not hold INSERT on match_snapshot');
  });

  test('P-06 — ingestion is not registered to update append-only football relations', () => {
    const def = roleDefinition('pt_pipeline_ingestion');
    for (const relation of [
      'football.standing',
      'football.player_valuation',
      'football.fixture_lifecycle_transition',
    ]) {
      const exception = def.relationExceptions?.find((e) => e.relation === relation);
      assert.ok(exception, `${relation} has no P-06 narrowing`);
      assert.ok(!exception.modes.includes('U'), `${relation} must not permit UPDATE`);
    }
  });

  test('only retention declares a dependency on session state', () => {
    for (const role of PIPELINE_ROLES) {
      assert.equal(
        roleDefinition(role).requiresSessionState,
        role === 'pt_retention',
        `${role} declares session-state dependency inconsistently`
      );
    }
  });

  test('lookup helpers behave', () => {
    assert.ok(isPipelineRole('pt_retention'));
    assert.ok(!isPipelineRole('pt_owner'));
    assert.ok(!isPipelineRole(42));
    assert.throws(() => roleDefinition('nope' as never), /Unknown pipeline role/);
    assert.equal(passwordEnvVar('pt_pipeline_module'), 'PT_V2_DB_PASSWORD_MODULE');
    assert.equal(poolMaxEnvVar('pt_retention'), 'PT_V2_POOL_MAX_RETENTION');
    assert.ok(rolesWithAccessTo('snapshot').includes('pt_pipeline_module'));
    assert.ok(!rolesWithAccessTo('product').includes('pt_pipeline_ingestion'));
  });

  test('expectedModes applies relation narrowing, replacing rather than merging', () => {
    assert.deepEqual(expectedModes('pt_pipeline_ingestion', 'football'), ['S', 'I', 'U']);
    assert.deepEqual(expectedModes('pt_pipeline_ingestion', 'football', 'standing'), ['S', 'I']);
    assert.deepEqual(expectedModes('pt_pipeline_ingestion', 'football', 'team'), ['S', 'I', 'U']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission verification against the deployed grants
// ─────────────────────────────────────────────────────────────────────────────

const MODE_TO_PRIVILEGE: Record<AccessMode, string> = {
  S: 'SELECT',
  I: 'INSERT',
  U: 'UPDATE',
  D: 'DELETE',
};

describe('permission verification (requires a V2 database)', { skip: skipReason() || false }, () => {
  after(async () => {
    await resetPoolsForTesting();
  });

  for (const role of testableRoles()) {
    test(`${role} holds no privilege the register does not claim`, async () => {
      // The direction that matters most. An UNCLAIMED privilege is either a
      // grant nobody reviewed or a register that has fallen behind — both are
      // the drift PR-02 places privilege ahead of guards to prevent.
      const { rows } = await withConnection(role, (client) =>
        client.query<{ schema: string; relation: string; privilege: string }>(
          `SELECT ns.nspname AS schema, c.relname AS relation, a.privilege_type AS privilege
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
             CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
            WHERE c.relkind IN ('r','p')
              AND NOT c.relispartition
              AND ns.nspname = ANY($1::text[])
              AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
              AND pg_catalog.pg_get_userbyid(a.grantee) = $2`,
          [DESIGN_SCHEMAS as unknown as string[], role]
        )
      );

      const unexpected = rows.filter((row) => {
        const modes = expectedModes(role, row.schema as DesignSchema, row.relation);
        return !modes.some((m) => MODE_TO_PRIVILEGE[m] === row.privilege);
      });

      assert.deepEqual(
        unexpected.map((r) => `${r.schema}.${r.relation}:${r.privilege}`),
        [],
        `${role} holds privileges the register does not claim — update roles.ts or revoke them`
      );
    });

    test(`${role} actually holds every schema-level privilege the register claims`, async () => {
      const missing: string[] = [];
      await withConnection(role, async (client) => {
        for (const [schema, modes] of Object.entries(roleDefinition(role).access)) {
          for (const mode of modes as readonly AccessMode[]) {
            const { rows } = await client.query<{ n: string }>(
              `SELECT count(*)::text AS n
                 FROM pg_catalog.pg_class c
                 JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
                WHERE c.relkind IN ('r','p') AND NOT c.relispartition
                  AND ns.nspname = $1
                  AND has_table_privilege($2, c.oid, $3)`,
              [schema, role, MODE_TO_PRIVILEGE[mode]]
            );
            if (Number(rows[0].n) === 0) missing.push(`${schema}:${MODE_TO_PRIVILEGE[mode]}`);
          }
        }
      });
      assert.deepEqual(missing, [], `${role} is missing claimed privileges`);
    });
  }

  test('R-69 holds in the database, not only in the register', async () => {
    const [role] = testableRoles();
    const { rows } = await withConnection(role, (client) =>
      client.query<{ offender: string }>(
        `SELECT format('%s on snapshot.%s to %s',
                       a.privilege_type, c.relname, pg_catalog.pg_get_userbyid(a.grantee)) AS offender
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
          WHERE ns.nspname = 'snapshot'
            AND a.privilege_type IN ('UPDATE','DELETE')
            AND a.grantee <> c.relowner`
      )
    );
    assert.deepEqual(rows.map((r) => r.offender), [], 'sealed content is modifiable');
  });

  test('R-22 holds in the database — DELETE on thinnable content is retention only', async () => {
    const [role] = testableRoles();
    const { rows } = await withConnection(role, (client) =>
      client.query<{ holder: string }>(
        `SELECT DISTINCT pg_catalog.pg_get_userbyid(a.grantee) AS holder
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
          WHERE ns.nspname IN ('feature','module')
            AND a.privilege_type = 'DELETE'
            AND a.grantee <> c.relowner`
      )
    );
    assert.deepEqual(rows.map((r) => r.holder), ['pt_retention']);
  });

  test('the database agrees with itself — both conformance assertions pass', async () => {
    // Migration 016 and 018 install these and Phase 6.1 §14.4 verified they
    // raise on a deliberate breach. Running them here means a connection-layer
    // test run also proves the deployment is intact.
    //
    // MUST run as pt_platform_admin, for two reasons discovered by running it as
    // something else: migration 016 grants EXECUTE on
    // fn_assert_access_correspondence to that role alone, and the function's
    // `format('%I.%I', …)::regclass` cast needs USAGE on all seven schemas,
    // which only the administrative role holds.
    const role = 'pt_platform_admin' as const;
    if (!testableRoles().includes(role)) return;
    await withConnection(role, async (client) => {
      const posture = await client.query<{ r: number }>(
        'SELECT operations.fn_assert_security_posture() AS r'
      );
      assert.equal(Number(posture.rows[0].r), 0);
      const access = await client.query<{ r: number }>(
        'SELECT operations.fn_assert_access_correspondence() AS r'
      );
      assert.equal(Number(access.rows[0].r), 0);
    });
  });
});
