// PLAYER DETAIL — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that the composed
// getPlayerDetail response actually carries the rich read model:
//   • an exposed player (passes the governed current-registration gate) returns
//     registration + availability + valuation + statistics, not just identity
//   • a player that fails the exposure gate returns null (no intelligence leaked)
//   • the Issue-1 fix flows end-to-end: a stored epoch (1970-01-01) expected-return
//     sentinel is reported as null while `current` stays true, independent of it
//
// This locks in the wiring that regressed only as a STALE RUNNING PROCESS in the
// field (the endpoint served pre-f35f13c code that returned only identity); the
// repository handler has returned all four fields since f35f13c.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getPlayerDetail } from '../handlers';

// A fake PoolClient that returns canned rows keyed by a substring of the SQL text.
// `expose` toggles the governed current-registration gate (PLAYER_CURRENT_TEAM_SQL).
function fakeTx(opts: { expose: boolean }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Exposure gate — current team within a governed edition.
    if (q.includes('team_registration') && q.includes('AS team_id')) {
      return opts.expose
        ? [{ team_id: '67', team_name: 'Fluminense', team_slug: 'fluminense', team_short: 'FLU', team_country: 'BRA',
              competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano', season_label: 'Brasileiro Serie A 2026' }]
        : [];
    }
    if (q.includes('to_char(p.date_of_birth')) {
      return [{ id: '27', full_name: 'Germán Cano', short_name: 'Cano', slug: 'german-cano',
                date_of_birth: '1988-01-02', nationality_code: 'ARG', height_cm: 181, preferred_foot: 'RIGHT' }];
    }
    // Registration query (no team_registration join).
    if (q.includes('AS registration_kind_code') && !q.includes('team_registration')) {
      return [{ team_id: '67', registration_kind_code: 'PERMANENT', registration_from: '2026-01-01', registration_to: null,
                competition_edition_id: '18', season_label: 'Brasileiro Serie A 2026' }];
    }
    if (q.includes('football.player_availability')) {
      // expected_return_on stored as the epoch sentinel (provider "no return" → 1970-01-01).
      return [{ unavailability_kind_code: 'INJURY', spell_from: '2026-07-01', spell_to: null,
                expected_return_on: '1970-01-01', reason: 'hamstring', severity_rank: 3, is_current: true }];
    }
    if (q.includes('football.player_valuation')) {
      return [{ amount: '12000000', currency_code: 'EUR', as_of_on: '2026-06-01', source_code: 'TM' }];
    }
    if (q.includes('football.player_match_statistic')) {
      return [
        { fixture_id: '61', team_id: '67', statistic_key: 'rating', statistic_value: '7.5', value_type: 'number',
          scheduled_kickoff_at: '2026-07-17T23:00:00.000Z', competition_edition_id: '18', season_label: 'Brasileiro Serie A 2026',
          competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano',
          home_team_id: '67', away_team_id: '64', home_name: 'Fluminense', away_name: 'Red Bull Bragantino', home_goals: 1, away_goals: 1 },
      ];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getPlayerDetail wiring (DB-free)', () => {
  test('an exposed player returns registration + availability + valuation + statistics', async () => {
    const body = await getPlayerDetail(fakeTx({ expose: true }), '27');
    assert.notEqual(body, null);
    const r = body!;
    // Identity + governed context (never regressed).
    assert.equal(r.player.id, '27');
    assert.notEqual(r.currentTeam, null);
    assert.notEqual(r.competition, null);
    // The rich read model that must be present.
    assert.notEqual(r.registration, null);
    assert.equal(r.registration!.registrationKindCode, 'PERMANENT');
    assert.notEqual(r.availability, null);
    assert.equal(r.availability!.unavailabilityKindCode, 'INJURY');
    assert.notEqual(r.valuation, null);
    assert.equal(r.valuation!.amount, '12000000');
    assert.equal(r.statistics.matchesRepresented, 1);
    assert.deepEqual(r.statistics.availableStatisticKeys, ['rating']);
  });

  test('the response object always carries every rich key (never a partial subset)', async () => {
    const body = await getPlayerDetail(fakeTx({ expose: true }), '27');
    const keys = Object.keys(body!).sort();
    assert.deepEqual(keys, ['availability', 'competition', 'currentTeam', 'player', 'registration', 'statistics', 'valuation']);
  });

  test('a player failing the governed exposure gate returns null (no intelligence exposed)', async () => {
    const body = await getPlayerDetail(fakeTx({ expose: false }), '999');
    assert.equal(body, null);
  });

  test('Issue-1: a stored epoch expected-return is nulled, current stays true independently', async () => {
    const body = await getPlayerDetail(fakeTx({ expose: true }), '27');
    assert.equal(body!.availability!.expectedReturnOn, null); // not '1970-01-01'
    assert.equal(body!.availability!.current, true);          // independent of expectedReturnOn
    assert.equal(body!.availability!.from, '2026-07-01');     // real spell start preserved
  });
});
