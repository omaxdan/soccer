// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED ENRICHMENT JOB — dry-run planning + admitted execution
//
// Composes the demand planner (enrichmentPlanner) and the durable reservation
// governor (reservationStore) into a single job with two clearly separated phases:
//
//   1. planEnrichmentJob(tx, …)  — READ-ONLY. Reads demand, selects the fixtures to
//      enrich (targeted-to-floor or full backfill), resolves their provider match ids,
//      and previews the budget admission. It NEVER calls the provider, NEVER writes team
//      statistics, and NEVER takes a reservation. Safe to run anywhere, including here.
//
//   2. executeEnrichmentJob(plan, deps, …) — the ONLY path that can spend quota, and
//      only when the caller passes confirmRealEnrichment: true. Every side-effecting
//      capability is INJECTED:
//        • deps.admit(jobId, estimatedCalls)  → a durable admission (admitAndReserve in a
//          caller-owned transaction). All-or-nothing; a rejection spends nothing.
//        • deps.enrichFixture(providerId)     → the real per-fixture provider work
//          (enrichMatchFixture), which owns its own transaction and provider calls.
//        • deps.reconcile(jobId, actualCalls) → close the reservation against ACTUAL
//          attempts (reconcileReservation in a caller-owned transaction).
//      This module holds no long-lived transaction across provider calls, spends nothing
//      on its own, and reconciles to measured usage — the estimate is never the truth.
//
// ONE fixture = ONE `match_statistics` call = BOTH team sides. Selection is deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE, dailyQuota, type ProviderConfig } from '../provider/config';
import {
  readEditionEnrichmentDemand, selectTargetedFixtures,
  ATTRIBUTE_FLOOR, DEFAULT_COVERAGE_KEY,
  type EnrichmentDemand, type MissingFixture,
} from './enrichmentPlanner';
import {
  computeBudget, admit, reconcile, readActualUsedToday, retryReserveFromEnv,
  type Budget, type AdmissionDecision,
} from './budgetGovernor';
import { ACTIVE_COMMITTED_SQL, type ReservationDecision } from './reservationStore';

export type EnrichmentMode = 'TARGETED' | 'FULL_BACKFILL';

export interface PlannedFixture {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly fixtureProviderId: string; // == fixture.provider_external_id (what enrichMatchFixture needs)
  readonly kickoffAt: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

export interface EnrichmentJobPlan {
  readonly jobId: string;
  readonly editionId: string;
  readonly asOf: string;
  readonly mode: EnrichmentMode;
  readonly coverageKey: string;
  readonly attributeFloor: number;
  readonly selected: readonly PlannedFixture[];
  readonly estimatedCalls: number;   // == selected.length (1 fixture = 1 call, both sides)
  readonly unresolvedProviderIds: readonly string[]; // selected fixtures with no provider id (never enriched)
  readonly budget: Budget;           // measured usage + active committed + configured reserve
  readonly admissionPreview: AdmissionDecision; // WOULD it be admitted now? (no reservation taken)
  readonly demand: EnrichmentDemand;
}

export interface FixtureEnrichmentOutcome {
  readonly fixtureProviderId: string;
  readonly providerCalls: number;                    // ACTUAL calls this fixture made
  readonly runStatus: 'SUCCEEDED' | 'HARD_STOP';
  readonly hardStopReason?: string | null;
}

export interface EnrichmentExecutionDeps {
  /** Durable admission inside a caller-owned transaction (wire to admitAndReserve). */
  readonly admit: (jobId: string, estimatedCalls: number) => Promise<ReservationDecision>;
  /** Real per-fixture provider work (wire to enrichMatchFixture). Owns its own tx + calls. */
  readonly enrichFixture: (fixtureProviderId: string) => Promise<FixtureEnrichmentOutcome>;
  /** Close the reservation against ACTUAL attempts (wire to reconcileReservation). */
  readonly reconcile: (jobId: string, actualAttempts: number) => Promise<boolean>;
}

export interface EnrichmentExecutionResult {
  readonly jobId: string;
  readonly admitted: boolean;
  readonly admission: ReservationDecision;
  readonly attempted: number;        // fixtures the enricher was invoked for
  readonly succeeded: number;
  readonly hardStopped: number;
  readonly estimatedCalls: number;
  readonly actualCalls: number;      // Σ providerCalls across attempted fixtures (measured)
  readonly reconciled: boolean;
  readonly overrun: boolean;         // actual exceeded the estimate — surfaced, never hidden
  readonly overrunBy: number;
  readonly outcomes: readonly FixtureEnrichmentOutcome[];
}

export interface PlanOptions {
  readonly asOf?: Date;
  readonly mode?: EnrichmentMode;
  readonly coverageKey?: string;
  readonly attributeFloor?: number;
  readonly retryReserve?: number;
  readonly providerCode?: string;
  readonly config?: ProviderConfig;
  readonly jobId?: string;           // idempotency key; defaults to a deterministic edition+asOf id
  readonly maxCalls?: number;        // hard cap on selected fixtures (bounded batch); 0/undefined = uncapped
}

export interface ExecuteOptions {
  /** Real enrichment is refused unless this is explicitly true — the visible admission decision. */
  readonly confirmRealEnrichment?: boolean;
}

// ── provider-id resolution (read-only) ──────────────────────────────────────────

/** Resolve internal fixture ids to their provider match ids. Read-only. */
export const RESOLVE_PROVIDER_IDS_SQL = `
  SELECT id::text AS fixture_id, provider_external_id::text AS provider_id
    FROM football.fixture
   WHERE id = ANY($1::bigint[]) AND provider_code = $2::text
`;

/** Deterministic default job id so a re-plan of the same edition/day/mode is idempotent. */
export function defaultJobId(editionId: string, asOf: Date, mode: EnrichmentMode): string {
  return `enrich:${mode}:ed${editionId}:${asOf.toISOString().slice(0, 10)}`;
}

// ── phase 1: dry-run plan (READ-ONLY — no calls, no writes, no reservation) ──────

export async function planEnrichmentJob(
  tx: PoolClient, editionId: string, options: PlanOptions = {},
): Promise<EnrichmentJobPlan> {
  const asOf = options.asOf ?? new Date();
  const mode: EnrichmentMode = options.mode ?? 'TARGETED';
  const coverageKey = options.coverageKey ?? DEFAULT_COVERAGE_KEY;
  const attributeFloor = options.attributeFloor ?? ATTRIBUTE_FLOOR;
  const providerCode = options.providerCode ?? PROVIDER_CODE;
  const retryReserve = options.retryReserve ?? retryReserveFromEnv();
  const jobId = options.jobId ?? defaultJobId(editionId, asOf, mode);

  const demand = await readEditionEnrichmentDemand(tx, editionId, { asOf, coverageKey, attributeFloor });

  // Choose the fixtures to enrich. Both modes count 1 call per fixture (both team sides).
  let chosen: readonly MissingFixture[];
  if (mode === 'FULL_BACKFILL') {
    chosen = demand.missing;
  } else {
    const coveredByTeam = new Map(demand.teams.map((t) => [t.teamId, t.covered]));
    const sel = selectTargetedFixtures(demand.missing, coveredByTeam, attributeFloor);
    const wanted = new Set(sel.selectedFixtureIds);
    // Preserve the planner's deterministic (kickoff, id) order for the selected subset.
    chosen = demand.missing.filter((m) => wanted.has(m.fixtureId));
  }

  // Bounded batch: cap the number of fixtures (Phase 8 controlled enrichment is small).
  const cap = options.maxCalls && options.maxCalls > 0 ? options.maxCalls : chosen.length;
  const capped = chosen.slice(0, cap);

  // Resolve provider match ids for the capped selection.
  const providerById = new Map<string, string>();
  if (capped.length > 0) {
    const res = await tx.query<{ fixture_id: string; provider_id: string }>(
      RESOLVE_PROVIDER_IDS_SQL, [capped.map((f) => f.fixtureId), providerCode],
    );
    for (const r of res.rows) if (r.provider_id) providerById.set(r.fixture_id, r.provider_id);
  }

  const selected: PlannedFixture[] = [];
  const unresolved: string[] = [];
  for (const f of capped) {
    const providerId = providerById.get(f.fixtureId);
    if (!providerId) { unresolved.push(f.fixtureId); continue; } // never enrich a fixture we can't address
    selected.push({
      fixtureId: f.fixtureId, fixturePartitionOn: f.fixturePartitionOn, fixtureProviderId: providerId,
      kickoffAt: f.kickoffAt, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId,
    });
  }

  const estimatedCalls = selected.length;

  // Budget preview: measured usage + active durable committed + configured reserve. No lock,
  // no write — this is only a preview; execution re-checks under the advisory lock via deps.admit.
  const committedRes = await tx.query<{ committed: string }>(ACTIVE_COMMITTED_SQL, [providerCode, asOf.toISOString().slice(0, 10), asOf]);
  const committed = Number(committedRes.rows[0]?.committed ?? 0);
  const actualUsedToday = await readActualUsedToday(tx, asOf, providerCode);
  const budget = computeBudget({ dailyQuota: dailyQuota(options.config), actualUsedToday, committed, retryReserve });
  const admissionPreview = admit(estimatedCalls, budget);

  return {
    jobId, editionId, asOf: asOf.toISOString(), mode, coverageKey, attributeFloor,
    selected, estimatedCalls, unresolvedProviderIds: unresolved,
    budget, admissionPreview, demand,
  };
}

// ── phase 2: admitted execution (INJECTED deps; spends only on explicit confirmation) ──

/** The minimum an admitted job needs to execute: an idempotency key, the exact number of
 *  provider calls to reserve, and the fixtures (by provider id) to enrich. A full
 *  EnrichmentJobPlan satisfies this, and so does a leaner job assembled from a different
 *  demand reader (e.g. the lineup-aware bootstrap demand) — so the executor is reused
 *  without coupling to one planner's shape. */
export interface ExecutableEnrichmentJob {
  readonly jobId: string;
  readonly estimatedCalls: number;
  readonly selected: readonly PlannedFixture[];
}

/** Execute an admitted enrichment plan. Refuses to spend unless confirmRealEnrichment is true.
 *  Admission is durable + all-or-nothing (deps.admit); a rejection performs ZERO provider calls.
 *  On admission, each selected fixture is enriched via the injected enricher (which owns its own
 *  transaction and provider calls), actual attempts are tallied, and the reservation is reconciled
 *  to that MEASURED total — the estimate is never treated as the spend. */
export async function executeEnrichmentJob(
  plan: ExecutableEnrichmentJob, deps: EnrichmentExecutionDeps, options: ExecuteOptions = {},
): Promise<EnrichmentExecutionResult> {
  if (options.confirmRealEnrichment !== true) {
    throw new Error(
      'executeEnrichmentJob refused: real enrichment spends provider quota and requires an explicit ' +
      'admission decision (options.confirmRealEnrichment === true). Use planEnrichmentJob for a dry run.',
    );
  }

  const admission = await deps.admit(plan.jobId, plan.estimatedCalls);
  if (!admission.admitted) {
    // Budget rejected the job: spend nothing, enrich nothing, reconcile nothing.
    return {
      jobId: plan.jobId, admitted: false, admission, attempted: 0, succeeded: 0, hardStopped: 0,
      estimatedCalls: plan.estimatedCalls, actualCalls: 0, reconciled: false,
      overrun: false, overrunBy: 0, outcomes: [],
    };
  }

  const outcomes: FixtureEnrichmentOutcome[] = [];
  let actualCalls = 0;
  let succeeded = 0;
  let hardStopped = 0;
  for (const fixture of plan.selected) {
    const outcome = await deps.enrichFixture(fixture.fixtureProviderId);
    outcomes.push(outcome);
    actualCalls += outcome.providerCalls;
    if (outcome.runStatus === 'SUCCEEDED') succeeded += 1; else hardStopped += 1;
  }

  const rec = reconcile(plan.estimatedCalls, actualCalls);
  const reconciled = await deps.reconcile(plan.jobId, actualCalls);

  return {
    jobId: plan.jobId, admitted: true, admission, attempted: plan.selected.length,
    succeeded, hardStopped, estimatedCalls: plan.estimatedCalls, actualCalls, reconciled,
    overrun: rec.overrun, overrunBy: rec.overrunBy, outcomes,
  };
}
