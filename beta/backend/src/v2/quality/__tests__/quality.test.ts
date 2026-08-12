// ─────────────────────────────────────────────────────────────────────────────
// S-12 — QUALITY ASSERTIONS
//
// Doc 15 §3.12 states the testing standard for this subsystem in one line:
// "Each check detects a deliberately introduced violation." Tests 9 and 10 are
// that standard applied to the two assertions this runner can actually reach —
// a breach is introduced against the real database, the runner is asked, and the
// result must name it.
//
// The registry half matters just as much and is easier to get wrong quietly:
// with `operations.quality_check_version` empty, EVERY result insert fails on a
// NOT NULL foreign key, and a runner that swallowed that would report a clean
// pass having written nothing. Test 6 is the tripwire.
// ─────────────────────────────────────────────────────────────────────────────

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

import {
  assertVersionsRegistered,
  callAssertion,
  IMPLEMENTED_KEYS,
  QUALITY_ROLE,
  recordResult,
  runQualityAssertions,
} from '../run';
import { initialRationale, INITIAL_DESIGNATION, seedQualityCheckVersions } from '../../seed/qualityRegistry';
import { roleDefinition } from '../../db/roles';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

// ─────────────────────────────────────────────────────────────────────────────
// Declaration — no database
// ─────────────────────────────────────────────────────────────────────────────

describe('S-12 · what the runner claims to cover', () => {
  it('1. names exactly the eight assertions that have an implementation', () => {
    // The number is the point. Seventeen are registered and nine have no code
    // (S5-2); if this list ever grows without an implementation arriving, a
    // check would be reported as evaluated while doing nothing.
    assert.deepEqual([...IMPLEMENTED_KEYS].sort(), [
      'feature_dependency_acyclic',
      'feature_scale_conformance',
      'orphan_absence',
      'privilege_policy_correspondence',
      'provenance_propagation',
      'retention_delete_privilege',
      'rls_enabled_and_forced',
      'snapshot_no_modification_privilege',
    ]);
  });

  it('2. runs as the one role permitted to execute the assertions', () => {
    assert.equal(QUALITY_ROLE, 'pt_platform_admin');
  });

  it('3. FINDING Q-1 — that role cannot record what it is the only role able to run', () => {
    // Not a wish: the access register records it, and migration 016 grants
    // pt_platform_admin 'S' on operations and nothing more. This test exists so
    // the finding cannot be quietly forgotten — when the grant lands, it fails
    // and doc 53's Q-1 must be closed with it.
    const operations = roleDefinition(QUALITY_ROLE).access.operations ?? [];
    assert.ok(operations.includes('S'), 'it must be able to read its own registry');
    assert.ok(
      !operations.includes('I'),
      'Q-1: if pt_platform_admin now holds INSERT on operations, the grant landed — ' +
        'close Q-1 in doc 53 and delete this assertion'
    );
  });

  it('3a. STRUCTURAL — a recording failure is never absorbed', () => {
    // Every behavioural assertion below would still pass if the record call were
    // wrapped in a try/catch: under a healthy database it never throws, so the
    // absorption would be invisible until the one run that mattered. For every
    // other subsystem swallowing a telemetry failure is correct; here the result
    // IS the deliverable, and a run that recorded nothing must not look clean.
    const source = readFileSync(resolve(__dirname, '..', 'run.ts'), 'utf8');
    const loop = source.match(/for \(const outcome of evaluated\) \{[\s\S]*?\n    \}/);
    assert.ok(loop, 'the recording loop must exist');
    assert.match(loop[0], /await recordResult\(tx, outcome\);/);
    assert.ok(
      !/\btry\b|\bcatch\b/.test(loop[0]),
      `a recording failure must propagate, not be absorbed:\n${loop[0]}`
    );
  });

  it('3b. a permission failure is NOT recorded as a failed assertion', async () => {
    // The distinction the platform's credibility rests on: "the assertion found
    // a breach" and "the runner was not allowed to look" are different facts,
    // and reporting the second as the first would declare the platform insecure
    // because of a missing GRANT.
    const refusing = (code: string) => ({
      query: async () => {
        throw Object.assign(new Error(`permission denied for function ${code}`), { code });
      },
    });

    for (const code of ['42501', '42883']) {
      await assert.rejects(
        () => callAssertion(refusing(code), 'operations.fn_assert_security_posture'),
        new RegExp(`could not be executed[\\s\\S]*${code}[\\s\\S]*not a quality finding`),
        `SQLSTATE ${code} must abort rather than be recorded`
      );
    }

    // A genuine assertion breach still comes back as a result, not a throw.
    const breaching = {
      query: async () => {
        throw Object.assign(new Error('row-level security is not enabled and forced on: x.y'), {
          code: 'P0001',
        });
      },
    };
    const result = await callAssertion(breaching, 'operations.fn_assert_security_posture');
    assert.equal(result.ok, false);
  });

  it('4. the rationale quotes the assertion it versions', () => {
    // A version row whose rationale did not state the wording would defeat the
    // purpose the relation exists for (LC-169): telling a changed assertion
    // apart from changed data.
    const text = initialRationale({
      quality_check_key: 'rls_enabled_and_forced',
      assertion_text: 'Row-level security is enabled AND forced on every relation.',
    });
    assert.match(text, /"Row-level security is enabled AND forced on every relation\."/);
    assert.match(text, /LC-169/);
    assert.match(text, /not\s+that an implementation exists/);
    assert.equal(INITIAL_DESIGNATION, '1.0.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

describe('S-12 persistence (requires a V2 database)', { skip: !hasDatabase }, () => {
  after(async () => {
    await closeAllPools();
  });

  const asAdmin = <T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> =>
    withConnection(QUALITY_ROLE, fn);

  const scalar = async (tx: PoolClient, sql: string, params: unknown[] = []): Promise<string> => {
    const { rows } = await tx.query<{ v: string }>(sql, params);
    return rows[0].v;
  };

  it('5. every registered check has a version, and the seed is idempotent', async () => {
    await asAdmin(async (tx) => {
      await seedQualityCheckVersions(tx);
      const registered = await scalar(
        tx,
        `SELECT count(*)::text AS v FROM operations.quality_check`
      );
      const versioned = await scalar(
        tx,
        `SELECT count(*)::text AS v FROM operations.quality_check_version WHERE designation = $1`,
        [INITIAL_DESIGNATION]
      );
      assert.equal(versioned, registered, 'one version per registered assertion');
      assert.equal(Number(registered), 17, 'migration 018 registers seventeen');

      const again = await seedQualityCheckVersions(tx);
      assert.equal(again[0].inserted, 0, 'a re-run writes nothing');
      assert.equal(again[0].skipped, Number(registered));
    });
  });

  it('6. THE TRIPWIRE — a result cannot be recorded without a version', async () => {
    // With the registry empty every insert fails on quality_check_version_id.
    // This proves the failure is real rather than theoretical, so nobody removes
    // the seed stage believing it decorative.
    await asAdmin(async (tx) => {
      await tx.query('BEGIN');
      try {
        await assert.rejects(
          tx.query(
            `INSERT INTO operations.quality_assertion_result
               (quality_check_id, quality_check_version_id, passed)
             SELECT c.id, NULL, true FROM operations.quality_check c LIMIT 1`
          ),
          (error: Error & { code?: string }) => {
            assert.equal(error.code, '23502', 'quality_check_version_id is NOT NULL');
            return true;
          }
        );
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('7. a run evaluates the eight, records them, and reports the nine it cannot', async () => {
    await asAdmin(seedQualityCheckVersions);
    const before = Number(
      await asAdmin((tx) =>
        scalar(tx, `SELECT count(*)::text AS v FROM operations.quality_assertion_result`)
      )
    );

    const report = await runQualityAssertions();

    assert.equal(report.evaluated.length + report.unreached.length, IMPLEMENTED_KEYS.length);
    assert.equal(report.unimplemented.length, 9, 'seventeen registered, eight implemented');
    assert.ok(
      !report.unimplemented.some((key) => IMPLEMENTED_KEYS.includes(key)),
      'nothing is both implemented and unimplemented'
    );

    const after = Number(
      await asAdmin((tx) =>
        scalar(tx, `SELECT count(*)::text AS v FROM operations.quality_assertion_result`)
      )
    );
    assert.equal(after - before, report.recorded, 'the report matches the ledger');
    assert.equal(report.recorded, report.evaluated.length, 'everything evaluated was recorded');
  });

  it('8. NO ROW is written for an assertion that has no implementation', async () => {
    // The honesty assertion. `passed` is NOT NULL, so an unimplemented check can
    // only be recorded as a pass or a failure, and both would be false.
    await asAdmin(seedQualityCheckVersions);
    const report = await runQualityAssertions();
    await asAdmin(async (tx) => {
      for (const key of report.unimplemented) {
        const n = await scalar(
          tx,
          `SELECT count(*)::text AS v
             FROM operations.quality_assertion_result r
             JOIN operations.quality_check c ON c.id = r.quality_check_id
            WHERE c.quality_check_key = $1`,
          [key]
        );
        assert.equal(n, '0', `${key} has no implementation and must have no result`);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Doc 15 §3.12: "Each check detects a deliberately introduced violation."
  // ───────────────────────────────────────────────────────────────────────────

  it('9. a deliberately introduced RLS breach is DETECTED and attributed', async () => {
    await asAdmin(seedQualityCheckVersions);

    const clean = await runQualityAssertions();
    const rls = clean.evaluated.find((o) => o.key === 'rls_enabled_and_forced');
    assert.ok(rls, 'the assertion must have been reached');
    assert.equal(rls.passed, true, 'the scratch database starts conformant');

    // The breach: turn FORCE off on one relation. Restored in `finally`.
    await asAdmin((tx) => tx.query('ALTER TABLE football.team NO FORCE ROW LEVEL SECURITY'));
    try {
      const breached = await runQualityAssertions();
      const found = breached.evaluated.find((o) => o.key === 'rls_enabled_and_forced');
      assert.ok(found, 'the breached assertion must still be reached');
      assert.equal(found.passed, false, 'the breach must be DETECTED');
      assert.match(found.detail ?? '', /football\.team/, 'and must name the offending relation');

      // The whole point of the sequence logic: the two assertions AFTER this one
      // never executed, so they must carry no result rather than a false pass.
      assert.deepEqual(breached.unreached, [
        'snapshot_no_modification_privilege',
        'retention_delete_privilege',
      ]);
      assert.ok(
        !breached.evaluated.some((o) => breached.unreached.includes(o.key)),
        'an assertion that did not run must not appear as evaluated'
      );
      assert.equal(breached.allPassed, false);
    } finally {
      await asAdmin((tx) => tx.query('ALTER TABLE football.team FORCE ROW LEVEL SECURITY'));
    }

    const restored = await runQualityAssertions();
    assert.equal(
      restored.evaluated.find((o) => o.key === 'rls_enabled_and_forced')?.passed,
      true,
      'and it passes again once the breach is repaired'
    );
  });

  it('10. the failure is PERMANENT — the breach is still readable afterwards', async () => {
    // E9.08's reason for the relation existing: "degradation is visible as a
    // TREND rather than an isolated event". Test 9 repaired the breach; the
    // record of it must survive that repair.
    await asAdmin(async (tx) => {
      const n = await scalar(
        tx,
        `SELECT count(*)::text AS v
           FROM operations.quality_assertion_result r
           JOIN operations.quality_check c ON c.id = r.quality_check_id
          WHERE c.quality_check_key = 'rls_enabled_and_forced' AND NOT r.passed`
      );
      assert.ok(Number(n) >= 1, 'the failed assertion is still on the record');

      const detail = await scalar(
        tx,
        `SELECT r.detail AS v
           FROM operations.quality_assertion_result r
           JOIN operations.quality_check c ON c.id = r.quality_check_id
          WHERE c.quality_check_key = 'rls_enabled_and_forced' AND NOT r.passed
          ORDER BY r.occurred_at DESC LIMIT 1`
      );
      assert.match(detail, /football\.team/, 'and it still names what was wrong');
    });
  });

  it('11. a missing version STOPS the run instead of evaluating into a void', async () => {
    // The precondition exists because both foreign keys are resolved by join,
    // and a join that matches nothing inserts nothing and raises nothing. A run
    // that evaluated eight assertions and filed none of them would look like
    // coverage. `9.9.9` is registered for no check, so it stands in for "the
    // seed has never run" without disturbing the registry.
    await asAdmin(async (tx) => {
      await assert.rejects(
        () => assertVersionsRegistered(tx, ['rls_enabled_and_forced'], '9.9.9'),
        /has no 9\.9\.9 row for: rls_enabled_and_forced[\s\S]*seed/
      );
      // And the version that IS registered passes the same check.
      await assertVersionsRegistered(tx, ['rls_enabled_and_forced']);
    });
  });

  it('12. recording that writes no row THROWS rather than counting a success', async () => {
    await asAdmin(async (tx) => {
      await tx.query('BEGIN');
      try {
        const outcome = {
          key: 'rls_enabled_and_forced',
          passed: true,
          detail: null,
          observedValue: '0',
          implementation: 'DATABASE' as const,
        };
        // A designation no version carries: the join matches nothing.
        await assert.rejects(
          () => recordResult(tx, outcome, '9.9.9'),
          /wrote 0 rows, not 1[\s\S]*result is NOT on the record/
        );
        // The same outcome at the real designation writes exactly one.
        await recordResult(tx, outcome);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('13. every recorded result cites the version in force', async () => {
    await asAdmin(async (tx) => {
      const orphans = await scalar(
        tx,
        `SELECT count(*)::text AS v
           FROM operations.quality_assertion_result r
           JOIN operations.quality_check c ON c.id = r.quality_check_id
           JOIN operations.quality_check_version v ON v.id = r.quality_check_version_id
          WHERE v.quality_check_key <> c.quality_check_key`
      );
      assert.equal(orphans, '0', 'a result must cite the version OF ITS OWN assertion');
    });
  });
});
