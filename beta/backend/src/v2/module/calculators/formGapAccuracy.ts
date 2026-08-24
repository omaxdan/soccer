// ─────────────────────────────────────────────────────────────────────────────
// form_gap_accuracy — "Does the form gap hold up?"
//
// The second S-6 FIXTURE-subject COMPARISON module, and the first ASYMMETRIC one:
// each side contributes its VENUE-APPROPRIATE recent form.
//
//   gap = home_team.team.home_form − away_team.team.away_form   (venue form index)
//   gap > 0 → SUPPORTS      ("Home venue form stronger")
//   gap < 0 → CONTRADICTS   ("Away venue form stronger")
//   gap = 0 → NEUTRAL       ("Even venue form")
//   either side's value absent → INACTIVE (raised by the engine, not here)
//
// STATUS IS THE MODULE'S OWN CHARACTERISATION (doc 56 C-2): SUPPORTS means the
// HOME side has the stronger venue form, CONTRADICTS the AWAY side — NOT "supports
// a prediction/bet/outcome". The favoured side and the underlying gap live in
// `verdict_text`; no orientation column exists or is needed (doc 56 C-3).
//
// WHY VENUE-SPECIFIC, AND WHY NOT A DUPLICATE OF HOME/AWAY SPLIT: the home team's
// `home_form` and the away team's `away_form` are each club's form in the venue
// context that applies to THIS fixture. The Home/Away Split module answers a
// different question — one team's OWN home-vs-away disparity — so the two are not
// duplicate calculations (governance gate; migration 029).
//
// DELIBERATE DEVIATION FROM V1: V1's `form_gap` used Banker/Strong/Lean/Coin-flip
// calibration bands and a `pickSide` selection over a single venue-agnostic
// `form_index`. V2 bars a selection (LC-71) and treats magnitude significance as
// an S-9 calibration concern, not a fabricated threshold; no probability or
// betting interpretation is made. This 1.0.0 rule is a PURE SIGNED COMPARISON of
// the two governed venue-form values.
//
// PURE: a function of the two consumed values. No clock, no database — identical
// inputs give an identical finding.
// ─────────────────────────────────────────────────────────────────────────────

import { MODULE_STATUS, type FixtureInputs, type FixtureModuleCalculator, type ModuleFinding } from '../types';
import { CALCULATION_CONTEXT_KIND } from '../../feature/calculators/types';
import { compare, subtract, toNumericString, ZERO, type Exact } from '../../feature/write/scale';

const HOME_FORM = 'team.home_form';
const AWAY_FORM = 'team.away_form';

/** Absolute value of an exact decimal (for a side-agnostic magnitude in the verdict). */
function magnitude(value: Exact): Exact {
  return compare(value, ZERO) < 0 ? subtract(ZERO, value) : value;
}

export const formGapAccuracy: FixtureModuleCalculator = {
  moduleKey: 'form_gap_accuracy',
  subjectKind: 'FIXTURE',
  contextKind: CALCULATION_CONTEXT_KIND, // ALL_COMPETITIONS — venue form is consumed edition-free
  // The union of both sides' inputs (the engine reads it once); the asymmetric
  // per-side split is declared below, so declared_input_count = 1 + 1 = 2.
  inputFeatureKeys: [HOME_FORM, AWAY_FORM],
  homeInputFeatureKeys: [HOME_FORM],
  awayInputFeatureKeys: [AWAY_FORM],

  evaluate(inputs: FixtureInputs): ModuleFinding {
    // The engine guarantees each side's declared input is present before calling;
    // assert rather than coerce, so a contract breach is loud (never a fabricated 0).
    const home = inputs.home.get(HOME_FORM);
    const away = inputs.away.get(AWAY_FORM);
    if (!home || !away) {
      throw new Error('form_gap_accuracy.evaluate called without both sides’ venue form present');
    }

    const gap = subtract(home.value, away.value);
    const cmp = compare(gap, ZERO);
    const shownGap = toNumericString(magnitude(gap));

    if (cmp > 0) {
      return { status: MODULE_STATUS.SUPPORTS, verdictText: `Home venue form stronger by ${shownGap}.` };
    }
    if (cmp < 0) {
      return { status: MODULE_STATUS.CONTRADICTS, verdictText: `Away venue form stronger by ${shownGap}.` };
    }
    return { status: MODULE_STATUS.NEUTRAL, verdictText: `Even venue form: both sides on ${toNumericString(home.value)}.` };
  },
};
