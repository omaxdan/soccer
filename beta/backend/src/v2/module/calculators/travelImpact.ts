// ─────────────────────────────────────────────────────────────────────────────
// travel_impact — "Does distance disadvantage a side in this fixture?"
//
// The third S-6 FIXTURE-subject COMPARISON module (owner S-6 authorization,
// Decisions 1-3). It compares the two teams' already-persisted, as-of-safe
// `team.travel_distance` (km between the venues of consecutively played fixtures;
// a measurement, UNSIGNED at the feature layer). The MODULE, not the feature,
// makes the home/away judgement.
//
// DISTINCTION (Decision 1): the module consumes the `team.travel_distance`
// FEATURE. It does NOT consume the `team.travel_impact` feature — that is a
// separate, legacy-derived feature and is not silently redefined here (docs 70
// §"name-collision", 71 §7-8: module #5 cites travel_distance directly).
//
//   travel_gap = away.travel_distance − home.travel_distance     (Decision 2)
//   gap > 0 → SUPPORTS     (away travelled farther → favours HOME)
//   gap < 0 → CONTRADICTS  (home travelled farther → against HOME)
//   gap = 0 → NEUTRAL      (equal travel)
//   either side's value absent → INACTIVE (raised by the engine, not here)
//
// The sign is INVERTED relative to rest_advantage: more travel is a DISADVANTAGE,
// so the side that travelled LESS is favoured. SUPPORTS/CONTRADICTS are the
// module's OWN characterisation of the HOME side (doc 56 C-2); the favoured side
// and the km gap live in verdict_text, with no orientation column (doc 56 C-3).
//
// 1.0.0 SCOPE (Decision 3): a categorical SUPPORTS/CONTRADICTS/NEUTRAL finding
// following the established rest_advantage single-finding pattern. strength,
// confidence and published_baseline_id are NULL (S-9 out of scope); no
// contribution_weight, no normalization and no calibration baseline is invented.
// The S-9 outcome baseline (doc 71 §10/§15) remains FUTURE. A pure signed
// comparison: any real distance difference is a real difference; magnitude
// significance ("does it register") is an S-9 calibration concern, not a
// fabricated threshold — the module gate is 0.
//
// PURE: a function of the two consumed values. No clock, no database — identical
// inputs give an identical finding.
// ─────────────────────────────────────────────────────────────────────────────

import { MODULE_STATUS, type FixtureInputs, type FixtureModuleCalculator, type ModuleFinding } from '../types';
import { CALCULATION_CONTEXT_KIND } from '../../feature/calculators/types';
import { compare, subtract, toNumericString, ZERO, type Exact } from '../../feature/write/scale';

const TRAVEL_DISTANCE = 'team.travel_distance';

/** Absolute value of an exact decimal (a side-agnostic magnitude for the verdict). */
function magnitude(value: Exact): Exact {
  return compare(value, ZERO) < 0 ? subtract(ZERO, value) : value;
}

export const travelImpact: FixtureModuleCalculator = {
  moduleKey: 'travel_impact',
  subjectKind: 'FIXTURE',
  contextKind: CALCULATION_CONTEXT_KIND, // ALL_COMPETITIONS — team.travel_distance is edition-free
  inputFeatureKeys: [TRAVEL_DISTANCE],

  evaluate(inputs: FixtureInputs): ModuleFinding {
    // The engine guarantees both sides' input is present before calling; assert
    // rather than coerce, so a contract breach is loud (never a fabricated 0).
    const home = inputs.home.get(TRAVEL_DISTANCE);
    const away = inputs.away.get(TRAVEL_DISTANCE);
    if (!home || !away) {
      throw new Error('travel_impact.evaluate called without both sides’ team.travel_distance present');
    }

    // Decision 2: home-relative exposure differential. More travel is a
    // disadvantage, so the side that travelled farther is the disfavoured one.
    const gap = subtract(away.value, home.value);
    const cmp = compare(gap, ZERO);
    const shownGap = toNumericString(magnitude(gap));

    if (cmp > 0) {
      return { status: MODULE_STATUS.SUPPORTS, verdictText: `Away travelled ${shownGap} km farther.` };
    }
    if (cmp < 0) {
      return { status: MODULE_STATUS.CONTRADICTS, verdictText: `Home travelled ${shownGap} km farther.` };
    }
    return { status: MODULE_STATUS.NEUTRAL, verdictText: `Even travel: both sides on ${toNumericString(home.value)} km.` };
  },
};
