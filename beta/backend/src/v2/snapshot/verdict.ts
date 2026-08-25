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
//   • completeness denominator = ELIGIBLE-ACTIVE modules for THIS fixture.
//   • absence is recorded as absence, never as NEUTRAL, never as zero-as-signal.
//
// S-8 (v1.1.0) adds ONE governed comparative field — `rest_edge` — computed by
// `computeRestEdge` and populated only under composition version 1.1.0+. Every
// other edge and risk / confidence / historical reliability remain NULL. No
// exceptions, no aggregation, no winner, no prediction. See the S-8 block below.
// ─────────────────────────────────────────────────────────────────────────────

import { fromString, subtract, toNumericString } from '../feature/write/scale';

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
  /** The value's subject team (TEAM-subject values only); null otherwise. Lets a
   *  FIXTURE comparison attribute each cited value to home or away (S-8). */
  readonly subjectTeamId: string | null;
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

/** The snapshot_verdict row content. Every graded field is NULL except the two
 *  governed comparative edges: `restEdge` (composition 1.1.0+, from the sealed
 *  rest_advantage reading) and `formEdge` (composition 1.2.0+, from the sealed
 *  form_gap_accuracy reading). Each is populated only under the version that
 *  governs it; otherwise it stays NULL like the rest. The two are independent —
 *  never aggregated. */
export interface VerdictRow {
  readonly consensusSupportsCount: number;
  readonly consensusContradictsCount: number;
  readonly consensusNeutralCount: number;
  readonly consensusInactiveCount: number;
  readonly evidenceCount: number;
  readonly completenessRatio: number;
  // Still permanently NULL — no governed substrate exists to fill them.
  // (These are the actual nullable columns on snapshot.snapshot_verdict.)
  readonly readinessEdge: null;
  /** The second governed comparative edge (S-8, composition 1.2.0+):
   *  home.home_form − away.away_form, as PostgreSQL numeric text (scale preserved).
   *  NULL when not governed (< 1.2.0) or a required side is absent. */
  readonly formEdge: string | null;
  readonly travelEdge: null;
  /** The first governed comparative edge (S-8, composition 1.1.0+):
   *  home.rest_advantage − away.rest_advantage, as PostgreSQL numeric text (scale
   *  preserved). NULL when not governed (< 1.1.0) or a required side is absent. */
  readonly restEdge: string | null;
  readonly congestionEdge: null;
  readonly availabilityEdge: null;
  readonly riskScore: null;
  readonly confidence: null;
  readonly historicalReliabilityBaselineId: null;
}

/**
 * Assembles the verdict. Every graded field is NULL except `restEdge` and
 * `formEdge`, which the caller supplies already computed and already gated on the
 * composition version (null under a version that does not govern them). The NULL
 * guarantees for the other fields are encoded in the type. The two edges are
 * carried independently — this function never combines them.
 */
export function buildVerdict(
  consensus: Consensus,
  completeness: Completeness,
  restEdge: string | null = null,
  formEdge: string | null = null
): VerdictRow {
  return {
    consensusSupportsCount: consensus.supports,
    consensusContradictsCount: consensus.contradicts,
    consensusNeutralCount: consensus.neutral,
    consensusInactiveCount: consensus.inactive,
    evidenceCount: consensus.evidenceCount,
    completenessRatio: completeness.completenessRatio,
    readinessEdge: null,
    formEdge,
    travelEdge: null,
    restEdge,
    congestionEdge: null,
    availabilityEdge: null,
    riskScore: null,
    confidence: null,
    historicalReliabilityBaselineId: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S-8 REST EDGE COMPOSITION — v1.1.0
//
// The first governed comparative edge. From the sealed FIXTURE rest_advantage
// reading and its two sealed underlying team.rest_advantage values:
//
//   rest_edge = home.rest_advantage − away.rest_advantage
//     > 0 → home has more rest; < 0 → away has more rest; 0 → equal rest.
//
// GOVERNED (S-8 decisions A/B/C), enforced here:
//   • Home-relative sign; the sign is NOT re-derived from feature direction,
//     module status or prose — only the two underlying numeric VALUES (decision A).
//   • Both required values present → compute, even when one/both are below
//     threshold; the below-threshold caveat stays in completeness, never nulls a
//     real value; zero is a real value, never "missing" (decision B).
//   • Either required value absent → NULL; nothing is substituted (decision B).
//   • NO aggregation, no winner, no prediction, no risk, no confidence.
//   • Populated ONLY under composition version 1.1.0+ (decision C); 1.0.0 → NULL.
// ─────────────────────────────────────────────────────────────────────────────

/** The FIXTURE comparison module that produces the rest edge. */
export const REST_EDGE_MODULE_KEY = 'rest_advantage';
/** The per-side TEAM feature the rest edge subtracts. */
export const REST_ADVANTAGE_FEATURE_KEY = 'team.rest_advantage';

/**
 * True when the governed composition version populates the rest edge — 1.1.0 and
 * any later version. Compared as a numeric (major,minor,patch) tuple so ordering
 * is real, not lexical ('1.10.0' > '1.2.0'). Unparseable designations → false
 * (the rest edge is only ever ADDED by a governed version, never by accident).
 */
export function restEdgeGovernedIn(designation: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(designation.trim());
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > 1 || (maj === 1 && min >= 1);
}

/**
 * The governed rest edge for a fixture, or null. Reads ONLY the already-selected
 * sealed spoke readings: it finds the one engaged FIXTURE rest_advantage reading,
 * attributes each of its cited team.rest_advantage values to home or away by the
 * value's own subject team, and returns home − away with the database scale
 * preserved. Returns null when the reading is absent (INACTIVE ⇒ not a spoke
 * reading) or when either required side's value is missing.
 */
export function computeRestEdge(
  spoke: readonly SpokeReading[],
  fixture: { readonly homeTeamId: string; readonly awayTeamId: string }
): string | null {
  const reading = spoke.find(
    (r) => r.subjectKindCode === 'FIXTURE' && r.moduleKey === REST_EDGE_MODULE_KEY
  );
  if (!reading) return null; // no engaged rest reading → nothing to compare.

  let home: string | undefined;
  let away: string | undefined;
  for (const cv of reading.citedValues) {
    if (cv.featureKey !== REST_ADVANTAGE_FEATURE_KEY) continue;
    if (cv.subjectTeamId === fixture.homeTeamId) home = cv.value;
    else if (cv.subjectTeamId === fixture.awayTeamId) away = cv.value;
  }
  if (home === undefined || away === undefined) return null; // a required side absent.

  return toNumericString(subtract(fromString(home), fromString(away)));
}

// ─────────────────────────────────────────────────────────────────────────────
// S-8 FORM EDGE COMPOSITION — v1.2.0
//
// The second governed comparative edge, and the first ASYMMETRIC one. From the
// sealed FIXTURE form_gap_accuracy reading and its two sealed underlying values —
// the home team's team.home_form and the away team's team.away_form:
//
//   form_edge = home.home_form − away.away_form
//     > 0 → home venue form stronger; < 0 → away stronger; 0 → equal.
//
// GOVERNED (S-8 form gate), enforced here:
//   • Home-relative sign; re-derived from the two sealed VALUES (the module reading
//     stores only a status, no numeric gap — this is the SAME differential the
//     module characterised, not a second rule).
//   • Each side is attributed by BOTH featureKey AND subjectTeamId, never by
//     citation order.
//   • Both required values present → compute, even below threshold; the caveat stays
//     in completeness; zero is a real value, never "missing".
//   • Reading absent/INACTIVE, or either required value missing → NULL; nothing
//     substituted.
//   • NO aggregation with rest_edge or any other edge; no winner, no prediction.
//   • Populated ONLY under composition version 1.2.0+; earlier versions → NULL.
// ─────────────────────────────────────────────────────────────────────────────

/** The FIXTURE comparison module that produces the form edge. */
export const FORM_EDGE_MODULE_KEY = 'form_gap_accuracy';
/** The home side's venue-form feature (read for the HOME team). */
export const HOME_FORM_FEATURE_KEY = 'team.home_form';
/** The away side's venue-form feature (read for the AWAY team). */
export const AWAY_FORM_FEATURE_KEY = 'team.away_form';

/**
 * True when the governed composition version populates the form edge — 1.2.0 and
 * any later version. Numeric (major,minor) compare, so '1.10.0' > '1.2.0'.
 * Unparseable designations → false (the edge is only ever ADDED by a governed
 * version, never by accident).
 */
export function formEdgeGovernedIn(designation: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(designation.trim());
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > 1 || (maj === 1 && min >= 2);
}

/**
 * The governed form edge for a fixture, or null. Reads ONLY the already-selected
 * sealed spoke readings: it finds the one engaged FIXTURE form_gap_accuracy
 * reading, takes the home side's team.home_form and the away side's team.away_form
 * — each identified by BOTH featureKey AND subjectTeamId (never citation order) —
 * and returns home − away with the database scale preserved. Returns null when the
 * reading is absent (INACTIVE ⇒ not a spoke reading) or when either required value
 * is missing.
 */
export function computeFormEdge(
  spoke: readonly SpokeReading[],
  fixture: { readonly homeTeamId: string; readonly awayTeamId: string }
): string | null {
  const reading = spoke.find(
    (r) => r.subjectKindCode === 'FIXTURE' && r.moduleKey === FORM_EDGE_MODULE_KEY
  );
  if (!reading) return null; // no engaged form reading → nothing to compare.

  let home: string | undefined;
  let away: string | undefined;
  for (const cv of reading.citedValues) {
    if (cv.featureKey === HOME_FORM_FEATURE_KEY && cv.subjectTeamId === fixture.homeTeamId) home = cv.value;
    else if (cv.featureKey === AWAY_FORM_FEATURE_KEY && cv.subjectTeamId === fixture.awayTeamId) away = cv.value;
  }
  if (home === undefined || away === undefined) return null; // a required side absent.

  return toNumericString(subtract(fromString(home), fromString(away)));
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
