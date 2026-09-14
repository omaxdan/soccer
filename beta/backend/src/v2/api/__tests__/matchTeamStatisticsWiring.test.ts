// MATCH TEAM STATISTICS — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getMatchTeamStatistics:
//   • returns null when the fixture does not exist (existence gate preserved)
//   • composes the match header + observed team statistics for a real fixture,
//     oriented home/away, with raw provider strings passed through
//   • surfaces coverage 'absent' with empty periods when none are reported,
//     without fabricating a statistic

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getMatchTeamStatistics } from '../handlers';

function fakeTx(opts: { exists: boolean; withStats: boolean }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
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
    if (q.includes('football.team_match_statistic')) {
      return opts.withStats
        ? [
            { period: 'ALL', group_name: 'Possession', statistic_key: 'ballPossession', statistic_name: 'Ball possession',
              home_value: '58', away_value: '42', home_display: '58%', away_display: '42%',
              value_type: 'PERCENT', compare_code: 'HOME', statistics_type: 'positive', render_type: 'bar',
              provider_code: 'SPORTSAPI_API', retrieved_at: '2026-07-18T02:00:00.000Z' },
            { period: 'ALL', group_name: 'Shots', statistic_key: 'totalShots', statistic_name: 'Total shots',
              home_value: '14', away_value: '9', home_display: '14', away_display: '9',
              value_type: 'INT', compare_code: 'HOME', statistics_type: 'positive', render_type: 'text',
              provider_code: 'SPORTSAPI_API', retrieved_at: '2026-07-18T02:00:00.000Z' },
          ]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getMatchTeamStatistics wiring (DB-free)', () => {
  test('a nonexistent fixture returns null (existence gate preserved)', async () => {
    assert.equal(await getMatchTeamStatistics(fakeTx({ exists: false, withStats: true }), '61'), null);
  });

  test('an existing fixture composes header + observed team statistics', async () => {
    const body = await getMatchTeamStatistics(fakeTx({ exists: true, withStats: true }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.match.homeTeam.id, '67');
    assert.equal(body!.match.awayTeam.id, '64');
    assert.equal(body!.teamStatistics.coverage.teamStatistics, 'present');
    assert.deepEqual(body!.teamStatistics.coverage.periodsPresent, ['ALL']);
    assert.equal(body!.teamStatistics.coverage.provider, 'SPORTSAPI_API');
    const all = body!.teamStatistics.periods[0];
    assert.equal(all.period, 'ALL');
    assert.deepEqual(all.statistics.map((s) => s.statisticKey), ['ballPossession', 'totalShots']);
    // Raw provider strings passed through, oriented home/away.
    assert.deepEqual(all.statistics[0].home, { value: '58', display: '58%' });
    assert.deepEqual(all.statistics[0].away, { value: '42', display: '42%' });
    assert.equal(all.statistics[0].compareCode, 'HOME');
  });

  test('an existing fixture with no statistics → coverage absent, empty periods', async () => {
    const body = await getMatchTeamStatistics(fakeTx({ exists: true, withStats: false }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.deepEqual(body!.teamStatistics.periods, []);
    assert.equal(body!.teamStatistics.coverage.teamStatistics, 'absent');
    assert.equal(body!.teamStatistics.coverage.provider, null);
  });
});
