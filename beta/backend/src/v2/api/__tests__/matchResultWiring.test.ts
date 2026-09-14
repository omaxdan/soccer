// MATCH RESULT — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getMatchResult:
//   • returns null when the fixture does not exist (existence gate preserved)
//   • composes the match header + the full scoreline for a real, played fixture
//   • surfaces result null + coverage 'absent' for an existing fixture with no
//     persisted result (e.g. not yet played), without fabricating a scoreline

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getMatchResult } from '../handlers';

function fakeTx(opts: { exists: boolean; withResult: boolean }): PoolClient {
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
    if (q.includes('football.result')) {
      return opts.withResult
        ? [{
            home_goals: 1, away_goals: 1,
            home_goals_half_time: 0, away_goals_half_time: 1,
            home_goals_extra_time: null, away_goals_extra_time: null,
            home_penalties: null, away_penalties: null,
            confirmed_at: '2026-07-18T01:05:00.000Z',
          }]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getMatchResult wiring (DB-free)', () => {
  test('a nonexistent fixture returns null (existence gate preserved)', async () => {
    assert.equal(await getMatchResult(fakeTx({ exists: false, withResult: true }), '61'), null);
  });

  test('an existing played fixture composes header + full scoreline', async () => {
    const body = await getMatchResult(fakeTx({ exists: true, withResult: true }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.match.homeTeam.id, '67');
    assert.equal(body!.match.awayTeam.id, '64');
    assert.equal(body!.coverage.result, 'present');
    assert.equal(body!.coverage.resultIsObserved, true);
    assert.deepEqual(body!.result!.final, { home: 1, away: 1 });
    assert.deepEqual(body!.result!.halfTime, { home: 0, away: 1 });
    assert.equal(body!.result!.extraTime, null);
    assert.equal(body!.result!.penalties, null);
    assert.equal(body!.result!.confirmedAt, '2026-07-18T01:05:00.000Z');
  });

  test('an existing fixture with no result → result null, coverage absent', async () => {
    const body = await getMatchResult(fakeTx({ exists: true, withResult: false }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.result, null);
    assert.equal(body!.coverage.result, 'absent');
  });
});
