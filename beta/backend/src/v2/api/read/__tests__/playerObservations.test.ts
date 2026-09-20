// PLAYER MATCH-PERFORMANCE OBSERVATIONS — read-model tests (DB-free).
//
// Two layers per repo convention:
//   • Pure-logic unit tests: participation, result derivation, xG (own only),
//     null-not-zero, json exclusion, sequence index, coverage, historical team scope.
//   • SQL-shape assertions: strict `< $asOf`, COMPLETED + result join, participation
//     LEFT JOIN, deterministic ordering, edition/venue filters, no team-orientation /
//     no group_name / no period — with a capture tx for binding + no-N+1.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  numericOrNull, deriveResult, deriveParticipation, buildObservation,
  computeMetricCoverage, assemblePlayerObservations, readPlayerObservations,
  playerObservationsFixturesSql, PLAYER_OBSERVATIONS_STATS_SQL,
  CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS,
  type PlayerObsStatRow, type PlayerObsFixtureRow,
} from '../playerObservations';

// ── fixtures ────────────────────────────────────────────────────────────────────
const KO = '2026-08-23T19:00:00.000Z';
const statRow = (over: Partial<PlayerObsStatRow> & { statistic_key: string }): PlayerObsStatRow => ({
  fixture_id: '292', statistic_value: null, value_type: 'number',
  provider_code: 'SPORTSAPI_API', retrieved_at: '2026-08-23T21:00:00.000Z',
  ...over,
});
const fixtureRow = (over: Partial<PlayerObsFixtureRow> = {}): PlayerObsFixtureRow => ({
  fixture_id: '292', fixture_partition_on: '2026-08-23', kickoff_at: KO, is_home: true,
  edition_id: '18', season_label: 'Brasileiro Serie A 2026',
  competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325',
  team_id: '72', team_name: 'Palmeiras', team_slug: 'palmeiras-1963',
  opponent_id: '58', opponent_name: 'Vasco da Gama', opponent_slug: 'vasco-da-gama-1974',
  home_goals: 4, away_goals: 1, is_starting: true, ...over,
});

describe('numericOrNull — missing never becomes zero, real zero preserved', () => {
  test('coerces numbers, preserves 0, nulls non-numeric/empty', () => {
    assert.equal(numericOrNull('2.3'), 2.3);
    assert.equal(numericOrNull('0'), 0);       // real zero preserved
    assert.equal(numericOrNull(null), null);   // missing → null, not 0
    assert.equal(numericOrNull(''), null);
    assert.equal(numericOrNull('n/a'), null);
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

describe('deriveParticipation — STARTED / BENCH / UNKNOWN only', () => {
  test('is_starting true → STARTED, false → BENCH, null → UNKNOWN', () => {
    assert.equal(deriveParticipation(true), 'STARTED');
    assert.equal(deriveParticipation(false), 'BENCH');
    assert.equal(deriveParticipation(null), 'UNKNOWN');
  });
});

describe('buildObservation — team scope, result orientation, xG (own only), participation, missing≠zero', () => {
  const rows = [
    statRow({ statistic_key: 'minutesPlayed', statistic_value: '90' }),
    statRow({ statistic_key: 'goals', statistic_value: '2' }),
    statRow({ statistic_key: 'expectedGoals', statistic_value: '1.34' }),
    statRow({ statistic_key: 'totalTackle', statistic_value: '0' }), // real zero
  ];
  test('HOME player: result from player-team perspective, xG own value, STARTED', () => {
    const o = buildObservation(fixtureRow({ is_home: true, is_starting: true }), rows, 1);
    assert.equal(o.venueSide, 'home');
    assert.equal(o.team.id, '72'); assert.equal(o.opponent.id, '58');
    assert.equal(o.goalsFor, 4); assert.equal(o.goalsAgainst, 1); assert.equal(o.result, 'W'); assert.equal(o.points, 3);
    assert.equal(o.participation, 'STARTED');
    assert.equal(o.xg, 1.34);
    assert.equal((o as { xga?: unknown }).xga, undefined); // no player xGA field
    assert.equal(o.metrics.find((m) => m.key === 'goals')!.value, 2);
    assert.equal(o.metrics.find((m) => m.key === 'totalTackle')!.value, 0); // stored zero preserved
    assert.equal(o.metrics.find((m) => m.key === 'minutesPlayed')!.value, 90);
    assert.equal(o.metrics.find((m) => m.key === 'minutesPlayed')!.display, null); // no display column
    assert.equal(o.sequenceIndex, 1);
  });
  test('AWAY player: result flips to away perspective', () => {
    const o = buildObservation(fixtureRow({ is_home: false, is_starting: false }), rows, 2);
    assert.equal(o.venueSide, 'away');
    assert.equal(o.goalsFor, 1); assert.equal(o.goalsAgainst, 4); assert.equal(o.result, 'L'); assert.equal(o.points, 0);
    assert.equal(o.participation, 'BENCH');
    assert.equal(o.xg, 1.34); // own expectedGoals, orientation-independent
  });
  test('no lineup row → participation UNKNOWN (never inferred absent/not-selected)', () => {
    const o = buildObservation(fixtureRow({ is_starting: null }), rows, 1);
    assert.equal(o.participation, 'UNKNOWN');
  });
  test('missing expectedGoals → xg null (never inferred zero, never team-derived)', () => {
    const o = buildObservation(fixtureRow(), [statRow({ statistic_key: 'minutesPlayed', statistic_value: '45' })], 1);
    assert.equal(o.xg, null);
  });
  test('absent key → metric omitted (not zero)', () => {
    const o = buildObservation(fixtureRow(), [statRow({ statistic_key: 'minutesPlayed', statistic_value: '90' })], 1);
    assert.equal(o.metrics.find((m) => m.key === 'goals'), undefined);
    assert.equal(o.metrics.find((m) => m.key === 'saves'), undefined);
  });
  test('present-but-non-numeric value → null, not zero', () => {
    const o = buildObservation(fixtureRow(), [statRow({ statistic_key: 'minutesPlayed', statistic_value: 'x' })], 1);
    assert.equal(o.metrics.find((m) => m.key === 'minutesPlayed')!.value, null);
  });
  test('json-typed value → excluded from metrics and from xg', () => {
    const o = buildObservation(fixtureRow(), [
      statRow({ statistic_key: 'minutesPlayed', statistic_value: '90' }),
      statRow({ statistic_key: 'expectedGoals', statistic_value: '{"raw":1}', value_type: 'json' }),
    ], 1);
    assert.equal(o.xg, null); // json xG excluded
    assert.equal(o.metrics.find((m) => m.key === 'expectedGoals'), undefined);
  });
  test('provenance: uniform provider + latest retrieved_at across the player rows', () => {
    const o = buildObservation(fixtureRow(), [
      statRow({ statistic_key: 'minutesPlayed', statistic_value: '90', retrieved_at: '2026-08-23T21:00:00.000Z' }),
      statRow({ statistic_key: 'goals', statistic_value: '1', retrieved_at: '2026-08-23T21:07:00.000Z' }),
    ], 1);
    assert.equal(o.provenance.provider, 'SPORTSAPI_API');
    assert.equal(o.provenance.retrievedAt, '2026-08-23T21:07:00.000Z');
  });
});

describe('computeMetricCoverage — present / partial / absent', () => {
  test('goals present on 1 of 2 observations → partial; absent key → absent', () => {
    const withGoals = buildObservation(fixtureRow({ fixture_id: '1' }), [statRow({ fixture_id: '1', statistic_key: 'goals', statistic_value: '1' })], 1);
    const without = buildObservation(fixtureRow({ fixture_id: '2' }), [statRow({ fixture_id: '2', statistic_key: 'minutesPlayed', statistic_value: '20' })], 2);
    const cov = computeMetricCoverage([withGoals, without]);
    const goals = cov.find((c) => c.key === 'goals')!;
    assert.equal(goals.state, 'partial'); assert.equal(goals.present, 1); assert.equal(goals.total, 2);
    const saves = cov.find((c) => c.key === 'saves')!;
    assert.equal(saves.state, 'absent'); assert.equal(saves.present, 0);
    const mins = cov.find((c) => c.key === 'minutesPlayed')!;
    assert.equal(mins.state, 'partial'); // present on the second only
  });
});

describe('assemblePlayerObservations — sequence index, coverage existence, scope', () => {
  test('sequence 1..n; coverage present; scope reflects filters', () => {
    const fixtures = [fixtureRow({ fixture_id: '1' }), fixtureRow({ fixture_id: '2' })];
    const stats = new Map<string, PlayerObsStatRow[]>([
      ['1', [statRow({ fixture_id: '1', statistic_key: 'minutesPlayed', statistic_value: '90' })]],
      ['2', [statRow({ fixture_id: '2', statistic_key: 'minutesPlayed', statistic_value: '75' })]],
    ]);
    const res = assemblePlayerObservations({ id: '9', fullName: 'Raphael Veiga', slug: 'raphael-veiga' }, fixtures, stats,
      { asOf: new Date('2026-09-01T00:00:00.000Z'), editionId: '18', venue: 'home', order: 'asc' });
    assert.equal(res.observationCount, 2);
    assert.deepEqual(res.observations.map((o) => o.sequenceIndex), [1, 2]);
    assert.equal(res.coverage.observations, 'present');
    assert.deepEqual(res.scope, { competition: 'edition', editionId: '18', venue: 'home', order: 'asc' });
  });
  test('empty series → count 0, coverage absent, no manufactured rows', () => {
    const res = assemblePlayerObservations({ id: '9', fullName: 'X', slug: 'x' }, [], new Map(),
      { asOf: new Date('2026-09-01T00:00:00.000Z'), editionId: null, venue: null, order: 'asc' });
    assert.equal(res.observationCount, 0);
    assert.equal(res.coverage.observations, 'absent');
    assert.deepEqual(res.observations, []);
    assert.equal(res.scope.competition, 'all');
    assert.equal(res.scope.venue, 'all');
  });
});

describe('historical team scope — a fixture uses its own team_id, never a current team', () => {
  test('player observed under two different teams keeps each fixture on its own team', () => {
    const fixtures = [
      fixtureRow({ fixture_id: '1', team_id: '72', team_name: 'Palmeiras', team_slug: 'palmeiras-1963', is_home: true, opponent_id: '58' }),
      fixtureRow({ fixture_id: '2', team_id: '58', team_name: 'Vasco da Gama', team_slug: 'vasco-da-gama-1974', is_home: false, opponent_id: '72', opponent_name: 'Palmeiras', opponent_slug: 'palmeiras-1963' }),
    ];
    const stats = new Map<string, PlayerObsStatRow[]>([
      ['1', [statRow({ fixture_id: '1', statistic_key: 'minutesPlayed', statistic_value: '90' })]],
      ['2', [statRow({ fixture_id: '2', statistic_key: 'minutesPlayed', statistic_value: '90' })]],
    ]);
    const res = assemblePlayerObservations({ id: '9', fullName: 'Transfer Player', slug: 'transfer-player' }, fixtures, stats,
      { asOf: new Date('2026-09-01T00:00:00.000Z'), editionId: null, venue: null, order: 'asc' });
    assert.equal(res.observations[0].team.id, '72');
    assert.equal(res.observations[1].team.id, '58');
    assert.equal(res.observations[1].opponent.id, '72'); // opponent correct on the second team's fixture
  });
});

describe('canonical metric set — definitional', () => {
  test('excludes composites/metadata and the P1-absent keys; includes confirmed keys', () => {
    const keys = new Set<string>(CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS);
    for (const excluded of ['rating', 'ratingVersions', 'statisticsType', 'defensiveValueNormalized', 'passValueNormalized', 'dribbleValueNormalized', 'keyPasses', 'goalsPrevented']) {
      assert.equal(keys.has(excluded), false, `canonical set must exclude ${excluded}`);
    }
    for (const included of ['minutesPlayed', 'goals', 'expectedGoals', 'expectedGoalsOnTarget', 'saves', 'goalAssist', 'kilometersCovered', 'numberOfSprints', 'totalShots']) {
      assert.equal(keys.has(included), true, `canonical set should include ${included}`);
    }
  });
});

// ── SQL shape ─────────────────────────────────────────────────────────────────
describe('SQL shape — strict as-of, eligibility, participation, deterministic order, no team-orientation', () => {
  test('fixtures SQL: strict `< $2`, COMPLETED, result join, participation LEFT JOIN, edition/venue filters, order, read-only', () => {
    const asc = playerObservationsFixturesSql('asc');
    assert.match(asc, /f\.scheduled_kickoff_at < \$2::timestamptz/); // STRICT, never <=
    assert.doesNotMatch(asc, /scheduled_kickoff_at <= /);
    assert.match(asc, /f\.lifecycle_state_code = 'COMPLETED'/);
    assert.match(asc, /JOIN football\.result r\s+ON r\.fixture_id = f\.id/);
    assert.match(asc, /LEFT JOIN football\.lineup_selection ls/);
    assert.match(asc, /player_match_statistic[\s\S]*WHERE player_id = \$1::bigint/); // team_id from stats, not current team
    assert.match(asc, /\$3::bigint IS NULL OR f\.competition_edition_id = \$3::bigint/);
    assert.match(asc, /\$4 = 'home'[\s\S]*\$4 = 'away'/);
    assert.match(asc, /ORDER BY f\.scheduled_kickoff_at ASC, f\.id ASC/);
    assert.match(playerObservationsFixturesSql('desc'), /ORDER BY f\.scheduled_kickoff_at DESC, f\.id DESC/);
    // must NOT carry team-observation-only structures
    assert.doesNotMatch(asc, /home_value|away_value|group_name|period = 'ALL'/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(asc));
  });
  test('stats SQL: player-scoped, fixture-id array, no period/group_name, read-only', () => {
    assert.match(PLAYER_OBSERVATIONS_STATS_SQL, /pms\.player_id = \$1::bigint/);
    assert.match(PLAYER_OBSERVATIONS_STATS_SQL, /pms\.fixture_id = ANY\(\$2::bigint\[\]\)/);
    assert.doesNotMatch(PLAYER_OBSERVATIONS_STATS_SQL, /period|group_name|home_value|away_value/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(PLAYER_OBSERVATIONS_STATS_SQL));
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

describe('readPlayerObservations — binding + 404 + no N+1', () => {
  test('unknown/unexposed player → null (404), only the identity query runs', async () => {
    const { tx, calls } = captureTx([[]]); // identity returns no rows
    const res = await readPlayerObservations(tx, '999');
    assert.equal(res, null);
    assert.equal(calls.length, 1); // no fixtures/stats queries issued
  });
  test('exposed player, no fixtures → empty series; exactly identity + fixtures (no per-fixture N+1)', async () => {
    const { tx, calls } = captureTx([[{ id: '9', full_name: 'Raphael Veiga', slug: 'raphael-veiga' }], []]);
    const res = await readPlayerObservations(tx, '9', { asOf: new Date('2026-09-01T00:00:00.000Z') });
    assert.ok(res); assert.equal(res!.observationCount, 0);
    assert.equal(res!.player.fullName, 'Raphael Veiga');
    assert.equal(calls.length, 2); // identity + fixtures; stats skipped when no fixtures
    assert.equal(calls[1].params[0], '9');
    assert.ok(calls[1].params[1] instanceof Date); // as_of bound
  });
  test('exposed player with fixtures → identity + fixtures + ONE stats query (bounded, not per fixture)', async () => {
    const { tx, calls } = captureTx([
      [{ id: '9', full_name: 'Raphael Veiga', slug: 'raphael-veiga' }],
      [fixtureRow({ fixture_id: '1' }), fixtureRow({ fixture_id: '2' })],
      [statRow({ fixture_id: '1', statistic_key: 'minutesPlayed', statistic_value: '90' }),
       statRow({ fixture_id: '2', statistic_key: 'minutesPlayed', statistic_value: '75' })],
    ]);
    const res = await readPlayerObservations(tx, '9', { asOf: new Date('2026-09-01T00:00:00.000Z') });
    assert.equal(calls.length, 3); // identity + fixtures + one stats-by-ids query
    assert.equal(calls[2].params[0], '9');               // stats scoped to the player
    assert.deepEqual(calls[2].params[1], ['1', '2']);    // fetched for both fixtures in one call
    assert.equal(res!.observationCount, 2);
    assert.deepEqual(res!.observations.map((o) => o.sequenceIndex), [1, 2]);
  });
});
