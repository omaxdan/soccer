// ─────────────────────────────────────────────────────────────────────────────
// S-7 SEALING — write one immutable, non-directional match snapshot (v1.0.0)
//
// Runs inside an attributed transaction (withRun → tx + job). It SELECTS existing
// readings/evidence/values, TALLIES a non-directional verdict, computes the
// content checksum in the governed canonical order, and INSERTS the sealed family
// in dependency order. Everything commits together or not at all — a partial
// snapshot is never visible as sealed (the schema's ON DELETE RESTRICT chain and
// the sealing guard of migration 015 back this up).
//
// Idempotent: match_snapshot's business identity is
// (fixture, point, verdict_composition_version, consensus_rule_version); a re-seal
// under the same rule versions conflicts and is skipped. A new rule version yields
// a DISTINCT snapshot rather than mutating the old one.
//
// NO new intelligence: no edges, no risk, no confidence, no reliability. Those
// columns are written NULL, structurally, via VerdictRow.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { requireJobRun, type JobRunRef } from '../db/tx';
import { deriveAsOf } from '../feature/driver/eligibility';
import {
  readSpokeReadings,
  readEligibleModules,
  tryResolveVersionInForce,
  type FixtureToSeal,
  type SnapshotPoint,
} from './read/selection';
import {
  tallyConsensus,
  computeCompleteness,
  buildVerdict,
  buildManifest,
  type SpokeReading,
} from './verdict';
import {
  contentChecksum,
  decimal,
  CHECKSUM_ALGORITHM_DESIGNATION,
  type Canonical,
  type SnapshotContent,
} from './canonical';

export type SealOutcome =
  | { readonly status: 'SEALED'; readonly matchSnapshotId: string; readonly snapshotAsOf: Date; readonly evidenceCount: number; readonly completenessRatio: string }
  | { readonly status: 'SKIPPED'; readonly reason: 'ALREADY_SEALED' | 'NO_RULE_IN_FORCE' };

/** completeness_ratio as a fixed-scale decimal string (deterministic, in [0,1]). */
function ratioText(engaged: number, expected: number): string {
  if (expected === 0) return '0.000000';
  return (engaged / expected).toFixed(6);
}

/** Builds the canonical content (governed v1 order) for the checksum. Pure given its inputs. */
export function buildContent(args: {
  readonly fixture: FixtureToSeal;
  readonly snapshotPointCode: string;
  readonly snapshotAsOf: Date;
  readonly verdictCompositionDesignation: string;
  readonly consensusRuleDesignation: string;
  readonly checksumAlgorithmDesignation: string;
  readonly spoke: readonly SpokeReading[];
  readonly manifest: readonly { componentKind: string; componentVersionId: string }[];
  readonly completenessItems: readonly { absenceKind: string; featureDefinitionId: string | null; moduleDefinitionId: string | null }[];
  readonly verdict: {
    consensusSupportsCount: number; consensusContradictsCount: number;
    consensusNeutralCount: number; consensusInactiveCount: number;
    evidenceCount: number; completenessRatioText: string;
  };
}): SnapshotContent {
  const header: Canonical = {
    fixtureId: args.fixture.fixtureId,
    fixturePartitionOn: args.fixture.fixturePartitionOn,
    snapshotPointCode: args.snapshotPointCode,
    snapshotAsOf: args.snapshotAsOf,
    verdictComposition: args.verdictCompositionDesignation,
    consensusRule: args.consensusRuleDesignation,
    checksumAlgorithm: args.checksumAlgorithmDesignation,
  };

  const versionManifest: Canonical[] = args.manifest.map((m) => ({
    componentKind: m.componentKind,
    componentVersionId: m.componentVersionId,
  }));

  // Feature state: distinct cited values, ordered by feature value id.
  const byValueId = new Map<string, Canonical>();
  for (const r of args.spoke) {
    for (const cv of r.citedValues) {
      if (byValueId.has(cv.featureValueId)) continue;
      byValueId.set(cv.featureValueId, {
        featureValueId: cv.featureValueId,
        featureValueAsOf: cv.featureValueAsOf,
        featureVersionId: cv.featureVersionId,
        featureKey: cv.featureKey,
        value: decimal(cv.value),
        provenanceClassCode: cv.provenanceClassCode,
        sampleObservationCount: cv.sampleObservationCount,
        sampleMeetsThreshold: cv.sampleMeetsThreshold,
      });
    }
  }
  const featureState = [...byValueId.entries()]
    .sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0))
    .map(([, v]) => v);

  const moduleReadings: Canonical[] = [...args.spoke]
    .sort((a, b) => (BigInt(a.readingId) < BigInt(b.readingId) ? -1 : BigInt(a.readingId) > BigInt(b.readingId) ? 1 : 0))
    .map((r) => ({
      readingId: r.readingId,
      readingAsOf: r.readingAsOf,
      moduleKey: r.moduleKey,
      teamId: r.teamId,
      status: r.status,
      sampleObservationCount: r.sampleObservationCount,
      sampleMeetsThreshold: r.sampleMeetsThreshold,
      contextKindCode: r.contextKindCode,
      contextCompetitionEditionId: r.contextCompetitionEditionId,
      moduleVersionId: r.moduleVersionId,
    }));

  const completenessItems: Canonical[] = [...args.completenessItems]
    .map((i) => ({ absenceKind: i.absenceKind, featureDefinitionId: i.featureDefinitionId, moduleDefinitionId: i.moduleDefinitionId }))
    .sort((a, b) => canonKey(a) < canonKey(b) ? -1 : canonKey(a) > canonKey(b) ? 1 : 0);

  const verdict: Canonical = {
    consensusSupportsCount: args.verdict.consensusSupportsCount,
    consensusContradictsCount: args.verdict.consensusContradictsCount,
    consensusNeutralCount: args.verdict.consensusNeutralCount,
    consensusInactiveCount: args.verdict.consensusInactiveCount,
    evidenceCount: args.verdict.evidenceCount,
    completenessRatio: decimal(args.verdict.completenessRatioText),
    // NON-DIRECTIONAL: every graded field is null, part of the hashed content.
    readinessEdge: null, formEdge: null, travelEdge: null, restEdge: null,
    congestionEdge: null, availabilityEdge: null, riskScore: null,
    confidence: null, historicalReliabilityBaselineId: null,
  };

  return { header, versionManifest, featureState, moduleReadings, modelOutputs: [], completenessItems, verdict };
}

function canonKey(i: { absenceKind: string; featureDefinitionId: string | null; moduleDefinitionId: string | null }): string {
  return `${i.absenceKind}|${i.featureDefinitionId ?? ''}|${i.moduleDefinitionId ?? ''}`;
}

/**
 * Seals ONE snapshot for a fixture at one snapshot point, within the caller's
 * attributed transaction. Returns SEALED with the new id, or SKIPPED when a
 * snapshot for this (fixture, point, rule versions) already exists.
 */
export async function sealSnapshot(
  tx: PoolClient,
  job: JobRunRef | null,
  params: { readonly fixture: FixtureToSeal; readonly snapshotPoint: SnapshotPoint }
): Promise<SealOutcome> {
  const attribution = requireJobRun(job, 'Sealing a match snapshot');
  const { fixture, snapshotPoint } = params;
  const snapshotAsOf = deriveAsOf(fixture.kickoffAt, snapshotPoint.offsetSeconds);

  // 1. Select existing content (as of the snapshot instant, context-matched).
  const [spoke, eligible, verdictV, consensusV, checksumV] = await Promise.all([
    readSpokeReadings(tx, {
      teamIds: [fixture.homeTeamId, fixture.awayTeamId],
      asOf: snapshotAsOf,
      competitionEditionId: fixture.competitionEditionId,
      fixtureId: fixture.fixtureId,
    }),
    readEligibleModules(tx),
    tryResolveVersionInForce(tx, 'module.verdict_composition_version', snapshotAsOf),
    tryResolveVersionInForce(tx, 'module.consensus_rule_version', snapshotAsOf),
    tryResolveVersionInForce(tx, 'module.checksum_algorithm_version', snapshotAsOf),
  ]);
  // A snapshot whose as-of precedes the governing rules cannot be sealed — there is
  // no rule to seal it under. Skip honestly rather than fabricate a rule identity.
  if (!verdictV || !consensusV || !checksumV) return { status: 'SKIPPED', reason: 'NO_RULE_IN_FORCE' };

  // 2. Tally (pure, non-directional).
  const consensus = tallyConsensus(spoke, eligible);
  const completeness = computeCompleteness(spoke, eligible);
  const verdict = buildVerdict(consensus, completeness);
  const manifest = buildManifest(spoke, {
    verdictCompositionVersionId: verdictV.id,
    consensusRuleVersionId: consensusV.id,
    checksumAlgorithmVersionId: checksumV.id,
  });
  const completenessRatioTxt = ratioText(completeness.engagedModuleCount, completeness.expectedModuleCount);

  // 3. Canonical content → checksum.
  const content = buildContent({
    fixture,
    snapshotPointCode: snapshotPoint.code,
    snapshotAsOf,
    verdictCompositionDesignation: verdictV.designation,
    consensusRuleDesignation: consensusV.designation,
    checksumAlgorithmDesignation: checksumV.designation,
    spoke,
    manifest,
    completenessItems: completeness.items,
    verdict: {
      consensusSupportsCount: verdict.consensusSupportsCount,
      consensusContradictsCount: verdict.consensusContradictsCount,
      consensusNeutralCount: verdict.consensusNeutralCount,
      consensusInactiveCount: verdict.consensusInactiveCount,
      evidenceCount: verdict.evidenceCount,
      completenessRatioText: completenessRatioTxt,
    },
  });
  const checksum = contentChecksum(content);

  // 4. Insert match_snapshot (idempotent on the business identity).
  const inserted = await tx.query<{ id: string; fixture_partition_on: string; snapshot_as_of: Date }>(
    `INSERT INTO snapshot.match_snapshot
       (fixture_partition_on, fixture_id, snapshot_point_code, snapshot_as_of,
        verdict_composition_version_id, consensus_rule_version_id,
        content_checksum, checksum_algorithm_version_id,
        pipeline_job_run_id, pipeline_job_run_occurred_at)
     VALUES ($1::date, $2::bigint, $3::text, $4::timestamptz,
             $5::bigint, $6::bigint, $7::bytea, $8::bigint, $9::bigint, $10::timestamptz)
     ON CONFLICT ON CONSTRAINT uq_match_snapshot__fixture_point_versions DO NOTHING
     RETURNING id::text, fixture_partition_on::text, snapshot_as_of`,
    [
      fixture.fixturePartitionOn, fixture.fixtureId, snapshotPoint.code, snapshotAsOf,
      verdictV.id, consensusV.id, checksum, checksumV.id,
      attribution.id, attribution.occurredAt,
    ]
  );
  if (inserted.rows.length === 0) return { status: 'SKIPPED', reason: 'ALREADY_SEALED' };

  const snapshotId = inserted.rows[0].id;
  const partitionOn = inserted.rows[0].fixture_partition_on;

  // 5. Version manifest — every referenced version, LC-103 complete.
  for (const m of manifest) {
    await tx.query(
      `INSERT INTO snapshot.snapshot_version_component
         (fixture_partition_on, match_snapshot_id, component_kind, component_version_id)
       VALUES ($1::date, $2::bigint, $3::text, $4::bigint)`,
      [partitionOn, snapshotId, m.componentKind, m.componentVersionId]
    );
  }

  // 6. Cited module readings (individually addressable). cited_as_of <= snapshot_as_of.
  for (const r of spoke) {
    await tx.query(
      `INSERT INTO snapshot.snapshot_module_reading
         (fixture_partition_on, match_snapshot_id, snapshot_as_of, cited_module_reading_id, cited_as_of)
       VALUES ($1::date, $2::bigint, $3::timestamptz, $4::bigint, $5::timestamptz)`,
      [partitionOn, snapshotId, snapshotAsOf, r.readingId, r.readingAsOf]
    );
  }

  // 7. Cited feature values (distinct), materialised as sealed feature state.
  const seenValue = new Set<string>();
  for (const r of spoke) {
    for (const cv of r.citedValues) {
      if (seenValue.has(cv.featureValueId)) continue;
      seenValue.add(cv.featureValueId);
      await tx.query(
        `INSERT INTO snapshot.snapshot_feature_state
           (fixture_partition_on, match_snapshot_id, snapshot_as_of, cited_feature_value_id, cited_as_of)
         VALUES ($1::date, $2::bigint, $3::timestamptz, $4::bigint, $5::timestamptz)`,
        [partitionOn, snapshotId, snapshotAsOf, cv.featureValueId, cv.featureValueAsOf]
      );
    }
  }

  // 8. Verdict — non-directional; graded columns NULL.
  await tx.query(
    `INSERT INTO snapshot.snapshot_verdict
       (fixture_partition_on, match_snapshot_id, verdict_composition_version_id,
        readiness_edge, form_edge, travel_edge, rest_edge, congestion_edge, availability_edge,
        risk_score, confidence, evidence_count,
        consensus_supports_count, consensus_contradicts_count, consensus_neutral_count, consensus_inactive_count,
        completeness_ratio, historical_reliability_baseline_id)
     VALUES ($1::date, $2::bigint, $3::bigint,
             NULL, NULL, NULL, NULL, NULL, NULL,
             NULL, NULL, $4::integer,
             $5::integer, $6::integer, $7::integer, $8::integer,
             $9::numeric, NULL)`,
    [
      partitionOn, snapshotId, verdictV.id,
      verdict.evidenceCount,
      verdict.consensusSupportsCount, verdict.consensusContradictsCount,
      verdict.consensusNeutralCount, verdict.consensusInactiveCount,
      completenessRatioTxt,
    ]
  );

  // 9. Completeness + items.
  const comp = await tx.query<{ id: string }>(
    `INSERT INTO snapshot.snapshot_completeness
       (fixture_partition_on, match_snapshot_id,
        expected_feature_count, present_feature_count,
        expected_module_count, engaged_module_count,
        below_threshold_count, estimated_input_count)
     VALUES ($1::date, $2::bigint, $3::integer, $4::integer, $5::integer, $6::integer, $7::integer, $8::integer)
     RETURNING id::text`,
    [
      partitionOn, snapshotId,
      completeness.expectedFeatureCount, completeness.presentFeatureCount,
      completeness.expectedModuleCount, completeness.engagedModuleCount,
      completeness.belowThresholdCount, completeness.estimatedInputCount,
    ]
  );
  const completenessId = comp.rows[0].id;
  for (const item of completeness.items) {
    await tx.query(
      `INSERT INTO snapshot.snapshot_completeness_item
         (fixture_partition_on, snapshot_completeness_id, absence_kind, feature_definition_id, module_definition_id)
       VALUES ($1::date, $2::bigint, $3::text, $4::bigint, $5::bigint)`,
      [partitionOn, completenessId, item.absenceKind, item.featureDefinitionId, item.moduleDefinitionId]
    );
  }

  return {
    status: 'SEALED',
    matchSnapshotId: snapshotId,
    snapshotAsOf,
    evidenceCount: verdict.evidenceCount,
    completenessRatio: completenessRatioTxt,
  };
}

export { CHECKSUM_ALGORITHM_DESIGNATION };
