// ─────────────────────────────────────────────────────────────────────────────
// giant_killer_index — TEAM × ALL_COMPETITIONS — MAGNITUDE (S-9C, 2.0.0)
//
// The Giant Killer module's 2.0.0 magnitude reading. It consumes the committed
// S-6 substrate `team.giant_killer_ppg` (recency-weighted points-per-game vs
// top-tertile opponents, 0–3) and emits the V1-authoritative Giant Killer score:
//
//   strength = 100 * ppgTop / 3            (OD-2, round-2 as V1 published it)
//
// It is NON-DIRECTIONAL: status = MEASURED, never SUPPORTS/NEUTRAL/CONTRADICTS.
// No threshold, no band, no categorical conversion (owner-barred). `confidence`
// and `published_baseline_id` are the engine's NULLs (calibration deferred, OD-6).
//
// PURE and deterministic: a function of the consumed value; no clock, no DB. The
// substrate is unchanged (ALL_COMPETITIONS, as_of-anchored recency, ≥3 top-tier or
// absent — all upstream in S-6). The engine emits this ONLY at the 2.0.0 version.
// ─────────────────────────────────────────────────────────────────────────────

import { MODULE_STATUS, type ConsumedFeature, type ModuleCalculator, type ModuleFinding } from '../types';
import { CALCULATION_CONTEXT_KIND } from '../../feature/calculators/types';
import { divide, fromInt, multiply, ONE_HUNDRED, roundHalfUp, toNumericString, type Exact } from '../../feature/write/scale';

const GIANT_KILLER_PPG = 'team.giant_killer_ppg';
const THREE = fromInt(3);
/** V1 published the score at two decimals (round2(100*ppgTop/3)). */
const SCORE_SCALE = 2;

export const giantKillerIndex: ModuleCalculator = {
  moduleKey: 'giant_killer_index',
  subjectKind: 'TEAM',
  contextKind: CALCULATION_CONTEXT_KIND,
  inputFeatureKeys: [GIANT_KILLER_PPG],
  emitsMagnitude: true,

  evaluate(inputs: ReadonlyMap<string, ConsumedFeature>): ModuleFinding {
    const ppg = inputs.get(GIANT_KILLER_PPG);
    // The engine calls evaluate only when every declared input is present; assert
    // rather than coerce, so a contract breach is loud.
    if (!ppg) {
      throw new Error('giant_killer_index.evaluate called without team.giant_killer_ppg present');
    }
    // strength = 100 * ppgTop / 3, rounded to two decimals (the V1 score). OD-2.
    const score: Exact = roundHalfUp(divide(multiply(ppg.value, ONE_HUNDRED), THREE), SCORE_SCALE);
    return {
      status: MODULE_STATUS.MEASURED,
      strength: score,
      verdictText:
        `Giant-killer score ${toNumericString(score)} of 100 — recency-weighted points per game ` +
        `against top-tertile opponents (${toNumericString(ppg.value)} PPG), scaled to 100.`,
    };
  },
};
