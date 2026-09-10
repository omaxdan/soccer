// ─────────────────────────────────────────────────────────────────────────────
// THIN CONFIG-DRIVEN ONBOARDING — `npm run onboard:v2`
//
// The smallest layer that lets an operator name a TRACKED COMPETITION instead of
// hand-looking-up and typing a season id. It chains the pieces that already
// exist and adds no new governance, edition-resolution, or ingestion logic:
//
//   trackedLeagues.ts   authoritative tournament id  (isTrackedId / findTrackedLeagueById)
//        │
//   DISCOVERY + RESOLUTION   discoverAndResolveSeason  (Task 1, provider read)
//        │
//   EDITION RESOLUTION   read football.competition_edition by provider season id
//        │
//   ── EXPLICIT GOVERNANCE GATE ──   readAuthorizationCount (governanceAuthorization)
//        │
//   INGESTION   runGovernedSeason → ingestSeason   (existing, unchanged)
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE SAFETY INVARIANT: DISCOVERY ≠ GOVERNANCE ≠ INGESTION.
//
// A discovered current season is only a CANDIDATE. This layer NEVER authorizes:
// it reads governance and reports. It NEVER mutates governance or football in its
// default (dry-run) mode — every database statement it issues on that path is a
// SELECT. Ingestion happens only when the operator adds the explicit `--ingest`
// flag AND governance already authorizes the edition; even then the work is done
// by the existing runGovernedSeason, which re-checks authorization at commit
// (Gate 4). There is no second authorization system and no second ingestion path.
// ─────────────────────────────────────────────────────────────────────────────

import '../../config/env';

import type { PoolClient } from 'pg';
import { ProviderClient } from '../provider/client';
import { loadProviderConfig, PROVIDER_CODE } from '../provider/config';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { INGESTION_ROLE } from '../pipeline';
import { isTrackedId, findTrackedLeagueById, getBandById } from '../../../config/trackedLeagues';
import { discoverAndResolveSeason, type SeasonDiscoveryResult } from './seasonDiscovery';
import { readAuthorizationCount, runGovernedSeason, classifyAuthorization } from './governedSeason';
import { parseSeasonSpan, type ProviderSeasonMeta } from '../provider/seasons';
import { logger } from '../../../utils/logger';

/* eslint-disable no-console */

/** A materialised competition edition, as read from football (never written here). */
export interface ExistingEdition {
  readonly competitionEditionId: string;
  readonly competitionId: string;
  readonly seasonLabel: string | null;
}

/**
 * Reads the football edition for a provider SEASON id, or null if none exists.
 *
 * The conflict target of resolveCompetitionEdition is
 * `uq_competition_edition__provider_external_id` (the season id, migration 022),
 * so this read uses the SAME identity ingestion upserts on — which is exactly why
 * onboarding cannot create a duplicate: it only ever reads this key, and the one
 * writer (ingestSeason) upserts on it. READ-ONLY.
 */
export async function readEditionByProviderSeason(
  client: PoolClient,
  seasonProviderId: string
): Promise<ExistingEdition | null> {
  const { rows } = await client.query<{
    competition_edition_id: string;
    competition_id: string;
    season_label: string | null;
  }>(
    `SELECT id::text            AS competition_edition_id,
            competition_id::text AS competition_id,
            season_label         AS season_label
       FROM football.competition_edition
      WHERE provider_external_id = $1`,
    [seasonProviderId]
  );
  if (rows.length === 0) return null;
  return {
    competitionEditionId: rows[0].competition_edition_id,
    competitionId: rows[0].competition_id,
    seasonLabel: rows[0].season_label,
  };
}

export type OnboardingState =
  | 'UNTRACKED' // the tournament id is not in trackedLeagues.ts
  | 'DISCOVERY_UNRESOLVED' // no current season could be resolved (off-season / ambiguous / provider gap)
  | 'GOVERNANCE_REQUIRED' // a current season resolved, but it is NOT authorized for ingestion
  | 'GOVERNANCE_AMBIGUOUS' // more than one authorized governance row — refuse (fail-closed)
  | 'GOVERNANCE_SATISFIED'; // exactly one authorized governance row — ingestion may proceed

export interface OnboardingPlan {
  readonly state: OnboardingState;
  readonly providerCode: string;
  readonly tournamentId: string;
  readonly trackedName: string | null;
  readonly band: string | null;
  /** The resolved current season, when discovery succeeded. */
  readonly season: ProviderSeasonMeta | null;
  /** The existing football edition for that season, when materialised. */
  readonly edition: ExistingEdition | null;
  readonly authorizationCount: number;
  /** Season-period window suggested from the resolved year (governance is authoritative). */
  readonly suggestedFrom: string | null;
  readonly suggestedTo: string | null;
  readonly reason: string;
}

/** Inclusive `--to` (day before the exclusive span end) as YYYY-MM-DD, or null. */
function suggestedWindow(season: ProviderSeasonMeta | null): {
  from: string | null;
  to: string | null;
} {
  if (!season) return { from: null, to: null };
  const span = parseSeasonSpan(season.year, season.name);
  if (!span.startsAt || !span.endsBefore) return { from: null, to: null };
  const from = span.startsAt.toISOString().slice(0, 10);
  const lastDay = new Date(span.endsBefore.getTime() - 24 * 60 * 60 * 1000);
  return { from, to: lastDay.toISOString().slice(0, 10) };
}

export interface PlanInputs {
  readonly providerCode: string;
  readonly tournamentId: string;
  readonly isTracked: boolean;
  readonly discovery: SeasonDiscoveryResult | null;
  readonly edition: ExistingEdition | null;
  readonly authorizationCount: number;
}

/**
 * Pure classification of the onboarding state. No I/O — every fact it needs has
 * already been gathered — so the whole decision table is unit-testable.
 *
 * The governance gate lives entirely here: only `authorizationCount === 1`
 * (exactly one authorized governance row) yields GOVERNANCE_SATISFIED. A resolved
 * season with no authorization is GOVERNANCE_REQUIRED — never silently upgraded.
 */
export function planOnboarding(input: PlanInputs): OnboardingPlan {
  const trackedName = isTrackedId(input.tournamentId)
    ? findTrackedLeagueById(input.tournamentId)?.name ?? null
    : null;
  const band = isTrackedId(input.tournamentId) ? getBandById(input.tournamentId) : null;
  const season =
    input.discovery && (input.discovery.resolution.kind === 'RESOLVED' ||
      input.discovery.resolution.kind === 'RESOLVED_BY_OVERRIDE')
      ? input.discovery.resolution.season
      : null;
  const { from, to } = suggestedWindow(season);

  const base = {
    providerCode: input.providerCode,
    tournamentId: input.tournamentId,
    trackedName,
    band,
    season,
    edition: input.edition,
    authorizationCount: input.authorizationCount,
    suggestedFrom: from,
    suggestedTo: to,
  };

  if (!input.isTracked) {
    return {
      ...base,
      state: 'UNTRACKED',
      reason: `tournament ${input.tournamentId} is not in trackedLeagues.ts; onboarding refuses an untracked competition before any provider or governance action`,
    };
  }

  if (!season) {
    const why = input.discovery
      ? (input.discovery.resolution as { reason: string }).reason
      : 'discovery did not run';
    return {
      ...base,
      state: 'DISCOVERY_UNRESOLVED',
      reason: `no current season resolved: ${why}. Nothing to govern or ingest.`,
    };
  }

  const outcome = classifyAuthorization(input.authorizationCount);
  if (outcome === 'AMBIGUOUS') {
    return {
      ...base,
      state: 'GOVERNANCE_AMBIGUOUS',
      reason: `${input.authorizationCount} authorized governance rows match this identity; failing closed — ingestion refused`,
    };
  }
  if (outcome === 'UNAUTHORIZED') {
    return {
      ...base,
      state: 'GOVERNANCE_REQUIRED',
      reason: `season ${season.id} ("${season.name}") is a discovered candidate but is NOT authorized for ingestion. Governance is explicit and separate — authorize it before any ingestion.`,
    };
  }
  return {
    ...base,
    state: 'GOVERNANCE_SATISFIED',
    reason: `season ${season.id} ("${season.name}") is authorized for ingestion (exactly one governance row). Ingestion may proceed through the existing governed path.`,
  };
}

/** Injectable seams so the orchestrator is testable without a provider or a DB. */
export interface OnboardDeps {
  readonly resolveSeason?: (
    tournamentId: string,
    now: Date,
    overrideSeasonId?: string
  ) => Promise<SeasonDiscoveryResult>;
  readonly readAuthorization?: (
    providerCode: string,
    tournamentId: string,
    seasonId: string
  ) => Promise<number>;
  readonly readEdition?: (seasonId: string) => Promise<ExistingEdition | null>;
}

export interface OnboardArgs {
  readonly providerCode: string;
  readonly tournamentId: string;
  readonly now: Date;
  readonly overrideSeasonId?: string;
}

/**
 * Gathers every fact (tracked check, discovery, edition existence, governance
 * authorization) and returns the plan. STRICTLY READ-ONLY — it never authorizes
 * and never ingests. Production wires the seams to the real provider and a single
 * read-only DB connection; both DB reads share that one connection.
 */
export async function runOnboarding(
  args: OnboardArgs,
  deps: OnboardDeps = {}
): Promise<OnboardingPlan> {
  if (!isTrackedId(args.tournamentId)) {
    // Refuse BEFORE any provider call — an untracked id never reaches the network.
    return planOnboarding({
      providerCode: args.providerCode,
      tournamentId: args.tournamentId,
      isTracked: false,
      discovery: null,
      edition: null,
      authorizationCount: 0,
    });
  }

  const resolveSeason =
    deps.resolveSeason ??
    ((tournamentId: string, now: Date, override?: string) => {
      const client = new ProviderClient(loadProviderConfig());
      return discoverAndResolveSeason(client, tournamentId, now, override);
    });

  const discovery = await resolveSeason(args.tournamentId, args.now, args.overrideSeasonId);

  const resolved =
    discovery.resolution.kind === 'RESOLVED' ||
    discovery.resolution.kind === 'RESOLVED_BY_OVERRIDE'
      ? discovery.resolution.season
      : null;

  if (!resolved) {
    return planOnboarding({
      providerCode: args.providerCode,
      tournamentId: args.tournamentId,
      isTracked: true,
      discovery,
      edition: null,
      authorizationCount: 0,
    });
  }

  // ONE read-only connection for both governance and edition reads.
  const readAuthorization =
    deps.readAuthorization ??
    ((provider: string, tournamentId: string, seasonId: string) =>
      withConnection(INGESTION_ROLE, (client) =>
        readAuthorizationCount(client, provider, tournamentId, seasonId)
      ));
  const readEdition =
    deps.readEdition ??
    ((seasonId: string) =>
      withConnection(INGESTION_ROLE, (client) => readEditionByProviderSeason(client, seasonId)));

  const [authorizationCount, edition] = await Promise.all([
    readAuthorization(args.providerCode, args.tournamentId, resolved.id),
    readEdition(resolved.id),
  ]);

  return planOnboarding({
    providerCode: args.providerCode,
    tournamentId: args.tournamentId,
    isTracked: true,
    discovery,
    edition,
    authorizationCount,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  readonly tournamentId: string;
  readonly overrideSeasonId?: string;
  readonly ingest: boolean;
  readonly from?: string;
  readonly to?: string;
  readonly maxCalls?: string;
}

function parseArguments(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  let ingest = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'onboard') continue; // tolerate a leading subcommand word
    if (arg === '--ingest') {
      ingest = true;
    } else if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} expects a value`);
      values.set(arg, next);
      i += 1;
    }
  }
  const tournamentId = values.get('--competition') ?? values.get('--tournament');
  if (!tournamentId) {
    throw new Error(
      'A tracked competition is required: --competition <providerTournamentId>.\n' +
        'Example: onboard:v2 -- --competition 17'
    );
  }
  return {
    tournamentId,
    overrideSeasonId: values.get('--override-season'),
    ingest,
    from: values.get('--from'),
    to: values.get('--to'),
    maxCalls: values.get('--max-calls'),
  };
}

function printPlan(plan: OnboardingPlan, now: Date): void {
  console.log('\nV2 ONBOARDING — DRY RUN (read-only). Discovery ≠ Governance ≠ Ingestion.\n');
  console.log(`  provider          ${plan.providerCode}`);
  console.log(`  tournament        ${plan.tournamentId}  (${plan.trackedName ?? 'UNTRACKED'}${plan.band ? `, band ${plan.band}` : ''})`);
  console.log(`  now (runtime UTC) ${now.toISOString()}`);
  if (plan.season) {
    console.log(`  resolved season   ${plan.season.id}  "${plan.season.name}"  (year ${plan.season.year})`);
  }
  if (plan.edition) {
    console.log(`  existing edition  competition_edition_id ${plan.edition.competitionEditionId} (competition_id ${plan.edition.competitionId}, "${plan.edition.seasonLabel ?? ''}") — REUSED, not duplicated`);
  } else if (plan.season) {
    console.log('  existing edition  none materialised yet (ingestion will create exactly one, keyed on the season id)');
  }
  console.log(`  authorization     ${plan.authorizationCount} governance row(s)`);
  console.log(`\n  STATE  ${plan.state}`);
  console.log(`  ${plan.reason}\n`);

  if (plan.state === 'GOVERNANCE_REQUIRED' && plan.season) {
    const from = plan.suggestedFrom ?? '<period-start>';
    const to = plan.suggestedTo ?? '<period-end>';
    console.log('  GOVERNANCE GATE — authorize explicitly before any ingestion:');
    console.log(`    npm run governance:register -- --tournament ${plan.tournamentId} --season ${plan.season.id} --from ${from} --to ${to} --authorize --type LEAGUE --scope DOMESTIC`);
    console.log('  (Suggested --from/--to are derived from the resolved season year; the governance season_period you register is authoritative.)');
    console.log('  Onboarding STOPS here. It has authorized nothing and ingested nothing.\n');
  } else if (plan.state === 'GOVERNANCE_SATISFIED' && plan.season) {
    const from = plan.suggestedFrom ?? '<period-start>';
    const to = plan.suggestedTo ?? '<period-end>';
    console.log('  Governance already satisfied. To ingest through the EXISTING governed path:');
    console.log(`    npm run ingest:v2:governed -- --tournament ${plan.tournamentId} --season ${plan.season.id} --from ${from} --to ${to} --max-calls <ceiling>`);
    console.log(`  or re-run this command with:  --ingest --from ${from} --to ${to} [--max-calls <ceiling>]  (reuses runGovernedSeason)\n`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  const now = new Date();

  try {
    const plan = await runOnboarding(
      { providerCode: PROVIDER_CODE, tournamentId: args.tournamentId, now, overrideSeasonId: args.overrideSeasonId },
      {}
    );
    printPlan(plan, now);

    if (!args.ingest) {
      // Default: dry-run. Nothing mutated, nothing ingested.
      if (plan.state === 'UNTRACKED') process.exitCode = 2;
      if (plan.state === 'DISCOVERY_UNRESOLVED') process.exitCode = 2;
      if (plan.state === 'GOVERNANCE_REQUIRED') process.exitCode = 3;
      if (plan.state === 'GOVERNANCE_AMBIGUOUS') process.exitCode = 4;
      return;
    }

    // ── EXPLICIT INGESTION PATH ──────────────────────────────────────────────
    // Reached ONLY with --ingest. It still refuses unless governance is already
    // satisfied — onboarding never authorizes. Ingestion is delegated wholesale
    // to the existing runGovernedSeason; no fixture logic is reimplemented here.
    if (plan.state !== 'GOVERNANCE_SATISFIED' || !plan.season) {
      console.log(`  --ingest refused: state is ${plan.state}, not GOVERNANCE_SATISFIED. Authorize via the governance gate first.\n`);
      process.exitCode = 3;
      return;
    }
    if (!args.from || !args.to) {
      console.log('  --ingest requires an explicit --from and --to window (YYYY-MM-DD). Refusing to assume the ingestion window.\n');
      process.exitCode = 5;
      return;
    }
    const from = new Date(`${args.from}T00:00:00Z`);
    const to = new Date(`${args.to}T00:00:00Z`);
    console.log(`  --ingest: governance satisfied; delegating to runGovernedSeason for season ${plan.season.id} (${args.from}..${args.to}).\n`);
    const result = await runGovernedSeason({
      providerCode: plan.providerCode,
      competitionProviderId: plan.tournamentId,
      seasonProviderId: plan.season.id,
      from,
      to,
      maxCalls: args.maxCalls ? Number(args.maxCalls) : 10,
    });
    console.log(`  governed ingestion outcome: ${result.outcome} (authorization rows ${result.authorizationCount})\n`);
    if (result.outcome !== 'AUTHORIZED') process.exitCode = 3;
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nv2 onboarding FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
