// ─────────────────────────────────────────────────────────────────────────────
// MODULE EVIDENCE SOURCE — consumed feature values (S-6)
//
// A module reads the feature values it declares as inputs (D-3). This is the
// module-layer counterpart of the feature layer's `readPriorValues`: it pulls
// `feature_value` rows for one team, one instant, at the module's declared scope,
// under the current feature version.
//
// The scope is the module calculator's `contextKind` (Gate E-i):
//   COMPETITION_SCOPED — edition-keyed: `context_competition_edition_id = <edition>`
//                        (the venue features are edition-scoped; a reading for
//                        edition E must consume edition E's values, not another's).
//   ALL_COMPETITIONS   — edition-free: `context_competition_edition_id IS NULL`,
//                        matching `readPriorValues`, which filters ALL_COMPETITIONS
//                        by context kind alone (the edition is NULL by
//                        `ck_feature_value__context_edition_conditional`).
//
// `value` is parsed straight into an `Exact` (PD-06); `as_of` is used only to
// index and to carry into the evidence citation as the value's own instant
// (ER-01), never re-derived.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import {
  COMPETITION_SCOPED_CONTEXT_KIND,
  type CalculationScope,
} from '../../feature/calculators/types';
import { fromString } from '../../feature/write/scale';
import type { ConsumedFeature } from '../types';

/** Key for the consumed map: `<featureKey>|<teamId>`. One instant per call. */
export function consumedKey(featureKey: string, teamId: string): string {
  return `${featureKey}|${teamId}`;
}

/**
 * Consumed feature values for a set of teams at one instant and one scope.
 *
 * Keyed `<featureKey>|<teamId>`. Only the current feature version is read, so a
 * reading cannot cite a value produced under a superseded rule. A team/feature
 * with no value is simply absent from the map — the engine reads that as an
 * absent input (→ INACTIVE), never as a zero.
 *
 * The scope selects the edition predicate: COMPETITION_SCOPED matches exactly the
 * batch's edition; ALL_COMPETITIONS matches a NULL edition. The two never mix, so
 * an ALL_COMPETITIONS module cannot pick up an edition-scoped value or vice versa.
 */
export async function readConsumedFeatures(
  tx: PoolClient,
  featureKeys: readonly string[],
  teamIds: readonly string[],
  asOf: Date,
  scope: CalculationScope
): Promise<Map<string, ConsumedFeature>> {
  const consumed = new Map<string, ConsumedFeature>();
  if (featureKeys.length === 0 || teamIds.length === 0) return consumed;

  const scoped = scope.contextKind === COMPETITION_SCOPED_CONTEXT_KIND;
  // COMPETITION_SCOPED binds the edition ($5); ALL_COMPETITIONS requires it NULL.
  const editionPredicate = scoped
    ? 'AND fv.context_competition_edition_id = $5'
    : 'AND fv.context_competition_edition_id IS NULL';
  const params: unknown[] = [featureKeys, teamIds, asOf, scope.contextKind];
  if (scoped) params.push(scope.contextEditionId);

  const { rows } = await tx.query<{
    id: string;
    feature_key: string;
    subject_team_id: string;
    value: string;
    sample_observation_count: number;
  }>(
    `SELECT fv.id::text,
            d.feature_key,
            fv.subject_team_id::text,
            fv.value::text,
            fv.sample_observation_count
       FROM feature.feature_value fv
       JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
       JOIN feature.feature_version v
              ON v.id = fv.feature_version_id
             AND upper_inf(v.effective_period)
      WHERE d.feature_key = ANY($1::text[])
        AND fv.subject_team_id = ANY($2::bigint[])
        AND fv.as_of = $3
        AND fv.subject_kind_code = 'TEAM'
        AND fv.context_kind_code = $4
        ${editionPredicate}
      ORDER BY d.feature_key, fv.subject_team_id, fv.id`,
    params
  );

  for (const row of rows) {
    consumed.set(consumedKey(row.feature_key, row.subject_team_id), {
      featureKey: row.feature_key,
      valueId: row.id,
      asOf, // the application's instant, deliberately (ER-01)
      value: fromString(row.value),
      sampleObservationCount: row.sample_observation_count,
    });
  }
  return consumed;
}
