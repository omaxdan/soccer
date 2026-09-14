// COUNTRY — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getCountry:
//   • returns null when the country code is unknown (→ 404), and NEITHER the teams
//     nor the competitions query is reached first (gate-before-dependent-read);
//   • composes identity + canonical teams + canonical competitions for a real country;
//   • reports coverage 'absent' for a member collection that is empty, while the
//     country itself stays 'present'.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getCountry } from '../handlers';

function fakeTx(opts: {
  exists: boolean;
  withTeams: boolean;
  withCompetitions: boolean;
  onMemberQuery?: () => void;
}): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Teams query (football.team_registration) — distinct, checked first.
    if (q.includes('football.team_registration')) {
      opts.onMemberQuery?.();
      return opts.withTeams
        ? [{ id: '68', name: 'Flamengo', slug: 'flamengo-5981', short_name: 'Flamengo', country_code: 'BR' }]
        : [];
    }
    // Competitions query (FROM football.competition c).
    if (q.includes('football.competition c')) {
      opts.onMemberQuery?.();
      return opts.withCompetitions
        ? [{ id: '1', name: 'Brasileirão Série A', slug: 'brasileirao-serie-a' }]
        : [];
    }
    // Country-by-code query (FROM football.country c).
    if (q.includes('football.country c')) {
      return opts.exists ? [{ code: 'BR', display_name: 'Brazil', alpha3_code: 'BRA' }] : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getCountry wiring (DB-free)', () => {
  test('an unknown country returns null and never queries members', async () => {
    let memberQueried = false;
    const body = await getCountry(
      fakeTx({ exists: false, withTeams: true, withCompetitions: true, onMemberQuery: () => { memberQueried = true; } }),
      'ZZ',
    );
    assert.equal(body, null);
    assert.equal(memberQueried, false); // country-not-found short-circuits before teams/competitions
  });

  test('a known country composes identity + canonical teams + competitions', async () => {
    const body = await getCountry(fakeTx({ exists: true, withTeams: true, withCompetitions: true }), 'BR');
    assert.notEqual(body, null);
    assert.deepEqual(body!.country, { code: 'BR', name: 'Brazil', alpha3Code: 'BRA' });
    assert.equal(body!.teams.length, 1);
    assert.equal(body!.teams[0].id, '68');
    assert.equal(body!.competitions.length, 1);
    assert.equal(body!.competitions[0].slug, 'brasileirao-serie-a');
    assert.deepEqual(body!.coverage, { country: 'present', teams: 'present', competitions: 'present' });
  });

  test('a known country with no members → empty collections, coverage absent, country present', async () => {
    const body = await getCountry(fakeTx({ exists: true, withTeams: false, withCompetitions: false }), 'BR');
    assert.notEqual(body, null);
    assert.deepEqual(body!.teams, []);
    assert.deepEqual(body!.competitions, []);
    assert.deepEqual(body!.coverage, { country: 'present', teams: 'absent', competitions: 'absent' });
  });
});
