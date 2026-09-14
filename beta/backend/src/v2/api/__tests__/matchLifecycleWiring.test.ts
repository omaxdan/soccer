// MATCH LIFECYCLE — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getMatchLifecycle:
//   • returns null when the fixture does not exist (existence gate preserved)
//   • composes the match header + chronological transition history for a real fixture
//   • surfaces empty transitions + coverage 'absent' when none are recorded,
//     without fabricating a transition

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getMatchLifecycle } from '../handlers';

function fakeTx(opts: { exists: boolean; withTransitions: boolean }): PoolClient {
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
    if (q.includes('fixture_lifecycle_transition')) {
      return opts.withTransitions
        ? [
            { from_code: 'SCHEDULED', from_display: 'Scheduled', to_code: 'COMPLETED', to_display: 'Completed', transitioned_at: '2026-07-18T01:00:00.000Z', provider_status_raw: 'finished' },
            { from_code: null, from_display: null, to_code: 'SCHEDULED', to_display: 'Scheduled', transitioned_at: '2026-06-01T00:00:00.000Z', provider_status_raw: 'notstarted' },
          ]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getMatchLifecycle wiring (DB-free)', () => {
  test('a nonexistent fixture returns null (existence gate preserved)', async () => {
    assert.equal(await getMatchLifecycle(fakeTx({ exists: false, withTransitions: true }), '61'), null);
  });

  test('an existing fixture composes header + chronological history', async () => {
    const body = await getMatchLifecycle(fakeTx({ exists: true, withTransitions: true }), '61');
    assert.notEqual(body, null);
    assert.equal(body!.match.fixtureId, '61');
    assert.equal(body!.match.homeTeam.id, '67');
    assert.equal(body!.lifecycle.coverage.transitions, 'present');
    assert.equal(body!.lifecycle.coverage.transitionsAreObserved, true);
    // Ordered earliest-first; initial transition has fromState null.
    assert.deepEqual(body!.lifecycle.transitions.map((t) => t.toState.code), ['SCHEDULED', 'COMPLETED']);
    assert.equal(body!.lifecycle.transitions[0].fromState, null);
  });

  test('an existing fixture with no transitions → empty history, coverage absent', async () => {
    const body = await getMatchLifecycle(fakeTx({ exists: true, withTransitions: false }), '61');
    assert.notEqual(body, null);
    assert.deepEqual(body!.lifecycle.transitions, []);
    assert.equal(body!.lifecycle.coverage.transitions, 'absent');
  });
});
