// ─────────────────────────────────────────────────────────────────────────────
// RECURRING MATCH ENRICHMENT — the orchestrator's bounded maintenance stage
//
// Keeps statistical coverage (lineups + team/player statistics) current for NEWLY
// completed fixtures, as one governed stage inside the production orchestrator. It
// builds NO new enrichment engine: it COMPOSES the historical bootstrap's governed
// pieces verbatim —
//   selectAuthorizedEditions      → the governed edition scope (never a manual window)
//   readBootstrapEnrichmentDemand → coverage-based demand (missing lineup and/or stats)
//   admitAndReserve               → durable, all-or-nothing budget admission
//   enrichMatchFixture            → the actual provider work (lineups + statistics)
//   reconcileReservation          → close the reservation against ACTUAL attempts
//   executeEnrichmentJob          → admit → enrich → reconcile, per-fixture isolated
//
// INCREMENTAL BY CONSTRUCTION. After the historical bootstrap drained the backlog,
// demand is only the fixtures that have completed since. `selectRecurringFixtures`
// additionally bounds it to a maintenance horizon (recent kickoffs only) and to the
// call budget, so a cron tick can never re-drain the historical corpus even if a new
// edition is authorized — that remains the operator-controlled `bootstrap:v2` job.
//
// SAFETY: it spends only through the governor (never bypassed); admission is durable
// and all-or-nothing, so a budget rejection enriches nothing and is reported as
// budgetBlocked (non-fatal) for retry next run. A single fixture's failure is isolated
// (HARD_STOP) and stays as missing demand, retried next run. It never widens scope,
// never mutates a sealed snapshot, and never assumes the 7,500/day key.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { selectAuthorizedEditions } from '../orchestration/governedSelection';
import { readBootstrapEnrichmentDemand } from './enrichmentPlanner';
import {
  executeEnrichmentJob, RESOLVE_PROVIDER_IDS_SQL,
  type PlannedFixture, type EnrichmentExecutionDeps,
} from './enrichmentJob';
import { admitAndReserve, reconcileReservation } from './reservationStore';
import { enrichMatchFixture, INGESTION_ROLE } from '../pipeline';
import { PROVIDER_CODE } from '../provider/config';
import { withRun, withConnection } from '../../db/tx';

/** enrichMatchFixture fetches BOTH match_lineups and match_statistics, so a fixture ALWAYS
 *  costs 2 provider calls even when only one endpoint is missing. Reserving at 2×fixtures is
 *  therefore the ACCURATE estimate (never an under-reserve), reconciled to the measured spend. */
const CALLS_PER_FIXTURE = 2;
/** Only fixtures whose kickoff is within this many days enter the recurring path; anything
 *  older is the historical corpus and belongs to the operator-controlled bootstrap. */
export const RECURRING_ENRICHMENT_HORIZON_DAYS = 30;
const DAY_MS = 86_400_000;

export interface RecurringEnrichmentResult {
  readonly selected: number;      // fixtures chosen for this run (post horizon + budget cap)
  readonly callsSpent: number;    // measured provider attempts (reconciled)
  readonly succeeded: number;
  readonly failed: number;        // per-fixture HARD_STOPs (isolated; remain as demand)
  readonly budgetBlocked: boolean;
}

export interface RecurringEnrichmentDeps extends EnrichmentExecutionDeps {
  /** Load the governed, provider-resolved recurring selection (authorized editions →
   *  incremental demand → horizon + budget cap). Injected so the stage is DB-free testable. */
  readonly loadSelection: (asOf: Date, maxCalls: number) => Promise<PlannedFixture[]>;
}

/** Keep only fixtures within the maintenance horizon, freshest first, capped to the call
 *  budget. Pure. Incremental by construction — the horizon guarantees the historical corpus
 *  can never re-enter, and the cap bounds a single run. */
export function selectRecurringFixtures(
  fixtures: readonly PlannedFixture[],
  opts: { asOf: Date; maxCalls: number; horizonDays?: number },
): PlannedFixture[] {
  const horizonMs = opts.asOf.getTime() - (opts.horizonDays ?? RECURRING_ENRICHMENT_HORIZON_DAYS) * DAY_MS;
  const maxFixtures = Math.max(0, Math.floor(opts.maxCalls / CALLS_PER_FIXTURE));
  return fixtures
    .filter((f) => {
      const t = new Date(f.kickoffAt).getTime();
      return Number.isFinite(t) && t >= horizonMs; // within horizon (and a valid kickoff)
    })
    .slice()
    .sort((a, b) => (a.kickoffAt < b.kickoffAt ? 1 : a.kickoffAt > b.kickoffAt ? -1 : 0)) // freshest first
    .slice(0, maxFixtures);
}

/** Load the governed recurring selection (read-only): authorized editions → coverage demand →
 *  provider-id resolution → horizon + budget cap. Makes no provider call. */
export async function loadRecurringSelection(asOf: Date, maxCalls: number): Promise<PlannedFixture[]> {
  const editions = await selectAuthorizedEditions();
  const editionIds = editions.map((e) => e.competitionEditionId).filter((id): id is string => id !== null);
  if (editionIds.length === 0) return [];
  return withConnection(INGESTION_ROLE, async (tx: PoolClient) => {
    const demand = await readBootstrapEnrichmentDemand(tx, editionIds, { asOf });
    const ids = demand.fixtures.map((f) => f.fixtureId);
    const providerById = new Map<string, string>();
    if (ids.length > 0) {
      const res = await tx.query<{ fixture_id: string; provider_id: string }>(RESOLVE_PROVIDER_IDS_SQL, [ids, PROVIDER_CODE]);
      for (const r of res.rows) if (r.provider_id) providerById.set(r.fixture_id, r.provider_id);
    }
    const planned: PlannedFixture[] = demand.fixtures
      .filter((f) => providerById.has(f.fixtureId))
      .map((f) => ({
        fixtureId: f.fixtureId, fixturePartitionOn: f.fixturePartitionOn, fixtureProviderId: providerById.get(f.fixtureId)!,
        kickoffAt: f.kickoffAt, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId,
      }));
    return selectRecurringFixtures(planned, { asOf, maxCalls });
  });
}

/** Real deps: governed selection + durable admission + real enrichment + reconcile-to-actual. */
function productionDeps(): RecurringEnrichmentDeps {
  return {
    loadSelection: loadRecurringSelection,
    admit: (jobId, estimatedCalls) =>
      withRun(INGESTION_ROLE, 'v2.recurring.admit', (tx: PoolClient) => admitAndReserve(tx, jobId, estimatedCalls)),
    enrichFixture: async (fixtureProviderId) => {
      const r = await enrichMatchFixture({ fixtureProviderId });
      return { fixtureProviderId, providerCalls: r.providerCalls, runStatus: r.runStatus, hardStopReason: r.hardStopReason };
    },
    reconcile: (jobId, actualAttempts) =>
      withRun(INGESTION_ROLE, 'v2.recurring.reconcile', (tx: PoolClient) => reconcileReservation(tx, jobId, actualAttempts)),
  };
}

/** Run one bounded recurring-enrichment pass. Governed end to end: it admits a durable,
 *  all-or-nothing reservation for the selected fixtures, enriches each (per-fixture isolated),
 *  and reconciles to the measured spend. Empty demand → a clean no-op. A budget rejection
 *  enriches nothing and returns budgetBlocked (non-fatal). Deterministic given its deps. */
export async function runRecurringEnrichment(
  opts: { maxCalls: number; asOf?: Date },
  deps: RecurringEnrichmentDeps = productionDeps(),
): Promise<RecurringEnrichmentResult> {
  const asOf = opts.asOf ?? new Date();
  const selected = await deps.loadSelection(asOf, opts.maxCalls);
  if (selected.length === 0) {
    return { selected: 0, callsSpent: 0, succeeded: 0, failed: 0, budgetBlocked: false };
  }
  // Unique per run → a fresh reservation each tick; overlap is already prevented by the
  // orchestrator lock, so a per-invocation timestamp is a safe idempotency key.
  const jobId = `recurring:${asOf.toISOString()}`;
  const res = await executeEnrichmentJob(
    { jobId, estimatedCalls: selected.length * CALLS_PER_FIXTURE, selected },
    deps, { confirmRealEnrichment: true },
  );
  return {
    selected: selected.length,
    callsSpent: res.actualCalls,
    succeeded: res.succeeded,
    failed: res.hardStopped,
    budgetBlocked: !res.admitted,
  };
}
