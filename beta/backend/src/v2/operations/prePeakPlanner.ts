// ─────────────────────────────────────────────────────────────────────────────
// DEMAND-AWARE PRE-PEAK PLANNING READ MODEL (Task 5)
//
// A READ-ONLY decision-support layer on top of the Task-4 budget governor. It
// answers, before a high-demand window: "given current evidence, can the required
// edition sweeps be executed — ALLOW / DEFER / BLOCK / UNKNOWN — and which
// editions/windows are the reason?" It is NOT a scheduler, queue, or ingestion
// path, it holds no state, and it reuses assessBudget rather than duplicating any
// decision logic — so every Task-4 fail-closed guarantee is inherited, not
// re-implemented.
//
// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE CAN ONLY ZERO DEMAND, NEVER SCALE IT — AND WHY.
//
// operations.edition_ingestion_coverage attests which date windows were committed
// per edition (complete=true iff the walk exhausted the window). But the season
// pager has NO checkpoint/resume — a governed run re-walks from page 0 — and the
// only MEASURED provider cost is a WHOLE-SEASON sweep. There is no measured cost
// for a partial-window sweep. So this planner uses coverage strictly to decide
// whether a sweep is needed at all:
//   COVERED (complete) and no forced refresh -> demand 0 (already covered)
//   UNCOVERED or forced refresh              -> the MEASURED full sweep, or UNKNOWN
//   PARTIAL                                  -> UNKNOWN (no measured partial cost,
//                                               no resume — remaining demand cannot
//                                               be safely established; NOT invented)
// It never fabricates a fractional/partial call cost and never counts fixtures as
// calls. Unknown stays unknown.
// ─────────────────────────────────────────────────────────────────────────────

import {
  assessBudget,
  estimateEditionSweep,
  type BudgetAssessment,
  type Capacity,
  type EditionDemand,
  type Priority,
  type RetryReserve,
} from './budget';

const MS_PER_DAY = 86_400_000;

export type CoverageStatus = 'COVERED' | 'PARTIAL' | 'UNCOVERED';

/** A committed coverage period, half-open [start, endExclusive) — from a
 *  `complete=true` edition_ingestion_coverage row. */
export interface CoveragePeriod {
  readonly start: Date;
  readonly endExclusive: Date;
}

/**
 * Classifies how an inclusive [reqFrom .. reqTo] window is covered by the union of
 * `complete=true` coverage periods. Only complete periods count — a budget-
 * truncated (complete=false) attestation never grants coverage. Pure.
 *
 * The request is treated half-open [reqFrom, reqTo + 1 day) to match the ledger's
 * daterange convention. COVERED only when the union spans the whole request with
 * no internal gap; any overlap short of that is PARTIAL; no overlap is UNCOVERED.
 */
export function classifyWindowCoverage(
  reqFrom: Date,
  reqTo: Date,
  completePeriods: readonly CoveragePeriod[]
): CoverageStatus {
  const reqStart = reqFrom.getTime();
  const reqEnd = reqTo.getTime() + MS_PER_DAY; // inclusive day -> exclusive bound

  const clipped = completePeriods
    .map((p) => ({ s: Math.max(p.start.getTime(), reqStart), e: Math.min(p.endExclusive.getTime(), reqEnd) }))
    .filter((p) => p.s < p.e)
    .sort((a, b) => a.s - b.s);

  if (clipped.length === 0) return 'UNCOVERED';

  // Merge overlapping/adjacent intervals within the request.
  const merged: Array<{ s: number; e: number }> = [];
  for (const iv of clipped) {
    const last = merged[merged.length - 1];
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
    else merged.push({ ...iv });
  }

  if (merged.length === 1 && merged[0].s <= reqStart && merged[0].e >= reqEnd) return 'COVERED';
  return 'PARTIAL';
}

/** One edition the planner is asked to consider for the window. */
export interface EditionRequest {
  readonly editionLabel: string;
  /** Provider tournament id — the key MEASURED sweep costs are held under. */
  readonly tournamentId: string;
  /** Coverage of the requested window for this edition (from classifyWindowCoverage). */
  readonly coverageStatus: CoverageStatus;
}

export type EditionDemandBasis =
  | 'ALREADY_COVERED' // complete coverage, no refresh -> 0 calls
  | 'FULL_SWEEP_MEASURED' // uncovered/refresh, measured cost
  | 'FULL_SWEEP_UNKNOWN_COST' // uncovered/refresh, cost never measured (e.g. Brazil)
  | 'PARTIAL_UNKNOWN'; // partial coverage, remaining demand not safely establishable

export interface EditionPlanLine {
  readonly editionLabel: string;
  readonly tournamentId: string;
  readonly coverageStatus: CoverageStatus;
  readonly basis: EditionDemandBasis;
  readonly demand: EditionDemand;
  readonly note: string;
}

export interface PrePeakPlanInput {
  readonly provider: string;
  readonly windowLabel: string;
  readonly window: { readonly from: Date; readonly to: Date };
  readonly priority: Priority;
  readonly editions: readonly EditionRequest[];
  /** Force a fresh sweep even where the window is already fully covered. */
  readonly forceRefresh?: boolean;
  readonly capacity: Capacity;
  readonly consumed: number;
  readonly retryReserve: RetryReserve;
  readonly latestQuotaRemaining: number | null;
  /** Passed through to assessBudget; only the Task-4 P1 path honours it. */
  readonly emergencyOverride?: boolean;
}

export interface PrePeakPlan {
  readonly provider: string;
  readonly windowLabel: string;
  readonly window: { readonly from: Date; readonly to: Date };
  readonly priority: Priority;
  readonly editions: readonly EditionPlanLine[];
  /** The governor's verdict over the aggregated demand — inherits all Task-4 rules. */
  readonly assessment: BudgetAssessment;
  /** Labels of editions whose demand is UNKNOWN (why the aggregate may be UNKNOWN). */
  readonly unknownDemandEditions: readonly string[];
}

/** Derives one edition's demand from its coverage status and measured evidence. */
function editionLine(edition: EditionRequest, forceRefresh: boolean): EditionPlanLine {
  const measured = estimateEditionSweep(edition.tournamentId, edition.editionLabel);

  if (edition.coverageStatus === 'COVERED' && !forceRefresh) {
    return {
      editionLabel: edition.editionLabel,
      tournamentId: edition.tournamentId,
      coverageStatus: edition.coverageStatus,
      basis: 'ALREADY_COVERED',
      demand: { editionLabel: edition.editionLabel, endpointTier: 'FEED', estimatedCalls: 0, confidence: 'MEASURED' },
      note: 'window already fully covered (complete) — no fresh sweep needed',
    };
  }

  if (edition.coverageStatus === 'PARTIAL' && !forceRefresh) {
    return {
      editionLabel: edition.editionLabel,
      tournamentId: edition.tournamentId,
      coverageStatus: edition.coverageStatus,
      basis: 'PARTIAL_UNKNOWN',
      demand: { editionLabel: edition.editionLabel, endpointTier: 'FEED', estimatedCalls: null, confidence: 'UNKNOWN' },
      note: 'partial coverage: no measured partial-sweep cost and no resume, so remaining provider demand is UNKNOWN (not invented)',
    };
  }

  // UNCOVERED, or a forced refresh: a full sweep is required. Cost is the MEASURED
  // whole-season sweep where known, else UNKNOWN — never extrapolated.
  const known = measured.estimatedCalls !== null;
  return {
    editionLabel: edition.editionLabel,
    tournamentId: edition.tournamentId,
    coverageStatus: edition.coverageStatus,
    basis: known ? 'FULL_SWEEP_MEASURED' : 'FULL_SWEEP_UNKNOWN_COST',
    demand: measured,
    note: known
      ? `full sweep required; measured cost ${measured.estimatedCalls}`
      : 'full sweep required; sweep cost has never been measured for this tournament — demand UNKNOWN',
  };
}

/**
 * THE PLANNER. Pure: every fact is supplied. It turns coverage + measured costs
 * into an EditionDemand[] and delegates the verdict to assessBudget, so unknown
 * demand, unknown capacity, and unknown retry reserve all fail closed exactly as
 * Task 4 defines. It cannot turn any UNKNOWN into an ordinary ALLOW.
 */
export function planPrePeak(input: PrePeakPlanInput): PrePeakPlan {
  const lines = input.editions.map((e) => editionLine(e, input.forceRefresh === true));

  const assessment = assessBudget({
    provider: input.provider,
    windowLabel: input.windowLabel,
    capacity: input.capacity,
    consumed: input.consumed,
    latestQuotaRemaining: input.latestQuotaRemaining,
    retryReserve: input.retryReserve,
    demand: lines.map((l) => l.demand),
    priority: input.priority,
    emergencyOverride: input.emergencyOverride,
  });

  return {
    provider: input.provider,
    windowLabel: input.windowLabel,
    window: input.window,
    priority: input.priority,
    editions: lines,
    assessment,
    unknownDemandEditions: lines
      .filter((l) => l.demand.estimatedCalls === null)
      .map((l) => l.editionLabel),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY DB HELPER — complete coverage periods for an edition. SELECT only.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the `complete=true` covered periods for one edition. READ-ONLY. The
 * caller passes these to classifyWindowCoverage. `covered_period` is a daterange;
 * its lower/upper bounds are read as dates (the ledger writes `[from, to+1)`).
 */
export async function readCompleteCoveragePeriods(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  competitionEditionId: string
): Promise<CoveragePeriod[]> {
  const { rows } = await client.query(
    `SELECT lower(covered_period) AS start_on, upper(covered_period) AS end_exclusive_on
       FROM operations.edition_ingestion_coverage
      WHERE competition_edition_id = $1 AND complete = true
      ORDER BY lower(covered_period)`,
    [competitionEditionId]
  );
  return rows
    .filter((r) => r.start_on != null && r.end_exclusive_on != null)
    .map((r) => ({
      start: new Date(r.start_on as string),
      endExclusive: new Date(r.end_exclusive_on as string),
    }));
}
