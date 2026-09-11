// COVERAGE-AWARE WINDOW DERIVATION TESTS (Gate 6C).
//
// Two layers, following the repo convention:
//   • DB-free unit tests for input validation and pure row-assembly (no faking of
//     interval subtraction — assembly only).
//   • DB-gated integration tests (skip without PT_V2_DB_*) that run the REAL
//     multirange SQL against the real migration-026 schema — the interval math is
//     never reimplemented in JavaScript.

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  deriveUncoveredWindows,
  assembleDerivation,
} from '../coverageWindows';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE: input validation + pure assembly
// ─────────────────────────────────────────────────────────────────────────────
const throwingClient = { query: async () => { throw new Error('query must not run'); } } as unknown as PoolClient;

describe('coverage windows · input validation (no query issued)', () => {
  test('rejects a malformed date before touching the database', async () => {
    await assert.rejects(
      deriveUncoveredWindows(throwingClient, { competitionEditionId: '18', requestedFrom: '2026-8-1', requestedTo: '2026-08-20' }),
      /requestedFrom must be a valid YYYY-MM-DD/
    );
  });
  test('rejects an inverted window before touching the database', async () => {
    await assert.rejects(
      deriveUncoveredWindows(throwingClient, { competitionEditionId: '18', requestedFrom: '2026-08-20', requestedTo: '2026-08-01' }),
      /precedes/
    );
  });
});

describe('coverage windows · pure assembly', () => {
  const req = { kind: 'requested' as const, lo: '2026-08-01', hi: '2026-08-21' };

  test('fully covered → noWork FULLY_COVERED', () => {
    const r = assembleDerivation([req, { kind: 'covered', lo: '2026-08-01', hi: '2026-08-21' }], false);
    assert.deepEqual(r.uncovered, []);
    assert.equal(r.noWork, true);
    assert.equal(r.reason, 'FULLY_COVERED');
    assert.deepEqual(r.requested, { from: '2026-08-01', to: '2026-08-21' });
  });

  test('empty effective window under clip → EMPTY_AFTER_SEASON_CLIP', () => {
    const r = assembleDerivation([req], true); // no covered, no uncovered => effective empty
    assert.equal(r.noWork, true);
    assert.equal(r.reason, 'EMPTY_AFTER_SEASON_CLIP');
  });

  test('gaps are returned ascending by lower bound', () => {
    const r = assembleDerivation(
      [req, { kind: 'uncovered', lo: '2026-08-15', hi: '2026-08-21' }, { kind: 'uncovered', lo: '2026-08-06', hi: '2026-08-10' }],
      false
    );
    assert.deepEqual(r.uncovered, [{ from: '2026-08-06', to: '2026-08-10' }, { from: '2026-08-15', to: '2026-08-21' }]);
    assert.equal(r.noWork, false);
    assert.equal(r.reason, undefined);
  });

  test('a missing requested row is a contract violation', () => {
    assert.throws(() => assembleDerivation([{ kind: 'uncovered', lo: 'a', hi: 'b' }], false), /requested row/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED: the real multirange SQL against the real 026 schema
// ─────────────────────────────────────────────────────────────────────────────
describe('coverage windows · derivation over real coverage (requires a V2 database)', { skip: !hasDatabase }, () => {
  const REQ = { requestedFrom: '2026-08-01', requestedTo: '2026-08-20' }; // → [2026-08-01, 2026-08-21)
  let competitionId = '';
  let runId = '';
  let runOccurredAt: Date = new Date();
  let seq = 0;

  before(async () => {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      const c = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug)
         VALUES ('SPORTSAPI_API', 'G6C-COMP', 'G6C', 'g6c-cov-windows') RETURNING id::text`);
      competitionId = c.rows[0].id;
      const r = await tx.query<{ id: string; occurred_at: Date }>(
        `INSERT INTO operations.pipeline_run (run_key, trigger_kind, started_at, outcome, code_revision, occurred_at)
         VALUES ('v2.ingest.season', 'MANUAL', now(), 'RUNNING', 'test', date_trunc('milliseconds', now())) RETURNING id::text, occurred_at`);
      runId = r.rows[0].id; runOccurredAt = r.rows[0].occurred_at;
    });
  });

  after(async () => {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      // Editions/coverage are append-only/retained; only the competition tree we own is removed where possible.
      await tx.query(`DELETE FROM football.competition WHERE provider_external_id = 'G6C-COMP'`).catch(() => undefined);
    });
    await closeAllPools();
  });

  /** A fresh edition with a unique, non-overlapping season_period. */
  const newEdition = async (seasonPeriod = `[${1900 + seq}-01-01,${1901 + seq}-01-01)`): Promise<string> => {
    seq += 1;
    return withConnection('pt_pipeline_ingestion', async (tx) => {
      const e = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1, $2, $3, $4::daterange) RETURNING id::text`,
        [competitionId, `G6C-S${seq}`, `G6C season ${seq}`, seasonPeriod]);
      return e.rows[0].id;
    });
  };

  /** Append a coverage row [from, to+1) for an edition. */
  const cover = (editionId: string, from: string, to: string, complete = true) =>
    withConnection('pt_pipeline_ingestion', (tx) =>
      tx.query(
        `INSERT INTO operations.edition_ingestion_coverage
           (competition_edition_id, provider_code, provider_external_id, provider_season_external_id,
            covered_period, complete, events_committed, pipeline_run_id, run_occurred_at)
         VALUES ($1,'SPORTSAPI_API','G6C-COMP',$2, daterange($3::date,($4::date + 1),'[)'), $5, 1, $6, $7)`,
        [editionId, `G6C-S${seq}`, from, to, complete, runId, runOccurredAt]));

  const derive = (editionId: string, extra: { clipToSeason?: boolean } = {}) =>
    withConnection('pt_pipeline_ingestion', (tx) =>
      deriveUncoveredWindows(tx, { competitionEditionId: editionId, ...REQ, ...extra }));

  const iv = (from: string, to: string) => ({ from, to });

  it('1. no prior coverage → whole window uncovered', async () => {
    const r = await derive(await newEdition());
    assert.deepEqual(r.uncovered, [iv('2026-08-01', '2026-08-21')]);
    assert.equal(r.noWork, false);
  });

  it('2. exact full coverage → noWork FULLY_COVERED', async () => {
    const e = await newEdition(); await cover(e, '2026-08-01', '2026-08-20');
    const r = await derive(e);
    assert.deepEqual(r.uncovered, []);
    assert.equal(r.reason, 'FULLY_COVERED');
  });

  it('3. coverage before window → whole window uncovered', async () => {
    const e = await newEdition(); await cover(e, '2026-07-20', '2026-07-31');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-01', '2026-08-21')]);
  });

  it('4. coverage after window → whole window uncovered', async () => {
    const e = await newEdition(); await cover(e, '2026-08-21', '2026-08-31');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-01', '2026-08-21')]);
  });

  it('5. one interior gap', async () => {
    const e = await newEdition(); await cover(e, '2026-08-01', '2026-08-05'); await cover(e, '2026-08-10', '2026-08-20');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-06', '2026-08-10')]);
  });

  it('6. multiple gaps, ascending', async () => {
    const e = await newEdition(); await cover(e, '2026-08-01', '2026-08-05'); await cover(e, '2026-08-10', '2026-08-14');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-06', '2026-08-10'), iv('2026-08-15', '2026-08-21')]);
  });

  it('7. overlapping coverage collapses', async () => {
    const e = await newEdition(); await cover(e, '2026-08-01', '2026-08-07'); await cover(e, '2026-08-05', '2026-08-11');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-12', '2026-08-21')]);
  });

  it('8. adjacent coverage merges', async () => {
    const e = await newEdition(); await cover(e, '2026-08-01', '2026-08-05'); await cover(e, '2026-08-06', '2026-08-09');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-10', '2026-08-21')]);
  });

  it('9. duplicate attestations are harmless', async () => {
    const e = await newEdition(); await cover(e, '2026-08-01', '2026-08-05'); await cover(e, '2026-08-01', '2026-08-05'); await cover(e, '2026-08-01', '2026-08-05');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-06', '2026-08-21')]);
  });

  it('10. complete=false is ignored', async () => {
    const e = await newEdition(); await cover(e, '2026-08-01', '2026-08-20', false);
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-01', '2026-08-21')]);
  });

  it('11. coverage crossing the requested start is clipped', async () => {
    const e = await newEdition(); await cover(e, '2026-07-25', '2026-08-05');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-06', '2026-08-21')]);
  });

  it('12. coverage extending beyond the requested end is clipped', async () => {
    const e = await newEdition(); await cover(e, '2026-08-10', '2026-08-30');
    assert.deepEqual((await derive(e)).uncovered, [iv('2026-08-01', '2026-08-10')]);
  });

  it('13. season clip narrows the requested window', async () => {
    const e = await newEdition('[2026-08-05,2026-08-15)');
    assert.deepEqual((await derive(e, { clipToSeason: true })).uncovered, [iv('2026-08-05', '2026-08-15')]);
  });

  it('14. season clip that removes the window → EMPTY_AFTER_SEASON_CLIP', async () => {
    const e = await newEdition('[2020-01-01,2021-01-01)');
    const r = await derive(e, { clipToSeason: true });
    assert.deepEqual(r.uncovered, []);
    assert.equal(r.noWork, true);
    assert.equal(r.reason, 'EMPTY_AFTER_SEASON_CLIP');
  });

  it('15. a database/query error throws (never noWork)', async () => {
    await assert.rejects(
      withConnection('pt_pipeline_ingestion', (tx) =>
        deriveUncoveredWindows(tx, { competitionEditionId: 'not-a-bigint', ...REQ })),
      (e: unknown) => e instanceof Error && !/must be a valid|precedes/.test((e as Error).message)
    );
  });

  it('16. editions are isolated (coverage never merges across editions)', async () => {
    const a = await newEdition(); await cover(a, '2026-08-01', '2026-08-20');
    const b = await newEdition(); // b has no coverage
    assert.deepEqual((await derive(b)).uncovered, [iv('2026-08-01', '2026-08-21')], 'b is unaffected by a');
  });

  it('18. one-day requested interval', async () => {
    const e = await newEdition();
    const r = await withConnection('pt_pipeline_ingestion', (tx) =>
      deriveUncoveredWindows(tx, { competitionEditionId: e, requestedFrom: '2026-08-10', requestedTo: '2026-08-10' }));
    assert.deepEqual(r.uncovered, [iv('2026-08-10', '2026-08-11')]);
  });
});
