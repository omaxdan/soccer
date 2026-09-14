// COMPETITION — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getCompetition:
//   • returns null when the competition is unknown/unauthorized (→ 404), and the
//     editions query is NEVER reached first (gate-before-dependent-read);
//   • composes identity + canonical governed editions for an exposed competition;
//   • reports coverage.editions 'absent' (defensive) when no edition is returned,
//     while the competition itself stays 'present'.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getCompetition } from '../handlers';

function fakeTx(opts: { exists: boolean; withEditions: boolean; onEditionsQuery?: () => void }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Editions query (aggregates fixtures) — distinct, checked first.
    if (q.includes('count(f.id)')) {
      opts.onEditionsQuery?.();
      return opts.withEditions
        ? [{ edition_id: '42', season_label: '2025', competition_id: '28',
             competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325', fixture_count: '380' }]
        : [];
    }
    // Competition gate query (existence-under-governance).
    if (q.includes('from football.competition c')) {
      return opts.exists
        ? [{ id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', country_code: 'BR' }]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getCompetition wiring (DB-free)', () => {
  test('an unknown/unauthorized competition returns null and never queries editions', async () => {
    let editionsQueried = false;
    const body = await getCompetition(
      fakeTx({ exists: false, withEditions: true, onEditionsQuery: () => { editionsQueried = true; } }),
      '28',
    );
    assert.equal(body, null);
    assert.equal(editionsQueried, false); // gate short-circuits before the editions read
  });

  test('an exposed competition composes identity + canonical editions', async () => {
    const body = await getCompetition(fakeTx({ exists: true, withEditions: true }), '28');
    assert.notEqual(body, null);
    assert.deepEqual(body!.competition, { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', countryCode: 'BR' });
    assert.equal(body!.editions.length, 1);
    assert.equal(body!.editions[0].id, '42');
    assert.equal(body!.editions[0].fixtureCount, 380);
    assert.equal(body!.editions[0].competition.id, '28');
    assert.deepEqual(body!.coverage, { competition: 'present', editions: 'present' });
  });

  test('an exposed competition with no returned edition → editions empty, coverage absent, competition present', async () => {
    const body = await getCompetition(fakeTx({ exists: true, withEditions: false }), '28');
    assert.notEqual(body, null);
    assert.deepEqual(body!.editions, []);
    assert.deepEqual(body!.coverage, { competition: 'present', editions: 'absent' });
  });
});
