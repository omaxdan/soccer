// ─────────────────────────────────────────────────────────────────────────────
// fixture_load — team.rest_advantage, team.congestion_index
//
// Two features from one window of completed fixtures, which is why they share a
// calculator: "a calculator is the unit of implementation; a feature definition
// is the unit of meaning."
//
// ─────────────────────────────────────────────────────────────────────────────
// team.rest_advantage — DEC-3: V1 IS SUPERSEDED
//
// D-2, formally: "The value at `as_of` is the number of days since the team's
// most recent completed fixture before `as_of`."
//
// V1 computed `rest_days_avg`, the MEAN GAP ACROSS THE LAST FOUR FIXTURES
// (`processDbOnly.ts:1559–1566`). That is a different quantity, and DEC-3 rules
// that D-2 owns version 1.0.0. This calculator therefore implements the latest
// gap and NOT the mean — a mean of four gaps is not the latest gap, and
// implementing the mean here would silently restore the superseded definition.
//
// Provenance is OBSERVED, matching the registry ceiling: arithmetic over
// recorded kickoff instants, no estimation, no feature inputs.
// Sample count is 1 — the value rests on exactly one observation (D-2 §5).
//
// ─────────────────────────────────────────────────────────────────────────────
// team.congestion_index — DEC-3: THE APPROVED RATE TRANSFORM
//
// V1 banded a count of fixtures in the NEXT FOURTEEN DAYS
// (`processDbOnly.ts:353–361`). Forward-looking, which S-5 forbids outright:
// a value `as_of T` may read only reality at or before `T`.
//
// The approved transform keeps V1's calibrated bands and satisfies the backward
// window:
//
//   count = completed fixtures in the previous 28 days
//   rate  = count / 2                    ← an equivalent 14-day rate
//   band  = V1's original thresholds applied to that rate
//
// Applying V1's bands to the raw 28-day count would saturate: six or more
// fixtures in 28 days is routine, so nearly every side would score 80 and the
// feature would carry no information.
// ─────────────────────────────────────────────────────────────────────────────

import {
  before,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type CompletedFixture,
} from './types';
import { compare, divide, fromInt, type Exact } from '../write/scale';

const REST_ADVANTAGE = 'team.rest_advantage';
const CONGESTION_INDEX = 'team.congestion_index';

/** Milliseconds in a day. Both endpoints are integers, so the ratio is exact. */
const MS_PER_DAY = fromInt(86_400_000);

/** The congestion window, in milliseconds. Twenty-eight days, backward. */
const CONGESTION_WINDOW_MS = 28 * 86_400_000;

/** The rate divisor: a 28-day count expressed per 14 days. */
const RATE_DIVISOR = fromInt(2);

/**
 * V1's congestion bands, unchanged.
 *
 * From `processDbOnly.ts:355–361`. V1 tested equality against integer counts;
 * against a fractional rate the same boundaries become upper thresholds, which
 * is the reading DEC-3 approved. Higher is more congested — the feature is
 * `LOWER_IS_STRONGER`.
 */
const CONGESTION_BANDS: readonly (readonly [Exact, number])[] = [
  [fromInt(1), 0],
  [fromInt(2), 10],
  [fromInt(3), 25],
  [fromInt(4), 40],
  [fromInt(5), 60],
];
const CONGESTION_MAX = 80;

function bandFor(rate: Exact): number {
  for (const [threshold, score] of CONGESTION_BANDS) {
    if (compare(rate, threshold) <= 0) return score;
  }
  return CONGESTION_MAX;
}

export const fixtureLoad: Calculator = {
  calculatorKey: 'fixture_load',
  featureKeys: [REST_ADVANTAGE, CONGESTION_INDEX],

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const history = context.fixturesByTeam.get(subject.teamId);
      if (!history) continue;

      // Strict, for the reason stated in `before()`: at KICKOFF the generating
      // fixture must not be visible to the value it generates.
      const played = before(history.fixtures, subject.asOf);

      const rest = restAdvantage(subject.asOf, played);
      if (rest) {
        candidates.push({
          featureKey: REST_ADVANTAGE,
          teamId: subject.teamId,
          asOf: subject.asOf,
          value: rest,
          // D-2 §5: exactly one observation — the single prior fixture.
          sampleObservationCount: 1,
          consumed: [],
        });
      }

      const congestion = congestionIndex(subject.asOf, played);
      if (congestion) {
        candidates.push({
          featureKey: CONGESTION_INDEX,
          teamId: subject.teamId,
          asOf: subject.asOf,
          value: congestion.value,
          sampleObservationCount: congestion.observations,
          consumed: [],
        });
      }
    }

    return candidates;
  },
};

/**
 * Days since the most recent completed fixture.
 *
 * Returns null when there is none. PD-07: "a newly promoted side at season start
 * genuinely has no rest figure under this definition", and a zero would assert
 * that it played today.
 *
 * The difference is taken in whole milliseconds — both instants are integers —
 * so the division is exact input to exact arithmetic with no float anywhere.
 */
function restAdvantage(asOf: Date, played: readonly CompletedFixture[]): Exact | null {
  const mostRecent = played[0];
  if (!mostRecent) return null;
  const elapsedMs = asOf.getTime() - mostRecent.kickoffAt.getTime();
  // `before()` guarantees this is positive; a non-positive value would mean the
  // filter failed and must not be papered over with a clamp.
  if (elapsedMs <= 0) return null;
  return divide(fromInt(elapsedMs), MS_PER_DAY);
}

/**
 * Fixture density over the previous 28 days, banded via the 14-day rate.
 *
 * Returns null when the window holds no completed fixture. That is deliberate
 * and follows the stated rule that a team with no qualifying observation
 * produces no row: with S-4 ingesting forward-only, an empty early window means
 * *no data yet*, not *a quiet month*, and writing 0 — "not congested" — would
 * turn missing data into a confident reading. V1 erred optimistic here by
 * design; V2 represents absence as absence.
 */
function congestionIndex(
  asOf: Date,
  played: readonly CompletedFixture[]
): { value: Exact; observations: number } | null {
  const windowStart = asOf.getTime() - CONGESTION_WINDOW_MS;
  const inWindow = played.filter((fixture) => fixture.kickoffAt.getTime() >= windowStart);
  if (inWindow.length === 0) return null;

  const rate = divide(fromInt(inWindow.length), RATE_DIVISOR);
  return { value: fromInt(bandFor(rate)), observations: inWindow.length };
}
