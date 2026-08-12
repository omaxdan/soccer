// ─────────────────────────────────────────────────────────────────────────────
// travel_itinerary — team.travel_distance
//
// Total distance between the venues of a team's CONSECUTIVELY PLAYED fixtures,
// across the 28-day elapsed window, seeded by the fixture immediately before it.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS NOT `travel_load`, AND THE DIFFERENCE IS THE WHOLE POINT
//
// `travelLoad.ts` computes `team.travel_impact` and is UNCHANGED. S-0-a recorded
// four defects in it, and this calculator exists because each one is a
// semantic error rather than a bug:
//
//   D-i   away-only        it discards home fixtures, so a side that played away
//                          on Wednesday and hosts on Saturday reads the same as
//                          one that has been at home for a month
//   D-ii  star topology    every trip is measured from the team's home ground, so
//                          a back-to-back away pair becomes two radial trips
//                          rather than the leg actually flown
//   D-iii no time window   `WINDOW = 5` counts FIXTURES; five trips in a
//                          fortnight and five across five months score alike
//   D-iv  mean dilution    a mean per trip, so eight long journeys band the same
//                          as one
//
// So `travel_impact` answers "how far from home are this team's recent away
// grounds, on average?" and this answers "how far has this team actually
// travelled lately?". Two questions, two features. Neither replaces the other
// here; `travel_impact` is untouched and stays registered.
//
// ─────────────────────────────────────────────────────────────────────────────
// NODES ARE VENUES. `isHome` IS NEVER READ, AND THAT IS DELIBERATE
//
// The itinerary follows `fixture.venue_id` — where the match was actually
// played. A home fixture is a node like any other, which is what fixes D-i; and
// because the chain never asks whether a fixture was "home", a HOME FIXTURE AT A
// NEUTRAL GROUND is placed correctly with no flag consulted. `is_neutral_venue`
// is therefore not needed and is not read.
//
// `homeVenueByTeam` is available in the context and is deliberately unused. A
// null `venue_id` is an unknown location, NOT the home ground: substituting it
// would be an INFERENCE, and one inferred leg would cap every dependant at
// provenance rank 2 under `min(ceiling, weakest input)`.
//
// ─────────────────────────────────────────────────────────────────────────────
// NO RETURN-HOME LEG IS INVENTED
//
// A fixture list records where matches were PLAYED, not where the team was
// between them. `Away A → Away B` does not prove `Away A → Home → Away B`, so
// only the observed leg is counted. The metric is a true LOWER BOUND on distance
// travelled, and understating is a coverage fact where an invented leg would be
// a fabricated observation. That keeps every value DERIVED (rank 3) rather than
// INFERRED (rank 2).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SEED, AND WHY THE WINDOW STILL ENDS WHERE IT SAYS
//
// A chain built only from in-window fixtures yields n−1 legs from n fixtures and
// silently omits the journey INTO the window — for a side with one in-window
// fixture it yields nothing at all, which is exactly the away-Wednesday /
// home-Saturday case this feature exists for. So the most recent fixture BEFORE
// the window contributes its venue as the starting node. Its own earlier history
// does not: one node, not a recursion, so the window stays bounded.
//
// ─────────────────────────────────────────────────────────────────────────────
// 0 km IS A MEASUREMENT; AN UNMEASURABLE LEG IS NOT
//
// Two fixtures at one ground means the team did not travel between them — a
// measured zero, counted as an observation. A leg whose endpoint has no
// coordinates is UNKNOWN: excluded from the sum AND from the count, never
// written as zero. Collapsing the two would turn missing data into a confident
// reading, which is what LC-05 and PD-07 exist to prevent.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE AGGREGATE IS RETURNED UNROUNDED
//
// Legs are summed at full precision and the total is returned unrounded, as the
// calculator contract requires. `team.travel_distance` is registered at
// `value_scale = 0`, so `write/scale.ts` performs the single rounding at the
// write boundary and the stored value is whole kilometres. Rounding each leg
// first would lose a kilometre per leg on a congested month.
// ─────────────────────────────────────────────────────────────────────────────

import {
  before,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type CompletedFixture,
  type VenueLocation,
} from './types';
import { add, fromString, ZERO, type Exact } from '../write/scale';

const TRAVEL_DISTANCE = 'team.travel_distance';

/**
 * The window, in elapsed milliseconds.
 *
 * 28 × 86,400,000 — the same constant and the same arithmetic as
 * `fixtureLoad`'s congestion window, and `read/fixtures.ts` already returns
 * every fixture within it. Epoch milliseconds, so no timezone and no DST
 * boundary can shorten or lengthen it: "28 calendar days" would be 671 or 673
 * hours twice a year.
 */
const WINDOW_MS = 28 * 86_400_000;

/**
 * Mean earth radius in kilometres.
 *
 * REPRODUCED FROM `travelLoad.ts`, NOT IMPORTED. `haversineKm` is private
 * there, and both importing it and exporting it would modify a file that must
 * stay unchanged. A parity test pins the two implementations together to full
 * double precision so the duplication cannot drift silently.
 */
const EARTH_RADIUS_KM = 6371;

/** How many decimal places of the double are carried into exact arithmetic. */
const KM_PRECISION = 12;

/**
 * Great-circle distance in kilometres.
 *
 * Identical in form to `travelLoad.ts`'s. IEEE 754 is confined to this function;
 * its result is converted to an exact decimal immediately and every sum after
 * that is exact, so the aggregate cannot accumulate float error across legs.
 */
export function haversineKm(from: VenueLocation, to: VenueLocation): number {
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

/** One journey between two consecutive venues, when both can be located. */
interface Leg {
  readonly kilometres: Exact;
}

/**
 * The fixtures whose venues form the chain, oldest first.
 *
 * `played` arrives most-recent-first and is not re-sorted from the input: the
 * order is re-established here from `kickoffAt`, with `fixtureId` as the
 * tiebreak, so an unsorted context produces the same itinerary as a sorted one.
 * A calculator that trusted its input order would be non-deterministic in
 * exactly the way R-2 obligation 1 forbids.
 */
export function itineraryNodes(
  played: readonly CompletedFixture[],
  asOf: Date
): CompletedFixture[] {
  const windowStart = asOf.getTime() - WINDOW_MS;

  const ordered = [...played].sort((a, b) => {
    const byKickoff = a.kickoffAt.getTime() - b.kickoffAt.getTime();
    return byKickoff !== 0 ? byKickoff : a.fixtureId.localeCompare(b.fixtureId);
  });

  const inWindow = ordered.filter((fixture) => fixture.kickoffAt.getTime() >= windowStart);
  // THE SEED: the most recent fixture strictly before the window. `ordered` is
  // oldest-first, so the last one below the boundary is the nearest to it.
  const seed = ordered.filter((fixture) => fixture.kickoffAt.getTime() < windowStart).pop();

  return seed ? [seed, ...inWindow] : inWindow;
}

/** The measurable legs between consecutive nodes. */
function legsBetween(
  nodes: readonly CompletedFixture[],
  venuesById: ReadonlyMap<string, VenueLocation>
): Leg[] {
  const legs: Leg[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const from = nodes[index - 1].venueId ? venuesById.get(nodes[index - 1].venueId!) : undefined;
    const to = nodes[index].venueId ? venuesById.get(nodes[index].venueId!) : undefined;
    // Either endpoint unlocatable makes the journey unknown. Not zero.
    if (!from || !to) continue;
    legs.push({ kilometres: fromString(haversineKm(from, to).toFixed(KM_PRECISION)) });
  }
  return legs;
}

export const travelItinerary: Calculator = {
  calculatorKey: 'travel_itinerary',
  featureKeys: [TRAVEL_DISTANCE],

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const history = context.fixturesByTeam.get(subject.teamId);
      if (!history) continue;

      // `before()` is STRICT, so the fixture this value is calculated for can
      // never be a node — at the KICKOFF point `as_of` equals its kickoff.
      const nodes = itineraryNodes(before(history.fixtures, subject.asOf), subject.asOf);
      const legs = legsBetween(nodes, context.venuesById);

      // No measurable leg is an ABSENCE, not a zero (PD-07, LC-05). A side with
      // one fixture and no seed has travelled an unknown amount, not none.
      if (legs.length === 0) continue;

      candidates.push({
        featureKey: TRAVEL_DISTANCE,
        teamId: subject.teamId,
        asOf: subject.asOf,
        value: legs.reduce((total, leg) => add(total, leg.kilometres), ZERO),
        // MEASURABLE LEGS, not fixtures and not away fixtures. A 0 km leg
        // between two known venues counts; an unlocatable one does not.
        sampleObservationCount: legs.length,
        // Layer 1: this reads football relations, never another feature.
        consumed: [],
      });
    }

    return candidates;
  },
};
