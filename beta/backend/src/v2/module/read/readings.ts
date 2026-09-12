// ─────────────────────────────────────────────────────────────────────────────
// READING MODULE INTELLIGENCE — the current module reading per team (Phase B.1).
//
// The application-facing counterpart to the module WRITE path. It answers exactly
// one question: "what is the current PitchTerminal reading for this team, for each
// module, as of a moment?" — and nothing else. It calculates nothing and mutates
// nothing; the interval/statistical work already happened in the module pipeline
// and is recorded in module.module_reading.
//
// CURRENT-READING SEMANTICS. module.module_reading ACCUMULATES by `as_of`: the
// writer upserts on (subject, context, definition, as_of, version) and a new
// snapshot point is a new row (008; writeReading ON CONFLICT DO NOTHING). There is
// no completion/ordinal successor table for readings (unlike operations.pipeline_run),
// so "current" is the row with the greatest `as_of` at or before the requested
// moment, per (team, module definition, context) — chosen deterministically with
// DISTINCT ON, never an arbitrary historical row.
//
// SCOPES. `readiness_tracker` is ALL_COMPETITIONS (context edition NULL);
// `home_away_split` is COMPETITION_SCOPED (context edition set). A match page wants
// both: pass the fixture's competition_edition_id and this returns the
// all-competitions readings plus that edition's scoped readings, and no other
// edition's.
//
// Module identity (module_key, via module.module_definition) is kept distinct from
// reading identity (the module_reading row): the caller reasons about "the
// home_away_split reading", not about a row id.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** The two modules active at 1.0.0 (module.pipeline MODULE_CALCULATORS). */
export const ACTIVE_MODULE_KEYS = ['home_away_split', 'readiness_tracker'] as const;

/** One team's current reading for one module, in one context. Application-shaped. */
export interface TeamModuleReading {
  readonly moduleKey: string;
  readonly teamId: string;
  /** Context kind — ALL_COMPETITIONS vs COMPETITION_SCOPED (raw code). */
  readonly contextKindCode: string;
  /** Set for COMPETITION_SCOPED readings; null for ALL_COMPETITIONS. */
  readonly contextCompetitionEditionId: string | null;
  readonly asOf: Date;
  readonly calculatedAt: Date;
  readonly moduleStatusCode: string;
  /** Present only when the module published a magnitude (NULL at 1.0.0 for these two). */
  readonly strength: number | null;
  readonly confidence: number | null;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly verdictText: string | null;
  /** Set iff module_status_code = INACTIVE (023 contract). */
  readonly inactiveReason: string | null;
}

export interface ReadTeamModuleReadingsParams {
  /** Internal football.team ids. */
  readonly teamIds: readonly string[];
  /** Latest reading at or before this moment. Defaults to now. */
  readonly asOf?: Date;
  /** Restrict to these module_key values. Defaults to all modules present. */
  readonly moduleKeys?: readonly string[];
  /**
   * When set, COMPETITION_SCOPED readings are limited to this edition (plus every
   * ALL_COMPETITIONS reading). When null/omitted, scoped readings of every edition
   * are returned.
   */
  readonly contextCompetitionEditionId?: string | null;
}

/**
 * THE READ. One statement; DISTINCT ON picks the current reading per
 * (team, module definition, context). Read-only, schema-qualified.
 *   $1 team ids, $2 as_of ceiling, $3 module_keys | null, $4 context edition | null
 */
export const CURRENT_TEAM_READINGS_SQL = `
  SELECT DISTINCT ON (mr.subject_team_id, mr.module_definition_id, mr.context_kind_code, mr.context_competition_edition_id)
         md.module_key                            AS module_key,
         mr.subject_team_id::text                 AS team_id,
         mr.context_kind_code                     AS context_kind_code,
         mr.context_competition_edition_id::text  AS context_competition_edition_id,
         mr.as_of                                 AS as_of,
         mr.calculated_at                         AS calculated_at,
         mr.module_status_code                    AS module_status_code,
         mr.strength                              AS strength,
         mr.confidence                            AS confidence,
         mr.sample_observation_count              AS sample_observation_count,
         mr.sample_meets_threshold                AS sample_meets_threshold,
         mr.verdict_text                          AS verdict_text,
         mr.inactive_reason                       AS inactive_reason
    FROM module.module_reading mr
    JOIN module.module_definition md ON md.id = mr.module_definition_id
   WHERE mr.subject_kind_code = 'TEAM'
     AND mr.subject_team_id = ANY($1::bigint[])
     AND mr.as_of <= $2::timestamptz
     AND ($3::text[] IS NULL OR md.module_key = ANY($3::text[]))
     AND (mr.context_competition_edition_id IS NULL
          OR $4::bigint IS NULL
          OR mr.context_competition_edition_id = $4::bigint)
     -- GOVERNED INVALIDATION (035). A quarantined reading is not fit for product
     -- intelligence, so it is excluded HERE — among the DISTINCT ON candidates,
     -- before "current" is chosen — so the most recent NON-quarantined reading
     -- becomes current rather than the surface simply going dark. Empty quarantine
     -- table ⇒ NOT EXISTS is always true ⇒ no-op. The DISTINCT ON / ORDER BY are
     -- unchanged.
     AND NOT EXISTS (
       SELECT 1 FROM module.module_reading_quarantine q
        WHERE q.module_reading_id = mr.id
          AND q.reading_as_of = mr.as_of
     )
   ORDER BY mr.subject_team_id, mr.module_definition_id, mr.context_kind_code, mr.context_competition_edition_id,
            mr.as_of DESC, mr.calculated_at DESC, mr.id DESC
`;

interface ReadingRow {
  readonly module_key: string;
  readonly team_id: string;
  readonly context_kind_code: string;
  readonly context_competition_edition_id: string | null;
  readonly as_of: Date;
  readonly calculated_at: Date;
  readonly module_status_code: string;
  readonly strength: string | null;
  readonly confidence: string | null;
  readonly sample_observation_count: number | string;
  readonly sample_meets_threshold: boolean;
  readonly verdict_text: string | null;
  readonly inactive_reason: string | null;
}

const numeric = (value: string | null): number | null => (value === null ? null : Number(value));

/** Maps a raw row to the typed reading. numeric/bigint columns arrive as strings. */
export function mapReadingRow(row: ReadingRow): TeamModuleReading {
  return {
    moduleKey: row.module_key,
    teamId: row.team_id,
    contextKindCode: row.context_kind_code,
    contextCompetitionEditionId: row.context_competition_edition_id,
    asOf: row.as_of,
    calculatedAt: row.calculated_at,
    moduleStatusCode: row.module_status_code,
    strength: numeric(row.strength),
    confidence: numeric(row.confidence),
    sampleObservationCount: Number(row.sample_observation_count),
    sampleMeetsThreshold: row.sample_meets_threshold,
    verdictText: row.verdict_text,
    inactiveReason: row.inactive_reason,
  };
}

/**
 * Returns the current module reading for each (team, module, context). Read-only.
 * Empty `teamIds` → [] with no query issued.
 */
export async function readCurrentTeamReadings(
  tx: PoolClient,
  params: ReadTeamModuleReadingsParams
): Promise<TeamModuleReading[]> {
  if (params.teamIds.length === 0) return [];
  const asOf = params.asOf ?? new Date();
  const moduleKeys = params.moduleKeys && params.moduleKeys.length > 0 ? [...params.moduleKeys] : null;
  const contextEditionId = params.contextCompetitionEditionId ?? null;

  const result = await tx.query<ReadingRow>(CURRENT_TEAM_READINGS_SQL, [
    params.teamIds,
    asOf,
    moduleKeys,
    contextEditionId,
  ]);
  return result.rows.map(mapReadingRow);
}

/**
 * Convenience for the product path: the current readings for the two ACTIVE
 * modules, for a fixture's two teams in that fixture's competition edition.
 * Returns readiness_tracker (ALL_COMPETITIONS) + home_away_split (that edition).
 */
export function readActiveMatchReadings(
  tx: PoolClient,
  params: { homeTeamId: string; awayTeamId: string; competitionEditionId: string; asOf?: Date }
): Promise<TeamModuleReading[]> {
  return readCurrentTeamReadings(tx, {
    teamIds: [params.homeTeamId, params.awayTeamId],
    asOf: params.asOf,
    moduleKeys: ACTIVE_MODULE_KEYS,
    contextCompetitionEditionId: params.competitionEditionId,
  });
}
