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
//   npm run ingest:v2 -- season --tournament 325 --season 87678 \
//                               --from 2026-05-31 --to 2026-08-11 --max-calls 10
//
//   npm run ingest:v2 -- match --match 15237975   one fixture's raw match data
//                                                 (lineups + team/player stats)
//
// THE SEASON WINDOW IS REQUIRED AND HAS NO DEFAULT. `FIXTURE_WINDOW` in the
// pager is the evidence-derived value tests and exploration use; a production
// run states its own, and the resolved configuration is printed before the first
// provider call so a run record shows what was actually swept.
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

// FIRST IMPORT, DELIBERATELY. See `../config/env` — `.env` must be read before
// any module that reads `process.env` at load time is evaluated.
import '../config/env';

import { ingestSchedule, ingestSeason, ingestSquads, ingestTeam, enrichMatchFixture } from './pipeline';
import type {
  IngestionReport,
  SeasonIngestionReport,
  TeamIngestionReport,
  MatchEnrichmentReport,
} from './pipeline';
import { closeAllPools } from '../db/pool';

type Command = 'schedule' | 'squads' | 'season' | 'team' | 'match';

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

interface SeasonArguments {
  readonly command: 'season';
  readonly competitionProviderId: string;
  readonly seasonProviderId: string;
  readonly from: Date;
  readonly to: Date;
  readonly maxCalls: number;
  /** Opt in to the league-table call. Default OFF. */
  readonly withStandings: boolean;
}

interface TeamArguments {
  readonly command: 'team';
  readonly teamId: string;
  readonly uniqueTournamentId: string;
  readonly seasonId: string;
  readonly from: Date;
  readonly to?: Date;
  readonly maxCalls: number;
}

interface MatchArguments {
  readonly command: 'match';
  /** Provider match id — equals fixture.provider_external_id. */
  readonly fixtureProviderId: string;
}

export type Arguments =
  | ScheduleArguments
  | SquadArguments
  | SeasonArguments
  | TeamArguments
  | MatchArguments;

/** The whole sweep's budget. Four pages is the observed cost of one season. */
export const DEFAULT_SEASON_MAX_CALLS = 10;

/** Bounded first-run budget for the team spine walk plus reconciliation. */
export const DEFAULT_TEAM_MAX_CALLS = 12;

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
  const command: Command =
    positional[0] === 'squads'
      ? 'squads'
      : positional[0] === 'season'
        ? 'season'
        : positional[0] === 'team'
          ? 'team'
          : positional[0] === 'match'
            ? 'match'
            : 'schedule';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-over-budget') {
      enforceQuotaBudget = false;
    } else if (arg === '--with-standings') {
      // A standalone flag: it carries no value, so it must not consume the token
      // that follows it.
      continue;
    } else if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${arg} expects a value.`);
      }
      values.set(arg, next);
      i += 1;
    }
  }

  if (command === 'match') {
    // ONE FIXTURE, BY PROVIDER MATCH ID. No range, no work list — a match
    // endpoint costs a call per fixture, so broad enrichment is a separate,
    // budgeted decision this command does not make.
    if (!values.has('--match')) {
      throw new Error(
        '--match is required for a match run. ' +
          'Usage: ingest:v2 -- match --match 15237975'
      );
    }
    return { command, fixtureProviderId: values.get('--match')! };
  }

  if (command === 'team') {
    // EXPLICIT IDS ONLY. C1 enumeration and C2 season selection are bypassed for
    // the bounded first run, so team, competition and season are all required.
    for (const flag of ['--team', '--tournament', '--season', '--from']) {
      if (!values.has(flag)) {
        throw new Error(
          `${flag} is required for a team run. ` +
            'Usage: ingest:v2 -- team --team 1963 --tournament 325 --season 87678 --from 2026-05-31'
        );
      }
    }
    const from = parseUtcDate(values.get('--from')!, '--from');
    const to = values.has('--to') ? parseUtcDate(values.get('--to')!, '--to') : undefined;
    if (to && to.getTime() < from.getTime()) {
      throw new Error(`--to (${values.get('--to')}) precedes --from (${values.get('--from')}).`);
    }
    const rawMaxCalls = values.get('--max-calls');
    if (rawMaxCalls !== undefined && !/^[1-9]\d*$/.test(rawMaxCalls)) {
      throw new Error(`--max-calls expects a whole number of at least 1, received '${rawMaxCalls}'.`);
    }
    return {
      command,
      teamId: values.get('--team')!,
      uniqueTournamentId: values.get('--tournament')!,
      seasonId: values.get('--season')!,
      from,
      to,
      maxCalls: rawMaxCalls === undefined ? DEFAULT_TEAM_MAX_CALLS : Number(rawMaxCalls),
    };
  }

  if (command === 'season') {
    // EVERY ONE OF THESE IS REQUIRED. A season sweep with a defaulted window or
    // a defaulted competition is a sweep whose scope nobody stated, and the
    // refusal happens here — before a provider call is made, not after.
    for (const flag of ['--tournament', '--season', '--from', '--to']) {
      if (!values.has(flag)) {
        throw new Error(
          `${flag} is required for a season sweep. ` +
            'Usage: ingest:v2 -- season --tournament 325 --season 87678 --from 2026-05-31 --to 2026-08-11'
        );
      }
    }
    const from = parseUtcDate(values.get('--from')!, '--from');
    const to = parseUtcDate(values.get('--to')!, '--to');
    if (to.getTime() < from.getTime()) {
      throw new Error(`--to (${values.get('--to')}) precedes --from (${values.get('--from')}).`);
    }
    const rawMaxCalls = values.get('--max-calls');
    if (rawMaxCalls !== undefined && !/^[1-9]\d*$/.test(rawMaxCalls)) {
      throw new Error(`--max-calls expects a whole number of at least 1, received '${rawMaxCalls}'.`);
    }
    return {
      command,
      competitionProviderId: values.get('--tournament')!,
      seasonProviderId: values.get('--season')!,
      from,
      to,
      maxCalls: rawMaxCalls === undefined ? DEFAULT_SEASON_MAX_CALLS : Number(rawMaxCalls),
      withStandings: argv.includes('--with-standings'),
    };
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
  console.log(
    `  written   ${String(result.counts.written).padStart(6)}   ` +
      `(${result.counts.inserted} created, ${result.counts.updated} already existed)`
  );
  console.log(`  skipped   ${String(result.counts.skipped).padStart(6)}   (already present, or not applicable)`);
  console.log(`  rejected  ${String(result.counts.rejected).padStart(6)}   (unmapped or refused — see the log)\n`);
  /* eslint-enable no-console */
}

/** Printed BEFORE the first provider call, so a run states its own scope. */
function announceSeason(args: Extract<Arguments, { command: 'season' }>): void {
  /* eslint-disable no-console */
  console.log('\nv2 season sweep — resolved configuration');
  console.log(`  competition (uniqueTournament.id)  ${args.competitionProviderId}`);
  console.log(`  season (season.id)                ${args.seasonProviderId}`);
  console.log(`  window                            ${iso(args.from)} .. ${iso(args.to)} (inclusive, UTC)`);
  console.log(`  call budget (whole sweep)         ${args.maxCalls}`);
  console.log(
    `  standings                         ${args.withStandings ? 'YES — one season_standings call, variant TOTAL' : 'no (--with-standings to include)'}`
  );
  console.log(
    `  endpoints                         tournament_season_events_last | _next${args.withStandings ? ' | season_standings' : ''}`
  );
  console.log('  NOT used                          /schedule/{date}, match-level\n');
  /* eslint-enable no-console */
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

function reportSeason(result: SeasonIngestionReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 season sweep complete: competition ${result.competitionProviderId}, ` +
      `season ${result.seasonProviderId}, ${result.callsSpent} provider call(s)\n`
  );
  for (const direction of result.directions) {
    console.log(
      `  ${direction.direction.padEnd(5)} pages [${direction.pages.join(', ')}]  ` +
        `read ${direction.eventsRead}  selected ${direction.eventsSelected}  ` +
        `duplicates ${direction.duplicates}  calls ${direction.callsSpent}  ` +
        `stopped ${direction.stoppedBecause}` +
        (direction.resumeFromPage === null ? '' : `  resume-from ${direction.resumeFromPage}`)
    );
    for (const anomaly of direction.orderingAnomalies) console.log(`        ORDERING: ${anomaly}`);
  }
  console.log(`\n  events read      ${String(result.eventsRead).padStart(6)}`);
  console.log(`  events selected  ${String(result.eventsSelected).padStart(6)}`);
  console.log(`  quota remaining  ${String(result.quotaRemaining ?? 'not reported').padStart(6)}`);
  console.log(`  editions         ${String(result.editionsForSeason).padStart(6)}   (must be 1)`);
  if (result.standingsRequested) {
    const standings = result.standingsCounts;
    console.log(
      `  standings        ${String(standings?.written ?? 0).padStart(6)} written, ` +
        `${standings?.skipped ?? 0} skipped, ${standings?.rejected ?? 0} rejected ` +
        `— variant TOTAL, as of ${result.standingsAsOfOn} (observed, not reconstructed)`
    );
  }
  // `new` and `existing` split `written` (F-3), which is how "how much of this
  // competition was new?" is answered from the run rather than by counting rows
  // before and after. They are NOT in operations.write_record — it has no column
  // for them — so this report is where the distinction lives.
  console.log('\n  per relation:');
  for (const [relation, counts] of result.byRelation) {
    console.log(
      `    ${relation.padEnd(42)} examined ${String(counts.examined).padStart(5)}  ` +
        `written ${String(counts.written).padStart(5)}  ` +
        `new ${String(counts.inserted).padStart(5)}  existing ${String(counts.updated).padStart(5)}  ` +
        `skipped ${String(counts.skipped).padStart(5)}  ` +
        `rejected ${String(counts.rejected).padStart(5)}`
    );
  }
  console.log('');
  /* eslint-enable no-console */
}

function reportTeam(result: TeamIngestionReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 team run — team ${result.team}, competition ${result.uniqueTournament}, ` +
      `season ${result.season} — ${result.runStatus}` +
      (result.hardStopReason ? ` (${result.hardStopReason})` : '')
  );
  console.log(
    `  spine pages   last [${result.pagesLast.join(', ')}]  next [${result.pagesNext.join(', ')}]` +
      (result.resumeFromPage === null ? '' : `  resume-from ${result.resumeFromPage}`)
  );
  console.log(`  events observed   ${String(result.eventsObserved).padStart(6)}   distinct ${result.distinctEventIds}`);
  console.log(
    `  fixtures          ${String(result.fixturesCreated).padStart(6)} created, ` +
      `${result.fixturesReused} reused, ${result.duplicatesSuppressed} duplicates suppressed`
  );
  console.log(
    `  registrations     ${String(result.teamRegistrationsCreated).padStart(6)}   ` +
      `results ${result.resultsWritten}   lifecycle transitions ${result.lifecycleTransitions}`
  );
  console.log(
    `  reconciliation    matches ${result.reconciliationMatches}  MISSING_FROM_SPINE ${result.missingFromSpine}  ` +
      `spine_only ${result.spineOnly}  identity ${result.identityMismatches}  date ${result.dateDiscrepancies}  status ${result.statusDiscrepancies}`
  );
  console.log(
    `  quarantined ${result.quarantinedEvents}   unknown-status ${result.unknownStatusCount}   failures ${result.failures}`
  );
  console.log(
    `  provider calls    ${result.providerCalls} / budget ${result.providerBudget}   remaining ${result.budgetRemaining}`
  );
  console.log(
    `  isolation         module ${result.moduleWrites} · feature ${result.featureWrites} · ` +
      `snapshot ${result.snapshotWrites} · calibration ${result.calibrationWrites}  (all must be 0)`
  );
  for (const anomaly of result.anomalies.slice(0, 20)) console.log(`    AUDIT: ${anomaly}`);
  console.log('');
  /* eslint-enable no-console */
}

function reportMatch(result: MatchEnrichmentReport): void {
  /* eslint-disable no-console */
  console.log(
    `\nv2 match enrichment — provider match ${result.fixtureProviderId} — ${result.runStatus}` +
      (result.hardStopReason ? ` (${result.hardStopReason})` : '')
  );
  console.log(
    `  fixture           ${result.fixtureId ?? 'unresolved'}` +
      (result.fixturePartitionOn ? ` (partition ${result.fixturePartitionOn})` : '')
  );
  console.log(
    `  provider calls    ${result.providerCalls}   quota remaining ${result.quotaRemaining ?? 'not reported'}`
  );
  console.log('\n  per relation:');
  for (const [relation, counts] of result.byRelation) {
    console.log(
      `    ${relation.padEnd(38)} examined ${String(counts.examined).padStart(5)}  ` +
        `written ${String(counts.written).padStart(5)}  ` +
        `new ${String(counts.inserted).padStart(5)}  existing ${String(counts.updated).padStart(5)}  ` +
        `skipped ${String(counts.skipped).padStart(5)}  rejected ${String(counts.rejected).padStart(5)}`
    );
  }
  console.log('');
  /* eslint-enable no-console */
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArguments(argv);

    if (args.command === 'match') {
      const matchResult = await enrichMatchFixture({ fixtureProviderId: args.fixtureProviderId });
      reportMatch(matchResult);
      if (matchResult.runStatus === 'HARD_STOP') process.exitCode = 1;
      return;
    }

    if (args.command === 'team') {
      const teamResult = await ingestTeam({
        teamId: args.teamId,
        uniqueTournamentId: args.uniqueTournamentId,
        seasonId: args.seasonId,
        from: args.from,
        to: args.to,
        maxCalls: args.maxCalls,
      });
      reportTeam(teamResult);
      if (teamResult.runStatus === 'HARD_STOP') process.exitCode = 1;
      return;
    }

    if (args.command === 'season') {
      announceSeason(args);
      const seasonResult = await ingestSeason({
        competitionProviderId: args.competitionProviderId,
        seasonProviderId: args.seasonProviderId,
        from: args.from,
        to: args.to,
        maxCalls: args.maxCalls,
        withStandings: args.withStandings,
      });
      reportSeason(seasonResult);
      if (seasonResult.failed) process.exitCode = 1;
      return;
    }

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
