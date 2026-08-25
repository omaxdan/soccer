// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION CLI — `npm run calibration:v2`  (S-9B outcome/substrate accrual)
//
//   npm run calibration:v2 -- accrue                 attach outcomes to eligible snapshots
//   npm run calibration:v2 -- accrue --fixture 2557  exactly one fixture
//   npm run calibration:v2 -- accrue --dry-run       plan only, write nothing
//
// The smallest wrapper around runOutcomeAccrual(). It performs NO calibration, NO
// hit-rate, NO confidence, NO reliability, NO risk — it attaches the authoritative
// MATCH_RESULT outcome to eligible KICKOFF snapshots so the historical corpus
// accrues for later S-9C measurement.
// ─────────────────────────────────────────────────────────────────────────────

// FIRST IMPORT, DELIBERATELY — `.env` before any module that reads process.env at
// load time, matching the other V2 entry points.
import '../config/env';

import { runOutcomeAccrual, type OutcomeAccrualReport } from './driver';
import { closeAllPools } from '../db/pool';

interface Invocation {
  readonly dryRun: boolean;
  readonly fixtureId?: string;
}

export function parseArguments(argv: readonly string[]): Invocation {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const command = positional[0] ?? 'accrue';
  if (command !== 'accrue') throw new Error(`unknown command '${command}'. Expected accrue.`);

  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') { flags.set('--dry-run', 'true'); continue; }
    if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} expects a value`);
      flags.set(arg, next);
      i += 1;
    }
  }
  return { dryRun: flags.get('--dry-run') === 'true', fixtureId: flags.get('--fixture') };
}

function reportRun(report: OutcomeAccrualReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 outcome accrual complete: ${report.linked} linked, ${report.superseded} superseded (revised), ` +
      `${report.skipped} skipped (idempotent), ${report.skippedNoRule} skipped (no derivation version) ` +
      `of ${report.considered} eligible unit(s)${report.dryRun ? ' [dry-run]' : ''}\n`
  );
  /* eslint-enable no-console */
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const invocation = parseArguments(argv);
    const report = await runOutcomeAccrual({ dryRun: invocation.dryRun, fixtureId: invocation.fixtureId });
    reportRun(report);
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 calibration FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
