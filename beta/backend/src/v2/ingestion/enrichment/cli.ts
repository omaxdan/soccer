// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED BOOTSTRAP CLI — npm run bootstrap:v2
//
//   npm run bootstrap:v2 -- [--dry-run] [--confirm] [--max-calls N] [--batch-size N]
//
// The one governed driver for the historical provider enrichment. It COMPOSES the
// existing pieces and builds no new enrichment engine:
//   selectAuthorizedEditions      → the governed edition scope (never a manual window)
//   readBootstrapEnrichmentDemand → lineup-AND-stat aware demand + fixture selection
//   (resolve provider ids)        → RESOLVE_PROVIDER_IDS_SQL
//   admitAndReserve               → durable, all-or-nothing budget admission (per batch)
//   executeEnrichmentJob          → admit → enrich → reconcile, per batch
//   enrichMatchFixture            → the actual provider work (lineups + statistics)
//   reconcileReservation          → close the reservation against ACTUAL attempts
//
// SAFETY: dry-run (the default) performs ZERO provider calls and only reports demand +
// admission preview. Real spend requires an EXPLICIT --confirm. Every batch is admitted
// through the governor (never bypassed); admission is all-or-nothing and durable, so a
// budget rejection stops the run rather than partial-spending. It never assumes the
// 7,500/day key, never touches the recurring orchestrator, never mutates a sealed
// snapshot, and never runs a historical WINDOW (scope is the authorized editions only).
// ─────────────────────────────────────────────────────────────────────────────

// MUST be first — loads env before anything reads process.env
import '../../config/env';

import type { PoolClient } from 'pg';
import { selectAuthorizedEditions } from '../orchestration/governedSelection';
import { readBootstrapEnrichmentDemand } from './enrichmentPlanner';
import {
  executeEnrichmentJob, RESOLVE_PROVIDER_IDS_SQL,
  type PlannedFixture, type EnrichmentExecutionDeps, type EnrichmentExecutionResult,
} from './enrichmentJob';
import { admitAndReserve, reconcileReservation } from './reservationStore';
import { enrichMatchFixture, INGESTION_ROLE } from '../pipeline';
import { PROVIDER_CODE } from '../provider/config';
import { withRun, withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { logger } from '../../../utils/logger';

/** enrichMatchFixture fetches BOTH match_lineups and match_statistics → 2 provider calls
 *  per fixture, so reservations are sized at 2×fixtures (never under-reserve). */
export const CALLS_PER_FIXTURE = 2;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_CALLS = 150; // conservative; NEVER assumes the 7,500/day key

export interface BootstrapArgs {
  readonly dryRun: boolean;
  readonly confirm: boolean;
  readonly maxCalls: number;
  readonly batchSize: number;
  readonly asOf: Date;
  /**
   * Governed SINGLE-FIXTURE mode (verification only). When set, the run enriches
   * exactly this provider match id through the SAME governed path — admit →
   * enrich → reconcile — and skips ONLY the demand filter, so an already-covered
   * fixture can be re-run (the idempotency pass). It never bypasses the governor,
   * the reservation, the ingestion role, or the idempotent writer.
   */
  readonly fixtureProviderId?: string;
}

export function parseBootstrapArgs(argv: readonly string[], now: Date = new Date()): BootstrapArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const int = (v: string | undefined, fallback: number, flag: string): number => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer`);
    return n;
  };
  const confirm = argv.includes('--confirm');
  const dryRun = argv.includes('--dry-run') || !confirm; // default is dry-run; --confirm opts into spend
  const fixtureProviderId = get('--fixture-provider-id') ?? get('--fixture');
  return {
    dryRun, confirm,
    maxCalls: int(get('--max-calls'), DEFAULT_MAX_CALLS, '--max-calls'),
    batchSize: int(get('--batch-size'), DEFAULT_BATCH_SIZE, '--batch-size'),
    asOf: now,
    ...(fixtureProviderId ? { fixtureProviderId } : {}),
  };
}

/** Cap the selection to the call budget (2 calls/fixture) and split into deterministic
 *  batches. Pure. */
export function splitIntoBatches(
  selected: readonly PlannedFixture[], batchSize: number, maxCalls: number,
): PlannedFixture[][] {
  const maxFixtures = Math.floor(maxCalls / CALLS_PER_FIXTURE);
  const capped = selected.slice(0, Math.max(0, maxFixtures));
  const batches: PlannedFixture[][] = [];
  for (let i = 0; i < capped.length; i += batchSize) batches.push(capped.slice(i, i + batchSize));
  return batches;
}

export interface BootstrapReport {
  readonly dryRun: boolean;
  readonly totalFixtures: number;
  readonly totalEstimatedCalls: number;
  readonly batches: number;
  readonly admittedCalls: number;
  readonly actualCalls: number;
  readonly stoppedEarly: boolean;
  readonly executed: readonly EnrichmentExecutionResult[];
}

/** Orchestrate the bootstrap over deterministic batches. Dry-run performs ZERO provider
 *  calls (reports only). With confirm, each batch is admitted+executed via the injected
 *  deps; a budget rejection stops the run (no partial spend beyond admitted batches). */
export async function executeBootstrap(
  selected: readonly PlannedFixture[],
  deps: EnrichmentExecutionDeps,
  opts: { confirm: boolean; batchSize: number; maxCalls: number; runId: string; log?: (r: EnrichmentExecutionResult) => void },
): Promise<BootstrapReport> {
  const batches = splitIntoBatches(selected, opts.batchSize, opts.maxCalls);
  const totalFixtures = batches.reduce((s, b) => s + b.length, 0);
  const totalEstimatedCalls = totalFixtures * CALLS_PER_FIXTURE;
  if (!opts.confirm) {
    // DRY RUN: no admission, no provider call, no reservation — pure preview.
    return { dryRun: true, totalFixtures, totalEstimatedCalls, batches: batches.length, admittedCalls: 0, actualCalls: 0, stoppedEarly: false, executed: [] };
  }
  const executed: EnrichmentExecutionResult[] = [];
  let admittedCalls = 0, actualCalls = 0, stoppedEarly = false;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const res = await executeEnrichmentJob(
      { jobId: `bootstrap:${opts.runId}:b${i}`, estimatedCalls: batch.length * CALLS_PER_FIXTURE, selected: batch },
      deps, { confirmRealEnrichment: true },
    );
    executed.push(res);
    opts.log?.(res);
    if (!res.admitted) { stoppedEarly = true; break; } // budget rejected → stop, no partial spend
    admittedCalls += res.estimatedCalls;
    actualCalls += res.actualCalls;
  }
  return { dryRun: false, totalFixtures, totalEstimatedCalls, batches: batches.length, admittedCalls, actualCalls, stoppedEarly, executed };
}

/** Load the governed bootstrap selection (read-only): authorized editions → lineup-aware
 *  demand → provider-id resolution → PlannedFixture[]. Makes no provider call. */
export async function loadBootstrapSelection(asOf: Date, batchSize: number): Promise<{ editionIds: string[]; totalMissing: number; selected: PlannedFixture[] }> {
  const editions = await selectAuthorizedEditions();
  const editionIds = editions.map((e) => e.competitionEditionId).filter((id): id is string => id !== null);
  if (editionIds.length === 0) return { editionIds: [], totalMissing: 0, selected: [] };
  return withConnection(INGESTION_ROLE, async (tx: PoolClient) => {
    const demand = await readBootstrapEnrichmentDemand(tx, editionIds, { asOf, batchSize });
    const ids = demand.fixtures.map((f) => f.fixtureId);
    const providerById = new Map<string, string>();
    if (ids.length > 0) {
      const res = await tx.query<{ fixture_id: string; provider_id: string }>(RESOLVE_PROVIDER_IDS_SQL, [ids, PROVIDER_CODE]);
      for (const r of res.rows) if (r.provider_id) providerById.set(r.fixture_id, r.provider_id);
    }
    const selected: PlannedFixture[] = demand.fixtures
      .filter((f) => providerById.has(f.fixtureId))
      .map((f) => ({
        fixtureId: f.fixtureId, fixturePartitionOn: f.fixturePartitionOn, fixtureProviderId: providerById.get(f.fixtureId)!,
        kickoffAt: f.kickoffAt, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId,
      }));
    return { editionIds, totalMissing: demand.fixtures.length, selected };
  });
}

/** Resolve ONE fixture by its provider match id (read-only). Returns a single-element
 *  selection for the governed single-fixture verification mode, or an empty selection when
 *  the provider id addresses no fixture in this database. Makes no provider call. */
export async function loadSingleFixtureSelection(fixtureProviderId: string): Promise<PlannedFixture[]> {
  return withConnection(INGESTION_ROLE, async (tx: PoolClient) => {
    const res = await tx.query<{
      fixture_id: string; fixture_partition_on: string; provider_id: string;
      kickoff_at: Date | string; home_team_id: string; away_team_id: string;
    }>(
      `SELECT id::text AS fixture_id, fixture_partition_on::text AS fixture_partition_on,
              provider_external_id::text AS provider_id, scheduled_kickoff_at AS kickoff_at,
              home_team_id::text AS home_team_id, away_team_id::text AS away_team_id
         FROM football.fixture
        WHERE provider_code = $1::text AND provider_external_id = $2::text`,
      [PROVIDER_CODE, fixtureProviderId],
    );
    return res.rows.map((r) => ({
      fixtureId: r.fixture_id, fixturePartitionOn: r.fixture_partition_on, fixtureProviderId: r.provider_id,
      kickoffAt: r.kickoff_at instanceof Date ? r.kickoff_at.toISOString() : String(r.kickoff_at),
      homeTeamId: r.home_team_id, awayTeamId: r.away_team_id,
    }));
  });
}

/** Real deps: durable admission + real enrichment + reconcile-to-actual. Provider work only. */
function productionDeps(): EnrichmentExecutionDeps {
  return {
    admit: (jobId, estimatedCalls) =>
      withRun(INGESTION_ROLE, 'v2.bootstrap.admit', (tx: PoolClient) => admitAndReserve(tx, jobId, estimatedCalls)),
    enrichFixture: async (fixtureProviderId) => {
      const r = await enrichMatchFixture({ fixtureProviderId });
      return { fixtureProviderId, providerCalls: r.providerCalls, runStatus: r.runStatus, hardStopReason: r.hardStopReason };
    },
    reconcile: (jobId, actualAttempts) =>
      withRun(INGESTION_ROLE, 'v2.bootstrap.reconcile', (tx: PoolClient) => reconcileReservation(tx, jobId, actualAttempts)),
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseBootstrapArgs(argv);
  const runId = new Date().toISOString();

  // ── Governed SINGLE-FIXTURE mode (verification only) ──────────────────────────
  // Same admit → enrich → reconcile path; skips ONLY the demand filter so a covered
  // fixture can be re-run for the idempotency pass. batch-size is forced to 1.
  if (args.fixtureProviderId) {
    const selected = await loadSingleFixtureSelection(args.fixtureProviderId);
    logger.info({ fixtureProviderId: args.fixtureProviderId, resolved: selected.length, dryRun: args.dryRun },
      'v2 bootstrap: SINGLE-FIXTURE mode (governed; demand filter skipped)');
    if (selected.length === 0) {
      logger.error({ fixtureProviderId: args.fixtureProviderId }, 'v2 bootstrap: no fixture addresses that provider id');
      return 1;
    }
    const report = await executeBootstrap(selected, productionDeps(), {
      confirm: args.confirm, batchSize: 1, maxCalls: CALLS_PER_FIXTURE, runId,
      log: (r) => logger.info({ jobId: r.jobId, admitted: r.admitted, actualCalls: r.actualCalls, succeeded: r.succeeded, hardStopped: r.hardStopped, overrun: r.overrun }, 'v2 bootstrap: single-fixture batch'),
    });
    logger.info({ report }, args.confirm ? 'v2 bootstrap: single-fixture run finished' : 'v2 bootstrap: single-fixture DRY RUN (no provider call) — pass --confirm to spend');
    return report.stoppedEarly ? 1 : 0;
  }

  const { editionIds, totalMissing, selected } = await loadBootstrapSelection(args.asOf, args.batchSize);
  logger.info({ editionIds, totalMissing, resolved: selected.length, dryRun: args.dryRun, maxCalls: args.maxCalls, batchSize: args.batchSize },
    'v2 bootstrap: governed demand loaded');

  if (!args.confirm) {
    const report = await executeBootstrap(selected, productionDeps(), { confirm: false, batchSize: args.batchSize, maxCalls: args.maxCalls, runId });
    logger.info({ report }, 'v2 bootstrap: DRY RUN (no provider calls, no reservation, no writes) — pass --confirm to spend');
    return 0;
  }

  const report = await executeBootstrap(selected, productionDeps(), {
    confirm: true, batchSize: args.batchSize, maxCalls: args.maxCalls, runId,
    log: (r) => logger.info({ jobId: r.jobId, admitted: r.admitted, actualCalls: r.actualCalls, succeeded: r.succeeded, hardStopped: r.hardStopped, overrun: r.overrun }, 'v2 bootstrap: batch'),
  });
  logger.info({ report }, 'v2 bootstrap: run finished');
  return report.stoppedEarly ? 1 : 0;
}

if (require.main === module) {
  main()
    .then(async (code) => { await closeAllPools(); process.exit(code); })
    .catch(async (err) => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'v2 bootstrap: fatal');
      await closeAllPools();
      process.exit(1);
    });
}
