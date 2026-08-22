// GOVERNED SELECTION TESTS. No provider, no database.
//
// The selector's WHERE-clause filtering (TRACKED / ACTIVE / authorized) is
// enforced in SQL, so its behavioural exclusion is proven structurally here (the
// query carries each conjunct) and behaviourally against a real cluster in the
// Gate 3 verification step. These unit tests cover mapping, fail-closed empty,
// fail-closed error, no-window-derivation, read-only shape, and predicate parity.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectAuthorizedEditions,
  mapAuthorizedEditionRow,
  type AuthorizedEdition,
} from '../orchestration/governedSelection';
import {
  AUTHORIZED_EDITIONS_SQL,
  AUTHORIZATION_COUNT_SQL,
  AUTHORIZATION_STATUS_CONJUNCTS,
  AUTHORIZATION_IDENTITY_CONJUNCTS,
} from '../orchestration/governanceAuthorization';
import { AUTHORIZATION_SQL } from '../orchestration/governedSeason';

function row(overrides: Record<string, unknown> = {}) {
  return {
    provider_code: 'SPORTSAPI_API',
    competition_provider_external_id: '325',
    season_provider_external_id: '87678',
    competition_id: '28',
    competition_edition_id: '18',
    season_from: '2026-01-01',
    season_to: '2027-01-01',
    ...overrides,
  };
}

describe('governed selection · returns authorized editions', () => {
  test('maps every row the query returns', async () => {
    const editions = await selectAuthorizedEditions({
      fetchRows: async () => [row(), row({ competition_provider_external_id: '373', season_provider_external_id: '89353' })],
    });
    assert.equal(editions.length, 2);
    const first = editions[0];
    assert.equal(first.providerCode, 'SPORTSAPI_API');
    assert.equal(first.competitionProviderExternalId, '325');
    assert.equal(first.seasonProviderExternalId, '87678');
    assert.equal(first.competitionId, '28');
    assert.equal(first.competitionEditionId, '18');
    assert.deepEqual(first.seasonPeriod, { from: '2026-01-01', to: '2027-01-01' });
  });

  test('null reality linkage and null period are preserved as-is', () => {
    const mapped = mapAuthorizedEditionRow(
      row({ competition_id: null, competition_edition_id: null, season_from: null, season_to: null }) as never
    );
    assert.equal(mapped.competitionId, null);
    assert.equal(mapped.competitionEditionId, null);
    assert.deepEqual(mapped.seasonPeriod, { from: null, to: null });
  });
});

describe('governed selection · fail-closed', () => {
  test('no authorized rows returns [] (no fallback)', async () => {
    const editions = await selectAuthorizedEditions({ fetchRows: async () => [] });
    assert.deepEqual(editions, []);
  });

  test('a query/connection error THROWS — never [] or partial', async () => {
    await assert.rejects(
      selectAuthorizedEditions({
        fetchRows: async () => {
          throw new Error('connection reset');
        },
      }),
      /connection reset/
    );
  });
});

describe('governed selection · exclusion is enforced by the query', () => {
  // DB-free proof that excluded rows cannot be returned: the query filters on
  // each status conjunct. Behavioural exclusion is also proven live in the Gate 3
  // verification against an ephemeral cluster.
  test('excludes non-TRACKED (query requires TRACKED)', () => {
    assert.ok(AUTHORIZED_EDITIONS_SQL.includes("tc.tracking_status_code = 'TRACKED'"));
  });
  test('excludes non-ACTIVE (query requires ACTIVE)', () => {
    assert.ok(AUTHORIZED_EDITIONS_SQL.includes("te.edition_status_code = 'ACTIVE'"));
  });
  test('excludes authorized_for_ingestion = false (query requires true)', () => {
    assert.ok(AUTHORIZED_EDITIONS_SQL.includes('te.authorized_for_ingestion = true'));
  });
});

describe('governed selection · no window derivation', () => {
  test('seasonPeriod is exposed as a raw fact, not a from/to/maxCalls window', () => {
    const mapped: AuthorizedEdition = mapAuthorizedEditionRow(row() as never);
    // The fact is the raw period bounds…
    assert.deepEqual(mapped.seasonPeriod, { from: '2026-01-01', to: '2027-01-01' });
    // …and the record carries NO ingestion-window shape.
    assert.ok(!('maxCalls' in mapped));
    assert.ok(!('window' in mapped));
    assert.ok(!('from' in mapped));
    assert.ok(!('to' in mapped));
  });
});

describe('governed selection · read-only, no execution', () => {
  test('the enumerating query is a pure SELECT (no mutation, no ingestion)', () => {
    assert.match(AUTHORIZED_EDITIONS_SQL.trimStart(), /^SELECT/);
    for (const forbidden of ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP']) {
      assert.ok(!AUTHORIZED_EDITIONS_SQL.toUpperCase().includes(forbidden), `must not contain ${forbidden}`);
    }
  });
});

describe('governed selection · predicate parity with governedSeason', () => {
  test('both queries share the one status-conjunct definition', () => {
    assert.ok(AUTHORIZED_EDITIONS_SQL.includes(AUTHORIZATION_STATUS_CONJUNCTS));
    assert.ok(AUTHORIZATION_COUNT_SQL.includes(AUTHORIZATION_STATUS_CONJUNCTS));
  });
  test('the single-edition check adds identity conjuncts; the set enumerator does not', () => {
    assert.ok(AUTHORIZATION_COUNT_SQL.includes(AUTHORIZATION_IDENTITY_CONJUNCTS));
    assert.ok(!AUTHORIZED_EDITIONS_SQL.includes('$1'));
  });
  test('governedSeason re-exports the shared single-edition predicate', () => {
    assert.equal(AUTHORIZATION_SQL, AUTHORIZATION_COUNT_SQL);
  });
});
