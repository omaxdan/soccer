// DURABLE PROVIDER RESERVATIONS tests (DB-free: SQL-shape + captured-tx sequencing).
//
// No live DB in the sandbox, so these assert the concurrency-safe admission ALGORITHM and
// the SQL contract that makes it safe (transaction-scoped advisory lock, idempotent insert,
// active-committed sum, measured usage), not a real Postgres run.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  admitAndReserve, releaseReservation, reconcileReservation, expireStaleReservations,
  ADVISORY_LOCK_SQL, RESERVATION_BY_JOB_SQL, ACTIVE_COMMITTED_SQL,
  EXPIRE_STALE_SQL, INSERT_RESERVATION_SQL, RELEASE_SQL, RECONCILE_SQL,
} from '../reservationStore';

const CONFIG = { keys: ['k1', 'k2'], dailyQuotaPerKey: 100, minRequestIntervalMs: 2000 } as any; // 200/day

/** A captured tx that returns queued row-sets in order and records every (sql, params). */
function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = queue[i++] ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

// ── SQL contract ────────────────────────────────────────────────────────────────

describe('reservation · SQL contract (durable, concurrency-safe, no team-stat writes)', () => {
  test('advisory lock is transaction-scoped and keyed by a single text arg', () => {
    assert.match(ADVISORY_LOCK_SQL, /pg_advisory_xact_lock\(hashtext\(\$1::text\)\)/);
  });
  test('active committed sums ACTIVE, unexpired reservations for the provider-day', () => {
    assert.match(ACTIVE_COMMITTED_SQL, /SUM\(estimated_calls\)/);
    assert.match(ACTIVE_COMMITTED_SQL, /status = 'ACTIVE'/);
    assert.match(ACTIVE_COMMITTED_SQL, /expires_at > \$3::timestamptz/);
    assert.match(ACTIVE_COMMITTED_SQL, /provider_code = \$1::text AND quota_day = \$2::date/);
  });
  test('insert is idempotent by job_id (ON CONFLICT DO NOTHING)', () => {
    assert.match(INSERT_RESERVATION_SQL, /ON CONFLICT \(job_id\) DO NOTHING/);
    assert.match(INSERT_RESERVATION_SQL, /RETURNING id/);
  });
  test('expiry frees only ACTIVE, past-ttl reservations; release/reconcile are status transitions', () => {
    assert.match(EXPIRE_STALE_SQL, /SET status = 'EXPIRED'/);
    assert.match(EXPIRE_STALE_SQL, /status = 'ACTIVE' AND expires_at <= \$1::timestamptz/);
    assert.match(RELEASE_SQL, /SET status = 'RELEASED'/);
    assert.match(RECONCILE_SQL, /SET status = 'RECONCILED'.*actual_attempts = \$2::integer/s);
  });
  test('no reservation SQL writes team statistics', () => {
    for (const s of [ADVISORY_LOCK_SQL, RESERVATION_BY_JOB_SQL, ACTIVE_COMMITTED_SQL, EXPIRE_STALE_SQL, INSERT_RESERVATION_SQL, RELEASE_SQL, RECONCILE_SQL]) {
      assert.ok(!/team_match_statistic/i.test(s));
    }
  });
});

// ── admission algorithm ───────────────────────────────────────────────────────

describe('reservation · admitAndReserve', () => {
  const asOf = new Date('2026-09-21T10:00:00Z');

  test('takes the advisory lock FIRST, then checks idempotency (serialize before observe)', async () => {
    // queue: lock, by-job(empty), expire, committed, actual-used, insert(id)
    const { tx, calls } = captureTx([[], [], [], [{ committed: '0' }], [{ used: '0' }], [{ id: '1' }]]);
    const d = await admitAndReserve(tx, 'jobA', 10, { asOf, config: CONFIG });
    assert.equal(calls[0].sql, ADVISORY_LOCK_SQL);
    assert.equal(calls[0].params[0], `SPORTSAPI_API:2026-09-21`);
    assert.equal(calls[1].sql, RESERVATION_BY_JOB_SQL);
    assert.equal(d.admitted, true);
    assert.equal(d.code, 'ADMITTED');
    assert.equal(d.reused, false);
    assert.equal(d.available, 200); // 200 − 0 − 0 − 0
  });

  test('idempotent: an existing ACTIVE reservation is reused, never re-charged or re-inserted', async () => {
    // queue: lock, by-job(ACTIVE 30), actual-used  → returns before expire/committed/insert
    const { tx, calls } = captureTx([[], [{ job_id: 'jobA', estimated_calls: 30, status: 'ACTIVE' }], [{ used: '12' }]]);
    const d = await admitAndReserve(tx, 'jobA', 10, { asOf, config: CONFIG });
    assert.equal(d.code, 'ADMITTED_EXISTING');
    assert.equal(d.reused, true);
    assert.equal(d.estimatedCalls, 30); // the ORIGINAL estimate, not the re-request
    // no INSERT was issued
    assert.ok(!calls.some((c) => c.sql === INSERT_RESERVATION_SQL));
  });

  test('expires stale BEFORE summing committed, so a crashed job frees quota', async () => {
    const { tx, calls } = captureTx([[], [], [{ id: '9' }], [{ committed: '0' }], [{ used: '0' }], [{ id: '2' }]]);
    await admitAndReserve(tx, 'jobB', 5, { asOf, config: CONFIG });
    const expireIdx = calls.findIndex((c) => c.sql === EXPIRE_STALE_SQL);
    const committedIdx = calls.findIndex((c) => c.sql === ACTIVE_COMMITTED_SQL);
    assert.ok(expireIdx >= 0 && committedIdx > expireIdx);
  });

  test('rejects when estimate exceeds available; NO insert on rejection', async () => {
    // quota 200, committed 150, used 40 → available 10; ask for 20 → reject
    const { tx, calls } = captureTx([[], [], [], [{ committed: '150' }], [{ used: '40' }]]);
    const d = await admitAndReserve(tx, 'jobBig', 20, { asOf, config: CONFIG });
    assert.equal(d.admitted, false);
    assert.equal(d.code, 'REJECTED_BUDGET');
    assert.equal(d.available, 10);
    assert.equal(d.shortfall, 10);
    assert.ok(!calls.some((c) => c.sql === INSERT_RESERVATION_SQL));
  });

  test('concurrent double-insert under the lock (ON CONFLICT → 0 rows) resolves to reused, not double-charge', async () => {
    // admitted path but the INSERT returns 0 rows (a racing job inserted the same job_id first)
    const { tx } = captureTx([[], [], [], [{ committed: '0' }], [{ used: '0' }], []]); // insert → []
    const d = await admitAndReserve(tx, 'jobRace', 10, { asOf, config: CONFIG });
    assert.equal(d.admitted, true);
    assert.equal(d.reused, true);
    assert.equal(d.code, 'ADMITTED_EXISTING');
  });

  test('committed reservations reduce available (two jobs cannot both take the same capacity)', async () => {
    // 100 already committed, 0 used → available 100; a 100-call job is admitted at the exact boundary
    const { tx } = captureTx([[], [], [], [{ committed: '100' }], [{ used: '0' }], [{ id: '3' }]]);
    const d = await admitAndReserve(tx, 'jobC', 100, { asOf, config: CONFIG });
    assert.equal(d.available, 100);
    assert.equal(d.admitted, true);
    // and one call more would not fit
    const { tx: tx2 } = captureTx([[], [], [], [{ committed: '100' }], [{ used: '0' }], [{ id: '4' }]]);
    const d2 = await admitAndReserve(tx2, 'jobD', 101, { asOf, config: CONFIG });
    assert.equal(d2.admitted, false);
    assert.equal(d2.shortfall, 1);
  });
});

describe('reservation · lifecycle transitions', () => {
  test('release returns true only when an ACTIVE row was updated', async () => {
    const { tx } = captureTx([[{ id: '1' }]]);
    assert.equal(await releaseReservation(tx, 'jobA'), true);
    const { tx: tx2 } = captureTx([[]]);
    assert.equal(await releaseReservation(tx2, 'jobGone'), false);
  });
  test('reconcile records ACTUAL attempts and closes the row', async () => {
    const { tx, calls } = captureTx([[{ id: '1' }]]);
    assert.equal(await reconcileReservation(tx, 'jobA', 17), true);
    assert.equal(calls[0].params[1], 17);
  });
  test('expireStaleReservations returns the freed count', async () => {
    const { tx } = captureTx([[{ id: '1' }, { id: '2' }]]);
    assert.equal(await expireStaleReservations(tx, new Date()), 2);
  });
});
