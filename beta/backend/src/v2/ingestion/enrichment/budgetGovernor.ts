// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER BUDGET GOVERNOR — deterministic admission over measured usage
//
// Answers, BEFORE any provider call: how much daily quota remains, how much is
// committed, how much is reserved for retries, and whether a job may be admitted.
// It never spends quota and never duplicates provider accounting — actual usage is
// read from operations.api_usage (which records every attempt, including 429s).
//
//   AVAILABLE = dailyQuota − actualUsedToday − committed − retryReserve
//   admit(job) ⇔ estMinCalls(job) ≤ AVAILABLE
//
// GOVERNANCE (locked this workstream):
//   • dailyQuota from provider config (keys × dailyQuotaPerKey; verified 2×100=200).
//   • actualUsedToday = Σ quota_consumed in operations.api_usage for the current UTC
//     day — MEASURED, includes failed/429 attempts. "requested" is NEVER a proxy for
//     "consumed": reconcile() reconciles against actual attempts and SURFACES an overrun
//     (actual > estimated) rather than hiding it.
//   • committed = sum of live reservations (ReservationLedger). Reservation PERSISTENCE
//     is deferred (no live backfill job runs yet); the in-process ledger is the smallest
//     mechanism now and a future enrichment-execution workstream persists it (design in
//     the governance lock). committed is an INPUT so the source is pluggable.
//   • retryReserve is a deployment-configured integer (mechanism locked; no guessed
//     magnitude) — PT_V2_PROVIDER_RETRY_RESERVE, default 0 (deployments SHOULD raise it).
//   • Admission is all-or-nothing: estMinCalls > available → REJECTED (no silent partial).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE, dailyQuota, type ProviderConfig } from '../provider/config';

// ── budget math (pure) ────────────────────────────────────────────────────────

export interface BudgetInputs {
  readonly dailyQuota: number;
  readonly actualUsedToday: number;
  readonly committed: number;
  readonly retryReserve: number;
}

export interface Budget extends BudgetInputs {
  readonly available: number; // never negative
}

/** Deterministic remaining budget. Clamped at 0 (an over-spent day yields 0, not a
 *  negative that could re-admit work). Pure. */
export function computeBudget(i: BudgetInputs): Budget {
  const available = Math.max(0, i.dailyQuota - i.actualUsedToday - i.committed - i.retryReserve);
  return { ...i, available };
}

export type AdmissionCode = 'ADMITTED' | 'REJECTED_BUDGET';

export interface AdmissionDecision {
  readonly code: AdmissionCode;
  readonly admitted: boolean;
  readonly estMinCalls: number;
  readonly available: number;
  readonly shortfall: number; // calls by which the job exceeds available (0 when admitted)
}

/** All-or-nothing admission: a job is admitted only when its estimated MINIMUM call
 *  demand fits the available budget. No silent partial admission. Pure. */
export function admit(estMinCalls: number, budget: Budget): AdmissionDecision {
  const admitted = estMinCalls <= budget.available;
  return {
    code: admitted ? 'ADMITTED' : 'REJECTED_BUDGET',
    admitted,
    estMinCalls,
    available: budget.available,
    shortfall: admitted ? 0 : estMinCalls - budget.available,
  };
}

export interface Reconciliation {
  readonly estimated: number;
  readonly actualAttempts: number; // from operations.api_usage — the authoritative spend
  readonly consumed: number;       // == actualAttempts (never the estimate)
  readonly overrun: boolean;       // actual exceeded the estimate — a violation to surface
  readonly overrunBy: number;
}

/** Reconcile a completed job against its ACTUAL attempts (from api_usage). Consumed is
 *  always the actual count; an actual > estimated overrun is surfaced, never hidden. Pure. */
export function reconcile(estimated: number, actualAttempts: number): Reconciliation {
  const overrun = actualAttempts > estimated;
  return { estimated, actualAttempts, consumed: actualAttempts, overrun, overrunBy: overrun ? actualAttempts - estimated : 0 };
}

// ── reservation ledger (in-process; persistence deferred per governance lock) ───

export interface Reservation {
  readonly jobId: string;
  readonly estCalls: number;
  readonly createdAt: Date;
  readonly ttlMs: number; // reservation expires after this; recovers committed budget
}

/** Tracks committed (reserved-but-unspent) provider calls for in-flight jobs within one
 *  process. Deterministic; dedupes by jobId; expires stale reservations so a crashed job
 *  cannot hold budget forever. NOT persisted — a future workstream backs this with a
 *  durable store (operations table) when concurrent OS-process jobs exist. */
export class ReservationLedger {
  private readonly reservations = new Map<string, Reservation>();

  /** Reserve capacity for a job. Returns false (no-op) if the jobId already holds a live
   *  reservation — reservations are idempotent, never double-counted. */
  reserve(jobId: string, estCalls: number, now: Date = new Date(), ttlMs = 3_600_000): boolean {
    this.expire(now);
    if (this.reservations.has(jobId)) return false;
    this.reservations.set(jobId, { jobId, estCalls, createdAt: now, ttlMs });
    return true;
  }

  /** Release a job's reservation (on completion/failure); returns true if one existed. */
  release(jobId: string): boolean {
    return this.reservations.delete(jobId);
  }

  /** Drop reservations whose ttl has elapsed as of `now`. */
  expire(now: Date = new Date()): number {
    let dropped = 0;
    for (const [id, r] of this.reservations) {
      if (now.getTime() - r.createdAt.getTime() >= r.ttlMs) { this.reservations.delete(id); dropped += 1; }
    }
    return dropped;
  }

  /** Total committed calls across live (non-expired) reservations as of `now`. */
  committed(now: Date = new Date()): number {
    this.expire(now);
    let total = 0;
    for (const r of this.reservations.values()) total += r.estCalls;
    return total;
  }

  active(now: Date = new Date()): readonly Reservation[] {
    this.expire(now);
    return [...this.reservations.values()];
  }
}

// ── measured usage (read-only) ──────────────────────────────────────────────────

/** Start of the UTC day containing `asOf`, as an ISO string. */
export function utcDayStart(asOf: Date): string {
  return `${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** Actual provider calls consumed today (UTC), summed from operations.api_usage —
 *  includes failed/429 attempts recorded there. $1 provider_code · $2 UTC day start. */
export const ACTUAL_USED_TODAY_SQL = `
  SELECT COALESCE(SUM(quota_consumed), 0)::text AS used
    FROM operations.api_usage
   WHERE provider_code = $1::text
     AND occurred_at >= $2::timestamptz
`;

export async function readActualUsedToday(
  tx: PoolClient, asOf: Date = new Date(), providerCode: string = PROVIDER_CODE,
): Promise<number> {
  const res = await tx.query<{ used: string }>(ACTUAL_USED_TODAY_SQL, [providerCode, utcDayStart(asOf)]);
  return Number(res.rows[0]?.used ?? 0);
}

/** Retry reserve is a deployment concern (mechanism locked, magnitude not guessed). */
export function retryReserveFromEnv(): number {
  const raw = process.env.PT_V2_PROVIDER_RETRY_RESERVE;
  const n = raw === undefined ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Compose the current budget from measured usage + a committed source + configured
 *  reserve. Read-only; spends nothing. */
export async function currentBudget(
  tx: PoolClient,
  opts: { asOf?: Date; committed?: number; retryReserve?: number; config?: ProviderConfig } = {},
): Promise<Budget> {
  const asOf = opts.asOf ?? new Date();
  return computeBudget({
    dailyQuota: dailyQuota(opts.config),
    actualUsedToday: await readActualUsedToday(tx, asOf, PROVIDER_CODE),
    committed: opts.committed ?? 0,
    retryReserve: opts.retryReserve ?? retryReserveFromEnv(),
  });
}
