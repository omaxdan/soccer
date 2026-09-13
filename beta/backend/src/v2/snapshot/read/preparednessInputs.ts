// ─────────────────────────────────────────────────────────────────────────────
// TEAM PREPAREDNESS — seal-time input read (S-7 B3, read-only)
//
// Selects the CURRENT governed Layer-2 feature values the preparedness composition
// scores, for the fixture's two teams, as of the snapshot's own as-of ceiling. It
// computes nothing. It reuses the established current-value contract exactly:
//   • DISTINCT ON (team, feature def, context) ORDER BY as_of DESC, calculated_at
//     DESC, id DESC — the same current-value selection as feature/read/currentValues
//     and the module current-reading surface.
//   • as-of ceiling = the snapshot's snapshot_as_of; `fv.as_of <= ceiling` (the
//     seal's own snapshot_feature_state contamination check is `cited_as_of <=
//     snapshot_as_of`, so this matches; snapshot_as_of is strictly pre-kickoff).
//   • CURRENT feature version only (`upper_inf(effective_period)`), so a value
//     produced under a superseded rule is never consumed — matching readConsumedFeatures.
//
// SCOPE IS PER FEATURE, resolved HERE against the fixture (Layer 2 stays team+as_of
// and fixture-agnostic):
//   ALL_COMPETITIONS (edition NULL): team.home_form, team.away_form,
//     team.congestion_index, team.squad_stability.
//   COMPETITION_SCOPED (edition = the fixture's competition_edition_id):
//     team.home_win_rate, team.away_win_rate — edition-bound with NO ALL_COMPETITIONS
//     fallback (a venue value for edition E must be edition E's).
//
// Home/away orientation is applied here: the HOME side reads home_form/home_win_rate,
// the AWAY side away_form/away_win_rate; congestion and squad stability are the same
// per-team feature read for each side.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { fromString } from '../../feature/write/scale';
import {
  CALCULATION_CONTEXT_KIND,
  COMPETITION_SCOPED_CONTEXT_KIND,
} from '../../feature/calculators/types';
import {
  HOME_FORM_FEATURE_KEY,
  AWAY_FORM_FEATURE_KEY,
  CONGESTION_FEATURE_KEY,
  HOME_WIN_RATE_FEATURE_KEY,
  AWAY_WIN_RATE_FEATURE_KEY,
  SQUAD_STABILITY_FEATURE_KEY,
  type PreparednessInput,
  type PreparednessSideInputs,
} from '../preparedness';

/** The ALL_COMPETITIONS (edition-free) preparedness inputs. Exported for DB-free
 *  scope-assignment tests. */
export const ALL_COMPETITIONS_KEYS = [
  HOME_FORM_FEATURE_KEY,
  AWAY_FORM_FEATURE_KEY,
  CONGESTION_FEATURE_KEY,
  SQUAD_STABILITY_FEATURE_KEY,
] as const;

/** The COMPETITION_SCOPED (edition-bound) preparedness inputs — resolved against the
 *  fixture's competition edition, no ALL_COMPETITIONS fallback. Exported for tests. */
export const COMPETITION_SCOPED_KEYS = [HOME_WIN_RATE_FEATURE_KEY, AWAY_WIN_RATE_FEATURE_KEY] as const;

/**
 * One current feature value at/before the ceiling, at its governed scope.
 *   $1 team ids, $2 as_of ceiling, $3 ALL_COMPETITIONS keys, $4 COMPETITION_SCOPED
 *   keys, $5 competition edition id (for the scoped keys).
 * DISTINCT ON keeps the greatest as_of per (team, feature def, context). Selecting
 * feature_version_id lets the caller add the exact version to the manifest.
 */
const PREPAREDNESS_INPUTS_SQL = `
  SELECT DISTINCT ON (fv.subject_team_id, fv.feature_definition_id,
                      fv.context_kind_code, fv.context_competition_edition_id)
         d.feature_key                            AS feature_key,
         fv.subject_team_id::text                 AS team_id,
         fv.id::text                              AS feature_value_id,
         fv.as_of                                 AS feature_value_as_of,
         fv.feature_version_id::text              AS feature_version_id,
         fv.value::text                           AS value
    FROM feature.feature_value fv
    JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
    JOIN feature.feature_version v
           ON v.id = fv.feature_version_id AND upper_inf(v.effective_period)
   WHERE fv.subject_kind_code = 'TEAM'
     AND fv.subject_team_id = ANY($1::bigint[])
     AND fv.as_of <= $2::timestamptz
     AND (
           (d.feature_key = ANY($3::text[])
              AND fv.context_kind_code = $6
              AND fv.context_competition_edition_id IS NULL)
        OR (d.feature_key = ANY($4::text[])
              AND fv.context_kind_code = $7
              AND fv.context_competition_edition_id = $5::bigint)
         )
   ORDER BY fv.subject_team_id, fv.feature_definition_id, fv.context_kind_code,
            fv.context_competition_edition_id,
            fv.as_of DESC, fv.calculated_at DESC, fv.id DESC
`;

interface InputRow {
  feature_key: string;
  team_id: string;
  feature_value_id: string;
  feature_value_as_of: Date;
  feature_version_id: string;
  value: string;
}

function toInput(row: InputRow): PreparednessInput {
  return {
    featureKey: row.feature_key,
    value: fromString(row.value),
    featureValueId: row.feature_value_id,
    featureValueAsOf: row.feature_value_as_of,
    featureVersionId: row.feature_version_id,
  };
}

/**
 * The HOME and AWAY preparedness input sets for a fixture, as of the ceiling.
 * A team/feature with no current value is simply absent (→ that component is
 * missing, never a zero). Read-only.
 */
export async function readPreparednessInputs(
  tx: PoolClient,
  params: {
    readonly homeTeamId: string;
    readonly awayTeamId: string;
    readonly asOf: Date;
    readonly competitionEditionId: string;
  }
): Promise<{ readonly home: PreparednessSideInputs; readonly away: PreparednessSideInputs }> {
  const { rows } = await tx.query<InputRow>(PREPAREDNESS_INPUTS_SQL, [
    [params.homeTeamId, params.awayTeamId],
    params.asOf,
    ALL_COMPETITIONS_KEYS,
    COMPETITION_SCOPED_KEYS,
    params.competitionEditionId,
    CALCULATION_CONTEXT_KIND,
    COMPETITION_SCOPED_CONTEXT_KIND,
  ]);

  // Index by `${teamId}|${featureKey}` — one current value per pair by construction.
  const byKey = new Map<string, PreparednessInput>();
  for (const row of rows) byKey.set(`${row.team_id}|${row.feature_key}`, toInput(row));
  const at = (teamId: string, key: string): PreparednessInput | undefined =>
    byKey.get(`${teamId}|${key}`);

  const home: PreparednessSideInputs = {
    side: 'HOME',
    teamId: params.homeTeamId,
    form: at(params.homeTeamId, HOME_FORM_FEATURE_KEY),
    congestion: at(params.homeTeamId, CONGESTION_FEATURE_KEY),
    venue: at(params.homeTeamId, HOME_WIN_RATE_FEATURE_KEY),
    squad: at(params.homeTeamId, SQUAD_STABILITY_FEATURE_KEY),
  };
  const away: PreparednessSideInputs = {
    side: 'AWAY',
    teamId: params.awayTeamId,
    form: at(params.awayTeamId, AWAY_FORM_FEATURE_KEY),
    congestion: at(params.awayTeamId, CONGESTION_FEATURE_KEY),
    venue: at(params.awayTeamId, AWAY_WIN_RATE_FEATURE_KEY),
    squad: at(params.awayTeamId, SQUAD_STABILITY_FEATURE_KEY),
  };

  return { home, away };
}
