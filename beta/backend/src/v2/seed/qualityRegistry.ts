// ─────────────────────────────────────────────────────────────────────────────
// QUALITY CHECK VERSION REGISTRY — operations.quality_check_version
//
// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTRY THAT NOBODY SEEDED
//
// Migration 018 registers seventeen assertions in `operations.quality_check`.
// `operations.quality_check_version` — created back in migration 003 — was left
// EMPTY, and no migration, seed stage or runner has ever written a row to it.
//
// That is not cosmetic. `operations.quality_assertion_result.quality_check_
// version_id` is NOT NULL with a foreign key onto this relation, so with the
// registry empty **no assertion result can be recorded at all**. The seventeen
// checks could run and would have nowhere to land.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A VERSION AT ALL
//
// Migration 003's own comment: "E9.07. A changed assertion measures something
// different (LC-169). Recorded on every result so that a change in results
// attributable to a changed assertion is distinguishable from one attributable
// to changed data."
//
// So the version is not bookkeeping. Without it, tightening an assertion and
// discovering a regression look identical in the result history.
//
// ─────────────────────────────────────────────────────────────────────────────
// EVERY REGISTERED CHECK GETS ONE, INCLUDING THE ONES WITH NO IMPLEMENTATION
//
// Nine of the seventeen have no executable implementation (finding S5-2). They
// are still registered assertions with stated wording, and the version records
// THE WORDING IN FORCE — not the existence of code. The module registry sets the
// same precedent: a module registered inactive still gets version 1.0.0, because
// the version describes the definition rather than its evaluator.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE KEYS ARE READ FROM THE DATABASE, NOT LISTED HERE
//
// `quality_check_version.quality_check_key` carries NO foreign key onto
// `operations.quality_check` — verified against migration 003 — so a typo here
// would create a version for an assertion that does not exist and nothing would
// object. Deriving the keys from the registry makes that unrepresentable, and
// means a check added by a later migration is covered without editing this file.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { openEffectivePeriod, seedRows, type SeedOutcome } from './helpers';

/** The designation every assertion starts at. */
export const INITIAL_DESIGNATION = '1.0.0' as const;

interface RegisteredCheck {
  readonly quality_check_key: string;
  readonly assertion_text: string;
}

/**
 * The rationale recorded against version 1.0.0 of one assertion.
 *
 * It quotes the assertion text as registered, so the row states what was being
 * measured rather than merely that something was. A later revision appends a new
 * version quoting the new wording, and the two results become comparable
 * precisely because they are attributable to different rows.
 */
export function initialRationale(check: RegisteredCheck): string {
  return (
    'Initial registration of the assertion as worded in operations.quality_check: ' +
    `"${check.assertion_text}" — recorded so that a change in results attributable ` +
    'to a changed assertion is distinguishable from one attributable to changed ' +
    'data (LC-169). Registering a version asserts the WORDING is in force, not ' +
    'that an implementation exists.'
  );
}

/**
 * Seeds one version per registered quality check.
 *
 * Insert-only and idempotent like every other seed here: a re-run offers the
 * same rows and writes none of them. A check registered later by a migration is
 * picked up on the next run without this file changing.
 */
export async function seedQualityCheckVersions(tx: PoolClient): Promise<SeedOutcome[]> {
  const { rows } = await tx.query<RegisteredCheck>(
    `SELECT quality_check_key, assertion_text
       FROM operations.quality_check
      ORDER BY quality_check_key`
  );

  // One instant for the whole batch, so the seventeen versions do not disagree
  // about when the registry was established. The exclusion constraint is scoped
  // per key, so a shared lower bound conflicts with nothing.
  const period = openEffectivePeriod();

  return [
    await seedRows(
      tx,
      'operations.quality_check_version',
      ['quality_check_key', 'designation', 'effective_period', 'rationale'],
      rows.map((check) => [
        check.quality_check_key,
        INITIAL_DESIGNATION,
        period,
        initialRationale(check),
      ]),
      ['quality_check_key', 'designation']
    ),
  ];
}
