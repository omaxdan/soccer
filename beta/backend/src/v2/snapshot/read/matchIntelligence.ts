// ─────────────────────────────────────────────────────────────────────────────
// MATCH INTELLIGENCE — consolidated sealed-snapshot read model (S-7/S-8/B3, read-only)
//
// The serving-side read that turns the SEALED GOVERNED SNAPSHOT into a single
// Match Intelligence object for the /v2 product surface. It computes NOTHING — it
// selects existing sealed rows and maps them. It is the counterpart of the seal
// path: `seal.ts` writes the immutable record; this reads it back for the UI.
//
// GOVERNANCE POSTURE (do not weaken):
//   • Intelligence here is the SEALED snapshot — verdict, governed edges, Team
//     Preparedness, and the CITED evidence (snapshot_feature_state) — never a live
//     feature/module read substituted for it.
//   • CITED EVIDENCE (this model) is what the sealed calculation actually
//     referenced. DISPLAYED CONTEXT (recent form, venue form, live team features)
//     is NOT part of this model — it is composed at the API layer from the existing
//     live read services and kept in a separate array, so context is never
//     presented as calculation substrate. This model therefore exposes
//     `citedEvidence[]` only, by construction.
//   • ABSENCE STAYS ABSENCE: a component with no cited value simply does not appear
//     in `citedEvidence`, and preparedness `available_points < declared_points`
//     discloses the shortfall. Nothing is zero-filled and no weight is redistributed.
//   • Numerics are carried as PostgreSQL numeric TEXT (scale preserved), never
//     converted to a JS float — the same discipline the seal/composition observe.
//     Only genuine integer counts become numbers.
//   • Graded fields with no governed substrate (readiness/travel/congestion/
//     availability edges, risk, confidence, historical reliability) are surfaced as
//     NULL, honestly — never fabricated.
//
// "Current applicable sealed snapshot" for a fixture = the most recently sealed
// snapshot (greatest snapshot_as_of) for that fixture, with its governing
// composition version resolved from the registry. Fixtures with one sealed point
// return that point; none sealed → null.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readSnapshotPreparedness, type SnapshotPreparednessSide } from './snapshotPreparedness';

/** A.6 provenance — what the snapshot IS and under which governed versions it was sealed. */
export interface IntelligenceProvenance {
  readonly fixtureId: string;
  readonly matchSnapshotId: string;
  readonly fixturePartitionOn: string;
  readonly snapshotPointCode: string;
  readonly snapshotAsOf: string; // ISO-8601 UTC
  readonly sealedAt: string; // ISO-8601 UTC (distinct from snapshotAsOf: backfill is legible)
  readonly verdictCompositionVersion: string; // designation, e.g. '1.3.0'
  readonly checksumAlgorithmVersion: string; // designation, e.g. 'v1'
  readonly contentChecksumHex: string;
  /** The sealed family is immutable by construction (PD-01/R-23). */
  readonly immutable: true;
}

/** The sealed verdict. Non-directional (LC-71): counts + completeness + governed edges. */
export interface IntelligenceVerdict {
  readonly consensusSupportsCount: number;
  readonly consensusContradictsCount: number;
  readonly consensusNeutralCount: number;
  readonly consensusInactiveCount: number;
  readonly evidenceCount: number;
  readonly completenessRatio: string; // numeric text
  /** Governed comparative edges (S-8). Home-relative numeric text, or null when
   *  ungoverned/absent. NO prediction/probability semantics. */
  readonly formEdge: string | null;
  readonly restEdge: string | null;
  /** Graded fields with no governed substrate — surfaced as null, never fabricated. */
  readonly readinessEdge: string | null;
  readonly travelEdge: string | null;
  readonly congestionEdge: string | null;
  readonly availabilityEdge: string | null;
  readonly riskScore: string | null;
  readonly confidence: string | null; // null until calibration (S-9) produces it
  readonly historicalReliabilityBaselineId: string | null;
}

/** One side's sealed Team Preparedness, with the team it scores. */
export interface PreparednessSideView extends SnapshotPreparednessSide {
  /** The team this side scores (HOME → fixture home team, AWAY → away). */
  readonly teamId: string | null;
}

/** One feature value the sealed calculation CITED (from snapshot_feature_state). */
export interface CitedEvidenceItem {
  readonly featureKey: string;
  readonly subjectTeamId: string | null;
  readonly value: string; // numeric text, scale preserved
  readonly featureVersionId: string;
  readonly featureValueId: string;
  readonly citedAsOf: string; // ISO-8601 UTC
  readonly provenanceClassCode: string;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
}

/** The consolidated sealed Match Intelligence for one fixture. Sealed content only;
 *  displayed context is composed separately at the API layer. */
export interface MatchIntelligence {
  readonly provenance: IntelligenceProvenance;
  readonly verdict: IntelligenceVerdict;
  readonly preparedness: readonly PreparednessSideView[];
  readonly citedEvidence: readonly CitedEvidenceItem[];
}

/** ISO-8601 UTC from a pg timestamptz (Date) or an already-ISO string. Pure. */
function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ── Raw row shapes (as the queries below project them) ──────────────────────────

export interface SnapshotHeadRow {
  match_snapshot_id: string;
  fixture_id: string;
  fixture_partition_on: string;
  snapshot_point_code: string;
  snapshot_as_of: Date | string;
  sealed_at: Date | string;
  content_checksum_hex: string;
  verdict_composition_version: string;
  checksum_algorithm_version: string;
}

export interface VerdictRow {
  consensus_supports_count: number | string;
  consensus_contradicts_count: number | string;
  consensus_neutral_count: number | string;
  consensus_inactive_count: number | string;
  evidence_count: number | string;
  completeness_ratio: string;
  form_edge: string | null;
  rest_edge: string | null;
  readiness_edge: string | null;
  travel_edge: string | null;
  congestion_edge: string | null;
  availability_edge: string | null;
  risk_score: string | null;
  confidence: string | null;
  historical_reliability_baseline_id: string | null;
}

export interface CitedEvidenceRow {
  feature_key: string;
  subject_team_id: string | null;
  value: string;
  feature_version_id: string;
  feature_value_id: string;
  cited_as_of: Date | string;
  provenance_class_code: string;
  sample_observation_count: number | string;
  sample_meets_threshold: boolean;
}

// ── Pure mappers (DB-free; unit-tested) ─────────────────────────────────────────

/** Maps the snapshot head row to provenance. Pure. */
export function mapProvenance(row: SnapshotHeadRow): IntelligenceProvenance {
  return {
    fixtureId: row.fixture_id,
    matchSnapshotId: row.match_snapshot_id,
    fixturePartitionOn: row.fixture_partition_on,
    snapshotPointCode: row.snapshot_point_code,
    snapshotAsOf: isoOf(row.snapshot_as_of),
    sealedAt: isoOf(row.sealed_at),
    verdictCompositionVersion: row.verdict_composition_version,
    checksumAlgorithmVersion: row.checksum_algorithm_version,
    contentChecksumHex: row.content_checksum_hex,
    immutable: true,
  };
}

/** Maps the verdict row. Integer counts → numbers; every numeric/graded field stays
 *  its exact text, or null. No fabricated zeros. Pure. */
export function mapVerdict(row: VerdictRow): IntelligenceVerdict {
  return {
    consensusSupportsCount: Number(row.consensus_supports_count),
    consensusContradictsCount: Number(row.consensus_contradicts_count),
    consensusNeutralCount: Number(row.consensus_neutral_count),
    consensusInactiveCount: Number(row.consensus_inactive_count),
    evidenceCount: Number(row.evidence_count),
    completenessRatio: row.completeness_ratio,
    formEdge: row.form_edge,
    restEdge: row.rest_edge,
    readinessEdge: row.readiness_edge,
    travelEdge: row.travel_edge,
    congestionEdge: row.congestion_edge,
    availabilityEdge: row.availability_edge,
    riskScore: row.risk_score,
    confidence: row.confidence,
    historicalReliabilityBaselineId: row.historical_reliability_baseline_id,
  };
}

/** Maps one cited-evidence row. Value kept as text (never a float). Pure. */
export function mapCitedEvidence(row: CitedEvidenceRow): CitedEvidenceItem {
  return {
    featureKey: row.feature_key,
    subjectTeamId: row.subject_team_id,
    value: row.value,
    featureVersionId: row.feature_version_id,
    featureValueId: row.feature_value_id,
    citedAsOf: isoOf(row.cited_as_of),
    provenanceClassCode: row.provenance_class_code,
    sampleObservationCount: Number(row.sample_observation_count),
    sampleMeetsThreshold: row.sample_meets_threshold,
  };
}

/** Attaches the scored team id to each preparedness side (HOME→home, AWAY→away).
 *  A side keeps its sealed values verbatim; nothing is invented. Pure. */
export function attachPreparednessTeams(
  preparedness: readonly SnapshotPreparednessSide[],
  fixture: { readonly homeTeamId: string; readonly awayTeamId: string }
): readonly PreparednessSideView[] {
  return preparedness.map((p) => ({
    ...p,
    teamId: p.side === 'HOME' ? fixture.homeTeamId : p.side === 'AWAY' ? fixture.awayTeamId : null,
  }));
}

/** Assembles the sealed Match Intelligence object from its already-mapped parts.
 *  Pure — cited evidence and context are never mixed (context is not in this model). */
export function assembleMatchIntelligence(parts: {
  readonly provenance: IntelligenceProvenance;
  readonly verdict: IntelligenceVerdict;
  readonly preparedness: readonly PreparednessSideView[];
  readonly citedEvidence: readonly CitedEvidenceItem[];
}): MatchIntelligence {
  return {
    provenance: parts.provenance,
    verdict: parts.verdict,
    preparedness: parts.preparedness,
    citedEvidence: parts.citedEvidence,
  };
}

// ── DB read (thin; delegates all mapping to the pure functions above) ────────────

const SNAPSHOT_HEAD_SQL = `
  SELECT ms.id::text                       AS match_snapshot_id,
         ms.fixture_id::text               AS fixture_id,
         ms.fixture_partition_on::text     AS fixture_partition_on,
         ms.snapshot_point_code            AS snapshot_point_code,
         ms.snapshot_as_of                 AS snapshot_as_of,
         ms.sealed_at                      AS sealed_at,
         encode(ms.content_checksum,'hex') AS content_checksum_hex,
         vcv.designation                   AS verdict_composition_version,
         cav.designation                   AS checksum_algorithm_version
    FROM snapshot.match_snapshot ms
    JOIN module.verdict_composition_version vcv ON vcv.id = ms.verdict_composition_version_id
    JOIN module.checksum_algorithm_version  cav ON cav.id = ms.checksum_algorithm_version_id
   WHERE ms.fixture_id = $1::bigint
   ORDER BY ms.snapshot_as_of DESC, ms.id DESC
   LIMIT 1
`;

const VERDICT_SQL = `
  SELECT consensus_supports_count, consensus_contradicts_count, consensus_neutral_count,
         consensus_inactive_count, evidence_count,
         completeness_ratio::text                 AS completeness_ratio,
         form_edge::text                           AS form_edge,
         rest_edge::text                           AS rest_edge,
         readiness_edge::text                      AS readiness_edge,
         travel_edge::text                         AS travel_edge,
         congestion_edge::text                     AS congestion_edge,
         availability_edge::text                   AS availability_edge,
         risk_score::text                          AS risk_score,
         confidence::text                          AS confidence,
         historical_reliability_baseline_id::text  AS historical_reliability_baseline_id
    FROM snapshot.snapshot_verdict
   WHERE match_snapshot_id = $1::bigint AND fixture_partition_on = $2::date
`;

const CITED_EVIDENCE_SQL = `
  SELECT d.feature_key                 AS feature_key,
         fv.subject_team_id::text       AS subject_team_id,
         fv.value::text                 AS value,
         fv.feature_version_id::text    AS feature_version_id,
         fv.id::text                    AS feature_value_id,
         fs.cited_as_of                 AS cited_as_of,
         fv.provenance_class_code       AS provenance_class_code,
         fv.sample_observation_count    AS sample_observation_count,
         fv.sample_meets_threshold      AS sample_meets_threshold
    FROM snapshot.snapshot_feature_state fs
    JOIN feature.feature_value fv
      ON fv.id = fs.cited_feature_value_id AND fv.as_of = fs.cited_as_of
    JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
   WHERE fs.match_snapshot_id = $1::bigint AND fs.fixture_partition_on = $2::date
   ORDER BY d.feature_key, fv.subject_team_id
`;

const FIXTURE_TEAMS_SQL = `
  SELECT home_team_id::text AS home_team_id, away_team_id::text AS away_team_id
    FROM football.fixture WHERE id = $1::bigint
`;

/**
 * The consolidated sealed Match Intelligence for one fixture, or null when the
 * fixture has no sealed snapshot. Read-only; reuses `readSnapshotPreparedness`.
 */
export async function readMatchIntelligence(
  tx: PoolClient,
  fixtureId: string
): Promise<MatchIntelligence | null> {
  const head = await tx.query<SnapshotHeadRow>(SNAPSHOT_HEAD_SQL, [fixtureId]);
  if (head.rows.length === 0) return null;
  const h = head.rows[0];

  const [verdictRes, citedRes, teamsRes, preparednessSides] = await Promise.all([
    tx.query<VerdictRow>(VERDICT_SQL, [h.match_snapshot_id, h.fixture_partition_on]),
    tx.query<CitedEvidenceRow>(CITED_EVIDENCE_SQL, [h.match_snapshot_id, h.fixture_partition_on]),
    tx.query<{ home_team_id: string; away_team_id: string }>(FIXTURE_TEAMS_SQL, [h.fixture_id]),
    readSnapshotPreparedness(tx, {
      matchSnapshotId: h.match_snapshot_id,
      fixturePartitionOn: h.fixture_partition_on,
    }),
  ]);

  // A snapshot always has exactly one verdict (sealed together); guard rather than coerce.
  if (verdictRes.rows.length === 0) {
    throw new Error(`sealed snapshot ${h.match_snapshot_id} has no verdict row (contract breach)`);
  }
  const teams = teamsRes.rows[0] ?? { home_team_id: '', away_team_id: '' };

  return assembleMatchIntelligence({
    provenance: mapProvenance(h),
    verdict: mapVerdict(verdictRes.rows[0]),
    preparedness: attachPreparednessTeams(preparednessSides, {
      homeTeamId: teams.home_team_id,
      awayTeamId: teams.away_team_id,
    }),
    citedEvidence: citedRes.rows.map(mapCitedEvidence),
  });
}
