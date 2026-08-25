// ─────────────────────────────────────────────────────────────────────────────
// S-9B OUTCOME ACCRUAL DRIVER — attach MATCH_RESULT outcomes to eligible snapshots
//
// Orchestration for the ratified S-9A accrual substrate. For each eligible unit
// (a KICKOFF snapshot of a COMPLETED, TRACKED fixture with a prevailing result), it
// attaches the authoritative MATCH_RESULT outcome as an immutable, additive,
// revision-aware snapshot_outcome_link — under the writer role pt_pipeline_calibration.
//
// This is ACCRUAL, NOT CALIBRATION. It answers "what authoritative outcome occurred
// for this qualifying point-in-time observation?" and nothing more: no hit-rate, no
// confidence, no reliability, no risk, no sample-gate evaluation. Re-runs are
// idempotent. On a fresh system with no tracked fixtures yet (the prospective corpus
// begins 2026-08-26), it simply finds nothing to attach — the machinery is ready.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { withConnection, withRun } from '../db/tx';
import { withPipelineRun, operationalNow } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { recordWrite } from '../operations/writeRecord';
import { buildDiagnostic } from '../operations/failure';
import { assertDatabaseConfigured } from '../config/index';
import { logger } from '../../utils/logger';
import { readEligibleOutcomeUnits, resolveMatchResultDerivationVersion } from './read/eligibleOutcomes';
import { attachOutcomeLink } from './outcome/attach';

/** The only role S-9B authenticates as — the governed outcome-link writer. */
export const CALIBRATION_ROLE = 'pt_pipeline_calibration' as const;

export interface OutcomeAccrualOptions {
  readonly now?: Date;
  readonly dryRun?: boolean;
  /** Attach for exactly one fixture (targeted run/test). Omit for the full sweep. */
  readonly fixtureId?: string;
}

export interface OutcomeAccrualReport {
  readonly considered: number;   // eligible units examined
  readonly linked: number;       // new outcome links inserted (first or superseding)
  readonly superseded: number;   // currency rows written (revised results)
  readonly skipped: number;      // idempotent no-ops
  readonly skippedNoRule: number;// no MATCH_RESULT derivation version in force at `now`
  readonly dryRun: boolean;
}

/** Attaches MATCH_RESULT outcomes to every eligible KICKOFF snapshot. */
export async function runOutcomeAccrual(options: OutcomeAccrualOptions = {}): Promise<OutcomeAccrualReport> {
  assertDatabaseConfigured();
  installOperationalLayer();
  const now = options.now ?? operationalNow();

  const { units, derivationVersionId } = await withConnection(CALIBRATION_ROLE, async (tx) => {
    const units = await readEligibleOutcomeUnits(tx, { fixtureId: options.fixtureId });
    const derivationVersionId = await resolveMatchResultDerivationVersion(tx, now);
    return { units, derivationVersionId };
  });

  logger.info(
    { units: units.length, hasDerivationVersion: derivationVersionId !== null, dryRun: options.dryRun === true },
    'v2 calibration: outcome accrual plan loaded'
  );

  // No governed derivation version in force → attach nothing (never fabricate a rule).
  if (derivationVersionId === null) {
    return { considered: units.length, linked: 0, superseded: 0, skipped: 0, skippedNoRule: units.length, dryRun: options.dryRun === true };
  }

  let linked = 0, superseded = 0, skipped = 0, failures = 0;

  await withPipelineRun(CALIBRATION_ROLE, 'v2.calibration.outcome.accrue', async () => {
    for (const unit of units) {
      try {
        if (options.dryRun === true) { skipped += 1; continue; }
        await withRun(
          CALIBRATION_ROLE,
          'calibration.outcome_link',
          async (tx: PoolClient, job) => {
            const res = await attachOutcomeLink(tx, unit, derivationVersionId);
            linked += res.linked; superseded += res.superseded; skipped += res.skipped;
            if (res.linked > 0) {
              await withConnection(CALIBRATION_ROLE, async (control) => {
                await recordWrite(control, job, { schema: 'snapshot', relation: 'snapshot_outcome_link' }, {
                  rowsExamined: 1, rowsWritten: res.linked, rowsSkipped: res.skipped, rowsRejected: 0,
                });
                if (res.superseded > 0) {
                  await recordWrite(control, job, { schema: 'snapshot', relation: 'snapshot_outcome_link_currency' }, {
                    rowsExamined: res.superseded, rowsWritten: res.superseded, rowsSkipped: 0, rowsRejected: 0,
                  });
                }
              });
            }
          },
          { detail: { fixtureId: unit.fixtureId, matchSnapshotId: unit.matchSnapshotId, asOf: unit.snapshotAsOf.toISOString() } }
        );
      } catch (error) {
        failures += 1;
        logger.error(
          { fixtureId: unit.fixtureId, matchSnapshotId: unit.matchSnapshotId, error: buildDiagnostic(error) },
          'v2 calibration: outcome-link attach failed, continuing'
        );
      }
    }
  });

  if (failures > 0) logger.warn({ failures }, 'v2 calibration: some outcome-link attaches failed');
  return { considered: units.length, linked, superseded, skipped, skippedNoRule: 0, dryRun: options.dryRun === true };
}
