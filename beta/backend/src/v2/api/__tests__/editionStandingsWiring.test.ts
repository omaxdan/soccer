// EDITION STANDINGS — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getEditionStandings:
//   • returns null when the Day-1 governed exposure gate finds no exposed edition
//     (gate preserved — no ungoverned edition surfaced)
//   • composes edition identity + the standings projection for an exposed edition,
//     deriving goalDifference and reporting coverage
//   • surfaces an empty (coverage 'absent') standings set when none are ingested,
//     without fabricating a table

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getEditionStandings } from '../handlers';

function fakeTx(opts: { exposed: boolean; withStandings: boolean }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Exposure gate + identity (EDITION_HEADER_SQL joins governance.tracked_edition).
    if (q.includes('governance.tracked_edition') && q.includes('AS edition_id')) {
      return opts.exposed
        ? [{ edition_id: '18', season_label: 'Brasileiro Serie A 2026', competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano' }]
        : [];
    }
    // Standings projection query.
    if (q.includes('football.standing')) {
      return opts.withStandings
        ? [
            { standing_variant: 'TOTAL', as_of: '2026-07-01', position: 1, played: 20, won: 13, drawn: 4, lost: 3, goals_for: 40, goals_against: 18, points: 43, team_id: '67', team_name: 'Fluminense', team_slug: 'fluminense' },
            { standing_variant: 'TOTAL', as_of: '2026-07-01', position: 2, played: 20, won: 12, drawn: 5, lost: 3, goals_for: 35, goals_against: 20, points: 41, team_id: '64', team_name: 'Red Bull Bragantino', team_slug: 'red-bull-bragantino' },
          ]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getEditionStandings wiring (DB-free)', () => {
  test('a non-exposed edition returns null (governed gate preserved)', async () => {
    assert.equal(await getEditionStandings(fakeTx({ exposed: false, withStandings: true }), '18'), null);
  });

  test('an exposed edition composes identity + standings with derived goalDifference', async () => {
    const body = await getEditionStandings(fakeTx({ exposed: true, withStandings: true }), '18');
    assert.notEqual(body, null);
    assert.equal(body!.edition.id, '18');
    assert.equal(body!.edition.competition.slug, 'brasileirao-betano');
    assert.equal(body!.standings.coverage.standings, 'present');
    assert.deepEqual(body!.standings.coverage.variantsPresent, ['TOTAL']);
    const table = body!.standings.tables[0];
    assert.equal(table.variant, 'TOTAL');
    assert.equal(table.asOf, '2026-07-01');
    assert.deepEqual(table.rows.map((r) => r.position), [1, 2]);
    assert.equal(table.rows[0].goalDifference, 22); // 40 - 18, derived
    assert.equal(table.rows[0].team.id, '67');
  });

  test('an exposed edition with no ingested standings returns empty tables, coverage absent', async () => {
    const body = await getEditionStandings(fakeTx({ exposed: true, withStandings: false }), '18');
    assert.notEqual(body, null);
    assert.equal(body!.edition.id, '18');
    assert.deepEqual(body!.standings.tables, []);
    assert.equal(body!.standings.coverage.standings, 'absent');
  });
});
