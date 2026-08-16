// ─────────────────────────────────────────────────────────────────────────────
// MODULE EVIDENCE SOURCE — consumed feature values (S-6)
//
// A module reads the feature values it declares as inputs (D-3). This is the
// COMPETITION_SCOPED counterpart of the feature layer's `readPriorValues`: it
// pulls `feature_value` rows for one team, one instant, one competition edition,
// under the current feature version. It filters by
// `context_competition_edition_id` because the venue features are edition-scoped —
// a module reading for edition E must consume edition E's values, not another
// edition's.
//
// `value` is parsed straight into an `Exact` (PD-06); `as_of` is used only to
// index and to carry into the evidence citation as the value's own instant
// (ER-01), never re-derived.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { COMPETITION_SCOPED_CONTEXT_KIND } from '../../feature/calculators/types';
import { fromString } from '../../feature/write/scale';
import type { ConsumedFeature } from '../types';

/** Key for the consumed map: `<featureKey>|<teamId>`. One instant per call. */
export function consumedKey(featureKey: string, teamId: string): string {
  return `${featureKey}|${teamId}`;
}

/**
 * Consumed feature values for a set of teams within one edition, at one instant.
 *
 * Keyed `<featureKey>|<teamId>`. Only the current feature version is read, so a
 * reading cannot cite a value produced under a superseded rule. A team/feature
 * with no value is simply absent from the map — the engine reads that as an
 * absent input (→ INACTIVE), never as a zero.
 */
export async function readConsumedFeatures(
  tx: PoolClient,
  featureKeys: readonly string[],
  teamIds: readonly string[],
  asOf: Date,
  competitionEditionId: string
): Promise<Map<string, ConsumedFeature>> {
  const consumed = new Map<string, ConsumedFeature>();
  if (featureKeys.length === 0 || teamIds.length === 0) return consumed;

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
        AND fv.context_competition_edition_id = $5
      ORDER BY d.feature_key, fv.subject_team_id, fv.id`,
    [featureKeys, teamIds, asOf, COMPETITION_SCOPED_CONTEXT_KIND, competitionEditionId]
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
