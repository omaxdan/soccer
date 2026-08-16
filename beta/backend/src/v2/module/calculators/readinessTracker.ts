// ─────────────────────────────────────────────────────────────────────────────
// readiness_tracker — "Peaking or crashing?"
//
// The second S-6 module, and the first TEAM × ALL_COMPETITIONS consumer — it
// proves E-i's generic ALL_COMPETITIONS routing with a real module. A pure
// transcription of V1 `evalReadinessTracker` (doc 55 §1, doc 79 §2), reading the
// team's form-trend delta:
//
//   momentum = last5Points − prior5Points     (team.momentum, Gate E-ii)
//   momentum ≥ +10 → SUPPORTS   ("surging")
//   momentum ≤ −10 → CONTRADICTS ("crashing")
//   otherwise      → NEUTRAL     ("steady")
//
// TEAM-subject: the trend is one team's own form, so no orientation is needed and
// none is invented. The single input is the team's COMPETITION-agnostic momentum
// (ALL_COMPETITIONS, Gate E-ii). This is the first module to emit CONTRADICTS.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ±10 IS V1's THRESHOLD, TRANSCRIBED FROM classifyTrend — NOT INVENTED
//
// V1's `classifyTrend` bands the delta: `change ≥ 10 → SURGING`, `≤ −10 →
// CRASHING`. `evalReadinessTracker` maps SURGING → supports, CRASHING →
// contradicts, else neutral. The governing rule is that NUMERIC threshold.
//
// V1 has a presentation defect: `evalReadinessTracker` compares the FORMATTED
// string `classifyTrend(...).trend` (e.g. "SURGING (+12)") against the bare label
// "Surging", which never matches, so the live evaluator collapses to neutral. That
// defect is NOT reproduced here (doc 79 §2): the authoritative rule is the ±10
// threshold, and this module follows it.
//
// PURE: a function of the one consumed value. No clock, no database, no
// orientation state — identical input gives an identical finding.
// ─────────────────────────────────────────────────────────────────────────────

import {
  MODULE_STATUS,
  type ConsumedFeature,
  type ModuleCalculator,
  type ModuleFinding,
} from '../types';
import { CALCULATION_CONTEXT_KIND } from '../../feature/calculators/types';
import { compare, fromInt, toNumericString, type Exact } from '../../feature/write/scale';

const MOMENTUM = 'team.momentum';

/** V1's classifyTrend thresholds, transcribed. */
const SURGING_THRESHOLD: Exact = fromInt(10); // change ≥ +10
const CRASHING_THRESHOLD: Exact = fromInt(-10); // change ≤ −10

export const readinessTracker: ModuleCalculator = {
  moduleKey: 'readiness_tracker',
  subjectKind: 'TEAM',
  contextKind: CALCULATION_CONTEXT_KIND, // ALL_COMPETITIONS
  inputFeatureKeys: [MOMENTUM],

  evaluate(inputs: ReadonlyMap<string, ConsumedFeature>): ModuleFinding {
    // The engine guarantees the input is present before calling; assert rather
    // than silently coerce, so a contract breach is loud (never a fabricated 0).
    const momentum = inputs.get(MOMENTUM);
    if (!momentum) {
      throw new Error('readiness_tracker.evaluate called without team.momentum present');
    }

    const value = momentum.value;
    const shown = toNumericString(value);

    // Surging first, then crashing; the two are mutually exclusive (+10 and −10
    // cannot both hold). Anything between is steady form — NEUTRAL, never a
    // stand-in for absent data.
    if (compare(value, SURGING_THRESHOLD) >= 0) {
      return {
        status: MODULE_STATUS.SUPPORTS,
        verdictText: `Surging form: last-five points minus prior-five is ${shown}.`,
      };
    }
    if (compare(value, CRASHING_THRESHOLD) <= 0) {
      return {
        status: MODULE_STATUS.CONTRADICTS,
        verdictText: `Crashing form: last-five points minus prior-five is ${shown}.`,
      };
    }
    return {
      status: MODULE_STATUS.NEUTRAL,
      verdictText: `Steady form: last-five points minus prior-five is ${shown}.`,
    };
  },
};
