// ─────────────────────────────────────────────────────────────────────────────
// READING LAYER 2 — prior feature values, for the one composite
//
// Stage 2 reads what Stage 1 wrote. This is the only place S-5 reads its own
// output, and it is why Stage 2 cannot begin until Stage 1 has COMMITTED: the
// stages run on different connections, and an uncommitted row is invisible from
// another connection no matter how recently it was written.
//
// ─────────────────────────────────────────────────────────────────────────────
// `value` IS READ AS A STRING AND PARSED EXACTLY
//
// `pg` returns `numeric` as a string because it does not fit a double. Parsing
// it straight into an `Exact` preserves every digit PostgreSQL stored. A
// `parseFloat` here would silently undo PD-06 at the last moment before the
// value re-entered a calculation.
//
// ─────────────────────────────────────────────────────────────────────────────
// ER-01 — `as_of` COMES BACK AS A `Date`, AND IS NOT USED AS A KEY
//
// The `as_of` returned here is used only to INDEX the prior value for lookup.
// The `as_of` written into lineage is the application's own value, carried from
// the driver — never this one. PostgreSQL stores microseconds and a JS `Date`
// carries milliseconds, so a round trip truncates, and `as_of` is half of every
// composite reference to a feature value.
//
// The lookup key is built from the application's `as_of` on both sides, so a
// truncation could not silently produce a miss either.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { priorValueKey, type ConsumedValueRef } from '../calculators/types';
import { fromString } from '../write/scale';

/**
 * Values for the given features, subjects and instant.
 *
 * Keyed by `priorValueKey`, which is built from the APPLICATION's `as_of` —
 * the same instant the driver derived and the same one the write will carry —
 * so a lookup cannot depend on how PostgreSQL rendered the stored value.
 *
 * Filtered to the version currently in force, matching the version every value
 * this run writes is attributed to. Consuming a value produced under a
 * superseded rule while attributing the result to the current one would make the
 * composite's lineage describe a calculation that never happened.
 */
export async function readPriorValues(
  tx: PoolClient,
  featureKeys: readonly string[],
  teamIds: readonly string[],
  asOf: Date,
  contextKindCode: string
): Promise<Map<string, ConsumedValueRef>> {
  const priorValues = new Map<string, ConsumedValueRef>();
  if (featureKeys.length === 0 || teamIds.length === 0) return priorValues;

  const { rows } = await tx.query<{
    id: string;
    feature_key: string;
    subject_team_id: string;
    value: string;
    provenance_class_code: string;
    sample_observation_count: number;
  }>(
    `SELECT fv.id::text,
            d.feature_key,
            fv.subject_team_id::text,
            fv.value::text,
            fv.provenance_class_code,
            fv.sample_observation_count
       FROM feature.feature_value fv
       JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
       JOIN feature.feature_version v
              ON v.id = fv.feature_version_id
             AND upper_inf(v.effective_period)
      WHERE d.feature_key = ANY($1::text[])
        AND fv.subject_team_id = ANY($2::bigint[])
        AND fv.as_of = $3
        AND fv.context_kind_code = $4
        AND fv.subject_kind_code = 'TEAM'
      ORDER BY d.feature_key, fv.subject_team_id, fv.id`,
    [featureKeys, teamIds, asOf, contextKindCode]
  );

  for (const row of rows) {
    priorValues.set(priorValueKey(row.feature_key, row.subject_team_id, asOf), {
      featureKey: row.feature_key,
      valueId: row.id,
      // The application's instant, deliberately — not a value read back.
      asOf,
      value: fromString(row.value),
      provenanceClassCode: row.provenance_class_code,
      sampleObservationCount: row.sample_observation_count,
    });
  }

  return priorValues;
}

/**
 * Whether a value already exists for a candidate.
 *
 * Used by the dry-run path, which must report what a real run would write
 * without writing anything. The live write path does NOT use this — it relies on
 * `ON CONFLICT` against the named business-identity constraint, because a
 * check-then-insert is a race and the constraint is not.
 */
export async function countExistingValues(
  tx: PoolClient,
  featureKeys: readonly string[],
  teamIds: readonly string[],
  asOf: Date,
  contextKindCode: string
): Promise<number> {
  if (featureKeys.length === 0 || teamIds.length === 0) return 0;
  const { rows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text
       FROM feature.feature_value fv
       JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
      WHERE d.feature_key = ANY($1::text[])
        AND fv.subject_team_id = ANY($2::bigint[])
        AND fv.as_of = $3
        AND fv.context_kind_code = $4`,
    [featureKeys, teamIds, asOf, contextKindCode]
  );
  return Number(rows[0].count);
}
