// ─────────────────────────────────────────────────────────────────────────────
// THE CALCULATOR CONTRACT
//
// ─────────────────────────────────────────────────────────────────────────────
// CALCULATORS ARE PURE, AND THE TYPE SYSTEM IS MOST OF WHY
//
// A calculator receives already-read inputs and returns candidate values. It is
// handed no `PoolClient`, so it cannot open a connection or issue a write; it is
// handed no clock, so it cannot read one. R-2 obligation 6 forbids `now()`,
// `Date.now()` and `new Date()` anywhere in a calculation path — a calculator
// that measured "days since" against the wall clock instead of against `as_of`
// would be non-deterministic AND temporally incorrect, and both failures look
// like small numeric drift.
//
// The only current timestamp in S-5 is `calculated_at`, supplied by the write
// layer, plus eligibility selection in the driver. Neither is inside a calculator.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT A CALCULATOR RETURNS, AND WHAT IT DOES NOT DECIDE
//
// It returns an UNROUNDED exact value, an observation count, and the values it
// consumed. It does NOT decide:
//
//   the rounded value      — write/scale.ts rounds once, at the write boundary
//   the provenance class   — write/provenance.ts applies min(ceiling, weakest)
//   sample_meets_threshold — write/values.ts compares against the registry
//   the version            — the registry supplies it
//
// Centralising those four is what keeps them consistent across four calculators
// rather than four times reimplemented.
// ─────────────────────────────────────────────────────────────────────────────

import type { Exact } from '../write/scale';
import type { FeatureDefinition } from '../registry/load';

/**
 * The only context S-5 calculates at.
 *
 * D-3: `ALL_COMPETITIONS` only. The `COMPETITION_SCOPED` bindings on
 * `team.home_form`, `team.away_form` and `team.congestion_index` remain
 * registered and valid — nothing is retracted — and adding those values later is
 * additive. `ck_feature_value__context_edition_conditional` independently
 * requires `context_competition_edition_id` to be NULL for any kind other than
 * `COMPETITION_SCOPED`, so the write layer supplies NULL.
 */
export const CALCULATION_CONTEXT_KIND = 'ALL_COMPETITIONS';

/**
 * One (team, instant) pair to calculate for.
 *
 * `asOf` is APPLICATION-OWNED. It is derived by the driver from
 * `fixture.scheduled_kickoff_at` and a snapshot offset, truncated to whole
 * seconds, and the same object travels all the way into the lineage write.
 * ER-01: it is never read back from PostgreSQL and reconverted, because a
 * `timestamptz` round-tripped through a JS `Date` truncates microseconds and
 * would silently break every composite key it participates in.
 */
export interface SubjectMoment {
  readonly teamId: string;
  readonly asOf: Date;
}

/** A value consumed by a composite, recorded as lineage and bounding provenance. */
export interface ConsumedValueRef {
  readonly featureKey: string;
  /** `feature_value.id`, for the composite lineage reference. */
  readonly valueId: string;
  /** The consumed value's own `as_of`, the other half of that reference. */
  readonly asOf: Date;
  /**
   * The stored value, read as an exact decimal.
   *
   * `pg` returns `numeric` as a string precisely because it does not fit a
   * double, and it is parsed straight into an `Exact` — so a consumed value
   * reaches a composite with every digit PostgreSQL stored and none added.
   */
  readonly value: Exact;
  readonly provenanceClassCode: string;
  readonly sampleObservationCount: number;
}

/**
 * A candidate value, before rounding, provenance resolution and threshold
 * evaluation.
 *
 * `value` is carried at working precision. Rounding it here and again at the
 * write boundary would be double rounding, which can move a result by a full
 * unit of the last place.
 */
export interface CandidateValue {
  readonly featureKey: string;
  readonly teamId: string;
  readonly asOf: Date;
  readonly value: Exact;
  /**
   * Observations this value rests on.
   *
   * For a composite this is NOT set by the calculator — write/provenance.ts
   * derives it as `MIN(consumed.sample_observation_count)` per DEC-5, the same
   * weakest-input shape LC-37 uses for provenance. A calculator that set it
   * directly could contradict its own lineage.
   */
  readonly sampleObservationCount: number | null;
  /** Empty for every Layer 1 feature. Only `team.readiness_score` is non-empty. */
  readonly consumed: readonly ConsumedValueRef[];
}

/** Completed fixtures for one team, most recent first. */
export interface TeamFixtureHistory {
  readonly teamId: string;
  readonly fixtures: readonly CompletedFixture[];
}

export interface CompletedFixture {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly kickoffAt: Date;
  readonly isHome: boolean;
  /** Goals scored by the subject team. */
  readonly goalsFor: number | null;
  /** Goals conceded by the subject team. */
  readonly goalsAgainst: number | null;
  /** The venue the fixture was played at, when recorded. */
  readonly venueId: string | null;
}

/** Coordinates for distance, or null where the provider gave none. */
export interface VenueLocation {
  readonly venueId: string;
  /** Decimal degrees, as strings from `numeric` — parsed only for trigonometry. */
  readonly latitude: string;
  readonly longitude: string;
}

/**
 * Everything a calculator may read.
 *
 * Assembled by the pipeline from the `read/` layer before any calculator runs.
 * A calculator that needs something absent from here needs a declared source,
 * which is a registry change and not an S-5 decision.
 */
export interface CalculationContext {
  readonly definitions: ReadonlyMap<string, FeatureDefinition>;
  /** Subjects in a stable order — the pipeline sorts before handing them over. */
  readonly subjects: readonly SubjectMoment[];
  /** Completed fixtures strictly before each subject's `as_of`, by team id. */
  readonly fixturesByTeam: ReadonlyMap<string, TeamFixtureHistory>;
  /** Home venue per team, for travel origin. */
  readonly homeVenueByTeam: ReadonlyMap<string, string | null>;
  readonly venuesById: ReadonlyMap<string, VenueLocation>;
  /**
   * Values written by earlier stages, keyed `<featureKey>|<teamId>|<asOf ISO>`.
   *
   * Empty during Stage 1. Populated for Stage 2 from committed rows, which is
   * why Stage 2 cannot begin until Stage 1 has committed.
   */
  readonly priorValues: ReadonlyMap<string, ConsumedValueRef>;
}

/**
 * A pure calculation.
 *
 * `calculate` MUST be deterministic: the same context MUST produce the same
 * candidates in the same order, on any run and any machine.
 */
export interface Calculator {
  readonly calculatorKey: string;
  /** The feature keys this calculator owns. Reconciled against the registry. */
  readonly featureKeys: readonly string[];
  calculate(context: CalculationContext): readonly CandidateValue[];
}

/** The key under which a prior value is indexed for Stage 2 lookup. */
export function priorValueKey(featureKey: string, teamId: string, asOf: Date): string {
  return `${featureKey}|${teamId}|${asOf.toISOString()}`;
}

/**
 * Fixtures strictly before an instant, most recent first.
 *
 * THE BOUND IS STRICT, and that is load-bearing rather than fussy. At the
 * `KICKOFF` snapshot point `as_of` equals the generating fixture's kickoff, so
 * `<=` would let a value see the very fixture it is being calculated for — and
 * at `COMPLETED` it would see the result. "A feature that saw a fixture's result
 * before the fixture was played measures nothing."
 */
export function before(fixtures: readonly CompletedFixture[], asOf: Date): CompletedFixture[] {
  return fixtures.filter((fixture) => fixture.kickoffAt.getTime() < asOf.getTime());
}
