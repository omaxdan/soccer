// PLAYER DETAIL read-model tests (DB-free, pure).
//
// Proves the evidence-honest projection: raw registration/availability/valuation
// mapping (present + absent), per-key derived aggregates over stored numeric rows
// (sum/mean/matches), non-numeric keys staying null (never 0), missing keys staying
// ABSENT (never fabricated to 0), present-but-zero staying a real 0, deterministic
// ordering, team/opponent/score context, and that NO governed intelligence
// (score/verdict/confidence/readiness) is produced.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregatePlayerStatistics, mapRegistration, mapAvailability, mapValuation,
  type PlayerStatRow,
} from '../playerStatistics';

function row(over: Partial<PlayerStatRow> & { fixture_id: string; statistic_key: string }): PlayerStatRow {
  return {
    team_id: '67',
    statistic_value: null, value_type: 'number',
    scheduled_kickoff_at: '2026-07-17T23:00:00.000Z',
    competition_edition_id: '18', season_label: 'Brasileiro Serie A 2026',
    competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano',
    home_team_id: '67', away_team_id: '64', home_name: 'Fluminense', away_name: 'Red Bull Bragantino',
    home_goals: 2, away_goals: 1,
    ...over,
  };
}

// Two fixtures for the player (team 67): 100 (newer, home) and 90 (older, away).
const ROWS: PlayerStatRow[] = [
  // fixture 100 — home, 2–1
  row({ fixture_id: '100', statistic_key: 'goals',          statistic_value: '1',   value_type: 'number', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z' }),
  row({ fixture_id: '100', statistic_key: 'rating',         statistic_value: '7.5', value_type: 'number', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z' }),
  row({ fixture_id: '100', statistic_key: 'ratingVersions', statistic_value: '{"alt":7.4}', value_type: 'json', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z' }),
  // fixture 90 — away (home side is the opponent), 0–0; goals present-but-ZERO
  row({ fixture_id: '90', statistic_key: 'goals',  statistic_value: '0',   value_type: 'number', team_id: '67',
        scheduled_kickoff_at: '2026-05-03T21:30:00.000Z', home_team_id: '55', away_team_id: '67',
        home_name: 'Internacional', away_name: 'Fluminense', home_goals: 0, away_goals: 0 }),
  row({ fixture_id: '90', statistic_key: 'rating', statistic_value: '6.0', value_type: 'number', team_id: '67',
        scheduled_kickoff_at: '2026-05-03T21:30:00.000Z', home_team_id: '55', away_team_id: '67',
        home_name: 'Internacional', away_name: 'Fluminense', home_goals: 0, away_goals: 0 }),
];

describe('raw mappers — present and absent', () => {
  test('registration maps when present; null when absent', () => {
    assert.equal(mapRegistration(undefined), null);
    assert.equal(mapRegistration(null), null);
    assert.deepEqual(
      mapRegistration({ team_id: '67', registration_kind_code: 'PERMANENT', registration_from: '2026-01-01', registration_to: null, competition_edition_id: '18', season_label: '2026' }),
      { teamId: '67', registrationKindCode: 'PERMANENT', registrationFrom: '2026-01-01', registrationTo: null, competitionEditionId: '18', seasonLabel: '2026' },
    );
  });
  test('availability maps kind/spell/current; null when absent; severity coerced', () => {
    assert.equal(mapAvailability(undefined), null);
    const v = mapAvailability({ unavailability_kind_code: 'INJURY', spell_from: '2026-08-01', spell_to: null, expected_return_on: '2026-09-01', reason: 'knee', severity_rank: '3', is_current: true });
    assert.deepEqual(v, { unavailabilityKindCode: 'INJURY', from: '2026-08-01', to: null, expectedReturnOn: '2026-09-01', reason: 'knee', severityRank: 3, current: true });
    assert.equal(mapAvailability({ unavailability_kind_code: 'SUSPENSION', spell_from: null, spell_to: null, expected_return_on: null, reason: null, severity_rank: null, is_current: false })!.severityRank, null);
  });
  test('valuation maps amount/currency/date; null when absent', () => {
    assert.equal(mapValuation(null), null);
    assert.deepEqual(
      mapValuation({ amount: '1500000.00', currency_code: 'EUR', as_of_on: '2026-07-01', source_code: 'PROVIDER' }),
      { amount: '1500000.00', currencyCode: 'EUR', asOfOn: '2026-07-01', sourceCode: 'PROVIDER' },
    );
  });
});

describe('statistics aggregation over stored rows', () => {
  const s = aggregatePlayerStatistics(ROWS);

  test('matchesRepresented counts distinct fixtures; keys are the ones actually present', () => {
    assert.equal(s.matchesRepresented, 2);
    assert.deepEqual([...s.availableStatisticKeys], ['goals', 'rating', 'ratingVersions']); // sorted, only present keys
  });

  test('numeric keys aggregate to sum + mean across fixtures; present-but-zero counts as 0 (not dropped)', () => {
    const goals = s.summary.find((a) => a.statisticKey === 'goals')!;
    assert.equal(goals.matchesWithValue, 2);
    assert.equal(goals.numericTotal, '1');   // 1 + 0
    assert.equal(goals.numericMean, '0.5');   // (1+0)/2 — the zero fixture is included
    const rating = s.summary.find((a) => a.statisticKey === 'rating')!;
    assert.equal(rating.numericTotal, '13.5'); // 7.5 + 6.0
    assert.equal(rating.numericMean, '6.75');
  });

  test('non-numeric (json) key keeps null total/mean — never coerced to 0', () => {
    const rv = s.summary.find((a) => a.statisticKey === 'ratingVersions')!;
    assert.equal(rv.valueType, 'json');
    assert.equal(rv.matchesWithValue, 1);
    assert.equal(rv.numericTotal, null);
    assert.equal(rv.numericMean, null);
  });

  test('a statistic key never present is ABSENT (not zero-filled)', () => {
    assert.equal(s.summary.some((a) => a.statisticKey === 'assists'), false);
    assert.equal(s.availableStatisticKeys.includes('assists'), false);
  });

  test('editions participated derived from stored fixtures', () => {
    assert.equal(s.editions.length, 1);
    assert.equal(s.editions[0].competitionEditionId, '18');
    assert.equal(s.editions[0].matches, 2);
    assert.equal(s.editions[0].competition.slug, 'brasileirao-betano');
  });

  test('recent matches: deterministic newest-first order; per-match stats sorted by key', () => {
    assert.deepEqual(s.recentMatches.map((m) => m.fixtureId), ['100', '90']);
    assert.deepEqual(s.recentMatches[0].statistics.map((x) => x.key), ['goals', 'rating', 'ratingVersions']);
    // present-but-zero preserved verbatim as raw evidence
    const away = s.recentMatches.find((m) => m.fixtureId === '90')!;
    assert.equal(away.statistics.find((x) => x.key === 'goals')!.value, '0');
  });

  test('team/opponent/home-away/score context resolved from the side the player played', () => {
    const home = s.recentMatches.find((m) => m.fixtureId === '100')!;
    assert.equal(home.isHome, true);           // team 67 == home_team_id 67
    assert.equal(home.opponentTeamId, '64');
    assert.equal(home.opponentName, 'Red Bull Bragantino');
    assert.deepEqual(home.score, { home: 2, away: 1 });
    const away = s.recentMatches.find((m) => m.fixtureId === '90')!;
    assert.equal(away.isHome, false);          // team 67 == away_team_id
    assert.equal(away.opponentTeamId, '55');
    assert.equal(away.opponentName, 'Internacional');
    assert.deepEqual(away.score, { home: 0, away: 0 });
  });

  test('recentMatches is bounded by the limit', () => {
    const many = Array.from({ length: 15 }, (_, i) => row({ fixture_id: String(200 + i), statistic_key: 'goals', statistic_value: '1', scheduled_kickoff_at: `2026-0${(i % 9) + 1}-01T00:00:00.000Z` }));
    assert.equal(aggregatePlayerStatistics(many, 10).recentMatches.length, 10);
    assert.equal(aggregatePlayerStatistics(many, 10).matchesRepresented, 15); // count is full, list is capped
  });

  test('no stored stats → empty projection (absence, not fabrication)', () => {
    const empty = aggregatePlayerStatistics([]);
    assert.deepEqual(empty, { matchesRepresented: 0, availableStatisticKeys: [], summary: [], editions: [], recentMatches: [] });
  });

  test('no governed intelligence is fabricated anywhere in the projection', () => {
    const blob = JSON.stringify(aggregatePlayerStatistics(ROWS)).toLowerCase();
    for (const term of ['verdict', 'confidence', 'readiness', 'preparedness', 'sealed', 'intelligencescore']) {
      assert.equal(blob.includes(term), false, `player statistics must not contain governed term "${term}"`);
    }
  });
});
