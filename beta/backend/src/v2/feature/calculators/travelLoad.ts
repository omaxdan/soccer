// ─────────────────────────────────────────────────────────────────────────────
// travel_load — team.travel_impact
//
// V1'S BANDS, CARRIED ACROSS UNCHANGED (DEC-3).
//
//   avgKm ≤  100 → 100      avgKm ≤ 1000 → 65
//   avgKm ≤  300 →  90      avgKm ≤ 2000 → 45
//   avgKm ≤  600 →  80      otherwise    → 25
//
//   travel_impact = 100 − score
//
// From `processDbOnly.ts:818–833`. The carry-across is exact rather than
// approximate because `avgKm14` is `sum / trips.length` — a MEAN PER TRIP, not a
// total per period — so the same band table applies unchanged to a mean over the
// last five away fixtures. That was verified in source before this calculator
// was written, not assumed from the variable's name.
//
// The inversion is V1's too: its `travel_fatigue_score` is bad-high for
// consistency with congestion, and `team.travel_impact` is `LOWER_IS_STRONGER`.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE FLOATING POINT APPEARS, AND WHY IT IS SAFE
//
// Great-circle distance needs trigonometry, and there is no exact `sin` or
// `sqrt`. Haversine therefore runs in IEEE 754 — the only such arithmetic in
// S-5.
//
// It cannot reach `feature_value.value`. The distance selects a BAND, and the
// stored value is `100 − band`, an integer chosen from a fixed table. So the
// column receives an exact integer no matter what the last bit of the distance
// did.
//
// Determinism holds because IEEE 754 is deterministic: identical coordinates
// produce an identical double, hence an identical band, on every run. The only
// exposure would be a distance landing exactly on a band boundary, and even then
// the result is stable — it is the same double every time.
//
// ─────────────────────────────────────────────────────────────────────────────
// MISSING COORDINATES YIELD NO VALUE, NEVER A SUBSTITUTED DISTANCE
//
// LC-05: "NULL coordinates yield no distance value — absence rather than a
// substituted value, which follows from PD-07: absence of a distance is the
// absence of a feature value row." A trip whose origin or destination has no
// coordinates is excluded from the mean; a side with no usable trip gets no row.
// ─────────────────────────────────────────────────────────────────────────────

import {
  before,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type VenueLocation,
} from './types';
import { fromInt } from '../write/scale';

const TRAVEL_IMPACT = 'team.travel_impact';

/** Away fixtures considered. */
const WINDOW = 5;

/** Mean earth radius in kilometres, as haversine conventionally uses. */
const EARTH_RADIUS_KM = 6371;

/** V1's distance bands: upper bound in km, and the travel SCORE (higher = better). */
const TRAVEL_BANDS: readonly (readonly [number, number])[] = [
  [100, 100],
  [300, 90],
  [600, 80],
  [1000, 65],
  [2000, 45],
];
const TRAVEL_FLOOR_SCORE = 25;

function scoreFor(averageKm: number): number {
  for (const [upperBound, score] of TRAVEL_BANDS) {
    if (averageKm <= upperBound) return score;
  }
  return TRAVEL_FLOOR_SCORE;
}

/**
 * Great-circle distance in kilometres.
 *
 * IEEE 754, deliberately and only here — see the header. Coordinates arrive as
 * strings from `numeric(8,6)` / `numeric(9,6)` and are parsed for trigonometry
 * alone; nothing derived from this reaches a stored value except through a band.
 */
function haversineKm(from: VenueLocation, to: VenueLocation): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const lat1 = toRadians(Number(from.latitude));
  const lat2 = toRadians(Number(to.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(Number(to.longitude) - Number(from.longitude));

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const travelLoad: Calculator = {
  calculatorKey: 'travel_load',
  featureKeys: [TRAVEL_IMPACT],

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const history = context.fixturesByTeam.get(subject.teamId);
      if (!history) continue;

      const homeVenueId = context.homeVenueByTeam.get(subject.teamId) ?? null;
      const origin = homeVenueId ? context.venuesById.get(homeVenueId) : undefined;
      // No home ground, or one without coordinates, means no journey can be
      // measured from anywhere. Absence, not a zero-distance assumption.
      if (!origin) continue;

      const awayFixtures = before(history.fixtures, subject.asOf)
        .filter((fixture) => !fixture.isHome)
        .slice(0, WINDOW);

      const distances: number[] = [];
      for (const fixture of awayFixtures) {
        const destination = fixture.venueId ? context.venuesById.get(fixture.venueId) : undefined;
        if (!destination) continue;
        distances.push(haversineKm(origin, destination));
      }
      if (distances.length === 0) continue;

      // V1 rounds the mean to whole kilometres before the band lookup
      // (`Math.round(sum / length)`), and the rounding is part of the formula
      // rather than a presentation choice — a mean of 100.4 km bands as 100.
      const meanKm = Math.round(distances.reduce((sum, km) => sum + km, 0) / distances.length);
      const impact = 100 - scoreFor(meanKm);

      candidates.push({
        featureKey: TRAVEL_IMPACT,
        teamId: subject.teamId,
        asOf: subject.asOf,
        value: fromInt(impact),
        sampleObservationCount: distances.length,
        consumed: [],
      });
    }

    return candidates;
  },
};
