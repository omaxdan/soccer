// TEAM MATCH-PERFORMANCE OBSERVATIONS — read-model tests (DB-free).
//
// Two layers per repo convention:
//   • Pure-logic unit tests: orientation, result derivation, group dedup + agreement,
//     xG/xGA, null-not-zero, event-conditional absence, sequence index, coverage.
//   • SQL-shape assertions: strict `< $asOf`, COMPLETED + result join, ALL period,
//     deterministic ordering, edition/venue filters — with a capture tx for binding.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  numericOrNull, orientStat, deriveResult, collapseFixtureStats, buildObservation,
  computeMetricCoverage, assembleTeamObservations, readTeamObservations,
  teamObservationsFixturesSql, TEAM_OBSERVATIONS_STATS_SQL, TeamObservationDataIntegrityError,
  CANONICAL_OBSERVATION_METRIC_KEYS,
  type ObsStatRow, type ObsFixtureRow,
} from '../teamObservations';

// ── fixtures ────────────────────────────────────────────────────────────────────
const KO = '2026-08-23T19:00:00.000Z';
const statRow = (over: Partial<ObsStatRow> & { statistic_key: string }): ObsStatRow => ({
  fixture_id: '292', group_name: 'Match overview', statistic_name: null,
  home_value: null, away_value: null, home_display: null, away_display: null,
  value_type: 'number', provider_code: 'SPORTSAPI_API', retrieved_at: '2026-08-23T21:00:00.000Z',
  ...over,
});
const fixtureRow = (over: Partial<ObsFixtureRow> = {}): ObsFixtureRow => ({
  fixture_id: '292', fixture_partition_on: '2026-08-23', kickoff_at: KO, is_home: true,
  edition_id: '18', season_label: 'Brasileiro Serie A 2026',
  competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325',
  opponent_id: '58', opponent_name: 'Vasco da Gama', opponent_slug: 'vasco-da-gama-1974',
  home_goals: 4, away_goals: 1, ...over,
});

describe('numericOrNull — missing never becomes zero, real zero preserved', () => {
  test('coerces numbers, preserves 0, nulls non-numeric/empty', () => {
    assert.equal(numericOrNull('49.7'), 49.7);
    assert.equal(numericOrNull('0'), 0);       // real zero preserved
    assert.equal(numericOrNull(null), null);   // missing → null, not 0
    assert.equal(numericOrNull(''), null);
    assert.equal(numericOrNull('n/a'), null);
  });
});

describe('orientStat — target orientation (home vs away)', () => {
  const row = statRow({ statistic_key: 'ballPossession', home_value: '57', away_value: '43', home_display: '57%', away_display: '43%' });
  test('home target reads home_value; away target reads away_value', () => {
    assert.deepEqual(orientStat(row, true), { value: '57', display: '57%' });
    assert.deepEqual(orientStat(row, false), { value: '43', display: '43%' });
  });
});

describe('deriveResult — deterministic W/D/L, margin, points, clean sheet', () => {
  test('win / draw / loss + clean sheet', () => {
    assert.deepEqual(deriveResult(4, 1), { result: 'W', goalMargin: 3, points: 3, cleanSheet: false });
    assert.deepEqual(deriveResult(2, 2), { result: 'D', goalMargin: 0, points: 1, cleanSheet: false });
    assert.deepEqual(deriveResult(0, 2), { result: 'L', goalMargin: -2, points: 0, cleanSheet: false });
    assert.deepEqual(deriveResult(1, 0), { result: 'W', goalMargin: 1, points: 3, cleanSheet: true });
  });
});

describe('collapseFixtureStats — one metric per statistic_key, group agreement enforced', () => {
  test('same key in two groups with equal oriented values → collapsed once (smallest group_name)', () => {
    const rows = [
      statRow({ statistic_key: 'totalTackle', group_name: 'Duels', home_value: '18', away_value: '11' }),
      statRow({ statistic_key: 'totalTackle', group_name: 'Defending', home_value: '18', away_value: '11' }),
    ];
    const c = collapseFixtureStats(rows, true);
    assert.equal(c.byKey.size, 1);
    assert.equal(c.byKey.get('totalTackle')!.group_name, 'Defending'); // 'Defending' < 'Duels'
  });
  test('duplicate groups with DIFFERENT oriented values → data-integrity error (no silent pick)', () => {
    const rows = [
      statRow({ statistic_key: 'totalTackle', group_name: 'Duels', home_value: '18', away_value: '11' }),
      statRow({ statistic_key: 'totalTackle', group_name: 'Defending', home_value: '19', away_value: '11' }),
    ];
    assert.throws(() => collapseFixtureStats(rows, true), TeamObservationDataIntegrityError);
  });
  test('provenance: uniform provider + latest retrieved_at across rows', () => {
    const rows = [
      statRow({ statistic_key: 'passes', retrieved_at: '2026-08-23T21:00:00.000Z' }),
      statRow({ statistic_key: 'fouls', retrieved_at: '2026-08-23T21:05:00.000Z' }),
    ];
    const c = collapseFixtureStats(rows, true);
    assert.equal(c.provider, 'SPORTSAPI_API');
    assert.equal(c.retrievedAt, '2026-08-23T21:05:00.000Z');
  });
});

describe('buildObservation — orientation, result, xG/xGA, metrics, missing≠zero', () => {
  const rows = [
    statRow({ statistic_key: 'ballPossession', home_value: '57', away_value: '43', home_display: '57%', away_display: '43%' }),
    statRow({ statistic_key: 'expectedGoals', home_value: '1.74', away_value: '2.15' }),
    statRow({ statistic_key: 'redCards', home_value: '0', away_value: '1' }), // real zero for target
  ];
  test('HOME target: values, result, xG/xGA from home perspective', () => {
    const o = buildObservation(fixtureRow({ is_home: true }), rows, 1);
    assert.equal(o.venueSide, 'home');
    assert.equal(o.goalsFor, 4); assert.equal(o.goalsAgainst, 1); assert.equal(o.result, 'W'); assert.equal(o.points, 3);
    assert.equal(o.xg, 1.74);    // target expectedGoals
    assert.equal(o.xga, 2.15);   // opponent expectedGoals, same fixture
    const poss = o.metrics.find((m) => m.key === 'ballPossession')!;
    assert.equal(poss.value, 57); assert.equal(poss.display, '57%');
    const rc = o.metrics.find((m) => m.key === 'redCards')!;
    assert.equal(rc.value, 0);   // stored zero preserved, not dropped
    assert.equal(o.sequenceIndex, 1);
  });
  test('AWAY target: orientation flips values, result, xG/xGA', () => {
    const o = buildObservation(fixtureRow({ is_home: false }), rows, 3);
    assert.equal(o.venueSide, 'away');
    assert.equal(o.goalsFor, 1); assert.equal(o.goalsAgainst, 4); assert.equal(o.result, 'L'); assert.equal(o.points, 0);
    assert.equal(o.xg, 2.15); assert.equal(o.xga, 1.74);
    assert.equal(o.metrics.find((m) => m.key === 'ballPossession')!.value, 43);
    assert.equal(o.sequenceIndex, 3);
  });
  test('missing xG → xg/xga null (never inferred zero)', () => {
    const noXg = [statRow({ statistic_key: 'ballPossession', home_value: '50', away_value: '50' })];
    const o = buildObservation(fixtureRow(), noXg, 1);
    assert.equal(o.xg, null); assert.equal(o.xga, null);
  });
  test('event-conditional absence → metric omitted, never coerced to zero', () => {
    const o = buildObservation(fixtureRow(), [statRow({ statistic_key: 'ballPossession', home_value: '50', away_value: '50' })], 1);
    assert.equal(o.metrics.find((m) => m.key === 'hitWoodwork'), undefined); // absent, not 0
    assert.equal(o.metrics.find((m) => m.key === 'redCards'), undefined);
  });
  test('present-but-non-numeric value → null, not zero', () => {
    const o = buildObservation(fixtureRow(), [statRow({ statistic_key: 'ballPossession', home_value: 'x', away_value: 'y' })], 1);
    assert.equal(o.metrics.find((m) => m.key === 'ballPossession')!.value, null);
  });
  test('no duplicate metric per statistic_key', () => {
    const dup = [
      statRow({ statistic_key: 'passes', group_name: 'Passes', home_value: '551', away_value: '407' }),
      statRow({ statistic_key: 'passes', group_name: 'Match overview', home_value: '551', away_value: '407' }),
    ];
    const o = buildObservation(fixtureRow(), dup, 1);
    assert.equal(o.metrics.filter((m) => m.key === 'passes').length, 1);
  });
});

describe('computeMetricCoverage — present / partial / absent', () => {
  test('xG present on 1 of 2 observations → partial', () => {
    const withXg = buildObservation(fixtureRow({ fixture_id: '1' }), [statRow({ fixture_id: '1', statistic_key: 'expectedGoals', home_value: '1.5', away_value: '0.9' })], 1);
    const without = buildObservation(fixtureRow({ fixture_id: '2' }), [statRow({ fixture_id: '2', statistic_key: 'ballPossession', home_value: '50', away_value: '50' })], 2);
    const cov = computeMetricCoverage([withXg, without]);
    const xg = cov.find((c) => c.key === 'expectedGoals')!;
    assert.equal(xg.state, 'partial'); assert.equal(xg.present, 1); assert.equal(xg.total, 2);
    const poss = cov.find((c) => c.key === 'ballPossession')!;
    assert.equal(poss.state, 'partial'); // present on the second only
    const hw = cov.find((c) => c.key === 'hitWoodwork')!;
    assert.equal(hw.state, 'absent'); assert.equal(hw.present, 0);
  });
});

describe('assembleTeamObservations — sequence index, coverage existence, scope', () => {
  test('sequence index is 1..n in returned order; coverage present; scope reflects filters', () => {
    const fixtures = [fixtureRow({ fixture_id: '1' }), fixtureRow({ fixture_id: '2' })];
    const stats = new Map<string, ObsStatRow[]>([
      ['1', [statRow({ fixture_id: '1', statistic_key: 'ballPossession', home_value: '55', away_value: '45' })]],
      ['2', [statRow({ fixture_id: '2', statistic_key: 'ballPossession', home_value: '48', away_value: '52' })]],
    ]);
    const res = assembleTeamObservations({ id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }, fixtures, stats,
      { asOf: new Date('2026-09-01T00:00:00.000Z'), editionId: '18', venue: 'home', order: 'asc' });
    assert.equal(res.observationCount, 2);
    assert.deepEqual(res.observations.map((o) => o.sequenceIndex), [1, 2]);
    assert.equal(res.coverage.observations, 'present');
    assert.deepEqual(res.scope, { competition: 'edition', editionId: '18', venue: 'home', order: 'asc' });
  });
  test('empty series → observationCount 0, coverage absent, no manufactured rows', () => {
    const res = assembleTeamObservations({ id: '999', name: 'X', slug: 'x' }, [], new Map(),
      { asOf: new Date('2026-09-01T00:00:00.000Z'), editionId: null, venue: null, order: 'asc' });
    assert.equal(res.observationCount, 0);
    assert.equal(res.coverage.observations, 'absent');
    assert.deepEqual(res.observations, []);
    assert.equal(res.scope.competition, 'all');
    assert.equal(res.scope.venue, 'all');
  });
});

describe('canonical metric set — definitional', () => {
  test('excludes avgRating; includes core + xG + event-conditional', () => {
    const keys = new Set<string>(CANONICAL_OBSERVATION_METRIC_KEYS);
    assert.equal(keys.has('avgRating'), false);
    for (const k of ['ballPossession', 'expectedGoals', 'expectedGoalsOnTarget', 'redCards', 'hitWoodwork', 'penaltySaves']) {
      assert.equal(keys.has(k), true, `canonical set should include ${k}`);
    }
  });
});

// ── SQL shape ─────────────────────────────────────────────────────────────────
describe('SQL shape — strict as-of, eligibility, ALL period, deterministic order', () => {
  test('fixtures SQL: strict `< $2`, COMPLETED, result join, edition/venue filters, kickoff+id order, read-only', () => {
    const asc = teamObservationsFixturesSql('asc');
    assert.match(asc, /f\.scheduled_kickoff_at < \$2::timestamptz/); // STRICT, never <=
    assert.doesNotMatch(asc, /scheduled_kickoff_at <= /);
    assert.match(asc, /f\.lifecycle_state_code = 'COMPLETED'/);
    assert.match(asc, /JOIN football\.result r\s+ON r\.fixture_id = f\.id/);
    assert.match(asc, /\$3::bigint IS NULL OR f\.competition_edition_id = \$3::bigint/);
    assert.match(asc, /\$4 = 'home'[\s\S]*\$4 = 'away'/);
    assert.match(asc, /ORDER BY f\.scheduled_kickoff_at ASC, f\.id ASC/);
    assert.match(teamObservationsFixturesSql('desc'), /ORDER BY f\.scheduled_kickoff_at DESC, f\.id DESC/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(asc));
  });
  test('stats SQL: ALL period only, fixture-id array, read-only', () => {
    assert.match(TEAM_OBSERVATIONS_STATS_SQL, /tms\.period = 'ALL'/);
    assert.match(TEAM_OBSERVATIONS_STATS_SQL, /tms\.fixture_id = ANY\(\$1::bigint\[\]\)/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(TEAM_OBSERVATIONS_STATS_SQL));
  });
});

// ── read binding (capture tx) ────────────────────────────────────────────────
function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: queue[i++] ?? [] }; },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('readTeamObservations — binding + 404 + no N+1', () => {
  test('unknown team → null (404), only the identity query runs', async () => {
    const { tx, calls } = captureTx([[]]); // identity returns no rows
    const res = await readTeamObservations(tx, '999');
    assert.equal(res, null);
    assert.equal(calls.length, 1); // no fixtures/stats queries issued
  });
  test('known team, no fixtures → empty series; exactly identity + fixtures queries (no per-fixture N+1)', async () => {
    const { tx, calls } = captureTx([[{ id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }], []]);
    const res = await readTeamObservations(tx, '72', { asOf: new Date('2026-09-01T00:00:00.000Z') });
    assert.ok(res); assert.equal(res!.observationCount, 0);
    assert.equal(calls.length, 2); // identity + fixtures; stats skipped when no fixtures
    assert.equal(calls[1].params[0], '72');
    assert.ok(calls[1].params[1] instanceof Date); // as_of bound
  });
  test('known team with fixtures → identity + fixtures + ONE stats query (bounded, not per fixture)', async () => {
    const { tx, calls } = captureTx([
      [{ id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }],
      [fixtureRow({ fixture_id: '1' }), fixtureRow({ fixture_id: '2' })],
      [statRow({ fixture_id: '1', statistic_key: 'ballPossession', home_value: '55', away_value: '45' }),
       statRow({ fixture_id: '2', statistic_key: 'ballPossession', home_value: '50', away_value: '50' })],
    ]);
    const res = await readTeamObservations(tx, '72', { asOf: new Date('2026-09-01T00:00:00.000Z') });
    assert.equal(calls.length, 3); // identity + fixtures + one stats-by-ids query
    assert.deepEqual(calls[2].params[0], ['1', '2']); // stats fetched for both fixtures in one call
    assert.equal(res!.observationCount, 2);
    assert.deepEqual(res!.observations.map((o) => o.sequenceIndex), [1, 2]);
  });
});
