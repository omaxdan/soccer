// ─────────────────────────────────────────────────────────────────────────────
// consistency_index — TEAM × ALL_COMPETITIONS — MAGNITUDE (S-9C, 2.0.0)
//
// The Consistency Index module's 2.0.0 magnitude reading. It consumes the
// committed S-6 substrate `team.goal_margin_volatility` (unweighted sample
// standard deviation of signed goal margin over the 730-day window) and emits it
// UNCHANGED as the magnitude:
//
//   strength = team.goal_margin_volatility          (OD-3 — raw, no transform)
//
// No scale, normalize, invert, threshold, band, or categorical/directional
// mapping (owner-barred). Higher volatility = less consistent, but the direction
// is the consumer's judgement, not this reading's — status = MEASURED. `confidence`
// and `published_baseline_id` are the engine's NULLs (calibration deferred, OD-6).
//
// PURE and deterministic: a passthrough of the consumed value; no clock, no DB.
// The substrate's own sample gate (n ≥ 3 or absent) and precision are upstream in
// S-6. The engine emits this ONLY at the 2.0.0 version.
// ─────────────────────────────────────────────────────────────────────────────

import { MODULE_STATUS, type ConsumedFeature, type ModuleCalculator, type ModuleFinding } from '../types';
import { CALCULATION_CONTEXT_KIND } from '../../feature/calculators/types';
import { toNumericString } from '../../feature/write/scale';

const GOAL_MARGIN_VOLATILITY = 'team.goal_margin_volatility';

export const consistencyIndex: ModuleCalculator = {
  moduleKey: 'consistency_index',
  subjectKind: 'TEAM',
  contextKind: CALCULATION_CONTEXT_KIND,
  inputFeatureKeys: [GOAL_MARGIN_VOLATILITY],
  emitsMagnitude: true,

  evaluate(inputs: ReadonlyMap<string, ConsumedFeature>): ModuleFinding {
    const volatility = inputs.get(GOAL_MARGIN_VOLATILITY);
    if (!volatility) {
      throw new Error('consistency_index.evaluate called without team.goal_margin_volatility present');
    }
    // Raw measurement, emitted unchanged (OD-3): no scale/invert/normalize/threshold.
    return {
      status: MODULE_STATUS.MEASURED,
      strength: volatility.value,
      verdictText:
        `Goal-margin volatility ${toNumericString(volatility.value)} — sample standard deviation of ` +
        `signed goal margin over the 730-day window. Higher is less consistent.`,
    };
  },
};
