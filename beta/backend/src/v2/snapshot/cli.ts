// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT CLI — `npm run snapshot:v2`  (S-7 historical sealing)
//
//   npm run snapshot:v2 -- seal                      forward, arrived points
//   npm run snapshot:v2 -- seal --lookback-days 14
//   npm run snapshot:v2 -- replay --from … --to …    explicit kickoff range
//   npm run snapshot:v2 -- seal --fixture 2557       exactly one fixture
//
// The smallest wrapper around runSnapshotSealing(). It adds no calculation and
// makes no product/display change — it seals immutable, NON-DIRECTIONAL snapshots
// (v1.0.0) so historical evidence accumulates. `seal` and `replay` are the SAME
// path; only the kickoff range differs (mirroring feature:v2 / module:v2).
// ─────────────────────────────────────────────────────────────────────────────

// FIRST IMPORT, DELIBERATELY — `.env` before any module that reads process.env at
// load time, matching module:v2 / feature:v2 / the ingestion entry points.
import '../config/env';

import { runSnapshotSealing, type SnapshotRunReport } from './driver';
import { closeAllPools } from '../db/pool';

type Command = 'seal' | 'replay';

interface Invocation {
  readonly command: Command;
  readonly replayFrom?: Date;
  readonly replayTo?: Date;
  readonly lookbackDays?: number;
  readonly fixtureId?: string;
}

function parseUtcDate(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${flag} expects YYYY-MM-DD, received '${value}'`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${flag} is not a real date: '${value}'`);
  return parsed;
}

export function parseArguments(argv: readonly string[]): Invocation {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const command = (positional[0] ?? 'seal') as Command;
  if (!['seal', 'replay'].includes(command)) {
    throw new Error(`unknown command '${command}'. Expected seal or replay.`);
  }

  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} expects a value`);
      flags.set(arg, next);
      i += 1;
    }
  }

  if (command === 'replay') {
    if (!flags.has('--from') || !flags.has('--to')) {
      throw new Error('replay requires --from and --to (YYYY-MM-DD kickoff range)');
    }
    const replayFrom = parseUtcDate(flags.get('--from')!, '--from');
    const replayTo = parseUtcDate(flags.get('--to')!, '--to');
    if (replayTo.getTime() < replayFrom.getTime()) throw new Error('--to precedes --from');
    return { command, replayFrom, replayTo };
  }

  const lookback = flags.get('--lookback-days');
  return {
    command,
    lookbackDays: lookback === undefined ? undefined : Number(lookback),
    fixtureId: flags.get('--fixture'),
  };
}

function reportRun(report: SnapshotRunReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 snapshot sealing complete: ${report.sealed} sealed, ${report.skipped} already sealed, ` +
      `${report.skippedNoRule} skipped (no rule in force), ${report.notYetDue} not yet due, ` +
      `${report.failed} failed (isolated) ` +
      `(${report.fixturesConsidered} fixture(s), ${report.pointsConsidered} arrived point(s))\n`
  );
  /* eslint-enable no-console */
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const invocation = parseArguments(argv);
    const report = await runSnapshotSealing({
      replayFrom: invocation.replayFrom,
      replayTo: invocation.replayTo,
      lookbackDays: invocation.lookbackDays,
      fixtureId: invocation.fixtureId,
    });
    reportRun(report);
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 snapshot FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
