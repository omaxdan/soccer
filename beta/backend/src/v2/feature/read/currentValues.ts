// ─────────────────────────────────────────────────────────────────────────────
// READING CURRENT FEATURE VALUES (Phase C.1) — the current persisted feature value
// per team, for the Match-page Team Intelligence panel.
//
// A read consumer of feature.feature_value. It calculates nothing: the interval /
// window / banding work already happened in the feature pipeline and is recorded.
// This selects the CURRENT value — the greatest as_of at or before the requested
// moment, per (team, feature definition, context) — with DISTINCT ON, exactly like
// the module current-reading surface (B.1). A missing value stays missing (null);
// a zero stays zero; nothing is fabricated.
//
// The five features the panel needs are all ALL_COMPETITIONS (context edition NULL):
//   team.home_form, team.away_form  — 0-100 venue-split form (formBackfill)
//   team.momentum                   — Δ points last5−prior5 (teamMomentum)
//   team.rest_advantage             — days since last fixture (fixtureLoad)
//   team.congestion_index           — 0-100 congestion band (fixtureLoad)
// The read is context-general, matching the readings surface, so it also serves
// COMPETITION_SCOPED keys if asked.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** The feature keys the Match Team-Intelligence panel surfaces. All ALL_COMPETITIONS. */
export const TEAM_PANEL_FEATURE_KEYS = [
  'team.home_form',
  'team.away_form',
  'team.momentum',
  'team.rest_advantage',
  'team.congestion_index',
] as const;

/** One team's current value for one feature. Application-shaped. */
export interface TeamFeatureValue {
  readonly featureKey: string;
  readonly teamId: string;
  readonly contextKindCode: string;
  readonly contextCompetitionEditionId: string | null;
  readonly value: number;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly asOf: Date;
}

export interface ReadTeamFeaturesParams {
  readonly teamIds: readonly string[];
  /** Latest value at or before this moment. Defaults to now. */
  readonly asOf?: Date;
  /** Restrict to these feature_key values. Defaults to all present. */
  readonly featureKeys?: readonly string[];
  /**
   * When set, COMPETITION_SCOPED values are limited to this edition (plus every
   * ALL_COMPETITIONS value). When null/omitted, scoped values of every edition
   * are returned. ALL_COMPETITIONS values (the panel's five) are unaffected.
   */
  readonly contextCompetitionEditionId?: string | null;
}

/**
 * THE READ. One statement; DISTINCT ON picks the current value per
 * (team, feature definition, context). Read-only, schema-qualified.
 *   $1 team ids, $2 as_of ceiling, $3 feature_keys | null, $4 context edition | null
 */
export const CURRENT_TEAM_FEATURES_SQL = `
  SELECT DISTINCT ON (fv.subject_team_id, fv.feature_definition_id, fv.context_kind_code, fv.context_competition_edition_id)
         d.feature_key                            AS feature_key,
         fv.subject_team_id::text                 AS team_id,
         fv.context_kind_code                     AS context_kind_code,
         fv.context_competition_edition_id::text  AS context_competition_edition_id,
         fv.value                                 AS value,
         fv.sample_observation_count              AS sample_observation_count,
         fv.sample_meets_threshold                AS sample_meets_threshold,
         fv.as_of                                 AS as_of
    FROM feature.feature_value fv
    JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
   WHERE fv.subject_kind_code = 'TEAM'
     AND fv.subject_team_id = ANY($1::bigint[])
     AND fv.as_of <= $2::timestamptz
     AND ($3::text[] IS NULL OR d.feature_key = ANY($3::text[]))
     AND (fv.context_competition_edition_id IS NULL
          OR $4::bigint IS NULL
          OR fv.context_competition_edition_id = $4::bigint)
   ORDER BY fv.subject_team_id, fv.feature_definition_id, fv.context_kind_code, fv.context_competition_edition_id,
            fv.as_of DESC, fv.calculated_at DESC, fv.id DESC
`;

interface FeatureRow {
  readonly feature_key: string;
  readonly team_id: string;
  readonly context_kind_code: string;
  readonly context_competition_edition_id: string | null;
  readonly value: string;                 // numeric arrives as text
  readonly sample_observation_count: number | string;
  readonly sample_meets_threshold: boolean;
  readonly as_of: Date;
}

/** Maps a raw row to the typed value. numeric/bigint columns arrive as strings. */
export function mapFeatureRow(row: FeatureRow): TeamFeatureValue {
  return {
    featureKey: row.feature_key,
    teamId: row.team_id,
    contextKindCode: row.context_kind_code,
    contextCompetitionEditionId: row.context_competition_edition_id,
    value: Number(row.value),
    sampleObservationCount: Number(row.sample_observation_count),
    sampleMeetsThreshold: row.sample_meets_threshold,
    asOf: row.as_of,
  };
}

/**
 * Returns the current feature value for each (team, feature, context). Read-only.
 * Empty `teamIds` → [] with no query issued. A team/feature with no persisted
 * value simply does not appear — the caller renders that as missing, never zero.
 */
export async function readCurrentTeamFeatures(
  tx: PoolClient,
  params: ReadTeamFeaturesParams
): Promise<TeamFeatureValue[]> {
  if (params.teamIds.length === 0) return [];
  const asOf = params.asOf ?? new Date();
  const featureKeys = params.featureKeys && params.featureKeys.length > 0 ? [...params.featureKeys] : null;
  const contextEditionId = params.contextCompetitionEditionId ?? null;

  const result = await tx.query<FeatureRow>(CURRENT_TEAM_FEATURES_SQL, [
    params.teamIds,
    asOf,
    featureKeys,
    contextEditionId,
  ]);
  return result.rows.map(mapFeatureRow);
}
