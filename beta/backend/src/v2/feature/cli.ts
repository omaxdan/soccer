// ─────────────────────────────────────────────────────────────────────────────
// FEATURE CLI — `npm run feature:v2`
//
//   npm run feature:v2 -- calculate                    forward, from now
//   npm run feature:v2 -- calculate --dry-run          compute, write nothing
//   npm run feature:v2 -- replay --from … --to …       explicit kickoff range
//   npm run feature:v2 -- verify                       the four temporary controls
//
// `calculate` and `replay` are THE SAME PIPELINE (D-4). Only the driver's range
// differs — replay is not a second implementation, and cannot drift from forward
// operation because there is nothing separate to drift.
// ─────────────────────────────────────────────────────────────────────────────

import { runFeaturePipeline, type FeatureRunReport } from './pipeline';
import { runAllVerifications, type VerificationResult } from './verify';
import { closeAllPools } from '../db/pool';

type Command = 'calculate' | 'replay' | 'verify';

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
  if (!['calculate', 'replay', 'verify'].includes(command)) {
    throw new Error(`unknown command '${command}'. Expected calculate, replay or verify.`);
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
      // D-4: replay is an EXPLICIT invocation. Defaulting its range would make a
      // historical replay something a scheduled run could drift into.
      throw new Error('replay requires --from and --to (YYYY-MM-DD kickoff range)');
    }
    const replayFrom = parseUtcDate(flags.get('--from')!, '--from');
    const replayTo = parseUtcDate(flags.get('--to')!, '--to');
    if (replayTo.getTime() < replayFrom.getTime()) throw new Error('--to precedes --from');
    return { command, dryRun, replayFrom, replayTo };
  }

  const lookback = flags.get('--lookback-days');
  return {
    command,
    dryRun,
    lookbackDays: lookback === undefined ? undefined : Number(lookback),
  };
}

function reportRun(report: FeatureRunReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 feature ${report.dryRun ? 'DRY RUN' : 'run'} complete: ` +
      `${report.batches} batch(es), ${report.failures} failure(s)\n`
  );
  console.log(`  stages: ${report.stages.map((stage) => stage.join(' + ')).join('  ->  ')}`);
  console.log(`  order:  ${report.sequence.join(' -> ')}   (derived from feature_dependency)\n`);
  for (const [relation, counts] of [...report.counts].sort()) {
    console.log(
      `  ${relation.padEnd(28)} examined ${String(counts.examined).padStart(6)}  ` +
        `written ${String(counts.written).padStart(6)}  skipped ${String(counts.skipped).padStart(6)}`
    );
  }
  console.log('');
  /* eslint-enable no-console */
}

function reportVerifications(results: readonly VerificationResult[]): boolean {
  /* eslint-disable no-console */
  console.log('\nv2 feature verification — TEMPORARY IMPLEMENTATION CONTROLS\n');
  console.log('  These stand in for registered quality checks that have no database-side');
  console.log('  implementation (finding S5-2). Remove them when those assertions exist.\n');
  let allPassed = true;
  for (const result of results) {
    if (!result.passed) allPassed = false;
    console.log(
      `  ${result.passed ? 'PASS' : 'FAIL'}  ${result.key.padEnd(28)} ` +
        `${result.violations} violation(s)`
    );
    for (const example of result.examples) console.log(`          ${example}`);
  }
  console.log('');
  /* eslint-enable no-console */
  return allPassed;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const invocation = parseArguments(argv);

    if (invocation.command === 'verify') {
      const results = await runAllVerifications();
      if (!reportVerifications(results)) process.exitCode = 1;
      return;
    }

    const report = await runFeaturePipeline({
      dryRun: invocation.dryRun,
      replayFrom: invocation.replayFrom,
      replayTo: invocation.replayTo,
      lookbackDays: invocation.lookbackDays,
    });
    reportRun(report);
    // A run that completed with failed batches exits non-zero, so a deployment
    // step does not treat a partially failed run as success.
    if (report.failures > 0) process.exitCode = 1;
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 feature FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
