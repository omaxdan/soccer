// ─────────────────────────────────────────────────────────────────────────────
// rest_advantage — "Who is fresher, and does it register?"
//
// The first S-6 FIXTURE-subject COMPARISON module. It compares the two teams'
// already-persisted, as-of-safe `team.rest_advantage` (days of recovery since the
// previous fixture; HIGHER is better; OBSERVED).
//
//   gap = home.rest_advantage − away.rest_advantage
//   gap > 0 → SUPPORTS      ("Home fresher")
//   gap < 0 → CONTRADICTS   ("Away fresher")
//   gap = 0 → NEUTRAL       ("Even rest")
//   either side's value absent → INACTIVE (raised by the engine, not here)
//
// STATUS IS THE MODULE'S OWN CHARACTERISATION (doc 56 C-2): SUPPORTS means the
// HOME side has the rest advantage, CONTRADICTS the AWAY side — NOT "supports a
// prediction/bet/outcome". The favoured side and the underlying gap live in
// `verdict_text`; no orientation column exists or is needed (doc 56 C-3).
//
// DELIBERATE DEVIATION FROM V1: V1's `evalRest` used a ±4-day band with a
// selection (`pickSide`), which V2 bars (LC-71). This 1.0.0 rule is a PURE SIGNED
// COMPARISON — any real rest difference is a real difference; magnitude
// significance ("does it register") is a calibration concern (S-9), not a
// fabricated threshold here. No numeric threshold is invented (the feature's own
// sample threshold governs sufficiency; the module gate is 0).
//
// PURE: a function of the two consumed values. No clock, no database — identical
// inputs give an identical finding.
// ─────────────────────────────────────────────────────────────────────────────

import { MODULE_STATUS, type FixtureInputs, type FixtureModuleCalculator, type ModuleFinding } from '../types';
import { CALCULATION_CONTEXT_KIND } from '../../feature/calculators/types';
import { compare, subtract, toNumericString, ZERO, type Exact } from '../../feature/write/scale';

const REST_ADVANTAGE = 'team.rest_advantage';

/** Absolute value of an exact decimal (for a side-agnostic magnitude in the verdict). */
function magnitude(value: Exact): Exact {
  return compare(value, ZERO) < 0 ? subtract(ZERO, value) : value;
}

export const restAdvantage: FixtureModuleCalculator = {
  moduleKey: 'rest_advantage',
  subjectKind: 'FIXTURE',
  contextKind: CALCULATION_CONTEXT_KIND, // ALL_COMPETITIONS — team.rest_advantage is edition-free
  inputFeatureKeys: [REST_ADVANTAGE],

  evaluate(inputs: FixtureInputs): ModuleFinding {
    // The engine guarantees both sides' input is present before calling; assert
    // rather than coerce, so a contract breach is loud (never a fabricated 0).
    const home = inputs.home.get(REST_ADVANTAGE);
    const away = inputs.away.get(REST_ADVANTAGE);
    if (!home || !away) {
      throw new Error('rest_advantage.evaluate called without both sides’ team.rest_advantage present');
    }

    const gap = subtract(home.value, away.value);
    const cmp = compare(gap, ZERO);
    const shownGap = toNumericString(magnitude(gap));

    if (cmp > 0) {
      return { status: MODULE_STATUS.SUPPORTS, verdictText: `Home fresher: ${shownGap} days more rest.` };
    }
    if (cmp < 0) {
      return { status: MODULE_STATUS.CONTRADICTS, verdictText: `Away fresher: ${shownGap} days more rest.` };
    }
    return { status: MODULE_STATUS.NEUTRAL, verdictText: `Even rest: both sides on ${toNumericString(home.value)} days.` };
  },
};
