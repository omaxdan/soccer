// ─────────────────────────────────────────────────────────────────────────────
// READING MODULE EVIDENCE (Phase C.2) — the persisted explainability substrate
// behind a current module reading, for the Match-page ReadingCard.
//
// A read consumer of module.module_evidence + module.module_evidence_item. It
// computes nothing: the module engine already decided the reading's status, the
// set-level input counts, and each cited value's contribution_direction, and it
// recorded them. This surface projects that persisted evidence for the CURRENT
// reading — the same reading the readings surface (B.1) resolves for the page —
// and joins each cited value back to feature.feature_value / feature_definition
// for its identity and persisted number. Nothing is fabricated: a zero count
// stays zero, a zero value stays zero, an unresolved cited value stays null, and
// the contribution direction is carried through verbatim.
//
// CURRENT-READING SEMANTICS. Identical to module/read/readings.ts: "current" is
// the row with the greatest as_of at or before the requested moment, per
// (team, module definition, context), chosen with DISTINCT ON. The evidence is
// then the ONE evidence set of that reading (module_evidence is 1:1 with a
// reading, LC-61) and its items (1:N). The as_of ceiling is the fixture kickoff,
// so a reading displayed for fixture X never exposes evidence from a later
// reading or version.
//
// INACTIVE readings are excluded here BY THE QUERY. An INACTIVE reading is
// silent — the engine writes it with zero present inputs and NO evidence items
// (pipeline.assembleReading) — so it has no evidence to explain. Excluding it at
// the source guarantees the surface never returns fabricated or empty evidence
// for a reading that did not speak.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** The contribution a cited value made to the reading (ck_module_evidence_item__direction_known). */
export type ContributionDirection = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

/** One cited feature value's contribution to a reading. Application-shaped. */
export interface ReadingEvidenceItem {
  /** feature_definition.feature_key of the cited value; null only if the cited value cannot be resolved. */
  readonly featureKey: string | null;
  /** feature_definition.display_name of the cited value; null when unresolved. */
  readonly displayName: string | null;
  /** The persisted cited value; null when unresolved. A zero value is preserved as 0. */
  readonly value: number | null;
  /** The cited value's own as_of; null when unresolved. */
  readonly asOf: Date | null;
  /** The persisted direction — never derived here. */
  readonly contributionDirection: ContributionDirection;
}

/** One reading's persisted evidence set and its items. Application-shaped. */
export interface ReadingEvidence {
  readonly moduleKey: string;
  readonly teamId: string;
  readonly contextKindCode: string;
  readonly contextCompetitionEditionId: string | null;
  readonly declaredInputCount: number;
  readonly presentInputCount: number;
  readonly belowThresholdInputCount: number;
  readonly estimatedInputCount: number;
  readonly items: ReadingEvidenceItem[];
}

export interface ReadReadingEvidenceParams {
  /** Internal football.team ids. */
  readonly teamIds: readonly string[];
  /** Evidence for the current reading at or before this moment. Defaults to now. */
  readonly asOf?: Date;
  /** Restrict to these module_key values. Defaults to all modules present. */
  readonly moduleKeys?: readonly string[];
  /**
   * When set, COMPETITION_SCOPED readings are limited to this edition (plus every
   * ALL_COMPETITIONS reading). When null/omitted, scoped readings of every edition
   * are returned. Mirrors the readings surface, so evidence resolves for exactly
   * the readings the Match page shows.
   */
  readonly contextCompetitionEditionId?: string | null;
}

/**
 * THE READ. A CTE picks the current, ENGAGED reading per
 * (team, module definition, context) — the same DISTINCT ON as the readings
 * surface — then joins its single evidence set (1:1), its items (1:N), and each
 * item's cited feature value and definition. Read-only, schema-qualified.
 *   $1 team ids, $2 as_of ceiling, $3 module_keys | null, $4 context edition | null
 *
 * A LEFT JOIN on the items and the cited value is deliberate: a reading keeps its
 * evidence set even if it somehow has no items, and an item is preserved even if
 * its cited value cannot be resolved (its number then reads back as null, never
 * fabricated). module_evidence itself is INNER-joined: a reading with no evidence
 * set simply does not appear, and the caller renders that as no evidence.
 */
export const CURRENT_READING_EVIDENCE_SQL = `
  WITH current_reading AS (
    SELECT DISTINCT ON (mr.subject_team_id, mr.module_definition_id, mr.context_kind_code, mr.context_competition_edition_id)
           mr.id                                    AS reading_id,
           mr.as_of                                 AS reading_as_of,
           md.module_key                            AS module_key,
           mr.subject_team_id::text                 AS team_id,
           mr.context_kind_code                     AS context_kind_code,
           mr.context_competition_edition_id::text  AS context_competition_edition_id
      FROM module.module_reading mr
      JOIN module.module_definition md ON md.id = mr.module_definition_id
     WHERE mr.subject_kind_code = 'TEAM'
       AND mr.subject_team_id = ANY($1::bigint[])
       AND mr.as_of <= $2::timestamptz
       AND mr.module_status_code <> 'INACTIVE'
       AND ($3::text[] IS NULL OR md.module_key = ANY($3::text[]))
       AND (mr.context_competition_edition_id IS NULL
            OR $4::bigint IS NULL
            OR mr.context_competition_edition_id = $4::bigint)
     ORDER BY mr.subject_team_id, mr.module_definition_id, mr.context_kind_code, mr.context_competition_edition_id,
              mr.as_of DESC, mr.calculated_at DESC, mr.id DESC
  )
  SELECT cr.module_key                     AS module_key,
         cr.team_id                        AS team_id,
         cr.context_kind_code              AS context_kind_code,
         cr.context_competition_edition_id AS context_competition_edition_id,
         me.declared_input_count           AS declared_input_count,
         me.present_input_count            AS present_input_count,
         me.below_threshold_input_count    AS below_threshold_input_count,
         me.estimated_input_count          AS estimated_input_count,
         mei.contribution_direction        AS contribution_direction,
         d.feature_key                     AS cited_feature_key,
         d.display_name                    AS cited_display_name,
         fv.value                          AS cited_value,
         fv.as_of                          AS cited_as_of
    FROM current_reading cr
    JOIN module.module_evidence me
      ON me.module_reading_id = cr.reading_id
     AND me.reading_as_of = cr.reading_as_of
    LEFT JOIN module.module_evidence_item mei
      ON mei.module_evidence_id = me.id
     AND mei.reading_as_of = me.reading_as_of
    LEFT JOIN feature.feature_value fv
      ON fv.id = mei.cited_feature_value_id
     AND fv.as_of = mei.cited_feature_value_as_of
    LEFT JOIN feature.feature_definition d
      ON d.id = fv.feature_definition_id
   ORDER BY cr.team_id, cr.module_key, d.feature_key, mei.id
`;

interface EvidenceRow {
  readonly module_key: string;
  readonly team_id: string;
  readonly context_kind_code: string;
  readonly context_competition_edition_id: string | null;
  readonly declared_input_count: number | string;
  readonly present_input_count: number | string;
  readonly below_threshold_input_count: number | string;
  readonly estimated_input_count: number | string;
  readonly contribution_direction: ContributionDirection | null;
  readonly cited_feature_key: string | null;
  readonly cited_display_name: string | null;
  readonly cited_value: string | number | null;   // numeric arrives as text
  readonly cited_as_of: Date | null;
}

/** Groups the flat (reading × item) rows into one ReadingEvidence per reading. */
export function mapEvidenceRows(rows: readonly EvidenceRow[]): ReadingEvidence[] {
  const byReading = new Map<string, ReadingEvidence & { items: ReadingEvidenceItem[] }>();

  for (const row of rows) {
    const key = `${row.team_id}|${row.module_key}|${row.context_kind_code}|${row.context_competition_edition_id ?? ''}`;
    let evidence = byReading.get(key);
    if (!evidence) {
      evidence = {
        moduleKey: row.module_key,
        teamId: row.team_id,
        contextKindCode: row.context_kind_code,
        contextCompetitionEditionId: row.context_competition_edition_id,
        declaredInputCount: Number(row.declared_input_count),
        presentInputCount: Number(row.present_input_count),
        belowThresholdInputCount: Number(row.below_threshold_input_count),
        estimatedInputCount: Number(row.estimated_input_count),
        items: [],
      };
      byReading.set(key, evidence);
    }
    // A row with no contribution_direction is a reading whose evidence set carried
    // no items (LEFT JOIN); it establishes the set-level counts but adds no item.
    if (row.contribution_direction !== null) {
      evidence.items.push({
        featureKey: row.cited_feature_key,
        displayName: row.cited_display_name,
        // A cited value that could not be resolved stays null; a zero value stays 0.
        value: row.cited_value === null ? null : Number(row.cited_value),
        asOf: row.cited_as_of,
        contributionDirection: row.contribution_direction,
      });
    }
  }

  return [...byReading.values()];
}

/**
 * Returns the persisted evidence for each current engaged reading of the given
 * teams. Read-only. Empty `teamIds` → [] with no query issued. A reading with no
 * evidence set, and every INACTIVE reading, is simply absent — the caller renders
 * that as no evidence, never as a fabricated or empty-but-present block.
 */
export async function readCurrentReadingEvidence(
  tx: PoolClient,
  params: ReadReadingEvidenceParams
): Promise<ReadingEvidence[]> {
  if (params.teamIds.length === 0) return [];
  const asOf = params.asOf ?? new Date();
  const moduleKeys = params.moduleKeys && params.moduleKeys.length > 0 ? [...params.moduleKeys] : null;
  const contextEditionId = params.contextCompetitionEditionId ?? null;

  const result = await tx.query<EvidenceRow>(CURRENT_READING_EVIDENCE_SQL, [
    params.teamIds,
    asOf,
    moduleKeys,
    contextEditionId,
  ]);
  return mapEvidenceRows(result.rows);
}
