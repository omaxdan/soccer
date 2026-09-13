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
// Under composition 1.0.0 this seals NO intelligence: every edge, risk,
// confidence and reliability column is NULL. Each later version adds ONE governed
// comparative edge, computed from a sealed FIXTURE reading and nothing else:
//   • 1.1.0 (S-8) → rest_edge = home − away rest_advantage
//   • 1.2.0 (S-8) → form_edge = home.home_form − away.away_form
// The edges are independent and never combined: still no aggregation, no winner,
// no risk, no confidence.
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
  computeFormEdge,
  formEdgeGovernedIn,
  buildManifest,
  compareNumericId,
  computeRestEdge,
  restEdgeGovernedIn,
  type SpokeReading,
  type ManifestComponent,
} from './verdict';
import {
  contentChecksum,
  decimal,
  CHECKSUM_ALGORITHM_DESIGNATION,
  type Canonical,
  type SnapshotContent,
} from './canonical';
import { readPreparednessInputs } from './read/preparednessInputs';
import {
  computeTeamPreparedness,
  preparednessGovernedIn,
  type PreparednessSideResult,
} from './preparedness';

/**
 * Adds any preparedness input feature versions missing from the manifest as
 * FEATURE_VERSION components, then re-sorts with the SAME (kind, id) order
 * buildManifest uses — so the manifest stays LC-103-complete (every feature
 * version the sealed content references appears) and deterministic. Preparedness
 * inputs already cited by a module reading are already present; only the extras
 * are added.
 */
function mergeFeatureVersions(
  manifest: readonly ManifestComponent[],
  extraFeatureVersionIds: readonly string[]
): ManifestComponent[] {
  const base = [...manifest];
  if (extraFeatureVersionIds.length === 0) return base;
  const present = new Set(
    base.filter((m) => m.componentKind === 'FEATURE_VERSION').map((m) => m.componentVersionId)
  );
  const additions: ManifestComponent[] = [];
  for (const id of new Set(extraFeatureVersionIds)) {
    if (!present.has(id)) additions.push({ componentKind: 'FEATURE_VERSION', componentVersionId: id });
  }
  if (additions.length === 0) return base;
  return [...base, ...additions].sort((a, b) =>
    a.componentKind < b.componentKind ? -1
    : a.componentKind > b.componentKind ? 1
    : compareNumericId(a.componentVersionId, b.componentVersionId)
  );
}

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
    /** Governed rest edge (numeric text) under composition 1.1.0+, else null. */
    restEdge: string | null;
    /** Governed form edge (numeric text) under composition 1.2.0+, else null. */
    formEdge: string | null;
    /**
     * Governed Team Preparedness (composition 1.3.0+): the per-side results,
     * ALREADY ordered by side. Omitted/undefined under an earlier version, so the
     * verdict object — and therefore the checksum — is byte-identical to a
     * pre-1.3.0 snapshot's. Each numeric is canonical decimal text (scale 4);
     * preparednessPoints is null when no component was present.
     */
    teamPreparedness?: readonly {
      side: string;
      preparednessPoints: string | null;
      availablePoints: string;
      declaredPoints: string;
      coverageRatio: string;
    }[];
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

  const verdict: { [key: string]: Canonical } = {
    consensusSupportsCount: args.verdict.consensusSupportsCount,
    consensusContradictsCount: args.verdict.consensusContradictsCount,
    consensusNeutralCount: args.verdict.consensusNeutralCount,
    consensusInactiveCount: args.verdict.consensusInactiveCount,
    evidenceCount: args.verdict.evidenceCount,
    completenessRatio: decimal(args.verdict.completenessRatioText),
    // Every graded field is null in the hashed content EXCEPT the two governed
    // comparative edges: rest_edge (composition 1.1.0+) and form_edge (1.2.0+).
    // Their presence changes the checksum — a 1.2.0 verdict hashes differently
    // from a 1.1.0 one, which differs from 1.0.0.
    readinessEdge: null, travelEdge: null,
    formEdge: args.verdict.formEdge === null ? null : decimal(args.verdict.formEdge),
    restEdge: args.verdict.restEdge === null ? null : decimal(args.verdict.restEdge),
    congestionEdge: null, availabilityEdge: null, riskScore: null,
    confidence: null, historicalReliabilityBaselineId: null,
  };

  // Team Preparedness (composition 1.3.0+): fold the per-side results INTO the
  // existing verdict object — a new key within the SAME canonical v1 form (object
  // keys stay lexicographically sorted; no new top-level section), so no
  // checksum_algorithm_version change. The key is added ONLY when governed, so a
  // pre-1.3.0 verdict hashes byte-identically to before. The array is already
  // ordered by side; canon preserves that order.
  if (args.verdict.teamPreparedness && args.verdict.teamPreparedness.length > 0) {
    verdict.teamPreparedness = args.verdict.teamPreparedness.map((p) => ({
      side: p.side,
      preparednessPoints: p.preparednessPoints === null ? null : decimal(p.preparednessPoints),
      availablePoints: decimal(p.availablePoints),
      declaredPoints: decimal(p.declaredPoints),
      coverageRatio: decimal(p.coverageRatio),
    }));
  }

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

  // 2. Tally (pure, non-directional), then the governed comparative edges. Each is
  //    populated ONLY under the composition version that governs it, and each is
  //    independent — never combined. rest_edge: 1.1.0+; form_edge: 1.2.0+. A
  //    snapshot resolving to an earlier version keeps the ungoverned edge NULL.
  const consensus = tallyConsensus(spoke, eligible);
  const completeness = computeCompleteness(spoke, eligible);
  const fixtureSides = { homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId };
  const restEdge = restEdgeGovernedIn(verdictV.designation) ? computeRestEdge(spoke, fixtureSides) : null;
  const formEdge = formEdgeGovernedIn(verdictV.designation) ? computeFormEdge(spoke, fixtureSides) : null;
  const verdict = buildVerdict(consensus, completeness, restEdge, formEdge);

  // Team Preparedness (composition 1.3.0+): read the four governed inputs for both
  // sides at the SNAPSHOT's own as-of ceiling and governed scope (Layer 2 stays
  // team+as_of — home/away orientation and edition resolution happen HERE), then
  // compose the two per-side absolute scores. Ungoverned (< 1.3.0) → no read, no
  // rows, verdict object and checksum unchanged.
  let preparedness: readonly PreparednessSideResult[] | null = null;
  if (preparednessGovernedIn(verdictV.designation)) {
    const inputs = await readPreparednessInputs(tx, {
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      asOf: snapshotAsOf,
      competitionEditionId: fixture.competitionEditionId,
    });
    preparedness = computeTeamPreparedness(inputs.home, inputs.away);
  }

  // Manifest — every referenced version (LC-103). Preparedness input feature
  // versions are added, deduped against the module-cited ones.
  const prepFeatureVersionIds = preparedness
    ? preparedness.flatMap((p) => p.citedValues.map((c) => c.featureVersionId))
    : [];
  const manifest = mergeFeatureVersions(
    buildManifest(spoke, {
      verdictCompositionVersionId: verdictV.id,
      consensusRuleVersionId: consensusV.id,
      checksumAlgorithmVersionId: checksumV.id,
    }),
    prepFeatureVersionIds
  );
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
      restEdge: verdict.restEdge,
      formEdge: verdict.formEdge,
      teamPreparedness: preparedness ?? undefined,
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
  //    Both the module-cited values AND the Team Preparedness inputs are sealed
  //    here, sharing ONE dedup set: a value cited by both a module and preparedness
  //    is materialised once. This is what lets preparedness carry no citation/as-of
  //    column — its evidence and its temporal integrity live in snapshot_feature_state.
  const seenValue = new Set<string>();
  const citeFeatureValue = async (featureValueId: string, citedAsOf: Date): Promise<void> => {
    if (seenValue.has(featureValueId)) return;
    seenValue.add(featureValueId);
    await tx.query(
      `INSERT INTO snapshot.snapshot_feature_state
         (fixture_partition_on, match_snapshot_id, snapshot_as_of, cited_feature_value_id, cited_as_of)
       VALUES ($1::date, $2::bigint, $3::timestamptz, $4::bigint, $5::timestamptz)`,
      [partitionOn, snapshotId, snapshotAsOf, featureValueId, citedAsOf]
    );
  };
  for (const r of spoke) {
    for (const cv of r.citedValues) {
      await citeFeatureValue(cv.featureValueId, cv.featureValueAsOf);
    }
  }
  if (preparedness) {
    for (const p of preparedness) {
      for (const c of p.citedValues) {
        await citeFeatureValue(c.featureValueId, c.featureValueAsOf);
      }
    }
  }

  // 8. Verdict — rest_edge (composition 1.1.0+) and form_edge (1.2.0+) are the only
  //    graded columns that may be non-NULL, each independently; every other edge and
  //    risk/confidence/reliability stays NULL. The two edges are never combined.
  await tx.query(
    `INSERT INTO snapshot.snapshot_verdict
       (fixture_partition_on, match_snapshot_id, verdict_composition_version_id,
        readiness_edge, form_edge, travel_edge, rest_edge, congestion_edge, availability_edge,
        risk_score, confidence, evidence_count,
        consensus_supports_count, consensus_contradicts_count, consensus_neutral_count, consensus_inactive_count,
        completeness_ratio, historical_reliability_baseline_id)
     VALUES ($1::date, $2::bigint, $3::bigint,
             NULL, $4::numeric, NULL, $5::numeric, NULL, NULL,
             NULL, NULL, $6::integer,
             $7::integer, $8::integer, $9::integer, $10::integer,
             $11::numeric, NULL)`,
    [
      partitionOn, snapshotId, verdictV.id,
      verdict.formEdge,
      verdict.restEdge,
      verdict.evidenceCount,
      verdict.consensusSupportsCount, verdict.consensusContradictsCount,
      verdict.consensusNeutralCount, verdict.consensusInactiveCount,
      completenessRatioTxt,
    ]
  );

  // 8.5. Team Preparedness (composition 1.3.0+) — two sealed per-side rows. Their
  //      evidence is the feature-state citations sealed in step 7; the row carries
  //      no citation/as-of column. preparednessPoints is bound as NULL when no
  //      component was present. Absent entirely under an earlier composition version.
  if (preparedness) {
    for (const p of preparedness) {
      await tx.query(
        `INSERT INTO snapshot.snapshot_team_preparedness
           (fixture_partition_on, match_snapshot_id, side,
            preparedness_points, available_points, declared_points, coverage_ratio)
         VALUES ($1::date, $2::bigint, $3::text, $4::numeric, $5::numeric, $6::numeric, $7::numeric)`,
        [
          partitionOn, snapshotId, p.side,
          p.preparednessPoints, p.availablePoints, p.declaredPoints, p.coverageRatio,
        ]
      );
    }
  }

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
