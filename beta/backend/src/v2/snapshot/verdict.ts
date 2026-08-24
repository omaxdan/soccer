// ─────────────────────────────────────────────────────────────────────────────
// S-7 VERDICT COMPOSITION & CONSENSUS — v1.0.0 (NON-DIRECTIONAL)
//
// Pure, deterministic tallying over ALREADY-PERSISTED readings and evidence. It
// creates NO intelligence: it selects nothing (that is `read/selection.ts`),
// calculates no readiness/momentum/edge/risk/confidence, and infers no favoured
// team. It only:
//   • tallies engaged (spoke) module readings into a NON-DIRECTIONAL consensus,
//   • counts eligible reading-slots that stayed silent (inactive),
//   • derives completeness from the governed eligible-module set and the engaged
//     modules' own persisted evidence,
//   • assembles the version manifest from versions actually referenced.
//
// LOCKED GOVERNANCE (S-7 v1.0.0), enforced structurally here:
//   • consensus unit = one (module, team) SPOKE reading → one status. NOT a vote.
//   • home & away readings enter the SAME distribution independently; no winner.
//   • evidence_count = supports + contradicts + neutral   (INACTIVE excluded).
//   • edges / risk / confidence / historical reliability = NULL. No exceptions.
//   • completeness denominator = ELIGIBLE-ACTIVE modules for THIS fixture.
//   • absence is recorded as absence, never as NEUTRAL, never as zero-as-signal.
// ─────────────────────────────────────────────────────────────────────────────

/** The three engaged statuses. INACTIVE is never a spoke reading. */
export type EngagedStatus = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';
export type ContributionDirection = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

/** One feature value a spoke reading cited (from module_evidence_item → feature_value). */
export interface CitedFeatureValue {
  readonly featureValueId: string;
  readonly featureValueAsOf: Date;
  readonly featureVersionId: string;
  readonly featureDefinitionId: string;
  readonly featureKey: string;
  /** PostgreSQL numeric text — scale preserved (never a JS float). */
  readonly value: string;
  readonly provenanceClassCode: string;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly contributionDirection: ContributionDirection;
}

/** A current engaged (spoke) reading selected for sealing. TEAM or FIXTURE subject. */
export interface SpokeReading {
  readonly readingId: string;
  readonly readingAsOf: Date;
  readonly moduleKey: string;
  readonly moduleDefinitionId: string;
  readonly moduleVersionId: string;
  readonly subjectKindCode: 'TEAM' | 'FIXTURE';
  /** The team, for a TEAM reading; null for a FIXTURE reading. */
  readonly teamId: string | null;
  /** The fixture, for a FIXTURE reading; null for a TEAM reading. */
  readonly fixtureId: string | null;
  readonly status: EngagedStatus;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly contextKindCode: string;
  readonly contextCompetitionEditionId: string | null;
  readonly declaredInputCount: number;
  readonly presentInputCount: number;
  readonly citedValues: readonly CitedFeatureValue[];
}

/** An eligible-active module for the fixture (module-level). */
export interface EligibleModule {
  readonly moduleKey: string;
  readonly moduleDefinitionId: string;
  /** TEAM applies to both participants (2 slots); FIXTURE applies once (1 slot). */
  readonly subjectKindCode: 'TEAM' | 'FIXTURE';
  readonly applicableSubjectCount: number;
}

export interface Consensus {
  readonly supports: number;
  readonly contradicts: number;
  readonly neutral: number;
  readonly inactive: number;
  readonly evidenceCount: number;
}

/**
 * Tallies the NON-DIRECTIONAL consensus. Each spoke reading contributes one
 * status; every eligible reading-slot not filled by a spoke reading is inactive.
 * This is an EVIDENCE DISTRIBUTION over the fixture, never a vote for a team.
 */
export function tallyConsensus(
  spoke: readonly SpokeReading[],
  eligible: readonly EligibleModule[]
): Consensus {
  let supports = 0;
  let contradicts = 0;
  let neutral = 0;
  for (const r of spoke) {
    if (r.status === 'SUPPORTS') supports += 1;
    else if (r.status === 'CONTRADICTS') contradicts += 1;
    else neutral += 1;
  }
  const eligibleSlots = eligible.reduce((n, m) => n + m.applicableSubjectCount, 0);
  const evidenceCount = supports + contradicts + neutral;
  // Every eligible slot that produced no spoke reading is silent. Never negative:
  // selection guarantees spoke readings come only from eligible modules.
  const inactive = Math.max(0, eligibleSlots - evidenceCount);
  return { supports, contradicts, neutral, inactive, evidenceCount };
}

export type AbsenceKind =
  | 'FEATURE_ABSENT'
  | 'FEATURE_BELOW_THRESHOLD'
  | 'FEATURE_ESTIMATED'
  | 'MODULE_INACTIVE';

export interface CompletenessItem {
  readonly absenceKind: AbsenceKind;
  readonly featureDefinitionId: string | null;
  readonly moduleDefinitionId: string | null;
}

export interface Completeness {
  readonly expectedModuleCount: number;
  readonly engagedModuleCount: number;
  readonly expectedFeatureCount: number;
  readonly presentFeatureCount: number;
  readonly belowThresholdCount: number;
  readonly estimatedInputCount: number;
  readonly completenessRatio: number; // engaged / expected, in [0,1]
  readonly items: readonly CompletenessItem[];
}

/**
 * Derives completeness from the eligible set and the engaged modules' OWN
 * persisted evidence. Module coverage is module-level; feature coverage is scoped
 * to the input slots the engaged modules declared (we cannot know an
 * unimplemented module's inputs, so its absence is captured at MODULE level).
 */
export function computeCompleteness(
  spoke: readonly SpokeReading[],
  eligible: readonly EligibleModule[]
): Completeness {
  const engagedModuleKeys = new Set(spoke.map((r) => r.moduleKey));
  const expectedModuleCount = eligible.length;
  const engagedModuleCount = eligible.filter((m) => engagedModuleKeys.has(m.moduleKey)).length;

  let expectedFeatureCount = 0;
  let presentFeatureCount = 0;
  for (const r of spoke) {
    expectedFeatureCount += r.declaredInputCount;
    presentFeatureCount += r.presentInputCount;
  }

  // Below-threshold / estimated are read from the CITED VALUES' own persisted
  // flags (honest, not the engine's 1.0.0 hardcoded-zero evidence counters).
  // De-duplicated by feature value id so one value cited twice counts once.
  const seen = new Set<string>();
  const items: CompletenessItem[] = [];
  let belowThresholdCount = 0;
  let estimatedInputCount = 0;
  for (const r of spoke) {
    for (const cv of r.citedValues) {
      if (seen.has(cv.featureValueId)) continue;
      seen.add(cv.featureValueId);
      if (!cv.sampleMeetsThreshold) {
        belowThresholdCount += 1;
        items.push({ absenceKind: 'FEATURE_BELOW_THRESHOLD', featureDefinitionId: cv.featureDefinitionId, moduleDefinitionId: null });
      }
      if (cv.provenanceClassCode === 'ESTIMATED') {
        estimatedInputCount += 1;
        items.push({ absenceKind: 'FEATURE_ESTIMATED', featureDefinitionId: cv.featureDefinitionId, moduleDefinitionId: null });
      }
    }
  }

  // One MODULE_INACTIVE item per eligible module that produced no spoke reading —
  // absence recorded as absence, never folded into NEUTRAL.
  for (const m of eligible) {
    if (!engagedModuleKeys.has(m.moduleKey)) {
      items.push({ absenceKind: 'MODULE_INACTIVE', featureDefinitionId: null, moduleDefinitionId: m.moduleDefinitionId });
    }
  }

  const completenessRatio = expectedModuleCount === 0 ? 0 : engagedModuleCount / expectedModuleCount;

  return {
    expectedModuleCount,
    engagedModuleCount,
    expectedFeatureCount,
    presentFeatureCount,
    belowThresholdCount,
    estimatedInputCount,
    completenessRatio,
    items,
  };
}

/** The snapshot_verdict row content. Every directional/graded field is NULL in v1.0.0. */
export interface VerdictRow {
  readonly consensusSupportsCount: number;
  readonly consensusContradictsCount: number;
  readonly consensusNeutralCount: number;
  readonly consensusInactiveCount: number;
  readonly evidenceCount: number;
  readonly completenessRatio: number;
  // Deliberately, permanently NULL at v1.0.0 — no substrate exists to fill them.
  // (These are the actual nullable columns on snapshot.snapshot_verdict.)
  readonly readinessEdge: null;
  readonly formEdge: null;
  readonly travelEdge: null;
  readonly restEdge: null;
  readonly congestionEdge: null;
  readonly availabilityEdge: null;
  readonly riskScore: null;
  readonly confidence: null;
  readonly historicalReliabilityBaselineId: null;
}

/** Assembles the non-directional verdict. NULL guarantees are encoded in the type. */
export function buildVerdict(consensus: Consensus, completeness: Completeness): VerdictRow {
  return {
    consensusSupportsCount: consensus.supports,
    consensusContradictsCount: consensus.contradicts,
    consensusNeutralCount: consensus.neutral,
    consensusInactiveCount: consensus.inactive,
    evidenceCount: consensus.evidenceCount,
    completenessRatio: completeness.completenessRatio,
    readinessEdge: null,
    formEdge: null,
    travelEdge: null,
    restEdge: null,
    congestionEdge: null,
    availabilityEdge: null,
    riskScore: null,
    confidence: null,
    historicalReliabilityBaselineId: null,
  };
}

export type ComponentKind =
  | 'FEATURE_VERSION'
  | 'MODULE_VERSION'
  | 'VERDICT_COMPOSITION_VERSION'
  | 'CONSENSUS_RULE_VERSION'
  | 'CHECKSUM_ALGORITHM_VERSION';

export interface ManifestComponent {
  readonly componentKind: ComponentKind;
  readonly componentVersionId: string;
}

/**
 * The complete version manifest: every version actually referenced by the
 * snapshot content. Distinct, deterministically ordered by (kind, id). LC-103
 * requires completeness — nothing referenced may be missing, nothing extra added.
 */
export function buildManifest(
  spoke: readonly SpokeReading[],
  versions: {
    readonly verdictCompositionVersionId: string;
    readonly consensusRuleVersionId: string;
    readonly checksumAlgorithmVersionId: string;
  }
): ManifestComponent[] {
  const components: ManifestComponent[] = [];
  const moduleVersionIds = new Set<string>();
  const featureVersionIds = new Set<string>();
  for (const r of spoke) {
    moduleVersionIds.add(r.moduleVersionId);
    for (const cv of r.citedValues) featureVersionIds.add(cv.featureVersionId);
  }
  for (const id of moduleVersionIds) components.push({ componentKind: 'MODULE_VERSION', componentVersionId: id });
  for (const id of featureVersionIds) components.push({ componentKind: 'FEATURE_VERSION', componentVersionId: id });
  components.push({ componentKind: 'VERDICT_COMPOSITION_VERSION', componentVersionId: versions.verdictCompositionVersionId });
  components.push({ componentKind: 'CONSENSUS_RULE_VERSION', componentVersionId: versions.consensusRuleVersionId });
  components.push({ componentKind: 'CHECKSUM_ALGORITHM_VERSION', componentVersionId: versions.checksumAlgorithmVersionId });

  return components.sort((a, b) =>
    a.componentKind < b.componentKind ? -1
    : a.componentKind > b.componentKind ? 1
    : compareNumericId(a.componentVersionId, b.componentVersionId)
  );
}

/** Ascending by numeric value (ids are bigint text). */
export function compareNumericId(a: string, b: string): number {
  const l = BigInt(a);
  const r = BigInt(b);
  return l < r ? -1 : l > r ? 1 : 0;
}
