// ─────────────────────────────────────────────────────────────────────────────
// ⚠ TEMPORARY IMPLEMENTATION CONTROLS — REMOVE WHEN THE DATABASE ENFORCES THESE
//
// `operations.quality_check` registers fourteen assertions. Only two have
// executable implementations — `fn_assert_access_correspondence` and
// `fn_assert_security_posture`, both covering security posture. The other twelve
// are DECLARATIONS OF INTENT WITH NO CODE BEHIND THEM (finding S5-2), verified
// by enumerating `pg_proc` in schema `operations`.
//
// Four of them bear on S-5, and this module stands in for those four until the
// database-side assertions exist. EVERY COMMAND HERE IS TEMPORARY. Each carries
// that statement in its own documentation, and the whole module should be
// deleted — not extended — when the corresponding assertion is implemented.
//
// ─────────────────────────────────────────────────────────────────────────────
// THESE DO NOT DUPLICATE DATABASE CONSTRAINTS
//
// Each covers a rule the schema does NOT enforce, which is the only reason any
// of them is permitted to exist:
//
//   feature_scale_conformance   value_scale "cannot be enforced on the value
//                               column by CHECK, because a check constraint may
//                               not reference another relation" — the design
//                               names it a residual enforcement point
//   provenance_propagation      the A.12 trigger cannot fire (S5-1), so there is
//                               no database rule to duplicate
//   feature_dependency_acyclic  LC-44 is "validated, not triggered", and the
//                               validation does not exist
//   orphan_absence              no constraint expresses "retired definition";
//                               `is_active` is a flag, not a reference
//
// Nothing here re-checks a foreign key, the subject-exclusivity check, the
// context obligation, the version/definition binding or sample non-negativity.
// PostgreSQL owns those, and a violation must surface as a named constraint
// failure rather than as a finding from a script.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY, AS pt_platform_admin
//
// Two of the checks span `feature` and `football`, and the administrative role
// is the one principal with SELECT across every design schema. It holds no
// INSERT on `feature`, so this module could not write even by mistake.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { withConnection } from '../db/tx';
import { loadRegistry } from './registry/load';
import { findFeatureCycle } from './registry/order';

/** The role every verification runs as. Read breadth, no write capability. */
const VERIFY_ROLE = 'pt_platform_admin' as const;

export type VerificationKey =
  | 'feature_scale_conformance'
  | 'provenance_propagation'
  | 'feature_dependency_acyclic'
  | 'orphan_absence';

export interface VerificationResult {
  readonly key: VerificationKey;
  readonly passed: boolean;
  /** Rows violating the assertion. Zero when it passes. */
  readonly violations: number;
  /** A bounded sample, for diagnosis. Never the whole violation set. */
  readonly examples: readonly string[];
  /** Restated on every result so a passing report still says it is temporary. */
  readonly temporary: true;
  readonly standsInFor: string;
}

export const VERIFICATIONS: readonly VerificationKey[] = [
  'feature_dependency_acyclic',
  'feature_scale_conformance',
  'orphan_absence',
  'provenance_propagation',
];

/**
 * Runs every temporary control.
 *
 * Read-only throughout. Returns results rather than throwing, so a caller can
 * report all four rather than only the first to fail — a verification pass that
 * stops at the first problem tells you less than one that does not.
 */
export async function runAllVerifications(): Promise<VerificationResult[]> {
  return withConnection(VERIFY_ROLE, async (tx) => {
    const results: VerificationResult[] = [];
    for (const key of VERIFICATIONS) results.push(await runVerification(tx, key));
    return results;
  });
}

export async function runVerification(
  tx: PoolClient,
  key: VerificationKey
): Promise<VerificationResult> {
  switch (key) {
    case 'feature_scale_conformance':
      return scaleConformance(tx);
    case 'provenance_propagation':
      return provenancePropagation(tx);
    case 'feature_dependency_acyclic':
      return dependencyAcyclic(tx);
    case 'orphan_absence':
      return orphanAbsence(tx);
  }
}

/**
 * ⚠ TEMPORARY. Stands in for the registered `feature_scale_conformance` check.
 *
 * "Every feature value conforms to the scale declared in its registry entry."
 *
 * `value_scale` cannot be a CHECK on `feature_value.value`, because a check
 * constraint may not reference `feature_definition`. The design therefore names
 * it a residual enforcement point "enforced by the calculating process and
 * verified by the scale conformance assertion" — and that assertion does not
 * exist, so `write/scale.ts` is currently the ONLY thing enforcing it.
 *
 * A value conforms when re-rounding it to its declared scale changes nothing.
 * `scale()` on a numeric reports the stored scale, but a value stored as 12.50
 * at scale 2 and one stored as 12.5 differ in `scale()` while both conform, so
 * the comparison is against the rounded value rather than against the digit
 * count.
 */
async function scaleConformance(tx: PoolClient): Promise<VerificationResult> {
  const { rows } = await tx.query<{ example: string; total: string }>(
    `WITH offending AS (
       SELECT d.feature_key, fv.id, fv.value, d.value_scale
         FROM feature.feature_value fv
         JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
        WHERE fv.value <> round(fv.value, d.value_scale)
     )
     SELECT format('%s value %s = %s exceeds declared scale %s',
                   feature_key, id, value, value_scale) AS example,
            (SELECT count(*) FROM offending)::text AS total
       FROM offending
      ORDER BY feature_key, id
      LIMIT 5`
  );
  return result(
    'feature_scale_conformance',
    rows,
    'the registered feature_scale_conformance quality check, which has no implementation'
  );
}

/**
 * ⚠ TEMPORARY. Stands in for the registered `provenance_propagation` check.
 *
 * "No derived value carries a provenance class stronger than the weakest in its
 * lineage." LC-37.
 *
 * THE COMPENSATING CONTROL FOR S5-1. `tr_feature_value__provenance_propagation`
 * is installed and statement-level, but it joins new values against
 * `feature_lineage` — and lineage can only be written AFTER its produced value
 * exists, so the join matches zero rows at trigger time and every value is
 * exempted. Proven by execution: an OBSERVED value consuming an ESTIMATED one
 * was accepted.
 *
 * This query is the trigger's own predicate, run after the fact, which is
 * detection rather than prevention. `write/provenance.ts` is the prevention, and
 * mutation test 1 is what keeps it honest.
 */
async function provenancePropagation(tx: PoolClient): Promise<VerificationResult> {
  const { rows } = await tx.query<{ example: string; total: string }>(
    `WITH offending AS (
       SELECT n.id,
              d.feature_key,
              n.provenance_class_code AS declared,
              min(cp.strength_rank)   AS weakest_rank,
              np.strength_rank        AS declared_rank
         FROM feature.feature_value n
         JOIN feature.feature_definition d ON d.id = n.feature_definition_id
         JOIN football.provenance_class np ON np.code = n.provenance_class_code
         JOIN feature.feature_lineage l
           ON l.produced_value_id = n.id AND l.produced_value_as_of = n.as_of
         JOIN feature.feature_value cv
           ON cv.id = l.consumed_value_id AND cv.as_of = l.consumed_value_as_of
         JOIN football.provenance_class cp ON cp.code = cv.provenance_class_code
        GROUP BY n.id, d.feature_key, n.provenance_class_code, np.strength_rank
       HAVING np.strength_rank > min(cp.strength_rank)
     )
     SELECT format('%s value %s declares %s but its weakest input is weaker',
                   feature_key, id, declared) AS example,
            (SELECT count(*) FROM offending)::text AS total
       FROM offending
      ORDER BY feature_key, id
      LIMIT 5`
  );
  return result(
    'provenance_propagation',
    rows,
    'the A.12 trigger, which cannot fire (S5-1), and the registered ' +
      'provenance_propagation quality check, which has no implementation'
  );
}

/**
 * ⚠ TEMPORARY. Stands in for the registered `feature_dependency_acyclic` check.
 *
 * "The declared feature dependency graph contains no cycle." LC-44, registered
 * at **BLOCKING** severity.
 *
 * Enforced by neither constraint nor trigger — "a recursive trigger would run on
 * every registry modification and scale with graph size, and the registry is
 * modified rarely and under governance" — and the validation the design defers
 * to does not exist. S-5 is the first phase to populate `feature_dependency`, so
 * it is the first phase for which the absence matters.
 *
 * Detection is at FEATURE level rather than calculator level: a cycle between
 * two features owned by one calculator is still a cycle, and the execution
 * planner would not see it.
 */
async function dependencyAcyclic(tx: PoolClient): Promise<VerificationResult> {
  const registry = await loadRegistry(tx);
  const cycle = findFeatureCycle(registry.dependencies);
  return {
    key: 'feature_dependency_acyclic',
    passed: cycle === null,
    violations: cycle === null ? 0 : 1,
    examples: cycle === null ? [] : [`cycle: ${cycle.join(' -> ')}`],
    temporary: true,
    standsInFor:
      'the registered feature_dependency_acyclic quality check (BLOCKING), which has no implementation',
  };
}

/**
 * ⚠ TEMPORARY. Stands in for the registered `orphan_absence` check.
 *
 * "No calculated row references a retired definition or an unregistered version."
 *
 * The foreign keys guarantee the definition and version EXIST; nothing
 * guarantees the definition is still active. `is_active` is a flag, so a value
 * written against a definition later retired is referentially perfect and
 * semantically orphaned — which is precisely the gap this covers and precisely
 * why it is not duplicating a constraint.
 */
async function orphanAbsence(tx: PoolClient): Promise<VerificationResult> {
  const { rows } = await tx.query<{ example: string; total: string }>(
    `WITH offending AS (
       SELECT fv.id, d.feature_key, d.is_active, v.designation
         FROM feature.feature_value fv
         JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
         JOIN feature.feature_version v ON v.id = fv.feature_version_id
        WHERE d.is_active = false
     )
     SELECT format('value %s references retired definition %s at version %s',
                   id, feature_key, designation) AS example,
            (SELECT count(*) FROM offending)::text AS total
       FROM offending
      ORDER BY feature_key, id
      LIMIT 5`
  );
  return result(
    'orphan_absence',
    rows,
    'the registered orphan_absence quality check, which has no implementation'
  );
}

function result(
  key: VerificationKey,
  rows: readonly { example: string; total: string }[],
  standsInFor: string
): VerificationResult {
  const violations = rows.length === 0 ? 0 : Number(rows[0].total);
  return {
    key,
    passed: violations === 0,
    violations,
    examples: rows.map((row) => row.example),
    temporary: true,
    standsInFor,
  };
}
