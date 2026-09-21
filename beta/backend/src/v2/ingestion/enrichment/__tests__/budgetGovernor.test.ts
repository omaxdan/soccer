// PROVIDER BUDGET GOVERNOR tests (DB-free: pure math + reservation ledger + captured-tx).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  computeBudget, admit, reconcile, ReservationLedger, utcDayStart,
  readActualUsedToday, currentBudget, ACTUAL_USED_TODAY_SQL, retryReserveFromEnv,
} from '../budgetGovernor';

describe('budget math', () => {
  test('available = quota − used − committed − reserve, clamped at 0', () => {
    assert.equal(computeBudget({ dailyQuota: 200, actualUsedToday: 40, committed: 30, retryReserve: 10 }).available, 120);
    assert.equal(computeBudget({ dailyQuota: 200, actualUsedToday: 190, committed: 20, retryReserve: 10 }).available, 0); // clamp
  });
  test('admit: allowed, rejected, exact boundary', () => {
    const b = computeBudget({ dailyQuota: 200, actualUsedToday: 100, committed: 0, retryReserve: 0 }); // avail 100
    assert.equal(admit(100, b).code, 'ADMITTED');          // exact boundary
    assert.equal(admit(100, b).shortfall, 0);
    assert.equal(admit(101, b).code, 'REJECTED_BUDGET');
    assert.equal(admit(101, b).shortfall, 1);
  });
  test('reconcile: consumed is ACTUAL; overrun surfaced', () => {
    assert.deepEqual(reconcile(20, 17), { estimated: 20, actualAttempts: 17, consumed: 17, overrun: false, overrunBy: 0 });
    const over = reconcile(20, 23);
    assert.equal(over.consumed, 23);
    assert.equal(over.overrun, true);
    assert.equal(over.overrunBy, 3);
  });
});

describe('ReservationLedger', () => {
  const t0 = new Date('2026-09-21T00:00:00Z');
  test('reserve sums committed; duplicate jobId is idempotent (no double count)', () => {
    const l = new ReservationLedger();
    assert.equal(l.reserve('jobA', 30, t0), true);
    assert.equal(l.reserve('jobA', 30, t0), false); // duplicate → no-op
    assert.equal(l.reserve('jobB', 20, t0), true);
    assert.equal(l.committed(t0), 50);
  });
  test('release recovers committed budget', () => {
    const l = new ReservationLedger();
    l.reserve('jobA', 30, t0); l.reserve('jobB', 20, t0);
    assert.equal(l.release('jobA'), true);
    assert.equal(l.release('jobA'), false); // already gone
    assert.equal(l.committed(t0), 20);
  });
  test('expiry drops stale reservations and recovers budget', () => {
    const l = new ReservationLedger();
    l.reserve('jobA', 30, t0, 1000); // 1s ttl
    assert.equal(l.committed(new Date(t0.getTime() + 500)), 30);   // within ttl
    assert.equal(l.committed(new Date(t0.getTime() + 1500)), 0);   // expired
    assert.equal(l.active(new Date(t0.getTime() + 1500)).length, 0);
  });
});

describe('measured usage (read-only)', () => {
  function captureTx(rows: unknown[]) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const tx = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows }; } } as unknown as PoolClient;
    return { tx, calls };
  }
  test('utcDayStart is the UTC midnight of asOf', () => {
    assert.equal(utcDayStart(new Date('2026-09-21T13:45:00Z')), '2026-09-21T00:00:00.000Z');
  });
  test('readActualUsedToday sums quota_consumed for the UTC day, scoped by provider', async () => {
    const { tx, calls } = captureTx([{ used: '57' }]);
    const used = await readActualUsedToday(tx, new Date('2026-09-21T13:00:00Z'));
    assert.equal(used, 57);
    assert.equal(calls[0].params[1], '2026-09-21T00:00:00.000Z');
    assert.match(ACTUAL_USED_TODAY_SQL, /SUM\(quota_consumed\)/);
    assert.match(ACTUAL_USED_TODAY_SQL, /occurred_at >= \$2::timestamptz/);
  });
  test('currentBudget composes measured usage + injected committed + reserve', async () => {
    const { tx } = captureTx([{ used: '40' }]);
    const b = await currentBudget(tx, { asOf: new Date('2026-09-21T10:00:00Z'), committed: 30, retryReserve: 10, config: { keys: ['k1', 'k2'], dailyQuotaPerKey: 100, minRequestIntervalMs: 2000 } as any });
    assert.equal(b.dailyQuota, 200);
    assert.equal(b.actualUsedToday, 40);
    assert.equal(b.available, 120); // 200 − 40 − 30 − 10
  });
  test('retryReserveFromEnv defaults to 0 (mechanism locked, magnitude configured)', () => {
    const saved = process.env.PT_V2_PROVIDER_RETRY_RESERVE;
    delete process.env.PT_V2_PROVIDER_RETRY_RESERVE;
    assert.equal(retryReserveFromEnv(), 0);
    process.env.PT_V2_PROVIDER_RETRY_RESERVE = '15';
    assert.equal(retryReserveFromEnv(), 15);
    if (saved === undefined) delete process.env.PT_V2_PROVIDER_RETRY_RESERVE; else process.env.PT_V2_PROVIDER_RETRY_RESERVE = saved;
  });
});
