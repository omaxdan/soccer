// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED SEASON ORCHESTRATION — `npm run ingest:v2:governed`
//
//   npm run ingest:v2:governed -- --tournament 325 --season 87678 \
//                                 --from 2026-08-12 --to 2026-08-19 --max-calls 4
//
// THE GOVERNANCE BOUNDARY, AND NOTHING ELSE.
//
// This module is the one place ingestion consumes governance. It answers a single
// question against governance.tracked_competition / tracked_edition — "is this
// exact competition+season authorized for ingestion right now?" — and ONLY on a
// single authorized row does it hand the explicit ids to the EXISTING, unchanged
// `ingestSeason`. It reads governance read-only through the pt_pipeline_ingestion
// pool, which holds SELECT and nothing else on the governance schema, so the path
// that ingests can never be the path that authorizes.
//
//   governance  ──SELECT (pt_pipeline_ingestion)──►  this module (decision)
//                                                      │  exactly one authorized row
//                                                      ▼
//                                             ingestSeason(...)   ← existing, unchanged
//                                                      ▼
//                                             ingestEvents(...)   ← existing, unchanged
//
// FAIL-CLOSED. Zero authorized rows, more than one, or a governance read that
// cannot be completed all end the run BEFORE any provider call or football write.
// An absent authorization is a refusal, never a default.
//
// DELIBERATELY NARROW. It authorizes and runs ONE explicitly-named season. It does
// NOT enumerate competitions, iterate all authorized seasons, derive a window,
// select teams, promote discovery, write governance, or touch any pipeline beyond
// the season ingest. Those are later, separately-authorized gates.
// ─────────────────────────────────────────────────────────────────────────────

// FIRST IMPORT, DELIBERATELY. `.env` must be read before any module that reads
// process.env at load time — the same ordering the ingestion CLI relies on.
import '../../config/env';

import type { PoolClient } from 'pg';
import { ingestSeason, INGESTION_ROLE, type SeasonIngestionReport } from '../pipeline';
import { PROVIDER_CODE } from '../provider/config';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { logger } from '../../../utils/logger';
import { AUTHORIZATION_COUNT_SQL, AUTHORIZATION_LOCK_SQL } from './governanceAuthorization';

/** Mirrors the season sweep default (see cli.ts DEFAULT_SEASON_MAX_CALLS). */
export const DEFAULT_GOVERNED_MAX_CALLS = 10;

export interface GovernedArguments {
  /** Provider namespace. Defaults to the one ingestion constant, PROVIDER_CODE. */
  readonly providerCode: string;
  /** `tournament.uniqueTournament.id`. */
  readonly competitionProviderId: string;
  /** `season.id` — the edition, not `tournament.id`. */
  readonly seasonProviderId: string;
  readonly from: Date;
  readonly to: Date;
  readonly maxCalls: number;
}

/**
 * THE AUTHORIZATION PREDICATE. Parameterized, read-only. Its six conjuncts are
 * the governance contract (Doc 95 / V8): a TRACKED competition, an ACTIVE edition
 * of the requested season, explicitly authorized. `count` is exact so the caller
 * can distinguish none / one / many.
 *
 * DEFINED ONCE in ./governanceAuthorization and re-exported here so the single-
 * edition check and the set enumerator (governedSelection) share one predicate.
 */
export const AUTHORIZATION_SQL = AUTHORIZATION_COUNT_SQL;

export type AuthorizationOutcome = 'AUTHORIZED' | 'UNAUTHORIZED' | 'AMBIGUOUS';

/**
 * EXACTLY ONE authorized row authorizes. Zero is a refusal. More than one is a
 * refusal too — the schema's constraints (one tracked_competition per provider
 * identity, one ACTIVE edition per competition, unique (competition, season))
 * make it unreachable, so if it is ever observed the safe response is to stop,
 * not to pick one.
 */
export function classifyAuthorization(count: number): AuthorizationOutcome {
  if (count === 1) return 'AUTHORIZED';
  if (count === 0) return 'UNAUTHORIZED';
  return 'AMBIGUOUS';
}

/**
 * Thrown by the at-commit guard when governance no longer authorizes the edition
 * at commit time (Gate 4). Distinct type + code so operations.failure records a
 * revocation as recognisably different from an ordinary ingestion failure —
 * without a new DB outcome value (the job still closes FAILED and rolls back).
 */
export class GovernanceRevokedError extends Error {
  readonly code = 'GOVERNANCE_REVOKED';
  constructor(
    readonly detail: {
      readonly providerCode: string;
      readonly competitionProviderId: string;
      readonly seasonProviderId: string;
      readonly observed: number;
    }
  ) {
    super(
      `GOVERNANCE_REVOKED: authorization is no longer valid at commit for ` +
        `${detail.providerCode} / ${detail.competitionProviderId} / ${detail.seasonProviderId} ` +
        `(authorized rows = ${detail.observed}); rolling back — no football committed`
    );
    this.name = 'GovernanceRevokedError';
  }
}

/**
 * Builds the AT-COMMIT authorization guard for one edition (Gate 4, Level 3).
 *
 * Runs AUTHORIZATION_LOCK_SQL on the ingestion transaction's own connection,
 * taking `FOR SHARE` locks on the governance rows so a concurrent revocation
 * blocks until this transaction commits or rolls back. Exactly one row must
 * return; anything else throws GovernanceRevokedError → the write transaction
 * rolls back. A query failure is NOT caught: it propagates and also rolls back
 * (fail-closed — a check that cannot complete never authorizes).
 */
export function makeAtCommitAuthorizationGuard(args: {
  readonly providerCode: string;
  readonly competitionProviderId: string;
  readonly seasonProviderId: string;
}): (tx: PoolClient) => Promise<void> {
  return async (tx: PoolClient) => {
    const result = await tx.query(AUTHORIZATION_LOCK_SQL, [
      args.providerCode,
      args.competitionProviderId,
      args.seasonProviderId,
    ]);
    if (result.rows.length !== 1) {
      throw new GovernanceRevokedError({
        providerCode: args.providerCode,
        competitionProviderId: args.competitionProviderId,
        seasonProviderId: args.seasonProviderId,
        observed: result.rows.length,
      });
    }
  };
}

/** Read-only governance authorization count for one explicit identity. */
export async function readAuthorizationCount(
  client: PoolClient,
  providerCode: string,
  competitionProviderId: string,
  seasonProviderId: string
): Promise<number> {
  const result = await client.query<{ n: number }>(AUTHORIZATION_SQL, [
    providerCode,
    competitionProviderId,
    seasonProviderId,
  ]);
  return result.rows[0]?.n ?? 0;
}

function parseUtcDate(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} expects YYYY-MM-DD, received '${value}'.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${flag} is not a real date: '${value}'.`);
  return parsed;
}

/**
 * Parses the governed-season arguments. Competition, season and BOTH window
 * bounds are required and have no default — a governed run states its own scope,
 * exactly as the season sweep does.
 */
export function parseGovernedArguments(argv: readonly string[]): GovernedArguments {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} expects a value.`);
      values.set(arg, next);
      i += 1;
    }
  }

  for (const flag of ['--tournament', '--season', '--from', '--to']) {
    if (!values.has(flag)) {
      throw new Error(
        `${flag} is required for a governed season run. ` +
          'Usage: ingest:v2:governed -- --tournament 325 --season 87678 --from 2026-08-12 --to 2026-08-19 [--max-calls 4] [--provider SPORTSAPI_API]'
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
    providerCode: values.get('--provider') ?? PROVIDER_CODE,
    competitionProviderId: values.get('--tournament')!,
    seasonProviderId: values.get('--season')!,
    from,
    to,
    maxCalls: rawMaxCalls === undefined ? DEFAULT_GOVERNED_MAX_CALLS : Number(rawMaxCalls),
  };
}

export interface GovernedRunResult {
  readonly outcome: AuthorizationOutcome;
  readonly authorizationCount: number;
  /** The season report, present ONLY when the run was authorized and executed. */
  readonly report: SeasonIngestionReport | null;
}

/** Injectable seams. Production passes nothing and gets the real facilities. */
export interface GovernedRunDeps {
  readonly authorize?: (args: GovernedArguments) => Promise<number>;
  readonly ingest?: typeof ingestSeason;
}

/**
 * The boundary. Reads governance; on exactly one authorized row calls the
 * existing `ingestSeason` with the explicit ids and the operator-supplied window;
 * otherwise refuses without a provider call or a football write.
 */
export async function runGovernedSeason(
  args: GovernedArguments,
  deps: GovernedRunDeps = {}
): Promise<GovernedRunResult> {
  const authorize =
    deps.authorize ??
    ((a: GovernedArguments) =>
      withConnection(INGESTION_ROLE, (client) =>
        readAuthorizationCount(client, a.providerCode, a.competitionProviderId, a.seasonProviderId)
      ));
  const ingest = deps.ingest ?? ingestSeason;

  const authorizationCount = await authorize(args);
  const outcome = classifyAuthorization(authorizationCount);

  if (outcome !== 'AUTHORIZED') {
    // FAIL-CLOSED. No provider call, no football write. The refusal is the record.
    logger.error(
      {
        provider: args.providerCode,
        competition: args.competitionProviderId,
        season: args.seasonProviderId,
        authorizationCount,
        outcome,
      },
      outcome === 'AMBIGUOUS'
        ? 'v2 governed run REFUSED: more than one authorized governance row — failing closed'
        : 'v2 governed run REFUSED: no authorized governance row — failing closed'
    );
    return { outcome, authorizationCount, report: null };
  }

  logger.info(
    {
      provider: args.providerCode,
      competition: args.competitionProviderId,
      season: args.seasonProviderId,
      from: args.from.toISOString().slice(0, 10),
      to: args.to.toISOString().slice(0, 10),
      maxCalls: args.maxCalls,
    },
    'v2 governed run AUTHORIZED: dispatching to ingestSeason'
  );

  const report = await ingest({
    competitionProviderId: args.competitionProviderId,
    seasonProviderId: args.seasonProviderId,
    from: args.from,
    to: args.to,
    maxCalls: args.maxCalls,
    // withStandings deliberately omitted — the governed first run is the proven
    // four-call sweep, nothing added.
    //
    // AT-COMMIT GUARD (Gate 4). The pre-dispatch check above closes the gap before
    // the run; this closes the long provider-walk TOCTOU gap by re-checking AND
    // FOR SHARE-locking governance as the final step inside the write transaction.
    verifyBeforeCommit: makeAtCommitAuthorizationGuard({
      providerCode: args.providerCode,
      competitionProviderId: args.competitionProviderId,
      seasonProviderId: args.seasonProviderId,
    }),
  });

  return { outcome, authorizationCount, report };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseGovernedArguments(argv);
    const result = await runGovernedSeason(args);

    /* eslint-disable no-console */
    if (result.outcome !== 'AUTHORIZED') {
      console.error(
        `\nv2 governed run REFUSED (${result.outcome}): ` +
          `${args.providerCode} / ${args.competitionProviderId} / ${args.seasonProviderId} — ` +
          `authorized rows = ${result.authorizationCount}. No ingestion performed.\n`
      );
      process.exitCode = 1;
      return;
    }

    const r = result.report!;
    console.log(
      `\nv2 governed run complete: ${args.providerCode} / competition ${r.competitionProviderId} / ` +
        `season ${r.seasonProviderId}, ${r.callsSpent} provider call(s)`
    );
    console.log(
      `  events read ${r.eventsRead}  selected ${r.eventsSelected}  ` +
        `editions ${r.editionsForSeason} (must be 1)  failed ${r.failed}\n`
    );
    /* eslint-enable no-console */
    if (r.failed) process.exitCode = 1;
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 governed run FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
