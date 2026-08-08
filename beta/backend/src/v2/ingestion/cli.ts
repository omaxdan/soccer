// ─────────────────────────────────────────────────────────────────────────────
// INGESTION CLI — `npm run ingest:v2`
//
//   npm run ingest:v2                          today's schedule
//   npm run ingest:v2 -- --date 2026-08-01     one date
//   npm run ingest:v2 -- --from … --to …       a range
//   npm run ingest:v2 -- --from … --to … --allow-over-budget
//
//   npm run ingest:v2 -- squads                the stalest teams, bounded
//   npm run ingest:v2 -- squads --limit 40
//   npm run ingest:v2 -- squads --team 4501    exactly one team, by provider id
//
// BACKWARD COMPATIBLE BY CONSTRUCTION. An absent first positional, or one that
// looks like a flag, still means `schedule` — so every command in the runbook
// and every existing cron entry keeps working unchanged.
//
// The budget guard is ON unless --allow-over-budget is passed. Historical replay
// is a deliberate act (D-3): at 200 calls a day, a season is weeks of budget, and
// discovering that at call 201 leaves the range half-done with tomorrow's quota
// already spent. The same guard bounds a squad run, which is one call per team.
//
// THERE IS NO `squads --from/--to`, DELIBERATELY. A roster endpoint returns
// TODAY's squad. Replaying it into a past date would assert a registration
// nobody observed then, which is the fabrication the provenance rules exist to
// prevent. The only replay for a squad is "fetch this team again now".
// ─────────────────────────────────────────────────────────────────────────────

import { ingestSchedule, ingestSquads } from './pipeline';
import type { IngestionReport } from './pipeline';
import { closeAllPools } from '../db/pool';

type Command = 'schedule' | 'squads';

interface ScheduleArguments {
  readonly command: 'schedule';
  readonly from: Date;
  readonly to: Date;
  readonly enforceQuotaBudget: boolean;
}

interface SquadArguments {
  readonly command: 'squads';
  readonly limit?: number;
  readonly teamProviderExternalId?: string;
  readonly enforceQuotaBudget: boolean;
}

export type Arguments = ScheduleArguments | SquadArguments;

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

  const positional = argv.filter((arg) => !arg.startsWith('--'));
  // The first positional is a command ONLY when it names one. Anything else is
  // left alone so an unrecognised token cannot silently change what runs.
  const command: Command = positional[0] === 'squads' ? 'squads' : 'schedule';

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

  if (command === 'squads') {
    const rawLimit = values.get('--limit');
    if (rawLimit !== undefined && !/^\d+$/.test(rawLimit)) {
      throw new Error(`--limit expects a whole number, received '${rawLimit}'.`);
    }
    return {
      command,
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      teamProviderExternalId: values.get('--team'),
      enforceQuotaBudget,
    };
  }

  const single = values.get('--date');
  if (single) {
    const date = parseUtcDate(single, '--date');
    return { command, from: date, to: date, enforceQuotaBudget };
  }

  const from = values.has('--from') ? parseUtcDate(values.get('--from')!, '--from') : new Date();
  const to = values.has('--to') ? parseUtcDate(values.get('--to')!, '--to') : from;
  if (to.getTime() < from.getTime()) {
    throw new Error('--to precedes --from.');
  }
  return { command, from, to, enforceQuotaBudget };
}

function report(label: string, unit: string, result: IngestionReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 ${label} complete: ${result.datesProcessed} ${unit}(s), ` +
      `${result.apiCalls} provider call(s), ${result.failures} failure(s)\n`
  );
  console.log(`  examined  ${String(result.counts.examined).padStart(6)}`);
  console.log(`  written   ${String(result.counts.written).padStart(6)}`);
  console.log(`  skipped   ${String(result.counts.skipped).padStart(6)}   (already present, or not applicable)`);
  console.log(`  rejected  ${String(result.counts.rejected).padStart(6)}   (unmapped or refused — see the log)\n`);
  /* eslint-enable no-console */
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArguments(argv);

    const result =
      args.command === 'squads'
        ? await ingestSquads({
            limit: args.limit,
            teamProviderExternalId: args.teamProviderExternalId,
            enforceQuotaBudget: args.enforceQuotaBudget,
          })
        : await ingestSchedule(args);

    report(
      args.command === 'squads' ? 'squad ingestion' : 'ingestion',
      args.command === 'squads' ? 'team' : 'date',
      result
    );

    // A run with failures exits non-zero even though it completed, so a
    // deployment step does not treat a partially failed range as success.
    if (result.failures > 0) process.exitCode = 1;
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
