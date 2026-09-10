// ─────────────────────────────────────────────────────────────────────────────
// DEMAND-AWARE PROVIDER BUDGET GOVERNOR (Task 4)
//
// The smallest safe accounting/decision layer that answers ONE question:
//   "Can this planned provider demand be executed right now, given actual
//    recorded usage, configured capacity, MEASURED demand, retry reserve,
//    priority, and the parts of the provider's economics that remain UNKNOWN?"
//
// It is NOT a scheduler, a queue, a checkpoint system, or an ingestion path. The
// decision core is a PURE function; the only I/O is a read-only aggregation of
// the EXISTING operations.api_usage ledger. No migration, no new mutable ledger,
// no provider probe — a live quota_remaining header is consumed as evidence only
// if it is already present in api_usage.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CENTRAL RULE: UNKNOWN ECONOMICS STAY UNKNOWN.
//
// Capacity has a PROVENANCE, never a bare number:
//   CONFIGURED  keys × dailyQuotaPerKey (what the config asserts) — NOT proven.
//   MEASURED    derived from recorded observations.
//   VERIFIED    confirmed against the provider — currently NEVER true.
//   UNKNOWN     no trustworthy figure at all.
// The governor decides against CONFIGURED capacity when that is all we have, but
// it never RELABELS configured as verified, and it refuses (UNKNOWN / BLOCK)
// rather than approve on an unknown capacity or an unknown demand cost. Retry
// reserve is empirical (observed throttled attempts) or UNKNOWN — never a guessed
// percentage. The provider's reset WINDOW is unknown, so this layer reasons about
// a caller-supplied window label and makes no hard daily/62s reset assumption.
// ─────────────────────────────────────────────────────────────────────────────

/** How trustworthy a capacity figure is. Never collapse these into a number. */
export type CapacityProvenance = 'CONFIGURED' | 'MEASURED' | 'VERIFIED' | 'UNKNOWN';

export interface Capacity {
  /** Units in the window, or null when genuinely UNKNOWN. */
  readonly units: number | null;
  readonly provenance: CapacityProvenance;
}

export type DemandConfidence = 'MEASURED' | 'UNKNOWN';
export type EndpointTier = 'FEED' | 'PER_ENTITY' | 'DISCOVERY';

/** One planned unit of demand: a specific edition/endpoint sweep. */
export interface EditionDemand {
  readonly editionLabel: string;
  readonly endpointTier: EndpointTier;
  /** MEASURED call cost, or null when the cost has never been measured. */
  readonly estimatedCalls: number | null;
  readonly confidence: DemandConfidence;
}

export interface RetryReserve {
  /** Empirical reserve (observed throttled attempts), or null when UNKNOWN. */
  readonly units: number | null;
  readonly source: 'MEASURED' | 'UNKNOWN';
}

export type Priority = 'P1' | 'P2' | 'P3';
export type BudgetDecision = 'ALLOW' | 'DEFER' | 'BLOCK' | 'UNKNOWN';

export type BudgetReasonCode =
  | 'NO_DEMAND'
  | 'CAPACITY_UNKNOWN'
  | 'DEMAND_UNKNOWN'
  | 'CAPACITY_EXHAUSTED'
  | 'INSUFFICIENT_CAPACITY'
  | 'FITS'
  | 'PRIORITY_RESERVE_OVERRIDE'
  | 'DEFER_RESERVE';

export interface BudgetAssessmentInput {
  readonly provider: string;
  /** A label for the window being reasoned about; its real reset semantics are
   *  UNKNOWN, so this is descriptive, never an assertion of a provider reset. */
  readonly windowLabel: string;
  readonly capacity: Capacity;
  /** Actual calls already recorded this window (api_usage). Clamped ≥ 0. */
  readonly consumed: number;
  /** Latest provider-reported remaining, evidence only; null when not reported. */
  readonly latestQuotaRemaining: number | null;
  readonly retryReserve: RetryReserve;
  readonly demand: readonly EditionDemand[];
  readonly priority: Priority;
}

export interface BudgetAssessment {
  readonly decision: BudgetDecision;
  readonly reasonCode: BudgetReasonCode;
  readonly reason: string;
  readonly provider: string;
  readonly windowLabel: string;
  readonly capacityUnits: number | null;
  readonly capacityProvenance: CapacityProvenance;
  /** True ONLY when provenance === 'VERIFIED'. Never inferred from a number. */
  readonly capacityVerified: boolean;
  readonly consumed: number;
  /** max(0, capacity − consumed); null when capacity is UNKNOWN. */
  readonly remaining: number | null;
  readonly retryReserveUnits: number | null;
  readonly retryReserveKnown: boolean;
  /** remaining − reserve (reserve treated as 0 when unknown); null if capacity unknown. */
  readonly effectiveRemaining: number | null;
  /** Sum of demand; null when ANY edition cost is UNKNOWN. */
  readonly plannedCalls: number | null;
  readonly demandConfidence: DemandConfidence;
  readonly priority: Priority;
  readonly latestQuotaRemaining: number | null;
}

/**
 * THE PURE DECISION. No I/O, no clock, no provider — every input is supplied, so
 * the whole table is testable. Safety-first: unknown capacity or unknown demand
 * cost yields UNKNOWN (never ALLOW); exhausted or over-capacity yields BLOCK;
 * intrusion into the retry reserve is allowed only for the highest priority.
 */
export function assessBudget(input: BudgetAssessmentInput): BudgetAssessment {
  const consumed = Math.max(0, input.consumed);
  const plannedCalls = input.demand.some((d) => d.estimatedCalls === null)
    ? null
    : input.demand.reduce((n, d) => n + (d.estimatedCalls ?? 0), 0);
  const demandConfidence: DemandConfidence = input.demand.some((d) => d.confidence === 'UNKNOWN')
    ? 'UNKNOWN'
    : 'MEASURED';
  const retryReserveKnown = input.retryReserve.source === 'MEASURED' && input.retryReserve.units !== null;
  const reserveUnits = retryReserveKnown ? (input.retryReserve.units as number) : 0;

  const capacityVerified = input.capacity.provenance === 'VERIFIED';
  const remaining =
    input.capacity.units === null ? null : Math.max(0, input.capacity.units - consumed);
  const effectiveRemaining = remaining === null ? null : Math.max(0, remaining - reserveUnits);

  const base = {
    provider: input.provider,
    windowLabel: input.windowLabel,
    capacityUnits: input.capacity.units,
    capacityProvenance: input.capacity.provenance,
    capacityVerified,
    consumed,
    remaining,
    retryReserveUnits: input.retryReserve.units,
    retryReserveKnown,
    effectiveRemaining,
    plannedCalls,
    demandConfidence,
    priority: input.priority,
    latestQuotaRemaining: input.latestQuotaRemaining,
  } as const;

  const make = (decision: BudgetDecision, reasonCode: BudgetReasonCode, reason: string): BudgetAssessment =>
    ({ ...base, decision, reasonCode, reason });

  // 0. Nothing to spend — always safe, regardless of anything else.
  if (plannedCalls === 0) {
    return make('ALLOW', 'NO_DEMAND', 'no planned demand — nothing to execute');
  }
  // 1. Unknown capacity — cannot claim verified, cannot compute remaining.
  if (input.capacity.units === null) {
    return make('UNKNOWN', 'CAPACITY_UNKNOWN',
      'provider capacity is UNKNOWN; refusing to approve against an unverified/unknown allowance');
  }
  // 2. Unknown demand cost — never approve unsafe execution on a guessed cost.
  if (plannedCalls === null) {
    const missing = input.demand.filter((d) => d.estimatedCalls === null).map((d) => d.editionLabel);
    return make('UNKNOWN', 'DEMAND_UNKNOWN',
      `demand cost is UNKNOWN for: ${missing.join(', ')}; refusing to approve without a measured cost`);
  }
  // remaining is non-null here.
  const rem = remaining as number;
  // 3. Known capacity already exhausted.
  if (rem === 0) {
    return make('BLOCK', 'CAPACITY_EXHAUSTED',
      `known capacity exhausted (consumed ${consumed} of ${input.capacity.units})`);
  }
  // 4. Planned demand exceeds even raw remaining — cannot spend what is not there.
  if (plannedCalls > rem) {
    return make('BLOCK', 'INSUFFICIENT_CAPACITY',
      `planned ${plannedCalls} exceeds remaining ${rem} (capacity ${input.capacity.units}, consumed ${consumed})`);
  }
  // 5. Fits within the retry-reserve-protected budget.
  if (plannedCalls <= (effectiveRemaining as number)) {
    return make('ALLOW', 'FITS',
      `planned ${plannedCalls} fits effective remaining ${effectiveRemaining}` +
        (retryReserveKnown ? '' : ' (retry reserve UNKNOWN — treated as 0, not guessed)'));
  }
  // 6. Fits raw capacity but intrudes on the retry reserve. Priority decides.
  if (input.priority === 'P1') {
    return make('ALLOW', 'PRIORITY_RESERVE_OVERRIDE',
      `P1 volatile demand ${plannedCalls} intrudes on retry reserve (effective ${effectiveRemaining}, remaining ${rem}) — allowed by priority`);
  }
  return make('DEFER', 'DEFER_RESERVE',
    `${input.priority} demand ${plannedCalls} would intrude on retry reserve (effective ${effectiveRemaining}); deferring lower-priority work`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMAND ESTIMATION — from Task-3 MEASURED evidence only. Never from fixtures.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MEASURED full-season sweep costs, by provider tournament id, from the certified
 * ingestion runs (Task 3). A tournament ABSENT here has an UNKNOWN cost and MUST
 * NOT be assigned an invented value — Brazil (325) is deliberately absent because
 * its exact sweep cost was never measured.
 */
export const MEASURED_SWEEP_CALLS: Readonly<Record<string, number>> = {
  '17': 13, // England
  '45': 6, // Austria
  '35': 11, // Germany
};

/** A single-edition FEED sweep demand, MEASURED where evidence exists else UNKNOWN. */
export function estimateEditionSweep(tournamentId: string, editionLabel: string): EditionDemand {
  const cost = MEASURED_SWEEP_CALLS[tournamentId];
  return cost === undefined
    ? { editionLabel, endpointTier: 'FEED', estimatedCalls: null, confidence: 'UNKNOWN' }
    : { editionLabel, endpointTier: 'FEED', estimatedCalls: cost, confidence: 'MEASURED' };
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY ACCOUNTING over operations.api_usage. No mutation, no migration.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shape of an api_usage row this layer reads. */
export interface ApiUsageRow {
  readonly occurredAt: Date;
  readonly requestsMade: number;
  readonly quotaConsumed: number;
  readonly quotaRemaining: number | null;
  readonly throttledCount: number;
}

export interface UsageSummary {
  readonly actualCalls: number;
  readonly quotaConsumed: number;
  readonly throttledTotal: number;
  /** Most recent non-null provider-reported remaining, or null. Evidence only. */
  readonly latestQuotaRemaining: number | null;
  readonly windowCount: number;
}

/** Pure aggregation of api_usage rows into a usage summary. */
export function summariseUsage(rows: readonly ApiUsageRow[]): UsageSummary {
  let actualCalls = 0;
  let quotaConsumed = 0;
  let throttledTotal = 0;
  let latestQuotaRemaining: number | null = null;
  let latestAt = -Infinity;
  for (const r of rows) {
    actualCalls += r.requestsMade;
    quotaConsumed += r.quotaConsumed;
    throttledTotal += r.throttledCount;
    if (r.quotaRemaining !== null && r.occurredAt.getTime() > latestAt) {
      latestAt = r.occurredAt.getTime();
      latestQuotaRemaining = r.quotaRemaining;
    }
  }
  return { actualCalls, quotaConsumed, throttledTotal, latestQuotaRemaining, windowCount: rows.length };
}

/**
 * Retry reserve from OBSERVED throttled attempts — empirical, never a guessed
 * percentage. With no recorded windows there is no evidence, so the reserve is
 * UNKNOWN rather than a fabricated zero-confidence number.
 */
export function deriveRetryReserve(summary: UsageSummary): RetryReserve {
  if (summary.windowCount === 0) return { units: null, source: 'UNKNOWN' };
  return { units: summary.throttledTotal, source: 'MEASURED' };
}

/** Reads api_usage for a provider since an instant. READ-ONLY (SELECT only). */
export async function readUsageSince(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  provider: string,
  since: Date
): Promise<ApiUsageRow[]> {
  const { rows } = await client.query(
    `SELECT occurred_at, requests_made, quota_consumed, quota_remaining, throttled_count
       FROM operations.api_usage
      WHERE provider_code = $1 AND occurred_at >= $2
      ORDER BY occurred_at`,
    [provider, since]
  );
  return rows.map((r) => ({
    occurredAt: r.occurred_at as Date,
    requestsMade: Number(r.requests_made),
    quotaConsumed: Number(r.quota_consumed),
    quotaRemaining: r.quota_remaining === null || r.quota_remaining === undefined ? null : Number(r.quota_remaining),
    throttledCount: Number(r.throttled_count ?? 0),
  }));
}
