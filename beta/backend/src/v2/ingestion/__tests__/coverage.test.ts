// EDITION COVERAGE WRITE-PATH UNIT TESTS. No provider, no database.
//
// Proves recordEditionCoverage issues a single append into the ledger on the
// SUPPLIED transaction, with the approved half-open covered_period convention and
// the correct columns/params — without opening a transaction of its own.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { recordEditionCoverage } from '../coverage';

function captureTx() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('recordEditionCoverage', () => {
  test('appends one row into operations.edition_ingestion_coverage with the right columns/params', async () => {
    const { tx, calls } = captureTx();
    const runOccurredAt = new Date('2026-08-23T05:33:22.128Z');
    await recordEditionCoverage(tx, {
      competitionEditionId: '18',
      providerCode: 'SPORTSAPI_API',
      competitionProviderId: '325',
      seasonProviderId: '87678',
      fromDate: '2026-08-12',
      toDate: '2026-08-19',
      complete: true,
      eventsCommitted: 10,
      pipelineRunId: '81',
      runOccurredAt,
    });

    assert.equal(calls.length, 1, 'exactly one statement');
    const { sql, params } = calls[0];
    assert.match(sql, /INSERT INTO operations\.edition_ingestion_coverage/);
    // No BEGIN/COMMIT/ROLLBACK of its own — it participates in the caller's
    // transaction. Word boundaries so the `events_committed` column is not matched.
    assert.ok(!/\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i.test(sql));
    // Approved covered_period convention: inclusive [from..to] -> [from, to+1).
    assert.match(sql, /daterange\(\$5::date, \(\$6::date \+ 1\), '\[\)'\)/);
    assert.deepEqual(params, ['18', 'SPORTSAPI_API', '325', '87678', '2026-08-12', '2026-08-19', true, 10, '81', runOccurredAt]);
  });

  test('carries complete=false through unchanged (partial/budget-truncated runs)', async () => {
    const { tx, calls } = captureTx();
    await recordEditionCoverage(tx, {
      competitionEditionId: '18', providerCode: 'SPORTSAPI_API', competitionProviderId: '325',
      seasonProviderId: '87678', fromDate: '2026-08-12', toDate: '2026-08-19',
      complete: false, eventsCommitted: 3, pipelineRunId: '82', runOccurredAt: new Date('2026-08-23T00:00:00Z'),
    });
    assert.equal(calls[0].params[6], false);
    assert.equal(calls[0].params[7], 3);
  });
});
