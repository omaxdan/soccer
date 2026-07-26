/**
 * The confidence blend's component assembly, extracted so it can be tested.
 *
 * processDbOnly builds this table inline inside a 4,000-line job that talks to
 * the database on the way in and out, which makes the arithmetic unreachable
 * from a test. The travel bug lived in one row of that table and could not
 * have been caught without a live run.
 *
 * This mirrors the live table exactly — same order, same saturations, same
 * weights, same gate. It is deliberately NOT yet wired into processDbOnly:
 * that swap changes a hot path and belongs in its own commit. Until then this
 * is the regression surface, and any change to the live table must be made
 * here too or the tests stop meaning anything.
 */

export type Gap = number | null;

export interface ConfidenceInputs {
  readinessGap: Gap;
  strengthGap: Gap;
  injuryGap: Gap;
  congestionGap: Gap;
  /** Cumulative fatigue gap, away minus home. NOT this fixture's trip in km. */
  travelFatigueGap: Gap;
  stabilityGap: Gap;
  venueGap: Gap;
  motivationGap: Gap;
}

/** [gap toward home, saturation, weight] — mirrors processDbOnly. */
export function componentTable(i: ConfidenceInputs): [Gap, number, number][] {
  return [
    [i.readinessGap, 30, 30],
    [i.strengthGap, 30, 20],
    [i.injuryGap, 40, 15],
    [i.congestionGap, 50, 10],
    [i.travelFatigueGap, 40, 10],
    [i.stabilityGap, 40, 5],
    [i.venueGap, 40, 7],
    [i.motivationGap, 20, 3],
  ];
}

export const MIN_COMPONENTS_WITH_DATA = 4;

export interface ConfidenceResult {
  score: number | null;
  componentsWithData: number;
  weightUsed: number;
}

export function computeConfidence(
  inputs: ConfidenceInputs,
  pickSign: 1 | -1
): ConfidenceResult {
  let weightedSum = 0;
  let weightUsed = 0;
  let componentsWithData = 0;

  for (const [gapTowardHome, saturation, weight] of componentTable(inputs)) {
    if (gapTowardHome === null) continue;
    const edge = Math.max(-1, Math.min(1, (gapTowardHome * pickSign) / saturation));
    weightedSum += edge * weight;
    weightUsed += weight;
    componentsWithData++;
  }

  if (componentsWithData < MIN_COMPONENTS_WITH_DATA || weightUsed === 0)
    return { score: null, componentsWithData, weightUsed };

  return {
    score:
      Math.round(
        Math.max(0, Math.min(100, 50 + 50 * (weightedSum / weightUsed))) * 10
      ) / 10,
    componentsWithData,
    weightUsed,
  };
}
