// ─────────────────────────────────────────────────────────────────────────────
// DURABLE PROVIDER RESERVATIONS — concurrency-safe budget admission
//
// Resolves the v1 governor's in-process limitation: reservations now live in
// operations.provider_reservation (migration proposed separately), so they survive
// process restart and two concurrent jobs cannot both consume the same remaining quota.
//
// CONCURRENCY MODEL: admission runs inside the CALLER'S transaction and takes a
// transaction-scoped advisory lock keyed by (provider_code, quota_day). That serializes
// admissions per provider-day, so the invariant
//     actual_used + active_committed + retry_reserve ≤ daily_quota
// is evaluated and the reservation inserted atomically — no two admissions observe the
// same free capacity. Actual usage remains operations.api_usage (authoritative); a
// reservation is only a pre-spend claim, reconciled to actual attempts afterwards.
//
// Idempotent by job_id (unique). Reservations expire (ttl) so a crashed job frees quota.
// This module NEVER calls the provider and NEVER writes team statistics.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE, dailyQuota, type ProviderConfig } from '../provider/config';
import { computeBudget, admit, readActualUsedToday, retryReserveFromEnv, type AdmissionCode } from './budgetGovernor';

export type ReservationAdmissionCode = AdmissionCode | 'ADMITTED_EXISTING';

export interface ReservationDecision {
  readonly code: ReservationAdmissionCode;
  readonly admitted: boolean;
  readonly reused: boolean;      // an ACTIVE reservation for this jobId already existed (idempotent)
  readonly jobId: string;
  readonly estimatedCalls: number;
  readonly dailyQuota: number;
  readonly actualUsedToday: number;
  readonly committed: number;
  readonly retryReserve: number;
  readonly available: number;
  readonly shortfall: number;
}

export interface ReservationOptions {
  readonly asOf?: Date;
  readonly retryReserve?: number;
  readonly ttlMs?: number;
  readonly providerCode?: string;
  readonly config?: ProviderConfig;
}

const utcDay = (asOf: Date): string => asOf.toISOString().slice(0, 10);

// ── SQL ─────────────────────────────────────────────────────────────────────────

/** Transaction-scoped serialization per (provider, quota_day). Released at COMMIT/ROLLBACK. */
export const ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext($1::text))`;

export const RESERVATION_BY_JOB_SQL = `
  SELECT job_id, estimated_calls, status
    FROM operations.provider_reservation WHERE job_id = $1::text`;

export const ACTIVE_COMMITTED_SQL = `
  SELECT COALESCE(SUM(estimated_calls), 0)::text AS committed
    FROM operations.provider_reservation
   WHERE provider_code = $1::text AND quota_day = $2::date
     AND status = 'ACTIVE' AND expires_at > $3::timestamptz`;

export const EXPIRE_STALE_SQL = `
  UPDATE operations.provider_reservation SET status = 'EXPIRED'
   WHERE status = 'ACTIVE' AND expires_at <= $1::timestamptz RETURNING id`;

export const INSERT_RESERVATION_SQL = `
  INSERT INTO operations.provider_reservation
    (job_id, provider_code, quota_day, estimated_calls, expires_at)
  VALUES ($1::text, $2::text, $3::date, $4::integer, $5::timestamptz)
  ON CONFLICT (job_id) DO NOTHING
  RETURNING id`;

export const RELEASE_SQL = `
  UPDATE operations.provider_reservation SET status = 'RELEASED', released_at = now()
   WHERE job_id = $1::text AND status = 'ACTIVE' RETURNING id`;

/** Reconcile a job to its ACTUAL attempts (from api_usage). Closes the reservation. */
export const RECONCILE_SQL = `
  UPDATE operations.provider_reservation
     SET status = 'RECONCILED', reconciled_at = now(), actual_attempts = $2::integer
   WHERE job_id = $1::text AND status IN ('ACTIVE', 'RELEASED') RETURNING id`;

// ── operations ──────────────────────────────────────────────────────────────────

/** Atomically admit and durably reserve capacity for a job. MUST run inside a transaction
 *  (the advisory lock is transaction-scoped). Idempotent: an existing ACTIVE reservation
 *  for the jobId is returned as ADMITTED_EXISTING without a second charge. */
export async function admitAndReserve(
  tx: PoolClient,
  jobId: string,
  estimatedCalls: number,
  options: ReservationOptions = {},
): Promise<ReservationDecision> {
  const asOf = options.asOf ?? new Date();
  const providerCode = options.providerCode ?? PROVIDER_CODE;
  const quotaDay = utcDay(asOf);
  const retryReserve = options.retryReserve ?? retryReserveFromEnv();
  const ttlMs = options.ttlMs ?? 3_600_000;
  const quota = dailyQuota(options.config);

  // Serialize admissions for this provider-day so capacity cannot be double-observed.
  await tx.query(ADVISORY_LOCK_SQL, [`${providerCode}:${quotaDay}`]);

  // Idempotency: a live reservation for this job is reused, never re-charged.
  const existing = await tx.query<{ job_id: string; estimated_calls: number; status: string }>(RESERVATION_BY_JOB_SQL, [jobId]);
  if (existing.rows.length > 0 && existing.rows[0].status === 'ACTIVE') {
    const est = Number(existing.rows[0].estimated_calls);
    return {
      code: 'ADMITTED_EXISTING', admitted: true, reused: true, jobId, estimatedCalls: est,
      dailyQuota: quota, actualUsedToday: await readActualUsedToday(tx, asOf, providerCode),
      committed: 0, retryReserve, available: 0, shortfall: 0,
    };
  }

  await tx.query(EXPIRE_STALE_SQL, [asOf]); // free crashed/abandoned reservations first

  const committedRes = await tx.query<{ committed: string }>(ACTIVE_COMMITTED_SQL, [providerCode, quotaDay, asOf]);
  const committed = Number(committedRes.rows[0]?.committed ?? 0);
  const actualUsedToday = await readActualUsedToday(tx, asOf, providerCode);
  const budget = computeBudget({ dailyQuota: quota, actualUsedToday, committed, retryReserve });
  const decision = admit(estimatedCalls, budget);

  let reused = false;
  if (decision.admitted) {
    const expiresAt = new Date(asOf.getTime() + ttlMs).toISOString();
    const ins = await tx.query<{ id: string }>(INSERT_RESERVATION_SQL, [jobId, providerCode, quotaDay, estimatedCalls, expiresAt]);
    if ((ins.rowCount ?? 0) === 0) reused = true; // concurrent insert of the same job under the lock
  }

  return {
    code: reused ? 'ADMITTED_EXISTING' : decision.code, admitted: decision.admitted, reused, jobId,
    estimatedCalls, dailyQuota: quota, actualUsedToday, committed, retryReserve,
    available: budget.available, shortfall: decision.shortfall,
  };
}

export async function releaseReservation(tx: PoolClient, jobId: string): Promise<boolean> {
  const res = await tx.query<{ id: string }>(RELEASE_SQL, [jobId]);
  return (res.rowCount ?? 0) > 0;
}

/** Reconcile a job to its ACTUAL attempts (from operations.api_usage — never the estimate). */
export async function reconcileReservation(tx: PoolClient, jobId: string, actualAttempts: number): Promise<boolean> {
  const res = await tx.query<{ id: string }>(RECONCILE_SQL, [jobId, actualAttempts]);
  return (res.rowCount ?? 0) > 0;
}

export async function expireStaleReservations(tx: PoolClient, asOf: Date = new Date()): Promise<number> {
  const res = await tx.query<{ id: string }>(EXPIRE_STALE_SQL, [asOf]);
  return res.rowCount ?? 0;
}
