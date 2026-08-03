// ─────────────────────────────────────────────────────────────────────────────
// THE DRIVER — which (subject, instant) pairs to calculate
//
// D-1: `as_of` is PER SNAPSHOT POINT. For a fixture with kickoff K, the instants
// are K − offset for each point in `football.snapshot_point`.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE OFFSETS ARE READ, NEVER WRITTEN INTO SOURCE
//
// The point set is an open decision (Phase 4 D8) carrying a TODO in migration
// 002. Four offsets hard-coded here would silently diverge the moment the
// vocabulary changed — and EVERY `as_of` in the system derives from them, so the
// divergence would be total rather than partial.
//
// ─────────────────────────────────────────────────────────────────────────────
// A VALUE MUST NOT BE CALCULATED BEFORE ITS OWN `as_of`
//
// A pair is eligible only when `K − offset <= now()`. Calculating earlier would
// read less reality than existed at `as_of` while labelling the result "as of
// that instant" — a claim the value cannot support, and one that append-only
// makes permanent under its version.
//
// This is the single place S-5 reads the wall clock for selection. Calculators
// never do (R-2 obligation 6), and the clock is captured ONCE per run and passed
// down, so two pairs in one run cannot be judged against two different "now"s.
//
// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT IS THE TEAM, NOT THE FIXTURE
//
// Each fixture yields both participants. Two teams × four points × six features
// is 48 values per fixture.
//
// A team playing twice in a week can reach the SAME `as_of` from two fixtures
// (K₁ − 1d = K₂ − 7d). The business identity does not include the fixture, so
// the second is a duplicate: it conflicts, is skipped, and the count is
// reported. That is the identity working, not a case to route around — which is
// why pairs are de-duplicated into (as_of, team) batches here rather than left
// to collide in the database.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { Registry } from '../registry/load';
import { readFixturesForEligibility } from '../read/fixtures';

/** One instant, with every team needing it. */
export interface SubjectBatch {
  readonly asOf: Date;
  /** Ascending, de-duplicated — the order the pipeline hands to calculators. */
  readonly teamIds: readonly string[];
  /** The snapshot points that produced this instant. Diagnostic only. */
  readonly snapshotPointCodes: readonly string[];
}

export interface EligibilityOptions {
  /**
   * Fixtures kicking off before `now` are still considered for this many days,
   * so a run that missed a window can catch up. Re-running is idempotent, so a
   * modest overlap costs skipped rows rather than wrong ones.
   */
  readonly lookbackDays?: number;
  /** Replay only: the inclusive kickoff range. */
  readonly replayFrom?: Date;
  readonly replayTo?: Date;
}

const DEFAULT_LOOKBACK_DAYS = 2;

/** Whole seconds. See `deriveAsOf`. */
function truncateToSecond(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

/**
 * The instant for one fixture and one snapshot point.
 *
 * TRUNCATED TO WHOLE SECONDS, deliberately. `as_of` is a `timestamptz` that
 * participates in the primary key, in `uq_feature_value__id_as_of`, in both
 * endpoints of `feature_lineage` and in the partition key. PostgreSQL stores
 * microseconds and a JS `Date` carries milliseconds, so ER-01's round-trip
 * hazard is real here in a way it was not for S-4's `date` partition column.
 *
 * Truncating to seconds makes the value round-trip-safe BY CONSTRUCTION rather
 * than by luck: whatever precision the stored kickoff had, the derived instant
 * has none below a second, so no conversion anywhere can lose a digit.
 */
export function deriveAsOf(kickoffAt: Date, offsetSeconds: number): Date {
  return truncateToSecond(new Date(kickoffAt.getTime() - offsetSeconds * 1000));
}

/**
 * Selects the batches to calculate.
 *
 * `now` is passed in rather than read here, so one instant governs the whole run
 * and the selection is testable without a clock.
 *
 * Forward mode covers fixtures from `now − lookback` to `now + maxOffset`: any
 * later fixture has no eligible point yet, and any earlier one has been covered
 * by a previous run (and would be skipped anyway).
 *
 * Replay mode covers an explicit kickoff range. **It is the same code path** —
 * only the range differs — so a replay cannot drift from forward operation.
 * Eligibility still applies: a replay of a future fixture calculates only the
 * points that have actually arrived.
 */
export async function selectBatches(
  tx: PoolClient,
  registry: Registry,
  now: Date,
  options: EligibilityOptions = {}
): Promise<SubjectBatch[]> {
  if (registry.snapshotPoints.length === 0) {
    throw new Error(
      'no snapshot points are in force. `as_of` is derived from football.snapshot_point, ' +
        'and S-5 cannot select any subject without it.'
    );
  }

  const maxOffsetSeconds = Math.max(...registry.snapshotPoints.map((point) => point.offsetSeconds));
  const lookbackMs = (options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 86_400_000;

  const from = options.replayFrom ?? new Date(now.getTime() - lookbackMs);
  const to = options.replayTo ?? new Date(now.getTime() + maxOffsetSeconds * 1000);
  if (to.getTime() < from.getTime()) {
    throw new Error('the eligibility range ends before it begins');
  }

  const fixtures = await readFixturesForEligibility(tx, from, to);

  // Keyed by the instant, so two fixtures reaching the same moment for the same
  // team collapse to one subject rather than two identical writes.
  const byInstant = new Map<string, { asOf: Date; teamIds: Set<string>; points: Set<string> }>();

  for (const fixture of fixtures) {
    for (const point of registry.snapshotPoints) {
      const asOf = deriveAsOf(fixture.kickoffAt, point.offsetSeconds);
      if (asOf.getTime() > now.getTime()) continue;

      const key = asOf.toISOString();
      let batch = byInstant.get(key);
      if (!batch) {
        batch = { asOf, teamIds: new Set(), points: new Set() };
        byInstant.set(key, batch);
      }
      batch.teamIds.add(fixture.homeTeamId);
      batch.teamIds.add(fixture.awayTeamId);
      batch.points.add(point.code);
    }
  }

  // Ascending by instant, and teams ascending within a batch. Deterministic
  // ordering here is what makes "identical execution order" checkable on replay.
  return [...byInstant.values()]
    .sort((a, b) => a.asOf.getTime() - b.asOf.getTime())
    .map((batch) => ({
      asOf: batch.asOf,
      teamIds: [...batch.teamIds].sort(compareNumericId),
      snapshotPointCodes: [...batch.points].sort(),
    }));
}

/**
 * Ascending by numeric value, not lexicographic.
 *
 * Ids arrive as strings because a `bigint` does not fit a JS number. Sorting
 * them as text would put '10' before '9', which is a stable order but not the
 * one anybody reading the log expects — and the ordering appears in replay
 * comparisons, so it needs to be the obvious one.
 */
function compareNumericId(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
