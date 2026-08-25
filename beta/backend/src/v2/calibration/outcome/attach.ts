// ─────────────────────────────────────────────────────────────────────────────
// S-9B OUTCOME ACCRUAL — the immutable, additive, revision-aware attachment
//
// Attaches the authoritative MATCH_RESULT outcome to a qualifying KICKOFF snapshot
// as a snapshot_outcome_link. The link is a FACT ABOUT THE WORLD (the result),
// module-independent — it encodes no module prediction.
//
// GOVERNED (S-9A), enforced here:
//   • A4/R-23: links are ADDITIVE and IMMUTABLE. A revised result never mutates an
//     existing link; it appends a higher ordinal and records supersession in
//     snapshot_outcome_link_currency (with a reason). The original is retained.
//   • A5: the derivation version is resolved by the caller at link-creation time and
//     pinned on the link; a later version never re-scores an existing link.
//   • Idempotent: re-running with the same prevailing result and same derived
//     outcome creates nothing new.
//
// NO calibration, NO hit-rate, NO confidence, NO reliability is computed here.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { deriveMatchResult, MATCH_RESULT_DIMENSION, type MatchResultOutcome } from './deriveMatchResult';
import type { EligibleOutcomeUnit } from '../read/eligibleOutcomes';

export type AttachAction =
  | { readonly kind: 'INSERT_FIRST'; readonly ordinal: 0; readonly outcome: MatchResultOutcome }
  | { readonly kind: 'SUPERSEDE'; readonly ordinal: number; readonly supersededOrdinal: number; readonly outcome: MatchResultOutcome }
  | { readonly kind: 'SKIP' };

/**
 * Pure decision: given a unit (with its prevailing result and current highest-ordinal
 * link), decide whether to insert the first link, append a superseding revision, or
 * skip. Skips when the prevailing result already produced the current link with the
 * same derived outcome (idempotent). Appends a new ordinal only when the derived
 * outcome or the cited result changed (a result revision that moves the outcome).
 */
export function decideOutcomeLink(unit: EligibleOutcomeUnit): AttachAction {
  const outcome = deriveMatchResult(unit.homeGoals, unit.awayGoals);
  if (unit.existingOrdinal === null) {
    return { kind: 'INSERT_FIRST', ordinal: 0, outcome };
  }
  const unchanged = unit.existingOutcomeValue === outcome && unit.existingResultId === unit.resultId;
  if (unchanged) return { kind: 'SKIP' };
  return { kind: 'SUPERSEDE', ordinal: unit.existingOrdinal + 1, supersededOrdinal: unit.existingOrdinal, outcome };
}

export interface AttachResult {
  readonly linked: number;      // new links inserted (first or superseding)
  readonly superseded: number;  // currency rows written
  readonly skipped: number;     // idempotent no-ops
}

/**
 * Applies the decision for one unit, writing the immutable link (and, on
 * supersession, the currency row) in the caller's transaction. `derivationVersionId`
 * must be resolved by the caller at link-creation time (A5) and is pinned here.
 * The unique constraint on (fixture_partition_on, match_snapshot_id, dimension,
 * revision_ordinal) makes a concurrent duplicate a no-op via ON CONFLICT DO NOTHING.
 */
export async function attachOutcomeLink(
  tx: PoolClient,
  unit: EligibleOutcomeUnit,
  derivationVersionId: string
): Promise<AttachResult> {
  const action = decideOutcomeLink(unit);
  if (action.kind === 'SKIP') return { linked: 0, superseded: 0, skipped: 1 };

  const inserted = await tx.query(
    `INSERT INTO snapshot.snapshot_outcome_link
       (fixture_partition_on, match_snapshot_id, outcome_dimension_code, revision_ordinal,
        outcome_derivation_version_id, result_id, outcome_value)
     VALUES ($1::date, $2::bigint, $3::text, $4::integer, $5::bigint, $6::bigint, $7::text)
     ON CONFLICT ON CONSTRAINT uq_snapshot_outcome_link__snapshot_dimension_revision DO NOTHING`,
    [
      unit.fixturePartitionOn, unit.matchSnapshotId, MATCH_RESULT_DIMENSION, action.ordinal,
      derivationVersionId, unit.resultId, action.outcome,
    ]
  );
  if (inserted.rowCount === 0) return { linked: 0, superseded: 0, skipped: 1 }; // another run won the race

  if (action.kind === 'SUPERSEDE') {
    await tx.query(
      `INSERT INTO snapshot.snapshot_outcome_link_currency
         (fixture_partition_on, match_snapshot_id, outcome_dimension_code,
          superseded_ordinal, superseding_ordinal, supersession_reason)
       VALUES ($1::date, $2::bigint, $3::text, $4::integer, $5::integer, $6::text)`,
      [
        unit.fixturePartitionOn, unit.matchSnapshotId, MATCH_RESULT_DIMENSION,
        action.supersededOrdinal, action.ordinal, 'RESULT_REVISION',
      ]
    );
    return { linked: 1, superseded: 1, skipped: 0 };
  }
  return { linked: 1, superseded: 0, skipped: 0 };
}
