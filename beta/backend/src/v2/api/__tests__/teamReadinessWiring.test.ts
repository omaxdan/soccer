// TEAM READINESS — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getTeamReadiness:
//   • returns null when the team fails the governed exposure gate, and the readiness
//     reader is NEVER reached before the gate succeeds;
//   • composes identity + the governed reading for an exposed team;
//   • surfaces coverage 'absent' + readiness null when no reading exists (never
//     fabricated), while keeping the 404 gate distinct from an absent reading.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getTeamReadiness } from '../handlers';

function fakeTx(opts: { exposed: boolean; withReading: boolean; onReadingQuery?: () => void }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Governed exposure gate + editions (TEAM_COMPETITIONS_SQL joins governance.tracked_edition).
    if (q.includes('governance.tracked_edition') && q.includes('as edition_id')) {
      return opts.exposed
        ? [{ edition_id: '18', season_label: 'Brasileiro Serie A 2026', competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano' }]
        : [];
    }
    // Team identity (TEAM_IDENTITY_SQL).
    if (q.includes('football.team t') && q.includes('home_venue')) {
      return [{ id: '67', name: 'Fluminense', slug: 'fluminense', short_name: 'FLU', country_code: 'BRA', home_venue_name: 'Maracanã' }];
    }
    // Evidence query (readCurrentReadingEvidence joins module.module_evidence) → none.
    // Checked BEFORE the readings match because the evidence SQL also references
    // module_status_code (mr.module_status_code <> 'INACTIVE').
    if (q.includes('module.module_evidence')) {
      return [];
    }
    // Current module readings (CURRENT_TEAM_READINGS_SQL).
    if (q.includes('module_status_code')) {
      opts.onReadingQuery?.();
      return opts.withReading
        ? [{
            module_key: 'readiness_tracker', team_id: '67', context_kind_code: 'ALL_COMPETITIONS',
            context_competition_edition_id: null, as_of: new Date('2026-07-17T23:00:00.000Z'),
            calculated_at: new Date('2026-09-06T09:30:00.000Z'), module_status_code: 'NEUTRAL',
            strength: null, confidence: null, sample_observation_count: 10, sample_meets_threshold: true,
            verdict_text: 'Steady form.', inactive_reason: null,
          }]
        : [];
    }
    // Evidence query and anything else → none (evidence null is a valid contract state).
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getTeamReadiness wiring (DB-free)', () => {
  test('a non-exposed team returns null and never reaches the readiness reader', async () => {
    let readingQueried = false;
    const body = await getTeamReadiness(fakeTx({ exposed: false, withReading: true, onReadingQuery: () => { readingQueried = true; } }), '67');
    assert.equal(body, null);
    assert.equal(readingQueried, false); // gate short-circuits before the reading query
  });

  test('an exposed team composes identity + governed reading (no fabricated score)', async () => {
    const body = await getTeamReadiness(fakeTx({ exposed: true, withReading: true }), '67');
    assert.notEqual(body, null);
    assert.equal(body!.team.id, '67');
    assert.equal(body!.team.name, 'Fluminense');
    assert.equal(body!.coverage.readiness, 'present');
    assert.equal(body!.coverage.readinessIsGoverned, true);
    assert.equal(body!.readiness!.moduleKey, 'readiness_tracker');
    assert.equal(body!.readiness!.status, 'NEUTRAL');
    assert.equal(body!.readiness!.strength, null);
    assert.deepEqual(body!.readiness!.sample, { matches: 10, meetsThreshold: true });
    assert.equal(body!.readiness!.asOf, '2026-07-17T23:00:00.000Z'); // as_of, not calculated_at
    assert.equal(Object.prototype.hasOwnProperty.call(body!.readiness, 'score'), false);
  });

  test('an exposed team with no reading → readiness null, coverage absent (distinct from 404)', async () => {
    const body = await getTeamReadiness(fakeTx({ exposed: true, withReading: false }), '67');
    assert.notEqual(body, null);       // still 200 (team is governed) …
    assert.equal(body!.readiness, null); // … but the reading is honestly absent
    assert.equal(body!.coverage.readiness, 'absent');
  });
});
