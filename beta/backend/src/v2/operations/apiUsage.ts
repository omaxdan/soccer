// ─────────────────────────────────────────────────────────────────────────────
// API USAGE — operations.api_usage
//
// Persistence only. No provider-specific logic lives here: the endpoint key and
// the provider code are supplied by the caller, and this module does not know
// what a SportsAPI endpoint is or how its quota works.
//
// WHY THIS MATTERS BEYOND TELEMETRY
// Phase 1 recorded that the previous platform carried configuration specifically
// to double a daily quota by adding a second credential, and that nothing
// recorded consumption. At the coverage target, quota is the binding constraint
// on freshness — and an unmeasured binding constraint cannot be managed. This
// relation is retained longest of all operational content (3 years) for exactly
// that reason.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RELATION IS A WINDOW AGGREGATE, NOT A CALL LOG  (finding M-4)
//
// The S-2 brief asks api_usage to capture "request timestamp, response
// timestamp, HTTP status, rows returned". The approved relation records:
//
//     provider_code  endpoint_key  window_start  window_end
//     requests_made  quota_consumed  quota_remaining  throttled_count
//
// One row per (provider, endpoint, window) — not one row per call. There is no
// status column and no per-call timing.
//
// That is a deliberate shape, and the unique constraint says so:
// uq_api_usage__provider_endpoint_window UNIQUE (provider_code, endpoint_key,
// window_start, occurred_at). A per-call log would make that constraint
// meaningless. At the stated coverage target a per-call log would also be the
// largest operational relation by an order of magnitude, to answer questions
// ("what was the status of call 4,812,003") nobody asks, while the question that
// IS asked — "how much quota is left" — is answered directly by this shape.
//
// Per-call outcomes are not lost: a call that failed produces an
// operations.failure row with its diagnostic, which is where a single call's
// story belongs.
//
// The schema is immutable, so this module records what exists. The divergence
// is documented rather than worked around.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { operationalNow } from './run';
import { logger } from '../../utils/logger';

export interface ApiUsageWindow {
  /** Provider identifier, e.g. 'SPORTSAPI'. Caller's vocabulary, not this file's. */
  readonly providerCode: string;
  /** Endpoint identifier within the provider, e.g. 'fixtures.by-date'. */
  readonly endpointKey: string;
  readonly windowStart: Date;
  /** Must be strictly after windowStart — ck_api_usage__window_ordered. */
  readonly windowEnd: Date;
  readonly requestsMade: number;
  readonly quotaConsumed: number;
  /** Absent when the provider does not report remaining quota. */
  readonly quotaRemaining?: number | null;
  /** Requests the provider throttled or refused for rate reasons. */
  readonly throttledCount?: number;
}

/**
 * Persists one usage window.
 *
 * Deliberately NOT wrapped in a try/catch that swallows. Unlike write records
 * and failures, api_usage is not describing something that already went wrong —
 * it is the record that governs whether the next ingestion run may proceed. A
 * silently dropped usage row means the next run believes it has quota it does
 * not have, and the failure surfaces as provider refusals rather than as a
 * missing telemetry row. Fail loudly and let the caller decide.
 */
export async function recordApiUsage(
  control: PoolClient,
  usage: ApiUsageWindow
): Promise<{ id: string; occurredAt: Date }> {
  const occurredAt = operationalNow();
  const { rows } = await control.query<{ id: string }>(
    `INSERT INTO operations.api_usage
       (occurred_at, provider_code, endpoint_key, window_start, window_end,
        requests_made, quota_consumed, quota_remaining, throttled_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id::text`,
    [
      occurredAt,
      usage.providerCode,
      usage.endpointKey,
      usage.windowStart,
      usage.windowEnd,
      usage.requestsMade,
      usage.quotaConsumed,
      usage.quotaRemaining ?? null,
      usage.throttledCount ?? 0,
    ]
  );
  return { id: rows[0].id, occurredAt };
}

/**
 * Accumulates per-call observations into a window, which is the shape the
 * relation stores.
 *
 * This is where the brief's per-call model and the schema's window model meet.
 * A caller records each call as it happens; the accumulator folds them into one
 * row. Nothing per-call is written, and nothing per-call is needed — a failed
 * call's detail belongs in operations.failure.
 */
export class ApiUsageWindowBuilder {
  private requests = 0;
  private consumed = 0;
  private throttled = 0;
  private remaining: number | null = null;
  private readonly startedAt = new Date();

  constructor(
    private readonly providerCode: string,
    private readonly endpointKey: string
  ) {}

  /**
   * Records one call.
   *
   * `quotaCost` defaults to 1 because most providers charge per request; a
   * provider charging differently supplies its own figure. `remaining` is the
   * provider's own report, kept as the LATEST observation rather than a minimum:
   * the most recent figure is the one that governs the next call.
   */
  observe(options: { quotaCost?: number; throttled?: boolean; remaining?: number | null } = {}): void {
    this.requests += 1;
    this.consumed += options.quotaCost ?? 1;
    if (options.throttled) this.throttled += 1;
    if (options.remaining !== undefined && options.remaining !== null) {
      this.remaining = options.remaining;
    }
  }

  get callCount(): number {
    return this.requests;
  }

  /**
   * Folds the observations into a window and persists it.
   *
   * Returns null when no call was observed: ck_api_usage__window_ordered requires
   * window_end > window_start, and a zero-call window with identical bounds would
   * be rejected. An empty window carries no information anyway.
   */
  async flush(control: PoolClient): Promise<{ id: string; occurredAt: Date } | null> {
    if (this.requests === 0) return null;
    const windowEnd = new Date();
    // Guard the CHECK rather than let a same-millisecond window be refused. This
    // is not re-implementing the constraint — the database still enforces it —
    // it is supplying a valid value where the clock did not move.
    const safeEnd =
      windowEnd.getTime() > this.startedAt.getTime()
        ? windowEnd
        : new Date(this.startedAt.getTime() + 1);
    const result = await recordApiUsage(control, {
      providerCode: this.providerCode,
      endpointKey: this.endpointKey,
      windowStart: this.startedAt,
      windowEnd: safeEnd,
      requestsMade: this.requests,
      quotaConsumed: this.consumed,
      quotaRemaining: this.remaining,
      throttledCount: this.throttled,
    });
    logger.debug(
      {
        provider: this.providerCode,
        endpoint: this.endpointKey,
        requests: this.requests,
        remaining: this.remaining,
      },
      'v2: api usage window recorded'
    );
    this.requests = 0;
    this.consumed = 0;
    this.throttled = 0;
    return result;
  }
}

/**
 * Most recent reported remaining quota for a provider endpoint.
 *
 * Read helper for an ingestion job deciding whether to start. Ordered by
 * occurred_at then id, so a tie is broken deterministically rather than
 * arbitrarily (Phase 7 DB-04).
 */
export async function latestQuotaRemaining(
  control: PoolClient,
  providerCode: string,
  endpointKey?: string
): Promise<number | null> {
  const { rows } = await control.query<{ quota_remaining: number | null }>(
    `SELECT quota_remaining
       FROM operations.api_usage
      WHERE provider_code = $1
        AND ($2::text IS NULL OR endpoint_key = $2)
        AND quota_remaining IS NOT NULL
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1`,
    [providerCode, endpointKey ?? null]
  );
  return rows.length > 0 ? rows[0].quota_remaining : null;
}
