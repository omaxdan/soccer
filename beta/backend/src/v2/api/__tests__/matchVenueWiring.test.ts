// MATCH VENUE — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getMatchVenue:
//   • returns null when the fixture does not exist (existence gate preserved)
//   • reaches the venue query only after the fixture existence gate
//   • composes the match header + observed venue for a real fixture
//   • surfaces venue null + coverage 'absent' when the fixture has no recorded venue

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getMatchVenue } from '../handlers';

function fakeTx(opts: { exists: boolean; withVenue: boolean; onVenueQuery?: () => void }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Fixture header (existence gate + identity): FIXTURE_HEADER_SQL.
    if (q.includes('AS edition_id') && q.includes('AS home_id')) {
      return opts.exists
        ? [{
            fixture_id: '61', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z', lifecycle_state_code: 'COMPLETED',
            edition_id: '18', season_label: 'Brasileiro Serie A 2026',
            competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano',
            home_id: '67', home_name: 'Fluminense', home_slug: 'fluminense',
            away_id: '64', away_name: 'Red Bull Bragantino', away_slug: 'red-bull-bragantino',
            home_goals: 1, away_goals: 1,
          }]
        : [];
    }
    // Venue query (fixture LEFT JOIN venue).
    if (q.includes('football.venue')) {
      opts.onVenueQuery?.();
      return [{
        is_neutral_venue: false,
        venue_id: opts.withVenue ? '500' : null,
        name: opts.withVenue ? 'Maracanã' : null,
        city: opts.withVenue ? 'Rio de Janeiro' : null,
        country_code: opts.withVenue ? 'BRA' : null,
        latitude: opts.withVenue ? '-22.912160' : null,
        longitude: opts.withVenue ? '-43.230180' : null,
        elevation_metres: opts.withVenue ? 9 : null,
        timezone_name: opts.withVenue ? 'America/Sao_Paulo' : null,
        capacity: opts.withVenue ? 78838 : null,
        surface: opts.withVenue ? 'grass' : null,
      }];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getMatchVenue wiring (DB-free)', () => {
  test('a nonexistent fixture returns null and never reaches the venue query', async () => {
    let venueQueried = false;
    const body = await getMatchVenue(fakeTx({ exists: false, withVenue: true, onVenueQuery: () => { venueQueried = true; } }), '61');
    assert.equal(body, null);
    assert.equal(venueQueried, false); // gate short-circuits before the venue query
  });

  test('an existing fixture composes header + observed venue', async () => {
    const body = await getMatchVenue(fakeTx({ exists: true, withVenue: true }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.match.homeTeam.id, '67');
    assert.equal(body!.coverage.venue, 'present');
    assert.equal(body!.coverage.venueIsObserved, true);
    assert.equal(body!.isNeutralVenue, false);
    assert.equal(body!.venue!.name, 'Maracanã');
    assert.equal(body!.venue!.capacity, 78838);
    assert.equal(body!.venue!.latitude, -22.91216);
  });

  test('an existing fixture with no recorded venue → venue null, coverage absent', async () => {
    const body = await getMatchVenue(fakeTx({ exists: true, withVenue: false }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.venue, null);
    assert.equal(body!.coverage.venue, 'absent');
  });
});
