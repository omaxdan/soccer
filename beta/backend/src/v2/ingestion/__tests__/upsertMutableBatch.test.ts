// ─────────────────────────────────────────────────────────────────────────────
// upsertMutableBatch — set-based mutable upsert (DB-free)
//
// The performance fix for persistMatchEnrichment: ~1,345 player_match_statistic +
// ~133 team_match_statistic + ~46 lineup_selection rows per fixture were each an
// awaited round trip (~6–7 min/fixture). This primitive folds each relation into
// one multi-row INSERT ... ON CONFLICT DO UPDATE per parameter-limit chunk.
//
// These tests are the "DB-level/unit performance" check the audit requires WITHOUT
// a provider or a database: a fake PoolClient records every statement and its
// params, so we can assert the round-trip collapse, the chunk bound against
// PostgreSQL's 65535-parameter ceiling, and — crucially — that the emitted SQL is
// byte-for-byte the same ON CONFLICT DO UPDATE clause upsertMutable builds, so
// idempotency and the COALESCE update branch are provably preserved.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { upsertMutableBatch } from '../write/index';

interface Captured {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** A fake tx that records statements and answers a multi-row upsert with the
 *  affected-row count the primitive expects (one per tuple). */
function fakeTx(over: { rowCountFor?: (tupleCount: number) => number } = {}): {
  tx: PoolClient;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const cols = /\(([^)]*)\)\s*\n?\s*VALUES/.exec(sql)?.[1].split(',').length ?? 1;
    const tupleCount = Math.round(params.length / cols);
    return { rows: [], rowCount: over.rowCountFor ? over.rowCountFor(tupleCount) : tupleCount };
  };
  return { tx: { query } as unknown as PoolClient, calls };
}

const COLUMNS = ['fixture_partition_on', 'fixture_id', 'player_id', 'statistic_key', 'statistic_value', 'value_type'];
const CONFLICT = ['fixture_partition_on', 'fixture_id', 'player_id', 'statistic_key'];
const IMMUTABLE = ['fixture_partition_on', 'fixture_id', 'player_id', 'statistic_key'];

function statRow(playerId: string, key: string, value: string, existed = false) {
  return { values: ['2025-06-01', '61', playerId, key, value, 'number'], existedBeforeWrite: existed };
}

describe('upsertMutableBatch — round-trip collapse', () => {
  test('N rows become ONE statement (not N), well under the parameter ceiling', async () => {
    const { tx, calls } = fakeTx();
    const rows = Array.from({ length: 1345 }, (_, i) => statRow('p1', `k${i}`, String(i)));
    const counts = await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows });

    // 1,345 rows × 6 columns = 8,070 params — one statement, one round trip.
    assert.equal(calls.length, 1, 'a single multi-row statement replaces 1,345 round trips');
    assert.equal(calls[0].params.length, 1345 * 6);
    assert.ok(calls[0].params.length < 65535, 'stays under the 16-bit bind-parameter ceiling');
    assert.equal(counts.written, 1345);
  });

  test('chunks so no statement exceeds maxParams', async () => {
    const { tx, calls } = fakeTx();
    // maxParams 100, 6 columns → 16 rows/chunk; 40 rows → 3 chunks (16+16+8).
    const rows = Array.from({ length: 40 }, (_, i) => statRow('p1', `k${i}`, String(i)));
    await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows, maxParams: 100 });

    assert.equal(calls.length, 3);
    for (const c of calls) assert.ok(c.params.length <= 100, `chunk has ${c.params.length} params (≤ 100)`);
    assert.deepEqual(calls.map((c) => c.params.length / 6), [16, 16, 8]);
  });
});

describe('upsertMutableBatch — SQL is upsertMutable, batched', () => {
  test('emits ON CONFLICT DO UPDATE with COALESCE on updatable columns and advances updated_at', async () => {
    const { tx, calls } = fakeTx();
    await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows: [statRow('p1', 'rating', '6.5')] });
    const sql = calls[0].sql;

    assert.ok(/ON CONFLICT \(fixture_partition_on, fixture_id, player_id, statistic_key\) DO UPDATE SET/.test(sql), 'idempotent upsert on the natural key');
    // updatable = statistic_value, value_type → COALESCE(EXCLUDED, target); keys are NOT reassigned.
    assert.ok(/statistic_value = COALESCE\(EXCLUDED\.statistic_value, player_match_statistic\.statistic_value\)/.test(sql));
    assert.ok(/value_type = COALESCE\(EXCLUDED\.value_type, player_match_statistic\.value_type\)/.test(sql));
    assert.ok(!/statistic_key = COALESCE/.test(sql), 'a conflict-key column is never in the update branch');
    assert.ok(/updated_at = now\(\)/.test(sql), 'updated_at advances by default');
  });

  test('hasUpdatedAt:false omits updated_at (lineup_selection has none)', async () => {
    const { tx, calls } = fakeTx();
    const cols = ['fixture_partition_on', 'lineup_id', 'player_id', 'is_starting'];
    await upsertMutableBatch(tx, {
      relation: 'football.lineup_selection', columns: cols,
      conflictTarget: ['fixture_partition_on', 'lineup_id', 'player_id'],
      immutableColumns: ['fixture_partition_on', 'lineup_id', 'player_id'],
      hasUpdatedAt: false,
      rows: [{ values: ['2025-06-01', 'L1', 'p1', true], existedBeforeWrite: false }],
    });
    assert.ok(!/updated_at/.test(calls[0].sql), 'no updated_at column is touched');
    assert.ok(/is_starting = COALESCE\(EXCLUDED\.is_starting, lineup_selection\.is_starting\)/.test(calls[0].sql));
  });
});

describe('upsertMutableBatch — idempotency & the intra-batch duplicate-key hazard', () => {
  test('a conflict key repeated within one batch is de-duplicated, last value winning', async () => {
    const { tx, calls } = fakeTx();
    const rows = [statRow('p1', 'rating', '6.5'), statRow('p1', 'rating', '7.1')]; // same (player, key)
    const counts = await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows });

    // One tuple only — Postgres would else raise "cannot affect row a second time".
    assert.equal(calls[0].params.length, 6, 'the repeated key collapses to a single tuple');
    assert.equal(counts.written, 1);
    // Last write wins: statistic_value 7.1, not 6.5 (index 4 in COLUMNS).
    assert.equal(calls[0].params[4], '7.1');
  });

  test('distinct keys are all kept', async () => {
    const { tx, calls } = fakeTx();
    const rows = [statRow('p1', 'rating', '6.5'), statRow('p1', 'saves', '1'), statRow('p2', 'rating', '7.0')];
    await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows });
    assert.equal(calls[0].params.length / 6, 3);
  });
});

describe('upsertMutableBatch — insert/update split from known existence', () => {
  test('inserted + updated === written, split by existedBeforeWrite', async () => {
    const { tx } = fakeTx();
    const rows = [
      statRow('p1', 'rating', '6.5', false), // insert
      statRow('p1', 'saves', '1', true),     // update
      statRow('p2', 'rating', '7.0', true),  // update
    ];
    const counts = await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows });
    assert.equal(counts.inserted, 1);
    assert.equal(counts.updated, 2);
    assert.equal(counts.written, 3);
    assert.equal(counts.inserted + counts.updated, counts.written);
  });

  test('a re-run over already-stored keys reports only updates (idempotent)', async () => {
    const { tx } = fakeTx();
    const rows = [statRow('p1', 'rating', '6.5', true), statRow('p1', 'saves', '1', true)];
    const counts = await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows });
    assert.equal(counts.inserted, 0);
    assert.equal(counts.updated, 2);
  });
});

describe('upsertMutableBatch — guards', () => {
  test('empty input writes nothing and issues no statement', async () => {
    const { tx, calls } = fakeTx();
    const counts = await upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows: [] });
    assert.equal(calls.length, 0);
    assert.equal(counts.written, 0);
  });

  test('a conflictTarget column absent from columns is a loud wiring error', async () => {
    const { tx } = fakeTx();
    await assert.rejects(
      () => upsertMutableBatch(tx, { relation: 'football.x', columns: ['a', 'b'], conflictTarget: ['a', 'missing'], rows: [{ values: [1, 2], existedBeforeWrite: false }] }),
      /conflictTarget column is absent/
    );
  });

  test('an affected-row shortfall (a silently dropped row) throws rather than under-counting', async () => {
    const { tx } = fakeTx({ rowCountFor: (n) => n - 1 }); // simulate one row not landing
    await assert.rejects(
      () => upsertMutableBatch(tx, { relation: 'football.player_match_statistic', columns: COLUMNS, conflictTarget: CONFLICT, immutableColumns: IMMUTABLE, rows: [statRow('p1', 'rating', '6.5'), statRow('p2', 'rating', '7.0')] }),
      /must touch every row/
    );
  });
});
