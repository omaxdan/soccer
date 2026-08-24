// ─────────────────────────────────────────────────────────────────────────────
// S-7 SELECTION — what a snapshot may seal (read-only, schema-qualified)
//
// Selects EXISTING rows by their governed composite identity; it computes no
// intelligence. Everything here reuses the established discipline:
//   • current reading = DISTINCT ON (team, module def, context) ORDER BY
//     as_of DESC, calculated_at DESC, id DESC — identical to module/read/readings.
//   • as-of ceiling = the snapshot's snapshot_as_of; cited rows satisfy
//     as_of <= snapshot_as_of (the schema's contamination CHECK is authoritative).
//   • context = ALL_COMPETITIONS (NULL edition) OR this fixture's edition.
//   • INACTIVE readings are excluded — a snapshot cites SPOKE readings; silent
//     modules are recorded by completeness, not cited as evidence.
//
// It returns ROW IDENTITIES (reading id+as_of, feature value id+as_of, version
// ids) because sealing CITES rows — snapshot_module_reading and
// snapshot_feature_state reference the exact source under RESTRICT, which is what
// promotes those rows to permanent.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { CitedFeatureValue, EligibleModule, EngagedStatus, SpokeReading } from '../verdict';

/** A fixture that may be sealed. */
export interface FixtureToSeal {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string; // YYYY-MM-DD
  readonly kickoffAt: Date;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly competitionEditionId: string;
}

/** A pre-match snapshot point and its offset from kickoff, in whole seconds. */
export interface SnapshotPoint {
  readonly code: string;
  readonly offsetSeconds: number;
  readonly isCanonical: boolean;
}

/** A resolved version identity in force at an instant. */
export interface VersionInForce {
  readonly id: string;
  readonly designation: string;
}

const FIXTURES_TO_SEAL_SQL = `
  SELECT f.id::text                     AS fixture_id,
         f.fixture_partition_on::text   AS fixture_partition_on,
         f.scheduled_kickoff_at         AS kickoff_at,
         f.home_team_id::text           AS home_team_id,
         f.away_team_id::text           AS away_team_id,
         f.competition_edition_id::text AS competition_edition_id
    FROM football.fixture f
   WHERE f.scheduled_kickoff_at >= $1::timestamptz
     AND f.scheduled_kickoff_at <  $2::timestamptz
   ORDER BY f.scheduled_kickoff_at, f.id
`;

/** Fixtures whose kickoff falls in [from, to). */
export async function readFixturesToSeal(tx: PoolClient, from: Date, to: Date): Promise<FixtureToSeal[]> {
  const { rows } = await tx.query<{
    fixture_id: string; fixture_partition_on: string; kickoff_at: Date;
    home_team_id: string; away_team_id: string; competition_edition_id: string;
  }>(FIXTURES_TO_SEAL_SQL, [from, to]);
  return rows.map((r) => ({
    fixtureId: r.fixture_id,
    fixturePartitionOn: r.fixture_partition_on,
    kickoffAt: r.kickoff_at,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    competitionEditionId: r.competition_edition_id,
  }));
}

/** One fixture by id (for a targeted seal). */
export async function readFixtureById(tx: PoolClient, fixtureId: string): Promise<FixtureToSeal | null> {
  const { rows } = await tx.query<{
    fixture_id: string; fixture_partition_on: string; kickoff_at: Date;
    home_team_id: string; away_team_id: string; competition_edition_id: string;
  }>(
    `SELECT f.id::text AS fixture_id, f.fixture_partition_on::text AS fixture_partition_on,
            f.scheduled_kickoff_at AS kickoff_at, f.home_team_id::text AS home_team_id,
            f.away_team_id::text AS away_team_id, f.competition_edition_id::text AS competition_edition_id
       FROM football.fixture f WHERE f.id = $1::bigint`,
    [fixtureId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    fixtureId: r.fixture_id, fixturePartitionOn: r.fixture_partition_on, kickoffAt: r.kickoff_at,
    homeTeamId: r.home_team_id, awayTeamId: r.away_team_id, competitionEditionId: r.competition_edition_id,
  };
}

/** The snapshot points in force, offset converted to whole seconds (ER-01-safe). */
export async function readSnapshotPoints(tx: PoolClient): Promise<SnapshotPoint[]> {
  const { rows } = await tx.query<{ code: string; offset_seconds: string; is_canonical: boolean }>(
    `SELECT code, EXTRACT(EPOCH FROM offset_before_kick)::bigint::text AS offset_seconds, is_canonical
       FROM football.snapshot_point
      WHERE effective_to IS NULL OR effective_to > now()
      ORDER BY offset_before_kick DESC`
  );
  return rows.map((r) => ({ code: r.code, offsetSeconds: Number(r.offset_seconds), isCanonical: r.is_canonical }));
}

/**
 * The eligible-active modules for a TEAM-vs-TEAM fixture. Eligible =
 * is_active AND subject kind applies to the fixture. TEAM applies to both
 * participants (2 slots); FIXTURE applies once (1 slot). COMPETITION_EDITION
 * modules are NOT per-fixture eligible (their subject is the edition), so they
 * are excluded — a governed decision, documented in the S-7 contract.
 */
export async function readEligibleModules(tx: PoolClient): Promise<EligibleModule[]> {
  const { rows } = await tx.query<{ module_key: string; module_definition_id: string; subject_kind_code: string }>(
    `SELECT module_key, id::text AS module_definition_id, subject_kind_code
       FROM module.module_definition
      WHERE is_active = true AND subject_kind_code IN ('TEAM','FIXTURE')
      ORDER BY module_key`
  );
  return rows.map((r) => ({
    moduleKey: r.module_key,
    moduleDefinitionId: r.module_definition_id,
    subjectKindCode: r.subject_kind_code as 'TEAM' | 'FIXTURE',
    applicableSubjectCount: r.subject_kind_code === 'TEAM' ? 2 : 1,
  }));
}

// The current SPOKE reading per (subject, module def, context) at or before the
// ceiling — the same current-reading selection used everywhere in V2, made
// subject-aware (S-7.x): a TEAM reading belongs to a fixture team; a FIXTURE
// reading belongs directly to the fixture. The DISTINCT ON key leads with the
// subject columns so a TEAM reading can never suppress a FIXTURE one, and one
// team's reading can never suppress the other's.
//   $1 team ids, $2 as_of ceiling, $3 context edition | null, $4 fixture id
const CURRENT_SPOKE_CTE = `
  WITH current_reading AS (
    SELECT DISTINCT ON (mr.subject_kind_code, mr.subject_team_id, mr.subject_fixture_id,
                        mr.module_definition_id, mr.context_kind_code, mr.context_competition_edition_id)
           mr.id                                    AS reading_id,
           mr.as_of                                 AS reading_as_of,
           md.module_key                            AS module_key,
           mr.module_definition_id::text            AS module_definition_id,
           mr.module_version_id::text               AS module_version_id,
           mr.subject_kind_code                     AS subject_kind_code,
           mr.subject_team_id::text                 AS team_id,
           mr.subject_fixture_id::text              AS fixture_id,
           mr.module_status_code                    AS status,
           mr.sample_observation_count              AS sample_observation_count,
           mr.sample_meets_threshold                AS sample_meets_threshold,
           mr.context_kind_code                     AS context_kind_code,
           mr.context_competition_edition_id::text  AS context_competition_edition_id
      FROM module.module_reading mr
      JOIN module.module_definition md ON md.id = mr.module_definition_id
     WHERE ((mr.subject_kind_code = 'TEAM' AND mr.subject_team_id = ANY($1::bigint[]))
            OR (mr.subject_kind_code = 'FIXTURE' AND mr.subject_fixture_id = $4::bigint))
       AND mr.as_of <= $2::timestamptz
       AND mr.module_status_code <> 'INACTIVE'
       AND (mr.context_competition_edition_id IS NULL
            OR $3::bigint IS NULL
            OR mr.context_competition_edition_id = $3::bigint)
     ORDER BY mr.subject_kind_code, mr.subject_team_id, mr.subject_fixture_id,
              mr.module_definition_id, mr.context_kind_code, mr.context_competition_edition_id,
              mr.as_of DESC, mr.calculated_at DESC, mr.id DESC
  )
`;

interface ReadingRow {
  reading_id: string; reading_as_of: Date; module_key: string; module_definition_id: string;
  module_version_id: string; subject_kind_code: string; team_id: string | null; fixture_id: string | null; status: string;
  sample_observation_count: number; sample_meets_threshold: boolean;
  context_kind_code: string; context_competition_edition_id: string | null;
  declared_input_count: number; present_input_count: number;
}

interface CitedRow {
  reading_id: string; contribution_direction: string;
  feature_value_id: string; feature_value_as_of: Date; feature_version_id: string;
  feature_definition_id: string; feature_key: string; subject_team_id: string | null; value: string;
  provenance_class_code: string; sample_observation_count: number; sample_meets_threshold: boolean;
}

/**
 * The current spoke readings for the fixture's two teams as of the ceiling, each
 * with its evidence set counts and its cited feature values. Read-only.
 * `teamIds` empty → []. Assembled in TS from two schema-qualified selects that
 * share the identical current-reading CTE, so the citation set matches the reading
 * set exactly.
 */
export async function readSpokeReadings(
  tx: PoolClient,
  params: {
    readonly teamIds: readonly string[];
    readonly asOf: Date;
    readonly competitionEditionId: string | null;
    /** The fixture whose FIXTURE-subject readings are also selected (S-7.x). */
    readonly fixtureId: string;
  }
): Promise<SpokeReading[]> {
  if (params.teamIds.length === 0) return [];
  const args = [params.teamIds, params.asOf, params.competitionEditionId, params.fixtureId];

  const readings = await tx.query<ReadingRow>(
    `${CURRENT_SPOKE_CTE}
     SELECT cr.reading_id, cr.reading_as_of, cr.module_key, cr.module_definition_id,
            cr.module_version_id, cr.subject_kind_code, cr.team_id, cr.fixture_id, cr.status,
            cr.sample_observation_count, cr.sample_meets_threshold,
            cr.context_kind_code, cr.context_competition_edition_id,
            me.declared_input_count, me.present_input_count
       FROM current_reading cr
       JOIN module.module_evidence me
         ON me.module_reading_id = cr.reading_id AND me.reading_as_of = cr.reading_as_of
      ORDER BY cr.subject_kind_code, cr.team_id, cr.fixture_id, cr.module_key`,
    args
  );

  const cited = await tx.query<CitedRow>(
    `${CURRENT_SPOKE_CTE}
     SELECT cr.reading_id,
            mei.contribution_direction,
            fv.id::text                 AS feature_value_id,
            fv.as_of                    AS feature_value_as_of,
            fv.feature_version_id::text AS feature_version_id,
            d.id::text                  AS feature_definition_id,
            d.feature_key               AS feature_key,
            fv.subject_team_id::text    AS subject_team_id,
            fv.value::text              AS value,
            fv.provenance_class_code    AS provenance_class_code,
            fv.sample_observation_count AS sample_observation_count,
            fv.sample_meets_threshold   AS sample_meets_threshold
       FROM current_reading cr
       JOIN module.module_evidence me
         ON me.module_reading_id = cr.reading_id AND me.reading_as_of = cr.reading_as_of
       JOIN module.module_evidence_item mei
         ON mei.module_evidence_id = me.id AND mei.reading_as_of = me.reading_as_of
       JOIN feature.feature_value fv
         ON fv.id = mei.cited_feature_value_id AND fv.as_of = mei.cited_feature_value_as_of
       JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
      ORDER BY cr.reading_id, d.feature_key, fv.id`,
    args
  );

  const citedByReading = new Map<string, CitedFeatureValue[]>();
  for (const c of cited.rows) {
    const list = citedByReading.get(c.reading_id) ?? [];
    list.push({
      featureValueId: c.feature_value_id,
      featureValueAsOf: c.feature_value_as_of,
      featureVersionId: c.feature_version_id,
      featureDefinitionId: c.feature_definition_id,
      featureKey: c.feature_key,
      subjectTeamId: c.subject_team_id,
      value: c.value,
      provenanceClassCode: c.provenance_class_code,
      sampleObservationCount: Number(c.sample_observation_count),
      sampleMeetsThreshold: c.sample_meets_threshold,
      contributionDirection: c.contribution_direction as CitedFeatureValue['contributionDirection'],
    });
    citedByReading.set(c.reading_id, list);
  }

  return readings.rows.map((r) => ({
    readingId: r.reading_id,
    readingAsOf: r.reading_as_of,
    moduleKey: r.module_key,
    moduleDefinitionId: r.module_definition_id,
    moduleVersionId: r.module_version_id,
    subjectKindCode: r.subject_kind_code as 'TEAM' | 'FIXTURE',
    teamId: r.team_id,
    fixtureId: r.fixture_id,
    status: r.status as EngagedStatus,
    sampleObservationCount: Number(r.sample_observation_count),
    sampleMeetsThreshold: r.sample_meets_threshold,
    contextKindCode: r.context_kind_code,
    contextCompetitionEditionId: r.context_competition_edition_id,
    declaredInputCount: Number(r.declared_input_count),
    presentInputCount: Number(r.present_input_count),
    citedValues: citedByReading.get(r.reading_id) ?? [],
  }));
}

type VersionRelation =
  | 'module.verdict_composition_version'
  | 'module.consensus_rule_version'
  | 'module.checksum_algorithm_version';

/**
 * The single version identity in force at `asOf` (effective_period @> asOf), or
 * null when none is — which happens for an as_of PRECEDING the rule's genesis. A
 * snapshot cannot be sealed without a governing rule, so the caller SKIPS such a
 * point rather than fabricating one. (In production the rules predate every
 * fixture; this only arises for an as_of before the rules were registered.)
 */
export async function tryResolveVersionInForce(
  tx: PoolClient,
  relation: VersionRelation,
  asOf: Date
): Promise<VersionInForce | null> {
  const { rows } = await tx.query<{ id: string; designation: string }>(
    `SELECT id::text, designation FROM ${relation} WHERE effective_period @> $1::timestamptz ORDER BY id DESC LIMIT 1`,
    [asOf]
  );
  return rows.length === 0 ? null : { id: rows[0].id, designation: rows[0].designation };
}

/** As `tryResolveVersionInForce`, but throws when none is in force. */
export async function resolveVersionInForce(tx: PoolClient, relation: VersionRelation, asOf: Date): Promise<VersionInForce> {
  const resolved = await tryResolveVersionInForce(tx, relation, asOf);
  if (!resolved) throw new Error(`no ${relation} in force at ${asOf.toISOString()}; a snapshot cannot be sealed without it`);
  return resolved;
}
