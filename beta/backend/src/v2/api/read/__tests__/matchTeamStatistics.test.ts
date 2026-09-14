// MATCH TEAM STATISTICS read-model tests (DB-free, pure).
//
// Proves the evidence-honest team-statistics projection:
//   • a stored row maps to a line with RAW provider strings passed through
//     (home/away value + display, value/compare/statistics/render type)
//   • a null provider value stays null — never fabricated to 0 or ''
//   • rows group by period; periods ordered by a stable rank (ALL, 1ST, 2ND, …);
//     statistics keep first-seen order within a period (deterministic)
//   • provenance (provider + latest retrievedAt) is drawn from rows, not invented
//   • an empty fixture yields empty periods and coverage 'absent'
//   • the provider's own compareCode is surfaced verbatim (never re-derived), and
//     no prediction/verdict/probability/score field leaks

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapTeamStatLine, groupTeamStatistics,
  type TeamMatchStatRow,
} from '../matchTeamStatistics';

function row(over: Partial<TeamMatchStatRow> & { period: string; group_name: string; statistic_key: string }): TeamMatchStatRow {
  return {
    statistic_name: 'Ball possession',
    home_value: '55', away_value: '45', home_display: '55%', away_display: '45%',
    value_type: 'PERCENT', compare_code: 'HOME', statistics_type: 'positive', render_type: 'bar',
    provider_code: 'SPORTSAPI_API', retrieved_at: '2026-07-18T02:00:00.000Z',
    ...over,
  };
}

describe('mapTeamStatLine', () => {
  test('passes raw provider strings through unchanged', () => {
    const line = mapTeamStatLine(row({ period: 'ALL', group_name: 'Possession', statistic_key: 'ballPossession' }));
    assert.deepEqual(line, {
      groupName: 'Possession', statisticKey: 'ballPossession', statisticName: 'Ball possession',
      home: { value: '55', display: '55%' }, away: { value: '45', display: '45%' },
      valueType: 'PERCENT', compareCode: 'HOME', statisticsType: 'positive', renderType: 'bar',
    });
  });

  test('a null provider value stays null (never fabricated to 0 or empty string)', () => {
    const line = mapTeamStatLine(row({ period: 'ALL', group_name: 'Shots', statistic_key: 'xg',
      home_value: null, away_value: null, home_display: null, away_display: null, statistic_name: null, compare_code: null }));
    assert.equal(line.home.value, null);
    assert.equal(line.away.value, null);
    assert.equal(line.home.display, null);
    assert.equal(line.statisticName, null);
    assert.equal(line.compareCode, null);
  });

  test('compareCode is surfaced verbatim, not re-derived from the values', () => {
    // home 10 < away 20 but provider says HOME — we must report the provider's code, not our own.
    const line = mapTeamStatLine(row({ period: 'ALL', group_name: 'Shots', statistic_key: 'shots', home_value: '10', away_value: '20', compare_code: 'HOME' }));
    assert.equal(line.compareCode, 'HOME');
  });
});

describe('groupTeamStatistics', () => {
  const rows: TeamMatchStatRow[] = [
    row({ period: '2ND', group_name: 'Possession', statistic_key: 'ballPossession' }),
    row({ period: 'ALL', group_name: 'Possession', statistic_key: 'ballPossession' }),
    row({ period: 'ALL', group_name: 'Shots', statistic_key: 'totalShots', home_value: '12', away_value: '9' }),
    row({ period: '1ST', group_name: 'Possession', statistic_key: 'ballPossession' }),
  ];
  const out = groupTeamStatistics(rows);

  test('periods ordered ALL, 1ST, 2ND regardless of input order', () => {
    assert.deepEqual(out.periods.map((p) => p.period), ['ALL', '1ST', '2ND']);
  });

  test('statistics grouped under their period, first-seen order preserved', () => {
    const all = out.periods.find((p) => p.period === 'ALL')!;
    assert.deepEqual(all.statistics.map((s) => s.statisticKey), ['ballPossession', 'totalShots']);
  });

  test('coverage present, periodsPresent lists the periods, observed flag set', () => {
    assert.equal(out.coverage.teamStatistics, 'present');
    assert.deepEqual(out.coverage.periodsPresent, ['ALL', '1ST', '2ND']);
    assert.equal(out.coverage.statisticsAreObserved, true);
  });

  test('provenance drawn from rows: provider + latest retrievedAt (ISO)', () => {
    const withLater = groupTeamStatistics([
      row({ period: 'ALL', group_name: 'Possession', statistic_key: 'ballPossession', retrieved_at: '2026-07-18T02:00:00.000Z' }),
      row({ period: 'ALL', group_name: 'Shots', statistic_key: 'shots', retrieved_at: '2026-07-19T09:30:00.000Z' }),
    ]);
    assert.equal(withLater.coverage.provider, 'SPORTSAPI_API');
    assert.equal(withLater.coverage.retrievedAt, '2026-07-19T09:30:00.000Z'); // latest
  });
});

describe('absence & governance', () => {
  test('no rows → empty periods, coverage absent, null provenance (never fabricated)', () => {
    const out = groupTeamStatistics([]);
    assert.deepEqual(out.periods, []);
    assert.equal(out.coverage.teamStatistics, 'absent');
    assert.deepEqual(out.coverage.periodsPresent, []);
    assert.equal(out.coverage.provider, null);
    assert.equal(out.coverage.retrievedAt, null);
    assert.equal(out.coverage.statisticsAreObserved, true);
  });

  test('projection is observed evidence only — no prediction/verdict/probability/score', () => {
    const out = groupTeamStatistics([row({ period: 'ALL', group_name: 'Possession', statistic_key: 'ballPossession' })]);
    const blob = JSON.stringify(out).toLowerCase();
    for (const term of ['predicted', 'probability', 'verdict', 'confidence', 'readiness', 'ranking']) {
      assert.equal(blob.includes(term), false, `team statistics must not emit "${term}"`);
    }
  });
});
