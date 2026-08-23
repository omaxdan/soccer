// ─────────────────────────────────────────────────────────────────────────────
// EDITION INGESTION COVERAGE — the runtime write path for the append-only ledger
// operations.edition_ingestion_coverage (migration 026, Gate 6A / design Gate 6).
//
// A coverage row ATTESTS that a date window was successfully committed for one
// competition edition. It is written on the SUPPLIED transaction connection and
// issues no BEGIN/COMMIT of its own, so it commits — or rolls back — together with
// the football writes of that transaction. Called as the final step of the season
// write transaction, AFTER the Gate 4 at-commit guard, this makes
//     authorization-holds ∧ football-writes-commit ∧ coverage-attestation-commits
// one atomic outcome.
//
// Coverage is EVIDENCE, never authorization: nothing here consults or grants
// permission. It never runs before, after, or outside the season transaction.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

export interface EditionCoverageAttestation {
  /** Internal anchor — football.competition_edition.id (resolved inside the tx). */
  readonly competitionEditionId: string;
  readonly providerCode: string;
  /** tournament.uniqueTournament.id — audit identity. */
  readonly competitionProviderId: string;
  /** season.id — audit identity. */
  readonly seasonProviderId: string;
  /** Operator window start, inclusive, as YYYY-MM-DD. */
  readonly fromDate: string;
  /** Operator window end, inclusive day, as YYYY-MM-DD. */
  readonly toDate: string;
  /** true iff the provider walk definitively exhausted the window (not budget-truncated). */
  readonly complete: boolean;
  /** Committed event fact from the season run (events selected into the committed writes). */
  readonly eventsCommitted: number;
  /** The ambient pipeline run — the FK evidence link. */
  readonly pipelineRunId: string;
  readonly runOccurredAt: Date;
}

/**
 * Appends ONE coverage attestation on the given transaction.
 *
 * `covered_period` follows the approved Gate 6 convention: an inclusive operator
 * window [from .. to] becomes the half-open daterange [from, to+1) — e.g.
 * `--from 2026-08-01 --to 2026-08-10` → `[2026-08-01, 2026-08-11)` — matching the
 * `season_period` daterange convention. The relation is append-only; re-covering a
 * window legitimately appends another attestation (no uniqueness).
 */
export async function recordEditionCoverage(
  tx: PoolClient,
  a: EditionCoverageAttestation
): Promise<void> {
  await tx.query(
    `INSERT INTO operations.edition_ingestion_coverage
       (competition_edition_id, provider_code, provider_external_id,
        provider_season_external_id, covered_period, complete, events_committed,
        pipeline_run_id, run_occurred_at)
     VALUES ($1, $2, $3, $4, daterange($5::date, ($6::date + 1), '[)'), $7, $8, $9, $10)`,
    [
      a.competitionEditionId,
      a.providerCode,
      a.competitionProviderId,
      a.seasonProviderId,
      a.fromDate,
      a.toDate,
      a.complete,
      a.eventsCommitted,
      a.pipelineRunId,
      a.runOccurredAt,
    ]
  );
}
