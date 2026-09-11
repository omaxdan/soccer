// GOVERNANCE ADMIN TESTS — registration + edition-reality linkage.
//
// Two layers, per the repo convention:
//   • DB-free unit tests for input validation, the register upsert shape, and the
//     pure link decision logic (pending / linked / conflict) with a scripted fake tx.
//   • DB-gated integration tests (skip without PT_V2_DB_*) that run register + link
//     against the real migration-025 governance schema and real football rows,
//     proving idempotency and deterministic, fail-safe linkage.

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  registerTrackedEdition,
  linkEditionRealities,
} from '../orchestration/governanceAdmin';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE: register upsert shape + validation
// ─────────────────────────────────────────────────────────────────────────────
function captureTx(responder: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return responder(sql, params);
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('registerTrackedEdition · upsert shape and idempotency contract', () => {
  const respond = (sql: string) =>
    /INSERT INTO governance\.tracked_edition/.test(sql)
      ? { rows: [{ id: '20', inserted: true }] }
      : { rows: [{ id: '10', inserted: true }] };

  test('issues idempotent upserts on the provider alternate keys with the right params', async () => {
    const { tx, calls } = captureTx(respond);
    const r = await registerTrackedEdition(tx, {
      competitionProviderId: '325', seasonProviderId: '87678',
      seasonFrom: '2026-01-01', seasonTo: '2027-01-01', authorized: true,
    });
    assert.equal(calls.length, 2, 'one competition upsert, one edition upsert');

    const comp = calls[0];
    assert.match(comp.sql, /INSERT INTO governance\.tracked_competition/);
    assert.match(comp.sql, /ON CONFLICT \(provider_code, provider_external_id\) DO UPDATE/);
    assert.deepEqual(comp.params, ['SPORTSAPI_API', '325', 'TRACKED', 'LEAGUE', 'DOMESTIC']);

    const ed = calls[1];
    assert.match(ed.sql, /INSERT INTO governance\.tracked_edition/);
    assert.match(ed.sql, /ON CONFLICT \(tracked_competition_id, provider_season_external_id\) DO UPDATE/);
    assert.match(ed.sql, /daterange\(\$5::date, \$6::date, '\[\)'\)/);
    assert.deepEqual(ed.params, ['10', '87678', 'ACTIVE', true, '2026-01-01', '2027-01-01']);

    assert.deepEqual(r, { trackedCompetitionId: '10', trackedEditionId: '20', competitionInserted: true, editionInserted: true, authorized: true });
  });

  test('authorization defaults to FALSE — a binding never silently authorizes', async () => {
    const { tx, calls } = captureTx(respond);
    await registerTrackedEdition(tx, { competitionProviderId: '1', seasonProviderId: '2', seasonFrom: '2026-01-01', seasonTo: '2027-01-01' });
    assert.equal(calls[1].params[3], false);
  });

  test('rejects a malformed date before issuing any statement', async () => {
    const { tx, calls } = captureTx(respond);
    await assert.rejects(
      registerTrackedEdition(tx, { competitionProviderId: '1', seasonProviderId: '2', seasonFrom: '2026-1-1', seasonTo: '2027-01-01' }),
      /seasonFrom must be a valid YYYY-MM-DD/
    );
    assert.equal(calls.length, 0);
  });

  test('rejects a non-increasing season period', async () => {
    const { tx } = captureTx(respond);
    await assert.rejects(
      registerTrackedEdition(tx, { competitionProviderId: '1', seasonProviderId: '2', seasonFrom: '2027-01-01', seasonTo: '2026-01-01' }),
      /must be after/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE: link decision logic with a scripted fake tx
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fake tx: the first query (pending SELECT) returns `pendingRows`; subsequent
 * football-edition lookups return whatever `editionFor` maps the season id to;
 * UPDATEs report rowCount 1.
 */
function linkTx(pendingRows: any[], editionFor: (seasonId: string) => { id: string; competition_id: string }[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM governance\.tracked_edition te/.test(sql)) return { rows: pendingRows };
      if (/FROM football\.competition_edition/.test(sql)) return { rows: editionFor(String(params[0])) };
      if (/UPDATE governance\.tracked_edition/.test(sql)) return { rows: [], rowCount: 1 };
      if (/UPDATE governance\.tracked_competition/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('linkEditionRealities · decision logic (no database)', () => {
  const pending = (id: string, season: string, compLinked: string | null) => ({
    tracked_edition_id: id, tracked_competition_id: '9', season_provider_external_id: season, tracked_competition_competition_id: compLinked,
  });

  test('materialized edition, unlinked competition → linked + competition linked', async () => {
    const { tx } = linkTx([pending('1', '87678', null)], (s) => (s === '87678' ? [{ id: '55', competition_id: '77' }] : []));
    const r = await linkEditionRealities(tx);
    assert.deepEqual(r.linked, [{ trackedEditionId: '1', seasonProviderExternalId: '87678', competitionEditionId: '55' }]);
    assert.equal(r.competitionsLinked, 1);
    assert.equal(r.pending.length, 0);
    assert.equal(r.conflicts.length, 0);
  });

  test('football edition not materialized yet → pending, not error', async () => {
    const { tx } = linkTx([pending('1', '999', null)], () => []);
    const r = await linkEditionRealities(tx);
    assert.equal(r.linked.length, 0);
    assert.equal(r.pending.length, 1);
    assert.match(r.pending[0].reason, /not materialized/);
  });

  test('resolved edition under a different competition → conflict, never linked', async () => {
    const { tx } = linkTx([pending('1', '87678', '77')], () => [{ id: '55', competition_id: '88' }]);
    const r = await linkEditionRealities(tx);
    assert.equal(r.linked.length, 0);
    assert.equal(r.conflicts.length, 1);
    assert.match(r.conflicts[0].reason, /belongs to competition 88/);
  });

  test('nothing pending → idempotent no-op', async () => {
    const { tx } = linkTx([], () => []);
    const r = await linkEditionRealities(tx);
    assert.deepEqual(r, { linked: [], pending: [], conflicts: [], competitionsLinked: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED: register + link against the real governance/football schema
// ─────────────────────────────────────────────────────────────────────────────
describe('governance admin · register + link (requires a V2 database)', { skip: !hasDatabase }, () => {
  const COMP = '70110';
  const SEASON = '70120';
  let editionId = '';

  before(async () => {
    await withConnection('pt_platform_admin', async (tx) => {
      await tx.query(`DELETE FROM governance.tracked_edition te USING governance.tracked_competition tc
                       WHERE te.tracked_competition_id = tc.id AND tc.provider_external_id = $1`, [COMP]);
      await tx.query(`DELETE FROM governance.tracked_competition WHERE provider_external_id = $1`, [COMP]);
    });
    // Materialize a real football.competition + competition_edition carrying the
    // provider season id as its alternate key (as ingestion would).
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      const c = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug)
         VALUES ('SPORTSAPI_API', $1, 'GA Comp', 'ga-comp-70110')
         ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id::text`, [COMP]);
      const e = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1, $2, 'GA 2026', daterange('2026-01-01','2027-01-01'))
         ON CONFLICT (provider_external_id) DO UPDATE SET season_label = EXCLUDED.season_label
         RETURNING id::text`, [c.rows[0].id, SEASON]);
      editionId = e.rows[0].id;
    });
  });

  after(async () => {
    await withConnection('pt_platform_admin', async (tx) => {
      await tx.query(`DELETE FROM governance.tracked_edition te USING governance.tracked_competition tc
                       WHERE te.tracked_competition_id = tc.id AND tc.provider_external_id = $1`, [COMP]).catch(() => undefined);
      await tx.query(`DELETE FROM governance.tracked_competition WHERE provider_external_id = $1`, [COMP]).catch(() => undefined);
    });
    await closeAllPools();
  });

  const countEditions = async () => {
    const { rows } = await withConnection('pt_platform_admin', (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text n FROM governance.tracked_edition te JOIN governance.tracked_competition tc ON tc.id = te.tracked_competition_id WHERE tc.provider_external_id = $1`, [COMP]));
    return Number(rows[0].n);
  };
  const linkageOf = async () => {
    const { rows } = await withConnection('pt_platform_admin', (tx) =>
      tx.query<{ cei: string | null }>(
        `SELECT te.competition_edition_id::text cei FROM governance.tracked_edition te JOIN governance.tracked_competition tc ON tc.id = te.tracked_competition_id WHERE tc.provider_external_id = $1`, [COMP]));
    return rows[0]?.cei ?? null;
  };

  it('registers idempotently — a second register does not create a duplicate edition', async () => {
    await withConnection('pt_platform_admin', async (tx) => {
      await tx.query('BEGIN');
      await registerTrackedEdition(tx, { competitionProviderId: COMP, seasonProviderId: SEASON, seasonFrom: '2026-01-01', seasonTo: '2027-01-01', authorized: true });
      await tx.query('COMMIT');
    });
    assert.equal(await countEditions(), 1);
    await withConnection('pt_platform_admin', async (tx) => {
      await tx.query('BEGIN');
      const r = await registerTrackedEdition(tx, { competitionProviderId: COMP, seasonProviderId: SEASON, seasonFrom: '2026-01-01', seasonTo: '2027-01-01', authorized: true });
      await tx.query('COMMIT');
      assert.equal(r.editionInserted, false, 'the second register updated, did not insert');
    });
    assert.equal(await countEditions(), 1, 'still exactly one edition');
  });

  it('links the governance edition to the materialized football edition (authoritative alternate key)', async () => {
    assert.equal(await linkageOf(), null, 'unlinked before');
    const r = await withConnection('pt_platform_admin', async (tx) => {
      await tx.query('BEGIN');
      const res = await linkEditionRealities(tx);
      await tx.query('COMMIT');
      return res;
    });
    assert.equal(r.linked.length, 1);
    assert.equal(r.linked[0].competitionEditionId, editionId);
    assert.equal(await linkageOf(), editionId, 'competition_edition_id now populated');
  });

  it('re-linking is idempotent — an already-correct linkage is left untouched', async () => {
    const r = await withConnection('pt_platform_admin', async (tx) => {
      await tx.query('BEGIN');
      const res = await linkEditionRealities(tx);
      await tx.query('COMMIT');
      return res;
    });
    assert.equal(r.linked.length, 0, 'nothing pending on the second link');
    assert.equal(await linkageOf(), editionId, 'linkage unchanged');
  });
});
