// TEAM PERFORMANCE — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getTeamPerformance:
//   • returns null when the team fails the governed exposure gate (never reaches
//     the feature read) — the gate is preserved
//   • composes identity + overall (ALL_COMPETITIONS) + byCompetition (scoped,
//     matched to governed editions) for an exposed team
//   • surfaces coverage honestly and never mixes scopes

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getTeamPerformance } from '../handlers';

function fakeTx(opts: { exposed: boolean; withFeatures: boolean; onFeatureRead?: () => void }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const rowsFor = (sql: string): unknown[] => {
    const q = norm(sql);
    // Governed exposure gate + editions (TEAM_COMPETITIONS_SQL joins governance.tracked_edition).
    if (q.includes('governance.tracked_edition') && q.includes('AS edition_id')) {
      return opts.exposed
        ? [{ edition_id: '18', season_label: 'Brasileiro Serie A 2026', competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano' }]
        : [];
    }
    // Team identity (TEAM_IDENTITY_SQL).
    if (q.includes('football.team t') && q.includes('home_venue')) {
      return [{ id: '67', name: 'Fluminense', slug: 'fluminense', short_name: 'FLU', country_code: 'BRA', home_venue_name: 'Maracanã' }];
    }
    // Feature read (CURRENT_TEAM_FEATURES_SQL over feature.feature_value).
    if (q.includes('feature.feature_value')) {
      opts.onFeatureRead?.();
      return opts.withFeatures
        ? [
            { feature_key: 'team.home_form', team_id: '67', context_kind_code: 'ALL_COMPETITIONS', context_competition_edition_id: null, value: '62.50', sample_observation_count: 8, sample_meets_threshold: true, as_of: new Date('2026-07-17T23:00:00.000Z') },
            { feature_key: 'team.giant_killer_ppg', team_id: '67', context_kind_code: 'ALL_COMPETITIONS', context_competition_edition_id: null, value: '1.50', sample_observation_count: 2, sample_meets_threshold: false, as_of: new Date('2026-07-17T23:00:00.000Z') },
            { feature_key: 'team.home_win_rate', team_id: '67', context_kind_code: 'COMPETITION_SCOPED', context_competition_edition_id: '18', value: '70.00', sample_observation_count: 10, sample_meets_threshold: true, as_of: new Date('2026-07-17T23:00:00.000Z') },
          ]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getTeamPerformance wiring (DB-free)', () => {
  test('a non-exposed team returns null and never reads features (gate preserved)', async () => {
    let featureRead = false;
    const body = await getTeamPerformance(fakeTx({ exposed: false, withFeatures: true, onFeatureRead: () => { featureRead = true; } }), '67');
    assert.equal(body, null);
    assert.equal(featureRead, false);
  });

  test('an exposed team composes identity + overall + scoped byCompetition', async () => {
    const body = await getTeamPerformance(fakeTx({ exposed: true, withFeatures: true }), '67');
    assert.notEqual(body, null);
    assert.equal(body!.team.id, '67');
    assert.equal(body!.team.name, 'Fluminense');
    // overall (ALL_COMPETITIONS)
    assert.equal(body!.overall.homeForm!.value, 62.5);
    assert.deepEqual(body!.overall.giantKillerPpg!.sample, { matches: 2, meetsThreshold: false });
    assert.equal(body!.overall.awayForm, null);             // not persisted → null
    assert.equal(body!.coverage.overall, 'partial');
    assert.equal(body!.coverage.performanceIsDescriptive, true);
    // byCompetition (scoped, matched to governed edition 18)
    assert.equal(body!.byCompetition.length, 1);
    assert.equal(body!.byCompetition[0].edition.id, '18');
    assert.equal(body!.byCompetition[0].homeWinRate!.value, 70);
    assert.equal(body!.byCompetition[0].awayWinRate, null);  // not persisted → null
  });

  test('an exposed team with no persisted features → coverage absent, null metrics', async () => {
    const body = await getTeamPerformance(fakeTx({ exposed: true, withFeatures: false }), '67');
    assert.notEqual(body, null);
    assert.equal(body!.coverage.overall, 'absent');
    assert.equal(body!.overall.homeForm, null);
    assert.equal(body!.byCompetition[0].homeWinRate, null);
  });
});
