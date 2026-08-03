// ─────────────────────────────────────────────────────────────────────────────
// team_readiness — team.readiness_score
//
// THE ONLY COMPOSITE, AND THE ONLY PRODUCER OF LINEAGE.
//
// ─────────────────────────────────────────────────────────────────────────────
// EXACTLY TWO INPUTS
//
//   rest_component       = clamp(rest_advantage_days / 7, 0, 1) × 100
//   congestion_component = 100 − congestion_index
//   readiness            = (50 × rest + 50 × congestion) / 100
//
// No form. No travel. No stability. No fatigue. No rotation.
//
// V1's readiness was a six-component composite — form 30, congestion 15, travel
// 15, stability 5, fatigue 10, rotation 10. Four of those six have no declared
// V2 input: form has no edge, travel is excluded by declaration, stability is
// never calculated (R-1), and fatigue and rotation are not registered features.
// Meanwhile rest, which V2 declares, does not appear in V1 readiness at all.
//
// DEC-1 resolved that as DECISION A: the S-5 specification supersedes V1, and
// version 1.0.0 means this rule. Reintroducing any V1 component here would be a
// different rule under the same version — precisely what feature_version exists
// to prevent, since "a measured rate spanning two rules describes a system that
// never existed".
//
// ─────────────────────────────────────────────────────────────────────────────
// WEIGHTS ARE 50/50 BY GOVERNED DECISION, NOT BY INHERITANCE
//
// V1 assigned congestion 15 and rest nothing at all, so no relative weighting
// existed to carry across. Equal weights were approved because no evidence
// supports asymmetry; inventing one would assert a relationship nobody has
// measured. When calibration exists (S-9), a re-weighting is a NEW
// feature_version — the governed path, not an edit here.
//
// The `/7` normalisation is likewise approved rather than derived: seven days is
// the canonical recovery week and matches T_MINUS_7D, and beyond a week further
// rest adds no readiness.
// ─────────────────────────────────────────────────────────────────────────────

import {
  priorValueKey,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type ConsumedValueRef,
} from './types';
import {
  add,
  clamp,
  divide,
  fromInt,
  multiply,
  ONE,
  ONE_HUNDRED,
  subtract,
  ZERO,
  type Exact,
} from '../write/scale';

const READINESS = 'team.readiness_score';
const REST_ADVANTAGE = 'team.rest_advantage';
const CONGESTION_INDEX = 'team.congestion_index';

/** Days of rest at which the component saturates. */
const FULL_RECOVERY_DAYS = fromInt(7);

/** Approved weights. Equal, and equal for a stated reason — see the header. */
const REST_WEIGHT = fromInt(50);
const CONGESTION_WEIGHT = fromInt(50);

/** One input, already oriented so that higher is better. */
interface Component {
  readonly oriented: Exact;
  readonly weight: Exact;
  readonly consumed: ConsumedValueRef;
}

export const teamReadiness: Calculator = {
  calculatorKey: 'team_readiness',
  featureKeys: [READINESS],

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const rest = context.priorValues.get(
        priorValueKey(REST_ADVANTAGE, subject.teamId, subject.asOf)
      );
      const congestion = context.priorValues.get(
        priorValueKey(CONGESTION_INDEX, subject.teamId, subject.asOf)
      );

      const components: Component[] = [];

      if (rest) {
        // clamp(days / 7, 0, 1) × 100. Already higher-is-better:
        // team.rest_advantage is HIGHER_IS_STRONGER.
        const fraction = clamp(divide(rest.value, FULL_RECOVERY_DAYS), ZERO, ONE);
        components.push({
          oriented: multiply(fraction, ONE_HUNDRED),
          weight: REST_WEIGHT,
          consumed: rest,
        });
      }

      if (congestion) {
        // 100 − congestion. Inverted because team.congestion_index is
        // LOWER_IS_STRONGER and readiness is HIGHER_IS_STRONGER; combining them
        // without orienting first would subtract fitness from fitness.
        components.push({
          oriented: subtract(ONE_HUNDRED, congestion.value),
          weight: CONGESTION_WEIGHT,
          consumed: congestion,
        });
      }

      // Both absent → no row. PD-07: absence of a fact is the absence of a row,
      // never a zero. A readiness of 0 would read as a side in the worst
      // possible condition rather than as a side nobody has measured.
      if (components.length === 0) continue;

      // One absent → renormalise over the present weight. This IS carried across
      // from V1, which filtered nulls and divided by the sum of the weights that
      // remained (`processDbOnly.ts:1689–1691`).
      let weighted = ZERO;
      let totalWeight = ZERO;
      for (const component of components) {
        weighted = add(weighted, multiply(component.oriented, component.weight));
        totalWeight = add(totalWeight, component.weight);
      }

      candidates.push({
        featureKey: READINESS,
        teamId: subject.teamId,
        asOf: subject.asOf,
        value: divide(weighted, totalWeight),
        // Derived by write/provenance.ts as MIN(consumed) per DEC-5 — the same
        // weakest-input shape LC-37 uses for provenance. Set here it could
        // contradict the lineage this very candidate carries.
        sampleObservationCount: null,
        // Lineage for the inputs ACTUALLY consumed. A renormalised value cites
        // one edge, not two: lineage is instance-level and records what this
        // value really read, not what its rule may read in general.
        consumed: components.map((component) => component.consumed),
      });
    }

    return candidates;
  },
};
