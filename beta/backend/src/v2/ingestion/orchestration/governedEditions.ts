// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED EDITIONS — `npm run ingest:v2:governed-all`
//
//   npm run ingest:v2:governed-all -- --from 2026-08-12 --to 2026-08-19 --max-calls 8
//
// Gate 5, and NOTHING more: it wires the Gate 3 authorized-edition selection into
// the Gate 4-protected execution path, for a single bounded, operator-invoked run.
//
//   selectAuthorizedEditions()            ← Gate 3, the ONLY source of what to ingest
//        ↓  (one operator-supplied window + total budget for the whole invocation)
//   runGovernedSeason()  per edition      ← Gate 4 boundary + at-commit lock, UNCHANGED
//        ↓
//   ingestSeason() → existing writer      ← UNCHANGED
//
// NOT here: scheduler, cron, recurrence, window derivation, season_period
// interpretation, coverage/cursor, backfill, discovery, promotion, governance
// writes, team ingestion. The window is operator-supplied; selection is the sole,
// fail-closed authority for scope.
//
// FAIL-CLOSED: zero authorized editions → zero ingestion (never "all"). Every
// edition executes THROUGH runGovernedSeason — this file never calls ingestSeason
// directly, so the Gate 4 authorization guard can never be bypassed.
//
// BUDGET: --max-calls is the TOTAL provider-call budget for the whole invocation
// (the safer reading — the operator's number is an absolute ceiling that N editions
// can never multiply). It is spent sequentially: each edition receives the REMAINING
// budget; once the remainder falls below one call, further editions are skipped
// rather than dispatched with nothing.
//
// FAILURE: FAIL-FAST. The first edition that fails or is refused stops the run;
// remaining editions are left NOT_ATTEMPTED. Editions already committed stay
// committed (each is its own Gate 4-guarded transaction). No retries, queues, or
// resumability are introduced.
// ─────────────────────────────────────────────────────────────────────────────

// FIRST IMPORT, DELIBERATELY — `.env` before any module that reads process.env at
// load time, matching the other ingestion entry points.
import '../../config/env';

import { selectAuthorizedEditions, type AuthorizedEdition } from './governedSelection';
import { runGovernedSeason, type GovernedRunResult } from './governedSeason';
import { deriveUncoveredWindows, type DateInterval, type UncoveredDerivation } from '../coverageWindows';
import { INGESTION_ROLE } from '../pipeline';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { logger } from '../../../utils/logger';

export interface GovernedEditionsArguments {
  readonly from: Date;
  readonly to: Date;
  /** TOTAL provider-call budget for the whole invocation, across all editions. */
  readonly maxCalls: number;
}

export type EditionStatus =
  | 'SUCCEEDED'
  | 'NO_WORK'
  | 'FAILED'
  | 'REFUSED'
  | 'SKIPPED_BUDGET'
  | 'NOT_ATTEMPTED';

export interface EditionOutcome {
  readonly competitionProviderExternalId: string;
  readonly seasonProviderExternalId: string;
  readonly providerCode: string;
  readonly status: EditionStatus;
  /** Number of uncovered gaps derived for this edition over the operator window. */
  readonly gaps: number;
  /** Total provider calls spent across this edition's gaps. */
  readonly callsSpent: number;
  /** Present for NO_WORK (reason), REFUSED (authorization), FAILED (error), or budget notes. */
  readonly detail?: string;
}

export interface GovernedEditionsResult {
  readonly selected: number;
  readonly outcomes: readonly EditionOutcome[];
  readonly totalCallsSpent: number;
  readonly aggregate: 'SUCCEEDED' | 'FAILED' | 'NOOP';
}

/** Injectable seams. Production passes nothing and gets the real facilities. */
export interface GovernedEditionsDeps {
  readonly select?: () => Promise<readonly AuthorizedEdition[]>;
  readonly run?: (args: {
    providerCode: string;
    competitionProviderId: string;
    seasonProviderId: string;
    from: Date;
    to: Date;
    maxCalls: number;
  }) => Promise<GovernedRunResult>;
  /** Gate 6C coverage-aware derivation of the uncovered gaps for one edition. */
  readonly derive?: (
    edition: AuthorizedEdition,
    requestedFrom: string,
    requestedTo: string
  ) => Promise<UncoveredDerivation>;
}

/** Converts a half-open coverage gap [from, to) into an inclusive dispatch window. */
function gapToInclusiveWindow(gap: DateInterval): { from: Date; to: Date } {
  const from = new Date(`${gap.from}T00:00:00Z`);
  // Inclusive last day = the half-open upper bound minus one day.
  const to = new Date(new Date(`${gap.to}T00:00:00Z`).getTime() - 86_400_000);
  return { from, to };
}

function parseUtcDate(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${flag} expects YYYY-MM-DD, received '${value}'.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${flag} is not a real date: '${value}'.`);
  return parsed;
}

/** Parses the governed-editions arguments. Window and budget are required. */
export function parseGovernedEditionsArguments(argv: readonly string[]): GovernedEditionsArguments {
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
  for (const flag of ['--from', '--to', '--max-calls']) {
    if (!values.has(flag)) {
      throw new Error(
        `${flag} is required for a governed-editions run. ` +
          'Usage: ingest:v2:governed-all -- --from 2026-08-12 --to 2026-08-19 --max-calls 8'
      );
    }
  }
  const from = parseUtcDate(values.get('--from')!, '--from');
  const to = parseUtcDate(values.get('--to')!, '--to');
  if (to.getTime() < from.getTime()) throw new Error(`--to (${values.get('--to')}) precedes --from (${values.get('--from')}).`);
  const rawMaxCalls = values.get('--max-calls')!;
  if (!/^[1-9]\d*$/.test(rawMaxCalls)) throw new Error(`--max-calls expects a whole number of at least 1, received '${rawMaxCalls}'.`);
  return { from, to, maxCalls: Number(rawMaxCalls) };
}

/**
 * Selects every authorized edition and executes each through the Gate 4 boundary,
 * bounded by one operator window and a total call budget. Fail-closed, fail-fast.
 */
export async function runGovernedEditions(
  args: GovernedEditionsArguments,
  deps: GovernedEditionsDeps = {}
): Promise<GovernedEditionsResult> {
  const select = deps.select ?? (() => selectAuthorizedEditions());
  const run = deps.run ?? runGovernedSeason;
  const derive =
    deps.derive ??
    ((edition: AuthorizedEdition, requestedFrom: string, requestedTo: string) =>
      withConnection(INGESTION_ROLE, (tx) =>
        deriveUncoveredWindows(tx, {
          competitionEditionId: edition.competitionEditionId!,
          requestedFrom,
          requestedTo,
        })
      ));

  const editions = await select(); // fail-closed: a read error propagates (never [])
  if (editions.length === 0) {
    logger.info({ from: iso(args.from), to: iso(args.to) }, 'v2 governed-editions: 0 authorized editions — nothing ingested');
    return { selected: 0, outcomes: [], totalCallsSpent: 0, aggregate: 'NOOP' };
  }

  const requestedFrom = iso(args.from);
  const requestedTo = iso(args.to);

  const outcomes: EditionOutcome[] = [];
  let remaining = args.maxCalls; // GLOBAL budget: never reset per edition or per gap
  let totalCallsSpent = 0;
  let stop = false;

  for (const e of editions) {
    const base = {
      competitionProviderExternalId: e.competitionProviderExternalId,
      seasonProviderExternalId: e.seasonProviderExternalId,
      providerCode: e.providerCode,
    };

    if (stop) {
      outcomes.push({ ...base, status: 'NOT_ATTEMPTED', gaps: 0, callsSpent: 0 });
      continue;
    }
    if (remaining < 1) {
      outcomes.push({ ...base, status: 'SKIPPED_BUDGET', gaps: 0, callsSpent: 0, detail: 'total --max-calls budget exhausted' });
      continue;
    }

    // ── Gate 6C: derive the uncovered gaps for this edition over the operator
    //    window. An edition with no materialized reality row (competitionEditionId
    //    null) has no coverage yet, so the whole window is uncovered — no read.
    let gaps: DateInterval[];
    try {
      if (e.competitionEditionId) {
        const derivation = await derive(e, requestedFrom, requestedTo);
        if (derivation.noWork) {
          // Fully covered (or clipped away): successful no-work, ZERO provider calls.
          outcomes.push({ ...base, status: 'NO_WORK', gaps: 0, callsSpent: 0, detail: derivation.reason });
          continue;
        }
        gaps = [...derivation.uncovered];
      } else {
        gaps = [{ from: requestedFrom, to: iso(new Date(args.to.getTime() + 86_400_000)) }];
      }
    } catch (error) {
      // A derivation (DB) failure cannot be resolved into work; fail-closed, fail-fast.
      outcomes.push({ ...base, status: 'FAILED', gaps: 0, callsSpent: 0, detail: `derivation failed: ${error instanceof Error ? error.message : String(error)}` });
      stop = true;
      continue;
    }

    // ── Dispatch each uncovered gap through the existing Gate 5 → Gate 4 path,
    //    drawing down the ONE global budget. Fail-fast within and across editions.
    let editionSpent = 0;
    let editionStatus: EditionStatus = 'SUCCEEDED';
    let editionDetail: string | undefined;
    let dispatched = 0;

    for (const gap of gaps) {
      if (remaining < 1) {
        editionStatus = 'SKIPPED_BUDGET';
        editionDetail = `budget exhausted after ${dispatched}/${gaps.length} gap(s)`;
        break;
      }
      const window = gapToInclusiveWindow(gap);
      try {
        const result = await run({
          providerCode: e.providerCode,
          competitionProviderId: e.competitionProviderExternalId,
          seasonProviderId: e.seasonProviderExternalId,
          from: window.from,
          to: window.to,
          maxCalls: remaining, // hand each gap the remaining GLOBAL budget
        });
        const spent = result.report?.callsSpent ?? 0;
        remaining -= spent;
        totalCallsSpent += spent;
        editionSpent += spent;
        dispatched += 1;

        if (result.outcome !== 'AUTHORIZED') {
          editionStatus = 'REFUSED';
          editionDetail = `authorization outcome ${result.outcome}`;
          stop = true;
          break;
        }
        if (result.report?.failed) {
          editionStatus = 'FAILED';
          editionDetail = 'ingestSeason reported failed';
          stop = true;
          break;
        }
      } catch (error) {
        editionStatus = 'FAILED';
        editionDetail = error instanceof Error ? error.message : String(error);
        stop = true;
        break;
      }
    }

    outcomes.push({ ...base, status: editionStatus, gaps: gaps.length, callsSpent: editionSpent, detail: editionDetail });
  }

  const anyBad = outcomes.some((o) => o.status === 'FAILED' || o.status === 'REFUSED');
  return { selected: editions.length, outcomes, totalCallsSpent, aggregate: anyBad ? 'FAILED' : 'SUCCEEDED' };
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseGovernedEditionsArguments(argv);
    const result = await runGovernedEditions(args);

    /* eslint-disable no-console */
    console.log(
      `\nv2 governed-editions: ${result.selected} authorized edition(s), window ${iso(args.from)}..${iso(args.to)}, ` +
        `total budget ${args.maxCalls} call(s)`
    );
    for (const o of result.outcomes) {
      console.log(
        `  ${o.providerCode} / ${o.competitionProviderExternalId} / ${o.seasonProviderExternalId}  ` +
          `${o.status.padEnd(14)} gaps ${o.gaps} calls ${o.callsSpent}${o.detail ? `  (${o.detail})` : ''}`
      );
    }
    console.log(`  total calls spent ${result.totalCallsSpent}   aggregate ${result.aggregate}\n`);
    /* eslint-enable no-console */

    if (result.aggregate === 'FAILED') process.exitCode = 1;
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 governed-editions FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
