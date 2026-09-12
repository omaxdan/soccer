// ─────────────────────────────────────────────────────────────────────────────
// S-9B OUTCOME ACCRUAL — eligibility selection (read-only, schema-qualified)
//
// Selects the (KICKOFF snapshot, prevailing result) units to which an authoritative
// MATCH_RESULT outcome may be attached, honoring the ratified S-9A contract:
//   • snapshot_point_code = 'KICKOFF' (D3) — the governed corpus point
//   • fixture lifecycle = 'COMPLETED' (A3) — no other state produces an outcome
//   • the fixture's edition is in the governed TRACKED universe (D2/D6) — a TRACKED
//     competition with an ACTIVE tracked_edition — so synthetic/test fixtures
//     (which are never tracked) are structurally excluded (I1)
//   • a prevailing football.result exists (D9) — regulation goals are read from it
//
// It also reads, per unit, the current highest-ordinal MATCH_RESULT link (if any)
// so the writer can be idempotent and revision-aware without mutating history.
//
// Reads only. Computes no outcome, no calibration, no hit-rate. The derivation and
// the attachment decision live in `outcome/deriveMatchResult.ts` / `outcome/attach.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { MATCH_RESULT_DIMENSION } from '../outcome/deriveMatchResult';

/** One qualifying unit: a KICKOFF snapshot of a completed, tracked fixture + its prevailing result. */
export interface EligibleOutcomeUnit {
  readonly matchSnapshotId: string;
  readonly fixturePartitionOn: string; // YYYY-MM-DD
  readonly snapshotAsOf: Date;
  readonly fixtureId: string;
  readonly resultId: string;
  readonly homeGoals: number;
  readonly awayGoals: number;
  /** The current prevailing MATCH_RESULT link for this snapshot, or null if none yet. */
  readonly existingOrdinal: number | null;
  readonly existingOutcomeValue: string | null;
  readonly existingResultId: string | null;
}

interface Row {
  match_snapshot_id: string; fixture_partition_on: string; snapshot_as_of: Date;
  fixture_id: string; result_id: string; home_goals: number; away_goals: number;
  existing_ordinal: number | null; existing_outcome_value: string | null; existing_result_id: string | null;
}

export const ELIGIBLE_SQL = `
  SELECT ms.id::text                       AS match_snapshot_id,
         ms.fixture_partition_on::text     AS fixture_partition_on,
         ms.snapshot_as_of                 AS snapshot_as_of,
         f.id::text                        AS fixture_id,
         r.id::text                        AS result_id,
         r.home_goals                      AS home_goals,
         r.away_goals                      AS away_goals,
         el.revision_ordinal               AS existing_ordinal,
         el.outcome_value                  AS existing_outcome_value,
         el.result_id::text                AS existing_result_id
    FROM snapshot.match_snapshot ms
    JOIN football.fixture f
      ON f.id = ms.fixture_id AND f.fixture_partition_on = ms.fixture_partition_on
    JOIN football.result r
      ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
    -- Governed TRACKED universe (real, not synthetic): the fixture's edition is an
    -- ACTIVE tracked_edition of a TRACKED competition. Test fixtures are never tracked.
    JOIN governance.tracked_edition te
      ON te.competition_edition_id = f.competition_edition_id
     AND te.edition_status_code = 'ACTIVE'
    JOIN governance.tracked_competition tc
      ON tc.id = te.tracked_competition_id
     AND tc.tracking_status_code = 'TRACKED'
    LEFT JOIN LATERAL (
      SELECT l.revision_ordinal, l.outcome_value, l.result_id
        FROM snapshot.snapshot_outcome_link l
       WHERE l.match_snapshot_id = ms.id
         AND l.fixture_partition_on = ms.fixture_partition_on
         AND l.outcome_dimension_code = $1
       ORDER BY l.revision_ordinal DESC
       LIMIT 1
    ) el ON true
   WHERE ms.snapshot_point_code = 'KICKOFF'
     AND f.lifecycle_state_code = 'COMPLETED'
     AND ($2::bigint IS NULL OR f.id = $2::bigint)
     -- GOVERNED INVALIDATION (035): a quarantined snapshot must not accrue a
     -- calibration outcome — an outcome link on it would let a corrupt/test
     -- snapshot enter reliability measurement. Excluded by anti-join here; the
     -- attach path (outcome/attach.ts) re-asserts it as defense in depth. Empty
     -- quarantine table ⇒ NOT EXISTS is always true ⇒ no-op.
     AND NOT EXISTS (
       SELECT 1 FROM snapshot.match_snapshot_quarantine q
        WHERE q.match_snapshot_id = ms.id
          AND q.fixture_partition_on = ms.fixture_partition_on
     )
   ORDER BY ms.fixture_partition_on, ms.id
`;

/**
 * Eligible outcome units. `fixtureId` narrows to one fixture (targeted runs/tests);
 * omit for the full sweep. Reads under the calibration role's SELECT grants.
 */
export async function readEligibleOutcomeUnits(
  tx: PoolClient,
  params: { readonly fixtureId?: string } = {}
): Promise<EligibleOutcomeUnit[]> {
  const { rows } = await tx.query<Row>(ELIGIBLE_SQL, [MATCH_RESULT_DIMENSION, params.fixtureId ?? null]);
  return rows.map((r) => ({
    matchSnapshotId: r.match_snapshot_id,
    fixturePartitionOn: r.fixture_partition_on,
    snapshotAsOf: r.snapshot_as_of,
    fixtureId: r.fixture_id,
    resultId: r.result_id,
    homeGoals: Number(r.home_goals),
    awayGoals: Number(r.away_goals),
    existingOrdinal: r.existing_ordinal === null ? null : Number(r.existing_ordinal),
    existingOutcomeValue: r.existing_outcome_value,
    existingResultId: r.existing_result_id,
  }));
}

/**
 * The MATCH_RESULT derivation version in force at `at` (A5: resolved at link
 * creation and pinned). Null when none is in force (no version registered yet).
 */
export async function resolveMatchResultDerivationVersion(tx: PoolClient, at: Date): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id::text FROM calibration.outcome_derivation_version
      WHERE outcome_dimension_code = $1 AND effective_period @> $2::timestamptz
      ORDER BY id DESC LIMIT 1`,
    [MATCH_RESULT_DIMENSION, at]
  );
  return rows.length === 0 ? null : rows[0].id;
}
