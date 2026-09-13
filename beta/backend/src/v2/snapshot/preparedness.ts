// ─────────────────────────────────────────────────────────────────────────────
// TEAM PREPAREDNESS — B3 governed verdict-composition contribution (v1.3.0)
//
// A per-SIDE absolute preparedness score, composed AT SNAPSHOT SEAL from governed
// Layer-2 feature values — NOT a home-vs-away differential (that is what the edges
// are), and NOT a module reading. Team Preparedness lives ONLY in the seal /
// verdict-composition layer: Layer 2 stays `team + as_of` and fixture-agnostic;
// home/away orientation and competition-edition resolution happen HERE, against
// the fixture being sealed.
//
// This module is PURE and DETERMINISTIC: it is handed already-read feature values
// and returns the two side results. It reads no database and no clock (the same
// R-2 obligation the feature/module calculators observe). The seal driver does the
// reading, the citation into snapshot_feature_state, the manifest and the insert.
//
// THE GOVERNED 60-POINT SUBSET (the deferred 40 — Travel 15 / Opponent 20 /
// Motivation 5 — are NOT implemented and are NEVER redistributed):
//
//   Form            30   home side: team.home_form ; away side: team.away_form   (0–100)
//   Congestion      15   team.congestion_index, oriented 100 − x                 (0–100)
//   Home/Venue      10   home side: team.home_win_rate ; away: team.away_win_rate (0–100, edition-scoped)
//   Squad Stability  5   team.squad_stability                                     (0–1 ratio)
//   ───────────────────
//   TOTAL           60   = declared_points
//
// COVERAGE (LC-97: absence recorded as absence, never zero-as-signal):
//   available_points  = Σ of the weights whose input is PRESENT (present-but-below-
//                       threshold still counts as present; the caveat lives in
//                       completeness, exactly as it does for the edges).
//   preparedness_points = Σ of the present components' points — an ABSOLUTE points
//                       sum in [0, available_points]. NO renormalisation over the
//                       present weight (that is `team_readiness`'s rule, not this
//                       one): a missing component reduces the reachable maximum, it
//                       does not inflate the survivors.
//   coverage_ratio    = available_points / 60.
//   All four inputs absent → preparedness_points = NULL, available = 0, ratio = 0.
//   A missing input is NEVER read as zero.
//
// Every output numeric is produced through feature/write/scale.ts and rounded ONCE
// (roundHalfUp) at scale 4, so the same inputs always yield byte-identical text —
// the property the checksum fold and calibration equality both depend on.
// ─────────────────────────────────────────────────────────────────────────────

import {
  add,
  clamp,
  divide,
  fromInt,
  multiply,
  roundHalfUp,
  subtract,
  toNumericString,
  ONE_HUNDRED,
  ZERO,
  type Exact,
} from '../feature/write/scale';

// The governed feature keys. Exact repository names — never renamed or invented.
export const HOME_FORM_FEATURE_KEY = 'team.home_form';
export const AWAY_FORM_FEATURE_KEY = 'team.away_form';
export const CONGESTION_FEATURE_KEY = 'team.congestion_index';
export const HOME_WIN_RATE_FEATURE_KEY = 'team.home_win_rate';
export const AWAY_WIN_RATE_FEATURE_KEY = 'team.away_win_rate';
export const SQUAD_STABILITY_FEATURE_KEY = 'team.squad_stability';

// Component weights (points). Their sum is the declared subset total.
const FORM_WEIGHT = fromInt(30);
const CONGESTION_WEIGHT = fromInt(15);
const VENUE_WEIGHT = fromInt(10);
const SQUAD_WEIGHT = fromInt(5);

/** The governed subset total — 60. Stored per row so a future 100-point contract
 *  (the deferred 40, under a later version) leaves these rows immutably at 60. */
export const DECLARED_POINTS: Exact = fromInt(60);

/** The single output rounding scale for every stored/hashed preparedness numeric. */
export const PREPAREDNESS_OUTPUT_SCALE = 4;

const ONE_RATIO = fromInt(1);

export type Side = 'HOME' | 'AWAY';

/** One consumed feature value, with the citation identity the seal will seal into
 *  snapshot_feature_state and the version the manifest will reference. */
export interface PreparednessInput {
  readonly featureKey: string;
  readonly value: Exact;
  readonly featureValueId: string;
  readonly featureValueAsOf: Date;
  readonly featureVersionId: string;
}

/** The four venue-appropriate inputs for one side. Any may be absent. */
export interface PreparednessSideInputs {
  readonly side: Side;
  readonly teamId: string;
  /** Venue-appropriate recent form (home_form for HOME, away_form for AWAY). */
  readonly form?: PreparednessInput;
  /** Fixture congestion (team.congestion_index). */
  readonly congestion?: PreparednessInput;
  /** Venue win rate (home_win_rate for HOME, away_win_rate for AWAY) — edition-scoped. */
  readonly venue?: PreparednessInput;
  /** Squad stability (team.squad_stability), a 0–1 ratio. */
  readonly squad?: PreparednessInput;
}

/** The cited feature value the seal materialises + manifests for one component. */
export interface PreparednessCitation {
  readonly featureValueId: string;
  readonly featureValueAsOf: Date;
  readonly featureVersionId: string;
}

/** The sealed per-side result. Numerics are canonical decimal text (scale 4),
 *  `preparednessPoints` NULL when no component is present. */
export interface PreparednessSideResult {
  readonly side: Side;
  readonly teamId: string;
  readonly preparednessPoints: string | null;
  readonly availablePoints: string;
  readonly declaredPoints: string;
  readonly coverageRatio: string;
  readonly citedValues: readonly PreparednessCitation[];
}

/**
 * True when the governed composition version populates Team Preparedness — 1.3.0
 * and any later version. Numeric (major,minor) compare, so '1.10.0' > '1.3.0'.
 * Unparseable designations → false (preparedness is only ever ADDED by a governed
 * version, never by accident). Mirrors restEdgeGovernedIn / formEdgeGovernedIn.
 */
export function preparednessGovernedIn(designation: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(designation.trim());
  if (!m) return false;
  const maj = Number(m[1]);
  const min = Number(m[2]);
  return maj > 1 || (maj === 1 && min >= 3);
}

/** points = (oriented / 100) × weight, computed exactly (rounded once by the caller). */
function scaledPoints(orientedZeroToHundred: Exact, weight: Exact): Exact {
  return divide(multiply(orientedZeroToHundred, weight), ONE_HUNDRED);
}

/** Compute one side's absolute preparedness over its PRESENT components. */
function computeSide(inputs: PreparednessSideInputs): PreparednessSideResult {
  let available = ZERO; // Σ present weights
  let points = ZERO; // Σ present component points
  let present = false;
  const citedValues: PreparednessCitation[] = [];

  const cite = (i: PreparednessInput): void => {
    citedValues.push({
      featureValueId: i.featureValueId,
      featureValueAsOf: i.featureValueAsOf,
      featureVersionId: i.featureVersionId,
    });
  };

  if (inputs.form) {
    // 0–100, higher is stronger. Clamped to its declared domain so a stray
    // out-of-range value can never push a component above its weight (and so the
    // ck_..._points_within_available invariant can never trip on a data glitch).
    const oriented = clamp(inputs.form.value, ZERO, ONE_HUNDRED);
    available = add(available, FORM_WEIGHT);
    points = add(points, scaledPoints(oriented, FORM_WEIGHT));
    cite(inputs.form);
    present = true;
  }

  if (inputs.congestion) {
    // team.congestion_index is LOWER_IS_STRONGER: orient to 100 − x before scoring
    // (the same orientation team_readiness applies), then clamp to [0,100].
    const oriented = clamp(subtract(ONE_HUNDRED, inputs.congestion.value), ZERO, ONE_HUNDRED);
    available = add(available, CONGESTION_WEIGHT);
    points = add(points, scaledPoints(oriented, CONGESTION_WEIGHT));
    cite(inputs.congestion);
    present = true;
  }

  if (inputs.venue) {
    // 0–100 win rate, higher is stronger.
    const oriented = clamp(inputs.venue.value, ZERO, ONE_HUNDRED);
    available = add(available, VENUE_WEIGHT);
    points = add(points, scaledPoints(oriented, VENUE_WEIGHT));
    cite(inputs.venue);
    present = true;
  }

  if (inputs.squad) {
    // Stored as a 0–1 ratio (higher is stronger): points = value × 5, no /100.
    const ratio = clamp(inputs.squad.value, ZERO, ONE_RATIO);
    available = add(available, SQUAD_WEIGHT);
    points = add(points, multiply(ratio, SQUAD_WEIGHT));
    cite(inputs.squad);
    present = true;
  }

  const availablePoints = toNumericString(available);
  const declaredPoints = toNumericString(DECLARED_POINTS);
  // ratio in [0,1]; available ≤ 60, so divide never exceeds 1. 0/60 = 0.
  const coverageRatio = toNumericString(
    roundHalfUp(divide(available, DECLARED_POINTS), PREPAREDNESS_OUTPUT_SCALE)
  );
  const preparednessPoints = present
    ? toNumericString(roundHalfUp(points, PREPAREDNESS_OUTPUT_SCALE))
    : null; // no component present → NULL, never a fabricated zero.

  return {
    side: inputs.side,
    teamId: inputs.teamId,
    preparednessPoints,
    availablePoints,
    declaredPoints,
    coverageRatio,
    citedValues,
  };
}

/**
 * The two per-side results, deterministically ordered by `side` ascending
 * (AWAY, HOME) so the checksum fold is order-stable. Pure: same inputs → same
 * results, byte for byte.
 */
export function computeTeamPreparedness(
  home: PreparednessSideInputs,
  away: PreparednessSideInputs
): readonly PreparednessSideResult[] {
  const results = [computeSide(home), computeSide(away)];
  return results.sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : 0));
}
