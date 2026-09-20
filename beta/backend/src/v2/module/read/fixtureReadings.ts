// ─────────────────────────────────────────────────────────────────────────────
// READING CURRENT FIXTURE-SUBJECT MODULE READINGS — the live comparative readings
// (form_gap_accuracy, rest_advantage, travel_impact) for one fixture.
//
// The FIXTURE-subject sibling of readActiveMatchReadings (which is TEAM-only). It
// calculates nothing: the comparison already happened in the module pipeline and is
// recorded in module.module_reading with subject_kind_code = 'FIXTURE'. This selects
// the CURRENT reading per (fixture, module) with DISTINCT ON — the greatest as_of AT
// OR BEFORE the requested instant — exactly like the TEAM reader.
//
// TEMPORAL SAFETY (critical): `asOf` is a REQUIRED upper bound (no default-to-now).
// A reading whose as_of is AFTER the requested instant is NEVER returned — this is
// what keeps a future-dated row (e.g. a Sep-1 fixture carrying an as_of of Oct-11)
// out of pre-match consumption. The caller anchors `asOf` to the fixture's scheduled
// kickoff, matching the rest of the Match read's temporal contract.
//
// Quarantined readings (035) are excluded among the DISTINCT ON candidates, so the
// most recent NON-quarantined reading becomes current rather than the surface going
// dark — identical to the TEAM reader.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** The FIXTURE-subject comparison modules surfaced on the Match page. */
export const FIXTURE_MATCH_MODULE_KEYS = [
  'form_gap_accuracy',
  'rest_advantage',
  'travel_impact',
] as const;

/** One fixture's current reading for one FIXTURE-subject module. Application-shaped. */
export interface FixtureModuleReading {
  readonly moduleKey: string;
  readonly fixtureId: string;
  readonly asOf: Date;
  readonly calculatedAt: Date;
  readonly moduleStatusCode: string;
  readonly strength: number | null;
  readonly confidence: number | null;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly verdictText: string | null;
  readonly inactiveReason: string | null;
}

export interface ReadFixtureModuleReadingsParams {
  readonly fixtureId: string;
  /** Fixture partition (YYYY-MM-DD) — part of the composite fixture subject reference. */
  readonly fixturePartitionOn: string;
  /** REQUIRED upper bound on as_of. A reading later than this is never returned. */
  readonly asOf: Date;
  /** Restrict to these module_key values. Defaults to the three comparison modules. */
  readonly moduleKeys?: readonly string[];
}

/**
 * THE READ. One statement; DISTINCT ON picks the current reading per
 * (fixture, module definition) at or before the cutoff. Read-only, schema-qualified.
 *   $1 fixture id, $2 fixture partition, $3 as_of ceiling, $4 module_keys | null
 */
export const CURRENT_FIXTURE_READINGS_SQL = `
  SELECT DISTINCT ON (mr.subject_fixture_id, mr.module_definition_id)
         md.module_key                            AS module_key,
         mr.subject_fixture_id::text              AS fixture_id,
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
   WHERE mr.subject_kind_code = 'FIXTURE'
     AND mr.subject_fixture_id = $1::bigint
     AND mr.subject_fixture_partition_on = $2::date
     AND mr.as_of <= $3::timestamptz
     AND ($4::text[] IS NULL OR md.module_key = ANY($4::text[]))
     AND NOT EXISTS (
       SELECT 1 FROM module.module_reading_quarantine q
        WHERE q.module_reading_id = mr.id
          AND q.reading_as_of = mr.as_of
     )
   ORDER BY mr.subject_fixture_id, mr.module_definition_id,
            mr.as_of DESC, mr.calculated_at DESC, mr.id DESC
`;

interface FixtureReadingRow {
  readonly module_key: string;
  readonly fixture_id: string;
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
export function mapFixtureReadingRow(row: FixtureReadingRow): FixtureModuleReading {
  return {
    moduleKey: row.module_key,
    fixtureId: row.fixture_id,
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
 * Returns the current FIXTURE-subject module reading for each (fixture, module) at or
 * before `asOf`. Read-only. A fixture with no persisted reading simply yields fewer
 * rows — the caller renders that as an honest unavailable state, never zero.
 */
export async function readFixtureModuleReadings(
  tx: PoolClient,
  params: ReadFixtureModuleReadingsParams
): Promise<FixtureModuleReading[]> {
  const moduleKeys = params.moduleKeys && params.moduleKeys.length > 0
    ? [...params.moduleKeys]
    : [...FIXTURE_MATCH_MODULE_KEYS];

  const result = await tx.query<FixtureReadingRow>(CURRENT_FIXTURE_READINGS_SQL, [
    params.fixtureId,
    params.fixturePartitionOn,
    params.asOf,
    moduleKeys,
  ]);
  return result.rows.map(mapFixtureReadingRow);
}
