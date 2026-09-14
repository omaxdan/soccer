// MATCH LINEUPS — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getMatchLineups:
//   • returns null when the fixture does not exist (existence gate preserved)
//   • composes the match header + lineups oriented to home/away for a real fixture,
//     splitting starting XI vs substitutes
//   • surfaces coverage 'absent' with both lineups null when none are reported,
//     without fabricating an XI

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getMatchLineups } from '../handlers';

function fakeTx(opts: { exists: boolean; withLineups: boolean }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Fixture header (existence gate + identity): FIXTURE_HEADER_SQL selects AS edition_id + home_id.
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
    // Lineups query.
    if (q.includes('football.lineup')) {
      return opts.withLineups
        ? [
            { team_id: '67', formation: '4-2-3-1', player_id: '1', player_full_name: 'Fábio', player_slug: 'fabio', position_code: 'GK', position_name: 'Goalkeeper', position_group: 'GOALKEEPER', shirt_number: 1, is_starting: true },
            { team_id: '67', formation: '4-2-3-1', player_id: '10', player_full_name: 'Ganso', player_slug: 'ganso', position_code: 'AM', position_name: 'Attacking Midfield', position_group: 'MIDFIELD', shirt_number: 10, is_starting: true },
            { team_id: '67', formation: '4-2-3-1', player_id: '23', player_full_name: 'Sub One', player_slug: 'sub-one', position_code: null, position_name: null, position_group: null, shirt_number: 23, is_starting: false },
            { team_id: '64', formation: '4-4-2', player_id: '99', player_full_name: 'Cleiton', player_slug: 'cleiton', position_code: 'GK', position_name: 'Goalkeeper', position_group: 'GOALKEEPER', shirt_number: 1, is_starting: true },
          ]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getMatchLineups wiring (DB-free)', () => {
  test('a nonexistent fixture returns null (existence gate preserved)', async () => {
    assert.equal(await getMatchLineups(fakeTx({ exists: false, withLineups: true }), '61'), null);
  });

  test('an existing fixture composes header + oriented lineups', async () => {
    const body = await getMatchLineups(fakeTx({ exists: true, withLineups: true }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.match.homeTeam.id, '67');
    assert.equal(body!.match.awayTeam.id, '64');
    assert.equal(body!.lineups.coverage.lineups, 'present');
    assert.equal(body!.lineups.coverage.lineupsAreObserved, true);
    // Home: formation + 2 starters (ordered by shirt) + 1 sub.
    assert.equal(body!.lineups.home!.formation, '4-2-3-1');
    assert.deepEqual(body!.lineups.home!.starting.map((p) => p.shirtNumber), [1, 10]);
    assert.equal(body!.lineups.home!.substitutes.length, 1);
    assert.equal(body!.lineups.home!.substitutes[0].positionCode, null);
    // Away oriented correctly.
    assert.equal(body!.lineups.away!.team.id, '64');
    assert.equal(body!.lineups.away!.starting[0].player.fullName, 'Cleiton');
  });

  test('an existing fixture with no reported lineups → coverage absent, both null', async () => {
    const body = await getMatchLineups(fakeTx({ exists: true, withLineups: false }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.lineups.home, null);
    assert.equal(body!.lineups.away, null);
    assert.equal(body!.lineups.coverage.lineups, 'absent');
  });
});
