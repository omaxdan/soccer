// ─────────────────────────────────────────────────────────────────────────────
// MODULE CLI — `npm run module:v2`
//
//   npm run module:v2 -- calculate                    forward, from now
//   npm run module:v2 -- calculate --dry-run          compute, write nothing
//   npm run module:v2 -- replay --from … --to …       explicit kickoff range
//
// The smallest possible wrapper around the EXISTING runModulePipeline(). It adds
// no calculation, activates no module, and changes no formula — it only provides
// the operator entry point the feature pipeline already has (feature:v2), so the
// intelligence layer can be run in production the same way. `calculate` and
// `replay` are THE SAME PIPELINE; only the eligibility range differs (mirroring
// feature:v2, D-4).
// ─────────────────────────────────────────────────────────────────────────────

// FIRST IMPORT, DELIBERATELY — `.env` before any module that reads process.env at
// load time, matching feature:v2 and the ingestion entry points.
import '../config/env';

import { runModulePipeline, type ModuleRunReport } from './pipeline';
import { closeAllPools } from '../db/pool';

type Command = 'calculate' | 'replay';

interface Invocation {
  readonly command: Command;
  readonly dryRun: boolean;
  readonly replayFrom?: Date;
  readonly replayTo?: Date;
  readonly lookbackDays?: number;
}

function parseUtcDate(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} expects YYYY-MM-DD, received '${value}'`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${flag} is not a real date: '${value}'`);
  return parsed;
}

export function parseArguments(argv: readonly string[]): Invocation {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const command = (positional[0] ?? 'calculate') as Command;
  if (!['calculate', 'replay'].includes(command)) {
    throw new Error(`unknown command '${command}'. Expected calculate or replay.`);
  }

  const flags = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--')) {
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
    return { command, dryRun, replayFrom, replayTo };
  }

  const lookback = flags.get('--lookback-days');
  return { command, dryRun, lookbackDays: lookback === undefined ? undefined : Number(lookback) };
}

function reportRun(report: ModuleRunReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 module ${report.dryRun ? 'DRY RUN' : 'run'} complete: ` +
      `${report.batches} batch(es), ${report.failures} failure(s)\n`
  );
  console.log(`  modules: ${report.modules.join(', ')}`);
  for (const [relation, counts] of [...report.counts].sort()) {
    console.log(
      `  ${relation.padEnd(28)} examined ${String(counts.examined).padStart(6)}  ` +
        `written ${String(counts.written).padStart(6)}  skipped ${String(counts.skipped).padStart(6)}`
    );
  }
  console.log('');
  /* eslint-enable no-console */
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const invocation = parseArguments(argv);
    const report = await runModulePipeline({
      dryRun: invocation.dryRun,
      replayFrom: invocation.replayFrom,
      replayTo: invocation.replayTo,
      lookbackDays: invocation.lookbackDays,
    });
    reportRun(report);
    if (report.failures > 0) process.exitCode = 1;
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 module FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
