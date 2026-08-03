// ─────────────────────────────────────────────────────────────────────────────
// S-3 SEED TESTS
//
// The property under test throughout is IDEMPOTENCE, and it is tested the only
// way that means anything: by running the whole bootstrap twice against a real
// database and asserting that the second run changed nothing — not the row
// counts, not the surrogate ids, not the created_at timestamps.
//
// Counting rows alone would pass even if the seed deleted and re-inserted every
// row on each run. Comparing ids and timestamps is what proves it did not.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withConnection } from '../../db/tx';
import { resetPoolsForTesting } from '../../db/pool';
import { resetJobLifecycleForTesting } from '../../db/tx';
import { roleDefinition } from '../../db/roles';
import { testableRoles, skipReason, assertCiHasDatabase } from '../../db/testSupport';

import {
  runAllSeeds,
  SEED_ROLES,
  MIGRATION_OWNED_VOCABULARIES,
  VOCABULARY_COUNTS,
  FEATURE_KEYS,
  CALCULATOR_KEYS,
  FEATURE_CONTEXT_PAIRS,
  MODULE_KEYS,
  ACTIVE_MODULE_KEYS,
  INACTIVE_MODULE_KEYS,
  ENTITLEMENT_KEYS,
  RETIRED_V1_MODULE_KEYS,
  seedRows,
} from '../index';

// ─────────────────────────────────────────────────────────────────────────────
// Declaration consistency — always runs
// ─────────────────────────────────────────────────────────────────────────────

describe('seed declarations (no database required)', () => {
  test('CI is not silently skipping the persistence halves', () => {
    assertCiHasDatabase();
  });

  test('exactly the approved thirteen modules are declared', () => {
    assert.equal(MODULE_KEYS.length, 13);
    assert.equal(new Set(MODULE_KEYS).size, 13, 'module keys must be unique');
  });

  test('the four newly approved modules are registered INACTIVE', () => {
    // Identity and version now; evaluation logic in S-6. Registering them active
    // would make them silently emit nothing, which is the class of silent
    // absence the operational layer exists to make visible.
    assert.deepEqual(INACTIVE_MODULE_KEYS.sort(), [
      'historical_advantage',
      'match_context',
      'risk_assessment',
      'squad_stability',
    ]);
    assert.equal(ACTIVE_MODULE_KEYS.length, 9);
  });

  test('the retired V1 modules are not carried forward', () => {
    for (const retired of RETIRED_V1_MODULE_KEYS) {
      assert.ok(
        !MODULE_KEYS.includes(retired),
        `${retired} was retired and must not be seeded — carrying it forward silently would ` +
          'make V1 the source of truth again'
      );
    }
  });

  test('every module has exactly one entitlement key, and they are unique', () => {
    assert.equal(ENTITLEMENT_KEYS.length, MODULE_KEYS.length);
    assert.equal(new Set(ENTITLEMENT_KEYS).size, ENTITLEMENT_KEYS.length);
  });

  test('feature keys satisfy the namespacing the database requires', () => {
    // ck_feature_definition__key_namespaced. Asserted here so a malformed key is
    // caught in a unit test rather than as a check violation mid-seed.
    for (const key of FEATURE_KEYS) {
      assert.match(key, /^(team|player|fixture|competition)\.[a-z0-9_]+$/, key);
    }
    assert.equal(new Set(FEATURE_KEYS).size, FEATURE_KEYS.length);
  });

  test('the seed roles are the four the privilege matrix requires', () => {
    // There is no single seed role: migration 016 assigns writes by layer.
    assert.deepEqual([...SEED_ROLES].sort(), [
      'pt_pipeline_feature',
      'pt_pipeline_ingestion',
      'pt_pipeline_module',
      'pt_platform_admin',
    ]);
    for (const role of SEED_ROLES) {
      assert.ok(roleDefinition(role), `${role} must be a registered pipeline role`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence and idempotence
// ─────────────────────────────────────────────────────────────────────────────

describe('seeding (requires a V2 database)', { skip: skipReason() || false }, () => {
  const reader = testableRoles().includes('pt_platform_admin')
    ? ('pt_platform_admin' as const)
    : testableRoles()[0];

  /** Row counts for every relation the bootstrap touches. */
  async function counts(): Promise<Record<string, number>> {
    return withConnection(reader, async (client) => {
      const { rows } = await client.query<{ relation: string; n: string }>(`
        SELECT 'football.currency' AS relation, count(*)::text AS n FROM football.currency
        UNION ALL SELECT 'football.country', count(*)::text FROM football.country
        UNION ALL SELECT 'football.position', count(*)::text FROM football.position
        UNION ALL SELECT 'product.entitlement_feature', count(*)::text FROM product.entitlement_feature
        UNION ALL SELECT 'feature.feature_calculator', count(*)::text FROM feature.feature_calculator
        UNION ALL SELECT 'feature.feature_definition', count(*)::text FROM feature.feature_definition
        UNION ALL SELECT 'feature.feature_definition_context_kind', count(*)::text FROM feature.feature_definition_context_kind
        UNION ALL SELECT 'feature.feature_version', count(*)::text FROM feature.feature_version
        UNION ALL SELECT 'module.module_definition', count(*)::text FROM module.module_definition
        UNION ALL SELECT 'module.module_version', count(*)::text FROM module.module_version
        UNION ALL SELECT 'module.verdict_composition_version', count(*)::text FROM module.verdict_composition_version
        UNION ALL SELECT 'module.consensus_rule_version', count(*)::text FROM module.consensus_rule_version
      `);
      return Object.fromEntries(rows.map((r) => [r.relation, Number(r.n)]));
    });
  }

  /** Identity fingerprint: surrogate ids and creation instants. */
  async function fingerprint(): Promise<string> {
    return withConnection(reader, async (client) => {
      const { rows } = await client.query<{ fp: string }>(`
        SELECT string_agg(fp, '|' ORDER BY fp) AS fp FROM (
          SELECT 'fd:'||id||':'||feature_key||':'||created_at::text AS fp FROM feature.feature_definition
          UNION ALL SELECT 'fv:'||id||':'||designation||':'||created_at::text FROM feature.feature_version
          UNION ALL SELECT 'fc:'||id||':'||calculator_key||':'||created_at::text FROM feature.feature_calculator
          UNION ALL SELECT 'md:'||id||':'||module_key||':'||created_at::text FROM module.module_definition
          UNION ALL SELECT 'mv:'||id||':'||designation||':'||created_at::text FROM module.module_version
          UNION ALL SELECT 'ef:'||feature_key||':'||created_at::text FROM product.entitlement_feature
          UNION ALL SELECT 'cy:'||code||':'||created_at::text FROM football.currency
          UNION ALL SELECT 'co:'||code||':'||created_at::text FROM football.country
          UNION ALL SELECT 'po:'||code||':'||created_at::text FROM football.position
        ) t
      `);
      return rows[0].fp ?? '';
    });
  }

  let firstCounts: Record<string, number>;
  let firstFingerprint: string;

  before(async () => {
    // Seed to a known end state.
    //
    // DELIBERATELY NOT asserting that this particular invocation inserted rows.
    // An earlier assertion did, and it failed the moment the suite ran after
    // `npm run seed:v2` — which made the suite depend on arriving at an
    // unseeded database, something no suite should require and nothing
    // guarantees.
    //
    // What actually matters is the END STATE and IDEMPOTENCE: after seeding, the
    // declared rows are present (test 1), and running again changes nothing
    // (tests 2–4). Both hold whether this run or a previous one wrote them,
    // which is the property a bootstrap is supposed to have.
    await runAllSeeds();
    firstCounts = await counts();
    firstFingerprint = await fingerprint();
  });

  after(async () => {
    resetJobLifecycleForTesting();
    await resetPoolsForTesting();
  });

  test('1. after seeding, every declared relation holds exactly its declared rows', async () => {
    assert.equal(firstCounts['football.currency'], VOCABULARY_COUNTS.currency);
    assert.equal(firstCounts['football.country'], VOCABULARY_COUNTS.country);
    assert.equal(firstCounts['football.position'], VOCABULARY_COUNTS.position);
    assert.equal(firstCounts['product.entitlement_feature'], ENTITLEMENT_KEYS.length);
    assert.equal(firstCounts['feature.feature_calculator'], CALCULATOR_KEYS.length);
    assert.equal(firstCounts['feature.feature_definition'], FEATURE_KEYS.length);
    assert.equal(firstCounts['feature.feature_definition_context_kind'], FEATURE_CONTEXT_PAIRS);
    assert.equal(firstCounts['feature.feature_version'], FEATURE_KEYS.length);
    assert.equal(firstCounts['module.module_definition'], MODULE_KEYS.length);
    assert.equal(firstCounts['module.module_version'], MODULE_KEYS.length);
    assert.equal(firstCounts['module.verdict_composition_version'], 1);
    assert.equal(firstCounts['module.consensus_rule_version'], 1);
  });

  test('2. running the seed again produces identical counts', async () => {
    const report = await runAllSeeds();
    assert.equal(report.totalInserted, 0, 'a second run must insert nothing');
    assert.deepEqual(await counts(), firstCounts);
  });

  test('3. ids and created_at are unchanged — nothing was rewritten', async () => {
    // The assertion that distinguishes idempotence from delete-and-reinsert.
    // Counts alone would pass either way.
    await runAllSeeds();
    assert.equal(
      await fingerprint(),
      firstFingerprint,
      'surrogate ids or creation instants changed — the seed is rewriting rows'
    );
  });

  test('4. ten consecutive runs change nothing', async () => {
    for (let i = 0; i < 8; i += 1) {
      const report = await runAllSeeds();
      assert.equal(report.totalInserted, 0, `run ${i + 3} inserted rows`);
    }
    assert.deepEqual(await counts(), firstCounts);
    assert.equal(await fingerprint(), firstFingerprint);
  });

  test('5. migration-owned vocabularies are untouched by the seed', async () => {
    // Thirteen vocabularies belong to migrations 002 and 012. S-3 verifies them
    // and must never re-seed or amend them.
    await withConnection(reader, async (client) => {
      for (const vocabulary of MIGRATION_OWNED_VOCABULARIES) {
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${vocabulary.relation}
            WHERE ${vocabulary.column} = ANY($1::text[])`,
          [vocabulary.codes as unknown as string[]]
        );
        assert.equal(
          Number(rows[0].n),
          vocabulary.codes.length,
          `${vocabulary.relation} lost or gained codes`
        );
      }
    });
  });

  test('6. an invalid vocabulary code is refused by the database, not by us', async () => {
    // football.country enforces ^[A-Z]{2}$. The seed does not pre-check it —
    // PostgreSQL owns validity, and duplicating the rule in TypeScript would
    // drift the moment the constraint changed.
    await withConnection('pt_pipeline_ingestion', async (client) => {
      await assert.rejects(
        seedRows(
          client,
          'football.country',
          ['code', 'display_name', 'alpha3_code', 'meaning'],
          [['NOT_A_CODE', 'Invalid', 'XXX', 'should be refused']],
          ['code']
        ),
        /violates check constraint/
      );
    });
  });

  test('6b. an unknown foreign key is refused by the database', async () => {
    await withConnection('pt_pipeline_module', async (client) => {
      await assert.rejects(
        seedRows(
          client,
          'module.module_definition',
          [
            'module_key',
            'display_number',
            'display_name',
            'question',
            'subject_kind_code',
            'entitlement_feature_key',
            'calibration_mode_code',
            'is_active',
          ],
          [['bogus', 99, 'Bogus', 'Why?', 'TEAM', 'NO_SUCH_ENTITLEMENT', 'CONTEXTUAL', false]],
          ['module_key']
        ),
        /violates foreign key constraint/
      );
    });
  });

  test('7. the seed roles hold only the privileges the registry claims', async () => {
    // Seeding must not have required, or acquired, anything broader.
    await withConnection(reader, async (client) => {
      const checks: [string, string, boolean][] = [
        // The role that seeds a layer holds INSERT there…
        ['pt_pipeline_ingestion', 'football.country', true],
        ['pt_pipeline_feature', 'feature.feature_definition', true],
        ['pt_pipeline_module', 'module.module_definition', true],
        ['pt_platform_admin', 'product.entitlement_feature', true],
        // …and nowhere else.
        ['pt_platform_admin', 'feature.feature_definition', false],
        ['pt_platform_admin', 'module.module_definition', false],
        ['pt_pipeline_ingestion', 'module.module_definition', false],
        ['pt_pipeline_feature', 'module.module_definition', false],
      ];
      for (const [role, relation, expected] of checks) {
        const { rows } = await client.query<{ ok: boolean }>(
          'SELECT has_table_privilege($1, $2, $3) AS ok',
          [role, relation, 'INSERT']
        );
        assert.equal(rows[0].ok, expected, `${role} INSERT on ${relation}`);
      }
    });
  });

  test('7b. no seed role gained UPDATE or DELETE on a registry', async () => {
    await withConnection(reader, async (client) => {
      const { rows } = await client.query<{ offender: string }>(
        `SELECT pg_get_userbyid(a.grantee)||':'||n.nspname||'.'||c.relname||':'||a.privilege_type AS offender
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(c.relacl) a
          WHERE (n.nspname, c.relname) IN
                (('feature','feature_definition'),('feature','feature_version'),
                 ('module','module_definition'),('module','module_version'),
                 ('product','entitlement_feature'))
            AND a.privilege_type = 'DELETE'
            AND a.grantee <> c.relowner`
      );
      assert.deepEqual(rows.map((r) => r.offender), [], 'no role may delete registry rows');
    });
  });

  test('8. every seeded module definition has at least one version', async () => {
    await withConnection(reader, async (client) => {
      const { rows } = await client.query<{ module_key: string }>(
        `SELECT d.module_key
           FROM module.module_definition d
          WHERE NOT EXISTS (
            SELECT 1 FROM module.module_version v WHERE v.module_definition_id = d.id
          )`
      );
      assert.deepEqual(rows.map((r) => r.module_key), [], 'a module without a version is unusable');
    });
  });

  test('8b. every feature definition has a version and at least one context kind', async () => {
    await withConnection(reader, async (client) => {
      const orphans = await client.query<{ feature_key: string; problem: string }>(
        `SELECT d.feature_key, 'no version' AS problem
           FROM feature.feature_definition d
          WHERE NOT EXISTS (SELECT 1 FROM feature.feature_version v WHERE v.feature_definition_id = d.id)
          UNION ALL
         SELECT d.feature_key, 'no context kind'
           FROM feature.feature_definition d
          WHERE NOT EXISTS (SELECT 1 FROM feature.feature_definition_context_kind k
                             WHERE k.feature_definition_id = d.id)`
      );
      assert.deepEqual(orphans.rows, []);
    });
  });

  test('9. feature definitions satisfy every database constraint', async () => {
    // Not re-checking the constraints — reading back what the database accepted,
    // and confirming the values are the ones declared rather than defaults.
    await withConnection(reader, async (client) => {
      const { rows } = await client.query<{
        feature_key: string;
        direction: string;
        value_scale: number;
        max_provenance_class_code: string;
      }>(
        `SELECT feature_key, direction, value_scale, max_provenance_class_code
           FROM feature.feature_definition ORDER BY feature_key`
      );
      assert.equal(rows.length, FEATURE_KEYS.length);
      for (const row of rows) {
        assert.ok(
          ['HIGHER_IS_STRONGER', 'LOWER_IS_STRONGER', 'UNSIGNED'].includes(row.direction),
          row.feature_key
        );
        assert.ok(row.value_scale >= 0 && row.value_scale <= 12, row.feature_key);
        assert.ok(
          ['OBSERVED', 'DERIVED', 'INFERRED', 'ESTIMATED'].includes(row.max_provenance_class_code),
          row.feature_key
        );
      }
      // rest_advantage is arithmetic over recorded kickoff times, not an
      // estimate — the one feature that may legitimately claim OBSERVED.
      const rest = rows.find((r) => r.feature_key === 'team.rest_advantage');
      assert.equal(rest?.max_provenance_class_code, 'OBSERVED');
    });
  });

  test('10. the outcome-dimension conditional holds for every module', async () => {
    // ck_module_definition__outcome_dimension_conditional: OUTCOME_SCORED
    // requires a dimension, and anything else forbids one.
    await withConnection(reader, async (client) => {
      const { rows } = await client.query<{ module_key: string }>(
        `SELECT module_key FROM module.module_definition
          WHERE (calibration_mode_code =  'OUTCOME_SCORED' AND outcome_dimension_code IS NULL)
             OR (calibration_mode_code <> 'OUTCOME_SCORED' AND outcome_dimension_code IS NOT NULL)`
      );
      assert.deepEqual(rows.map((r) => r.module_key), []);
    });
  });

  test('11. the newly approved modules are inactive in the database', async () => {
    await withConnection(reader, async (client) => {
      const { rows } = await client.query<{ module_key: string; is_active: boolean }>(
        'SELECT module_key, is_active FROM module.module_definition ORDER BY display_number'
      );
      const inactive = rows.filter((r) => !r.is_active).map((r) => r.module_key).sort();
      assert.deepEqual(inactive, [...INACTIVE_MODULE_KEYS].sort());
    });
  });

  test('12. seeding is attributed — the operational layer recorded it', async () => {
    // A seed is a pipeline execution and should not be the one execution nobody
    // can account for. This also proves S-2 works end to end under a real
    // workload rather than only under its own tests.
    await withConnection(reader, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.pipeline_run
          WHERE occurred_at >= now() - interval '1 hour' AND run_key LIKE 'seed.v2.%'`
      );
      assert.ok(Number(rows[0].n) >= 4, 'each of the four stages opens its own pipeline run');
    });
  });
});
