// ─────────────────────────────────────────────────────────────────────────────
// TEAM PREPAREDNESS — sealed read surface (S-7 B3, read-only)
//
// The smallest additive read over the sealed record: the two per-side preparedness
// rows for one match snapshot. It selects existing sealed rows and computes
// nothing. This is a library read surface; the HTTP API does not currently serve
// the sealed snapshot family at all (it serves live readings/features), so this
// exposes preparedness without redesigning the intelligence API.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { Side } from '../preparedness';

/** One sealed side's preparedness, projected for a read consumer. */
export interface SnapshotPreparednessSide {
  readonly side: Side;
  /** Achieved score in [0, availablePoints]; null when no component was present. */
  readonly preparednessPoints: string | null;
  readonly availablePoints: string;
  readonly declaredPoints: string;
  readonly coverageRatio: string;
}

interface Row {
  side: Side;
  preparedness_points: string | null;
  available_points: string;
  declared_points: string;
  coverage_ratio: string;
}

/**
 * The HOME and AWAY preparedness rows for one sealed snapshot, ordered by side.
 * Empty when the snapshot was sealed under a composition version that does not
 * govern preparedness (< 1.3.0) — the relation simply has no rows for it.
 */
export async function readSnapshotPreparedness(
  tx: PoolClient,
  params: { readonly matchSnapshotId: string; readonly fixturePartitionOn: string }
): Promise<readonly SnapshotPreparednessSide[]> {
  const { rows } = await tx.query<Row>(
    `SELECT side,
            preparedness_points::text AS preparedness_points,
            available_points::text    AS available_points,
            declared_points::text     AS declared_points,
            coverage_ratio::text      AS coverage_ratio
       FROM snapshot.snapshot_team_preparedness
      WHERE match_snapshot_id = $1::bigint
        AND fixture_partition_on = $2::date
      ORDER BY side`,
    [params.matchSnapshotId, params.fixturePartitionOn]
  );
  return rows.map((r) => ({
    side: r.side,
    preparednessPoints: r.preparedness_points,
    availablePoints: r.available_points,
    declaredPoints: r.declared_points,
    coverageRatio: r.coverage_ratio,
  }));
}
