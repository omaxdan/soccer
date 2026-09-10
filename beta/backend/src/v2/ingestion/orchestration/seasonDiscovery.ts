// ─────────────────────────────────────────────────────────────────────────────
// SEASON DISCOVERY — `npm run discover:season`
//
// The DISCOVERY + RESOLUTION entry point of config-driven onboarding, and NOTHING
// more. It takes an authoritative tracked tournament id, asks the provider for
// that tournament's season catalogue (one DISCOVERY-class call), and runs the
// pure resolver (provider/seasons.ts) to decide which season is current.
//
// IT AUTHORIZES NOTHING AND WRITES NO DATABASE ROW. The four onboarding concepts
// are kept strictly separate:
//
//     DISCOVERY  (this file: fetch the catalogue)
//        │
//     RESOLUTION (provider/seasons.ts: choose the current season)
//        │
//     GOVERNANCE (governanceAdmin.ts: register + authorize an edition)   ← manual, later
//        │
//     INGESTION  (governedSeason.ts: sweep + materialise, gated on authorization)
//
// Discovering the current season is a READ. Turning it into an ingestible edition
// is a deliberate, separately-authorized governance step the operator still runs
// by hand. This file therefore needs a provider key and nothing else — no pool,
// no governance connection — exactly like discover.ts.
// ─────────────────────────────────────────────────────────────────────────────

import '../../config/env';

import { ProviderClient } from '../provider/client';
import { loadProviderConfig, PROVIDER_CODE } from '../provider/config';
import {
  normaliseSeasons,
  resolveCurrentSeason,
  classifySeason,
  type ProviderSeasonMeta,
  type SeasonResolution,
} from '../provider/seasons';
import {
  isTrackedId,
  findTrackedLeagueById,
  getBandById,
} from '../../../config/trackedLeagues';
import { logger } from '../../../utils/logger';

/* eslint-disable no-console */

/** Fetches and normalises the provider's season catalogue for a tournament. */
export async function discoverSeasons(
  client: ProviderClient,
  tournamentId: string
): Promise<ProviderSeasonMeta[]> {
  const payload = await client.get<unknown>('tournament_seasons', { tournamentId });
  return normaliseSeasons(payload);
}

export interface SeasonDiscoveryResult {
  readonly tournamentId: string;
  readonly seasons: ProviderSeasonMeta[];
  readonly resolution: SeasonResolution;
}

/**
 * Discovers seasons for a tournament and resolves the current one. `now` is
 * injected (defaulting to the runtime clock) so the decision is reproducible and
 * testable; nothing here hard-codes a date.
 */
export async function discoverAndResolveSeason(
  client: ProviderClient,
  tournamentId: string,
  now: Date = new Date(),
  overrideSeasonId?: string
): Promise<SeasonDiscoveryResult> {
  const seasons = await discoverSeasons(client, tournamentId);
  const resolution = resolveCurrentSeason(seasons, now, { overrideSeasonId });
  return { tournamentId, seasons, resolution };
}

interface CliArgs {
  readonly competitionId: string;
  readonly overrideSeasonId?: string;
  readonly asJson: boolean;
}

function parseArguments(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      asJson = true;
    } else if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} expects a value`);
      values.set(arg, next);
      i += 1;
    }
  }
  const competitionId = values.get('--competition') ?? values.get('--tournament');
  if (!competitionId) {
    throw new Error(
      'A tracked competition is required: --competition <providerTournamentId>.\n' +
        'The id must be one authoritatively tracked in trackedLeagues.ts.'
    );
  }
  return { competitionId, overrideSeasonId: values.get('--override-season'), asJson };
}

function printHuman(result: SeasonDiscoveryResult, now: Date): void {
  const league = findTrackedLeagueById(result.tournamentId);
  console.log('\nV2 SEASON DISCOVERY — read-only; discovery does NOT authorize ingestion\n');
  console.log(`  provider          ${PROVIDER_CODE}`);
  console.log(`  tournament        ${result.tournamentId}  (${league?.name ?? '?'}, band ${getBandById(result.tournamentId) ?? '?'})`);
  console.log(`  now (runtime UTC) ${now.toISOString()}`);
  console.log(`  seasons returned  ${result.seasons.length}\n`);

  console.log('  catalogue (as returned — newest-first by convention):');
  for (const s of result.seasons.slice(0, 12)) {
    const c = classifySeason(s, now);
    console.log(
      `    [${String(s.index).padStart(2)}] id ${String(s.id).padEnd(7)} ${String(s.year ?? '?').padEnd(7)} ${c.temporalClass.padEnd(7)} ${c.span.format.padEnd(8)} ${s.name}`
    );
  }
  if (result.seasons.length > 12) console.log(`    … ${result.seasons.length - 12} older season(s) not shown`);

  const r = result.resolution;
  console.log('');
  if (r.kind === 'RESOLVED' || r.kind === 'RESOLVED_BY_OVERRIDE') {
    console.log(`  RESOLVED season   ${r.season.id}  "${r.season.name}"  (year ${r.season.year})`);
    if (r.kind === 'RESOLVED') console.log(`  basis             ${r.basis}`);
    console.log(`  why               ${r.reason}`);
    console.log('\n  NEXT (separate, manual, and NOT performed here):');
    console.log(`    1. governance:register -- --tournament ${result.tournamentId} --season ${r.season.id} --from <period-start> --to <period-end> --authorize --type LEAGUE --scope DOMESTIC`);
    console.log(`    2. ingest:v2:governed  -- --tournament ${result.tournamentId} --season ${r.season.id} --from <period-start> --to <period-end> --max-calls <ceiling>`);
    console.log('  (Discovery is evidence only. An edition is onboarded only after the governance step above.)\n');
  } else {
    console.log(`  UNRESOLVED        ${r.reason}`);
    console.log('  No season selected. For an intentional historical/backfill onboarding, re-run with --override-season <id>.\n');
    process.exitCode = 2;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);

  if (!isTrackedId(args.competitionId)) {
    throw new Error(
      `Tournament ${args.competitionId} is not in trackedLeagues.ts (isTrackedId=false). ` +
        'Season discovery only runs for authoritatively tracked competitions.'
    );
  }

  const now = new Date();
  const client = new ProviderClient(loadProviderConfig());
  logger.info({ tournament: args.competitionId }, 'v2 season discovery: requesting season catalogue');

  const result = await discoverAndResolveSeason(client, args.competitionId, now, args.overrideSeasonId);

  if (args.asJson) {
    console.log(
      JSON.stringify(
        {
          tournamentId: result.tournamentId,
          now: now.toISOString(),
          seasonCount: result.seasons.length,
          resolution: result.resolution,
        },
        null,
        2
      )
    );
  } else {
    printHuman(result, now);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nv2 season discovery FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
