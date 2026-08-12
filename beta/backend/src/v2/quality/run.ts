// ─────────────────────────────────────────────────────────────────────────────
// S-12 — QUALITY ASSERTIONS: EXECUTE THE REGISTERED CHECKS, RECORD THE RESULTS
//
// Doc 15 §3.12: "Seventeen registered checks in operations.quality_check,
// results to quality_assertion_result. […] The application schedules them and
// records results; IT DOES NOT REIMPLEMENT THEM."
//
// That last clause governs this file. Nothing here re-derives an assertion the
// database already expresses; `fn_assert_security_posture` and
// `fn_assert_access_correspondence` are called, not copied.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY RECORDING IS THE POINT
//
// Migration 012 on `quality_assertion_result`: "PERMANENT (§B.9.4) so
// degradation is visible as a TREND rather than an isolated event. The previous
// platform had verification logic that PRINTED AND EXITED — valuable logic whose
// output was not retained, so verification was a manual act rather than a
// monitorable trend."
//
// `feature/verify.ts` is, today, exactly that: four working controls that print
// and exit. This module is what retains them.
//
// ─────────────────────────────────────────────────────────────────────────────
// NINE OF SEVENTEEN HAVE NO IMPLEMENTATION, AND NO ROW IS WRITTEN FOR THEM
//
// `quality_assertion_result.passed` is `boolean NOT NULL`. There is no "not
// run" state and this module does not invent one:
//
//   passed = false  would report a FAILURE where there is an ABSENCE
//   passed = true   would report an assertion nobody made
//
// So an unimplemented check produces NO ROW and is reported as a coverage gap.
// Absence of a result is the honest representation of absence of a check, and
// it is exactly the posture the standings stage takes toward a missing variant.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE FUNCTION, THREE ASSERTIONS, AND WHY A FAILURE STOPS THE OTHER TWO
//
// `fn_assert_security_posture` RAISES on the first breach it finds and checks
// four things in sequence, spanning three registered keys. So:
//
//   it returns          → every assertion in it held. All three keys pass.
//   it raises           → the breach is attributed to ONE key by its message,
//                         and the assertions AFTER it never ran. Those keys get
//                         no row, because "not evaluated" is not "passed".
//
// Recording the unreached ones as passing would be the most damaging thing this
// module could do: a green result for an assertion that never executed.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { withConnection } from '../db/tx';
import { runVerification, VERIFICATIONS, type VerificationKey } from '../feature/verify';
import { logger } from '../../utils/logger';

/**
 * The one principal this runs as.
 *
 * `pt_platform_admin` is the ONLY role granted EXECUTE on either assertion
 * function (migration 016 and 018, verified against `pg_proc.proacl`), and the
 * only one with SELECT across every design schema — which four of the checks
 * need. `feature/verify.ts` already uses it for the same reason.
 *
 * ⚠ FINDING Q-1, and it is finding S3-1 in a second place. Migration 016 grants
 * `pt_platform_admin` only `S` on schema `operations`, so the role that is the
 * only one permitted to EXECUTE these assertions is NOT permitted to RECORD
 * their results. Under the single-login deployment the label carries no
 * privilege and this runs; under a credential-separated one the INSERT is
 * refused with 42501. `runAll.ts` already records the same defect costing the
 * entitlement stage its attribution — here it would cost the deliverable
 * itself. The remedy is a grant, which is a change to the F-09 privilege
 * posture and is NOT taken here. See doc 53.
 */
export const QUALITY_ROLE = 'pt_platform_admin' as const;

/** The designation results are attributed to until an assertion is revised. */
const DESIGNATION = '1.0.0' as const;

/**
 * Which registered key each executable assertion answers.
 *
 * `fn_assert_security_posture` covers three keys in one call; the order matches
 * the order of the RAISE statements inside it, which is what makes attributing a
 * failure — and refusing to attribute a pass to an unreached assertion —
 * possible at all.
 */
const SECURITY_POSTURE_SEQUENCE = [
  {
    key: 'rls_enabled_and_forced',
    /** The RAISE this step emits, matched to attribute a failure to this key. */
    signature: /row-level security is not enabled and forced/i,
  },
  {
    key: 'snapshot_no_modification_privilege',
    // Two RAISEs, one key: the registered assertion covers modification
    // privilege AND default privileges — "and no default privileges are
    // configured there" — so both belong here.
    signature: /sealed content is modifiable|default privileges are configured on schema snapshot/i,
  },
  {
    key: 'retention_delete_privilege',
    signature: /DELETE on thinnable content is held outside the retention role/i,
  },
] as const;

const ACCESS_CORRESPONDENCE_KEY = 'privilege_policy_correspondence' as const;

/** Every key this module can actually evaluate today. */
export const IMPLEMENTED_KEYS: readonly string[] = [
  ...SECURITY_POSTURE_SEQUENCE.map((step) => step.key),
  ACCESS_CORRESPONDENCE_KEY,
  ...VERIFICATIONS,
];

export interface AssertionOutcome {
  readonly key: string;
  readonly passed: boolean;
  /** Free text recorded on the result. Null when the assertion passed cleanly. */
  readonly detail: string | null;
  /** What the assertion measured, when it produces a figure. */
  readonly observedValue: string | null;
  /** Where the implementation lives, for the report. */
  readonly implementation: 'DATABASE' | 'APPLICATION_TEMPORARY';
}

export interface QualityRunReport {
  /** Assertions that ran and produced a result row. */
  readonly evaluated: readonly AssertionOutcome[];
  /** Registered, implemented, but NOT reached because an earlier step raised. */
  readonly unreached: readonly string[];
  /** Registered with no implementation at all (S5-2). No row is written. */
  readonly unimplemented: readonly string[];
  /** Result rows persisted. Fewer than `evaluated` only if recording failed. */
  readonly recorded: number;
  /** True when every assertion that ran passed. Says nothing about coverage. */
  readonly allPassed: boolean;
}

/** A registered check, as the database holds it. */
interface RegisteredCheck {
  readonly quality_check_key: string;
  readonly severity: string;
}

/**
 * Calls one assertion function, turning its RAISE into a result.
 *
 * These functions assert rather than report: they return 0 or throw. A throw is
 * a FINDING, not a runner failure, which is why it is caught here and recorded —
 * a quality run that aborted on the first breach would tell an operator less
 * than one that reports every assertion it managed to evaluate.
 */
export async function callAssertion(
  tx: Pick<PoolClient, 'query'>,
  fn: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await tx.query(`SELECT ${fn}()`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A permission failure is NOT an assertion failure. Recording it as one
    // would report the platform as insecure because the runner could not look.
    const code = (error as { code?: string }).code;
    if (code === '42501' || code === '42883') {
      throw new Error(
        `${fn} could not be executed as ${QUALITY_ROLE} (SQLSTATE ${code}): ${message}. ` +
          'This is a privilege or deployment fault, not a quality finding, and is ' +
          'deliberately not recorded as a failed assertion.'
      );
    }
    return { ok: false, message };
  }
}

/**
 * Runs the three assertions inside `fn_assert_security_posture`.
 *
 * Returns outcomes for the keys that were REACHED. A key after the failing one
 * is returned as unreached and gets no row.
 */
function attributeSecurityPosture(
  result: { ok: true } | { ok: false; message: string }
): { outcomes: AssertionOutcome[]; unreached: string[] } {
  if (result.ok) {
    return {
      outcomes: SECURITY_POSTURE_SEQUENCE.map((step) => ({
        key: step.key,
        passed: true,
        detail: null,
        observedValue: '0',
        implementation: 'DATABASE' as const,
      })),
      unreached: [],
    };
  }

  const index = SECURITY_POSTURE_SEQUENCE.findIndex((step) => step.signature.test(result.message));
  if (index === -1) {
    // An unrecognised message. Attributing it to a key by guesswork would file a
    // real breach against the wrong assertion, so it is attributed to none of
    // them and every key is reported unreached with the message preserved.
    logger.error(
      { message: result.message },
      'v2 quality: fn_assert_security_posture raised a message this runner cannot attribute'
    );
    return { outcomes: [], unreached: SECURITY_POSTURE_SEQUENCE.map((step) => step.key) };
  }

  return {
    // Everything BEFORE the failure ran and held; the failure itself is recorded;
    // everything after it never executed.
    outcomes: [
      ...SECURITY_POSTURE_SEQUENCE.slice(0, index).map((step) => ({
        key: step.key,
        passed: true,
        detail: null,
        observedValue: '0',
        implementation: 'DATABASE' as const,
      })),
      {
        key: SECURITY_POSTURE_SEQUENCE[index].key,
        passed: false,
        detail: result.message,
        observedValue: null,
        implementation: 'DATABASE' as const,
      },
    ],
    unreached: SECURITY_POSTURE_SEQUENCE.slice(index + 1).map((step) => step.key),
  };
}

/** Runs the four temporary application controls, without reimplementing them. */
async function runApplicationControls(tx: PoolClient): Promise<AssertionOutcome[]> {
  const outcomes: AssertionOutcome[] = [];
  for (const key of VERIFICATIONS as readonly VerificationKey[]) {
    const result = await runVerification(tx, key);
    outcomes.push({
      key,
      passed: result.passed,
      detail: result.passed
        ? null
        : `${result.violations} violation(s). Examples: ${result.examples.join('; ')}`,
      observedValue: String(result.violations),
      implementation: 'APPLICATION_TEMPORARY',
    });
  }
  return outcomes;
}

/**
 * Refuses to start unless every assertion about to run can be recorded.
 *
 * `recordResult` resolves both foreign keys with a join, and a join that matches
 * nothing INSERTS NOTHING AND RAISES NOTHING. Checking afterwards would still
 * leave a run that evaluated eight assertions and filed none of them; checking
 * first means the run either records what it finds or does not start.
 *
 * The seed (`seed/qualityRegistry.ts`) is what satisfies this. If it has never
 * run, this is the message that says so.
 */
export async function assertVersionsRegistered(
  tx: PoolClient,
  keys: readonly string[],
  designation: string = DESIGNATION
): Promise<void> {
  const { rows } = await tx.query<{ quality_check_key: string }>(
    `SELECT k.quality_check_key
       FROM unnest($1::text[]) AS k(quality_check_key)
      WHERE NOT EXISTS (
        SELECT 1 FROM operations.quality_check_version v
         WHERE v.quality_check_key = k.quality_check_key AND v.designation = $2)
      ORDER BY 1`,
    [keys, designation]
  );
  if (rows.length > 0) {
    throw new Error(
      `operations.quality_check_version has no ${designation} row for: ` +
        `${rows.map((row) => row.quality_check_key).join(', ')}. ` +
        'quality_assertion_result.quality_check_version_id is NOT NULL, so no result ' +
        'could be recorded. Run the S-3 seed (seed:v2) before the quality run.'
    );
  }
}

/**
 * Persists one result.
 *
 * `pipeline_job_run_id` is left null deliberately: it is NULLABLE on this
 * relation, and a quality run is not a pipeline job. Attributing it to one would
 * misstate what produced the result.
 *
 * THE ROW COUNT IS CHECKED. Both foreign keys are resolved by join, so an
 * unregistered key or a missing version writes nothing and reports success — the
 * precise shape of silent failure this subsystem exists to detect in others.
 */
export async function recordResult(
  tx: PoolClient,
  outcome: AssertionOutcome,
  designation: string = DESIGNATION
): Promise<void> {
  const { rowCount } = await tx.query(
    `INSERT INTO operations.quality_assertion_result
       (quality_check_id, quality_check_version_id, passed, observed_value, detail)
     SELECT c.id, v.id, $2, $3, $4
       FROM operations.quality_check c
       JOIN operations.quality_check_version v
         ON v.quality_check_key = c.quality_check_key AND v.designation = $5
      WHERE c.quality_check_key = $1`,
    [outcome.key, outcome.passed, outcome.observedValue, outcome.detail, designation]
  );
  if (rowCount !== 1) {
    throw new Error(
      `recording '${outcome.key}' at ${designation} wrote ${rowCount ?? 0} rows, not 1. ` +
        'Either the check is not registered in operations.quality_check or its version ' +
        'is missing. The assertion ran; its result is NOT on the record.'
    );
  }
}

/**
 * Executes every implemented assertion and records what it finds.
 *
 * ONE CONNECTION, NO TRANSACTION AROUND THE WHOLE RUN. Each result is a
 * statement about something that already happened; wrapping the run would mean a
 * later assertion's failure discarded the earlier ones' findings, which is the
 * opposite of what a permanent trend record is for.
 */
export async function runQualityAssertions(): Promise<QualityRunReport> {
  return withConnection(QUALITY_ROLE, async (tx) => {
    const { rows: registered } = await tx.query<RegisteredCheck>(
      `SELECT quality_check_key, severity FROM operations.quality_check
        WHERE is_active ORDER BY quality_check_key`
    );

    // BEFORE ANY ASSERTION RUNS. An evaluation whose result cannot be filed is
    // worse than one that never happened: it looks like coverage.
    await assertVersionsRegistered(tx, IMPLEMENTED_KEYS);

    const posture = attributeSecurityPosture(
      await callAssertion(tx, 'operations.fn_assert_security_posture')
    );

    const correspondence = await callAssertion(tx, 'operations.fn_assert_access_correspondence');
    const evaluated: AssertionOutcome[] = [
      ...posture.outcomes,
      {
        key: ACCESS_CORRESPONDENCE_KEY,
        passed: correspondence.ok,
        detail: correspondence.ok ? null : correspondence.message,
        observedValue: correspondence.ok ? '0' : null,
        implementation: 'DATABASE',
      },
      ...(await runApplicationControls(tx)),
    ];

    const evaluatedKeys = new Set(evaluated.map((outcome) => outcome.key));
    const unimplemented = registered
      .map((check) => check.quality_check_key)
      .filter((key) => !IMPLEMENTED_KEYS.includes(key));

    let recorded = 0;
    for (const outcome of evaluated) {
      // A recording failure must be LOUD. For every other subsystem telemetry is
      // a by-product and swallowing a failure is right; here the result IS the
      // deliverable, and a run that silently recorded nothing would look
      // identical to a clean one.
      await recordResult(tx, outcome);
      recorded += 1;
    }

    const report: QualityRunReport = {
      evaluated,
      unreached: posture.unreached,
      unimplemented,
      recorded,
      allPassed: evaluated.every((outcome) => outcome.passed),
    };

    logger.info(
      {
        registered: registered.length,
        evaluated: evaluated.length,
        failed: evaluated.filter((outcome) => !outcome.passed).map((outcome) => outcome.key),
        unreached: report.unreached,
        unimplemented: report.unimplemented.length,
        recorded,
      },
      'v2 quality: assertion run complete'
    );

    // Coverage is not a pass. An operator reading "all passed" must also be able
    // to read "…of the eight that exist", which is why this is logged separately
    // and at warning level rather than folded into the summary above.
    if (unimplemented.length > 0) {
      logger.warn(
        { unimplemented, evaluated: evaluated.length, registered: registered.length },
        'v2 quality: registered assertions with NO implementation — no result recorded for these (S5-2)'
      );
    }
    if (evaluatedKeys.size !== evaluated.length) {
      logger.error({ evaluated: [...evaluatedKeys] }, 'v2 quality: duplicate key in one run');
    }

    return report;
  });
}
