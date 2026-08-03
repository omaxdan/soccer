// ─────────────────────────────────────────────────────────────────────────────
// INGESTION CLI — `npm run ingest:v2`
//
//   npm run ingest:v2                          today
//   npm run ingest:v2 -- --date 2026-08-01     one date
//   npm run ingest:v2 -- --from 2026-08-01 --to 2026-08-07
//   npm run ingest:v2 -- --from … --to … --allow-over-budget
//
// The budget guard is ON unless --allow-over-budget is passed. Historical replay
// is a deliberate act (D-3): at 200 calls a day, a season is weeks of budget, and
// discovering that at call 201 leaves the range half-done with tomorrow's quota
// already spent.
// ─────────────────────────────────────────────────────────────────────────────

import { ingestSchedule } from './pipeline';
import { closeAllPools } from '../db/pool';

interface Arguments {
  readonly from: Date;
  readonly to: Date;
  readonly enforceQuotaBudget: boolean;
}

function parseUtcDate(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} expects YYYY-MM-DD, received '${value}'.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${flag} is not a real date: '${value}'.`);
  return parsed;
}

export function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  let enforceQuotaBudget = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-over-budget') {
      enforceQuotaBudget = false;
    } else if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${arg} expects a value.`);
      }
      values.set(arg, next);
      i += 1;
    }
  }

  const single = values.get('--date');
  if (single) {
    const date = parseUtcDate(single, '--date');
    return { from: date, to: date, enforceQuotaBudget };
  }

  const from = values.has('--from') ? parseUtcDate(values.get('--from')!, '--from') : new Date();
  const to = values.has('--to') ? parseUtcDate(values.get('--to')!, '--to') : from;
  if (to.getTime() < from.getTime()) {
    throw new Error('--to precedes --from.');
  }
  return { from, to, enforceQuotaBudget };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArguments(argv);
    const report = await ingestSchedule(args);

    /* eslint-disable no-console */
    console.log(
      `\nv2 ingestion complete: ${report.datesProcessed} date(s), ` +
        `${report.apiCalls} provider call(s), ${report.failures} failure(s)\n`
    );
    console.log(`  examined  ${String(report.counts.examined).padStart(6)}`);
    console.log(`  written   ${String(report.counts.written).padStart(6)}`);
    console.log(`  skipped   ${String(report.counts.skipped).padStart(6)}   (already present, or not applicable)`);
    console.log(`  rejected  ${String(report.counts.rejected).padStart(6)}   (unmapped or refused — see the log)\n`);
    /* eslint-enable no-console */

    // A run with failures exits non-zero even though it completed, so a
    // deployment step does not treat a partially failed range as success.
    if (report.failures > 0) process.exitCode = 1;
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 ingestion FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
