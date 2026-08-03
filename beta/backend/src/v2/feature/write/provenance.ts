// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE AND SAMPLE RESOLUTION — the weakest input wins, twice
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO CEILINGS, ONE RULE
//
// A value's provenance class is:
//
//   min( registry ceiling , weakest class in its lineage )
//
// The registry ceiling is `feature_definition.max_provenance_class_code` — "the
// strongest provenance class this feature can ever carry. A feature modelled in
// the absence of a source can never be OBSERVED."
//
// The lineage floor is LC-37: "A derived value is no stronger than the weakest
// input in its lineage. A value derived from an estimate is itself an estimate."
//
// A value with no lineage takes the ceiling alone. R-53 exempts it explicitly,
// and five of S-5's six features are in that position.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ THIS MODULE IS THE ONLY ENFORCEMENT OF LC-37 THAT EXISTS
//
// The database cannot help. `tr_feature_value__provenance_propagation` (A.12)
// is an AFTER INSERT statement-level trigger that joins the new values against
// `feature_lineage` — but `fk_feature_lineage__produced_value` means lineage can
// only be written AFTER its produced value exists, so at trigger time the join
// always matches zero rows and every value is exempted. Proven by execution and
// recorded as finding S5-1.
//
// The compensating `provenance_propagation` quality check is registered in
// `operations.quality_check` and has no implementation either (S5-2), which is
// why `verify.ts` carries a temporary stand-in.
//
// So: nothing downstream will catch an error here. Mutation test 1 exists
// because of that — removing the floor must fail the suite, and it is the only
// thing standing between a wrong provenance claim and a permanent record of it.
// ─────────────────────────────────────────────────────────────────────────────

import type { CandidateValue } from '../calculators/types';
import type { FeatureDefinition, Registry } from '../registry/load';

/** What the write layer needs beyond the candidate itself. */
export interface ResolvedProvenance {
  readonly provenanceClassCode: string;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
}

/**
 * Resolves provenance, sample count and threshold for one candidate.
 *
 * Raises rather than silently correcting when a consumed value carries a
 * provenance class the registry does not define: an unknown class cannot be
 * ranked, and guessing its strength would be inventing the very fact this
 * function exists to determine.
 */
export function resolve(
  registry: Registry,
  definition: FeatureDefinition,
  candidate: CandidateValue
): ResolvedProvenance {
  const provenanceClassCode = resolveProvenanceClass(registry, definition, candidate);
  const sampleObservationCount = resolveSampleCount(candidate);

  return {
    provenanceClassCode,
    sampleObservationCount,
    // LC-41: the threshold IN FORCE AT CALCULATION governs, and the outcome is
    // stored rather than derived at read time — "a later change to the
    // registry-declared threshold does not retroactively alter whether a
    // historical value met the threshold that applied to it".
    sampleMeetsThreshold: sampleObservationCount >= definition.meaningfulSampleThreshold,
  };
}

function resolveProvenanceClass(
  registry: Registry,
  definition: FeatureDefinition,
  candidate: CandidateValue
): string {
  const ceilingRank = registry.provenanceRankByCode.get(definition.maxProvenanceClassCode);
  if (ceilingRank === undefined) {
    throw new Error(
      `feature '${definition.featureKey}' declares max provenance ` +
        `'${definition.maxProvenanceClassCode}', which is not a registered provenance class`
    );
  }

  let weakestRank = ceilingRank;
  let weakestCode = definition.maxProvenanceClassCode;

  for (const consumed of candidate.consumed) {
    const rank = registry.provenanceRankByCode.get(consumed.provenanceClassCode);
    if (rank === undefined) {
      throw new Error(
        `consumed value ${consumed.valueId} carries provenance class ` +
          `'${consumed.provenanceClassCode}', which is not registered`
      );
    }
    if (rank < weakestRank) {
      weakestRank = rank;
      weakestCode = consumed.provenanceClassCode;
    }
  }

  return weakestCode;
}

/**
 * The observation count.
 *
 * For a Layer 1 feature the calculator supplies it directly — it knows how many
 * fixtures the figure rests on.
 *
 * For a COMPOSITE it is derived here as `MIN(consumed.sample_observation_count)`
 * per DEC-5, and the calculator supplies null. This is deliberately the same
 * shape as the provenance rule above: a composite is no better EVIDENCED than
 * its thinnest input, exactly as it is no STRONGER than its weakest one. Two
 * rules, one justification.
 *
 * Never SUM, never MAX, never the number of components. Summing would let two
 * thin inputs manufacture a well-evidenced result; taking the maximum would let
 * one strong input conceal a threadbare one; counting components would measure
 * the formula's shape rather than the evidence beneath it.
 */
function resolveSampleCount(candidate: CandidateValue): number {
  if (candidate.consumed.length === 0) {
    if (candidate.sampleObservationCount === null) {
      throw new Error(
        `candidate for '${candidate.featureKey}' has no lineage and no observation count. ` +
          'A Layer 1 calculator must state how many observations its value rests on.'
      );
    }
    return candidate.sampleObservationCount;
  }

  let minimum = Number.POSITIVE_INFINITY;
  for (const consumed of candidate.consumed) {
    if (consumed.sampleObservationCount < minimum) minimum = consumed.sampleObservationCount;
  }
  return minimum;
}
