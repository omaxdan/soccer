// ─────────────────────────────────────────────────────────────────────────────
// S-7 DRIVER — seal the eligible (fixture × snapshot point) snapshots
//
// Historical-sealing orchestration. For each fixture in range and each snapshot
// point whose instant has ARRIVED (snapshot_as_of <= now), it seals one immutable
// snapshot in its own attributed transaction. Re-runs are idempotent (the seal
// skips an already-sealed identity), so a modest overlap costs skips, not errors.
//
// This is NOT a product/display path. It accumulates governed historical
// snapshots so the later `snapshot → outcome_link → calibration` chain can exist,
// and so pre-match evidence is pinned (RESTRICT) before retention can thin it.
// ─────────────────────────────────────────────────────────────────────────────

import { withConnection, withRun } from '../db/tx';
import { withPipelineRun, operationalNow } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { deriveAsOf } from '../feature/driver/eligibility';
import { readFixturesToSeal, readFixtureById, readSnapshotPoints, type FixtureToSeal, type SnapshotPoint } from './read/selection';
import { sealSnapshot } from './seal';

const MODULE_ROLE = 'pt_pipeline_module' as const;
const DEFAULT_LOOKBACK_DAYS = 7;

export interface SnapshotRunOptions {
  /** Overrides the run clock. Tests supply it; production does not. */
  readonly now?: Date;
  /** Consider fixtures kicking off within this many days before `now` (catch-up). */
  readonly lookbackDays?: number;
  /** Replay: seal an explicit kickoff range instead of the forward window. */
  readonly replayFrom?: Date;
  readonly replayTo?: Date;
  /** Seal exactly one fixture (all its arrived points). Overrides the range. */
  readonly fixtureId?: string;
}

export interface SnapshotRunReport {
  readonly fixturesConsidered: number;
  readonly pointsConsidered: number;
  readonly sealed: number;
  readonly skipped: number;         // already sealed (idempotent re-run)
  readonly skippedNoRule: number;   // as-of precedes the governing rules
  readonly notYetDue: number;       // snapshot instant has not arrived
}

/** Seals every eligible (fixture, snapshot point) pair. */
export async function runSnapshotSealing(options: SnapshotRunOptions = {}): Promise<SnapshotRunReport> {
  installOperationalLayer();
  const now = options.now ?? operationalNow();

  const { fixtures, points } = await withConnection(MODULE_ROLE, async (tx) => {
    const points = await readSnapshotPoints(tx);
    if (points.length === 0) {
      throw new Error('no snapshot points are in force; S-7 derives snapshot_as_of from football.snapshot_point');
    }
    let fixtures: FixtureToSeal[];
    if (options.fixtureId) {
      const one = await readFixtureById(tx, options.fixtureId);
      fixtures = one ? [one] : [];
    } else {
      const maxOffset = Math.max(...points.map((p) => p.offsetSeconds));
      const lookbackMs = (options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 86_400_000;
      const from = options.replayFrom ?? new Date(now.getTime() - lookbackMs);
      // A fixture is worth considering until its LAST point (kickoff) has arrived.
      const to = options.replayTo ?? new Date(now.getTime() + maxOffset * 1000);
      if (to.getTime() < from.getTime()) throw new Error('the sealing range ends before it begins');
      fixtures = await readFixturesToSeal(tx, from, to);
    }
    return { fixtures, points };
  });

  let sealed = 0;
  let skipped = 0;
  let skippedNoRule = 0;
  let notYetDue = 0;
  let pointsConsidered = 0;

  await withPipelineRun(MODULE_ROLE, 'v2.snapshot.seal', async () => {
    for (const fixture of fixtures) {
      for (const point of points) {
        const asOf = deriveAsOf(fixture.kickoffAt, point.offsetSeconds);
        // Never seal a snapshot whose instant has not arrived — that would claim
        // information "as of" a moment the run could not have seen.
        if (asOf.getTime() > now.getTime()) { notYetDue += 1; continue; }
        pointsConsidered += 1;
        const outcome = await withRun(MODULE_ROLE, 'v2.snapshot.seal.one', (tx, job) =>
          sealSnapshot(tx, job, { fixture, snapshotPoint: point })
        );
        if (outcome.status === 'SEALED') sealed += 1;
        else if (outcome.reason === 'NO_RULE_IN_FORCE') skippedNoRule += 1;
        else skipped += 1;
      }
    }
  });

  return {
    fixturesConsidered: fixtures.length,
    pointsConsidered,
    sealed,
    skipped,
    skippedNoRule,
    notYetDue,
  };
}

export type { FixtureToSeal, SnapshotPoint };
