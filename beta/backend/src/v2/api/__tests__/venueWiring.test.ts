// VENUE — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getVenue:
//   • returns null when the venue does not exist (→ 404), and the home-teams query
//     is NEVER reached before the venue is found (gate-before-read);
//   • composes venue identity/geography + canonical home teams for a real venue;
//   • reports coverage.homeTeams 'absent' when the venue has no home team.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getVenue } from '../handlers';

function fakeTx(opts: { exists: boolean; withHomeTeams: boolean; onHomeTeamsQuery?: () => void }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Home-teams query (football.team WHERE home_venue_id) — checked first (distinct).
    if (q.includes('home_venue_id')) {
      opts.onHomeTeamsQuery?.();
      return opts.withHomeTeams
        ? [{ id: '67', name: 'Fluminense', slug: 'fluminense', short_name: 'FLU', country_code: 'BR' }]
        : [];
    }
    // Venue-by-id query.
    if (q.includes('football.venue v')) {
      return opts.exists
        ? [{ id: '25', name: 'Maracanã', city: 'Rio de Janeiro', country_code: 'BR',
             latitude: '-22.912160', longitude: '-43.230180', elevation_metres: 9,
             timezone_name: 'America/Sao_Paulo', capacity: 78838, surface: 'grass' }]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getVenue wiring (DB-free)', () => {
  test('a nonexistent venue returns null and never queries home teams', async () => {
    let homeTeamsQueried = false;
    const body = await getVenue(fakeTx({ exists: false, withHomeTeams: true, onHomeTeamsQuery: () => { homeTeamsQueried = true; } }), '25');
    assert.equal(body, null);
    assert.equal(homeTeamsQueried, false); // venue-not-found short-circuits before home teams
  });

  test('an existing venue composes geography + canonical home teams', async () => {
    const body = await getVenue(fakeTx({ exists: true, withHomeTeams: true }), '25');
    assert.notEqual(body, null);
    assert.equal(body!.venue.id, '25');
    assert.equal(body!.venue.name, 'Maracanã');
    assert.equal(body!.venue.latitude, -22.91216);
    assert.equal(body!.venue.capacity, 78838);
    assert.equal(body!.homeTeams.length, 1);
    assert.equal(body!.homeTeams[0].id, '67');
    assert.deepEqual(body!.coverage, { venue: 'present', homeTeams: 'present' });
  });

  test('an existing venue with no home team → homeTeams empty, coverage absent', async () => {
    const body = await getVenue(fakeTx({ exists: true, withHomeTeams: false }), '25');
    assert.notEqual(body, null);
    assert.deepEqual(body!.homeTeams, []);
    assert.equal(body!.coverage.homeTeams, 'absent');
    assert.equal(body!.coverage.venue, 'present');
  });
});
