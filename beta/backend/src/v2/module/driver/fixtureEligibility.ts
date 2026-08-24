// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE MODULE DRIVER — which (fixture, instant) pairs a FIXTURE module evaluates
//
// The FIXTURE-subject sibling of the feature/module TEAM driver. For a fixture
// with kickoff K, the instants are K − offset for each snapshot point (D-1),
// exactly as the TEAM path derives them — REUSING `deriveAsOf`, never a parallel
// as-of mechanism. A pair is eligible only when K − offset ≤ now (a value/reading
// is never produced before its own as_of).
//
// The unit is the FIXTURE (not a deduplicated team-set): a comparison reading is
// one row per (fixture, as_of), carrying both participants and the partition the
// composite fixture reference needs. Ordering is deterministic (as_of, then
// numeric fixture id) so replay is checkable.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { SnapshotPoint } from '../../feature/registry/load';
import { deriveAsOf, type EligibilityOptions } from '../../feature/driver/eligibility';

/** One fixture at one instant — the FIXTURE module's batch. */
export interface FixtureBatch {
  readonly asOf: Date;
  readonly fixtureId: string;
  readonly fixturePartitionOn: string; // YYYY-MM-DD
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly competitionEditionId: string;
  /** The snapshot points that produced this instant. Diagnostic only. */
  readonly snapshotPointCodes: readonly string[];
}

const DEFAULT_LOOKBACK_DAYS = 2;

interface FixtureRow {
  fixture_id: string;
  fixture_partition_on: string;
  scheduled_kickoff_at: Date;
  home_team_id: string;
  away_team_id: string;
  competition_edition_id: string;
}

/**
 * Selects the (fixture, instant) batches a FIXTURE module evaluates. Identical
 * eligibility windowing to the TEAM `selectBatches` — same lookback/replay range,
 * same strict `as_of ≤ now`, same snapshot-point offsets — but keyed by the
 * fixture, and carrying `fixture_partition_on` for the composite subject reference.
 */
export async function selectFixtureBatches(
  tx: PoolClient,
  snapshotPoints: readonly SnapshotPoint[],
  now: Date,
  options: EligibilityOptions = {}
): Promise<FixtureBatch[]> {
  if (snapshotPoints.length === 0) {
    throw new Error(
      'no snapshot points are in force; a FIXTURE module derives as_of from football.snapshot_point'
    );
  }

  const maxOffsetSeconds = Math.max(...snapshotPoints.map((p) => p.offsetSeconds));
  const lookbackMs = (options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 86_400_000;
  const from = options.replayFrom ?? new Date(now.getTime() - lookbackMs);
  const to = options.replayTo ?? new Date(now.getTime() + maxOffsetSeconds * 1000);
  if (to.getTime() < from.getTime()) throw new Error('the eligibility range ends before it begins');

  const { rows } = await tx.query<FixtureRow>(
    `SELECT id::text AS fixture_id,
            fixture_partition_on::text AS fixture_partition_on,
            scheduled_kickoff_at,
            home_team_id::text AS home_team_id,
            away_team_id::text AS away_team_id,
            competition_edition_id::text AS competition_edition_id
       FROM football.fixture
      WHERE lifecycle_state_code IN ('SCHEDULED','IN_PROGRESS','COMPLETED')
        AND scheduled_kickoff_at >= $1 AND scheduled_kickoff_at <= $2
      ORDER BY scheduled_kickoff_at, id`,
    [from, to]
  );

  // One batch per (fixture, instant); two points reaching the same instant for one
  // fixture collapse (only possible if offsets coincide, which the vocabulary avoids).
  const byKey = new Map<string, FixtureBatch & { pts: Set<string> }>();
  for (const f of rows) {
    for (const point of snapshotPoints) {
      const asOf = deriveAsOf(f.scheduled_kickoff_at, point.offsetSeconds);
      if (asOf.getTime() > now.getTime()) continue;
      const key = `${f.fixture_id}|${asOf.toISOString()}`;
      let batch = byKey.get(key);
      if (!batch) {
        batch = {
          asOf,
          fixtureId: f.fixture_id,
          fixturePartitionOn: f.fixture_partition_on,
          homeTeamId: f.home_team_id,
          awayTeamId: f.away_team_id,
          competitionEditionId: f.competition_edition_id,
          snapshotPointCodes: [],
          pts: new Set<string>(),
        };
        byKey.set(key, batch);
      }
      batch.pts.add(point.code);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => {
      const t = a.asOf.getTime() - b.asOf.getTime();
      if (t !== 0) return t;
      return BigInt(a.fixtureId) < BigInt(b.fixtureId) ? -1 : BigInt(a.fixtureId) > BigInt(b.fixtureId) ? 1 : 0;
    })
    .map((b) => ({
      asOf: b.asOf,
      fixtureId: b.fixtureId,
      fixturePartitionOn: b.fixturePartitionOn,
      homeTeamId: b.homeTeamId,
      awayTeamId: b.awayTeamId,
      competitionEditionId: b.competitionEditionId,
      snapshotPointCodes: [...b.pts].sort(),
    }));
}
