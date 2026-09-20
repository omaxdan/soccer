// TEAM TEMPORAL PERFORMANCE — read-model tests (DB-free).
//
// Layers:
//   • Pure-logic: metric classification, window selection (Last5/Previous5, no overlap),
//     SUM vs MEAN aggregation, xG sum, missing≠zero + coverage, change/percentage-point/
//     percentage/zero-previous, direction (raw only), results comparison, sample gate,
//     scope preservation, season.
//   • Binding: reuses readTeamObservations (404 passthrough; single observation read).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  metricClass, aggregateMetric, aggregateResults, compareMetric, assembleTeamTemporalPerformance,
  readTeamTemporalPerformance, PERCENT_METRIC_KEYS, AGGREGATION_VERSION,
} from '../teamTemporalPerformance';
import type { TeamObservation, TeamObservationsResponse } from '../teamObservations';

// ── observation builders ─────────────────────────────────────────────────────────
let seq = 0;
const obsPoint = (over: Partial<TeamObservation> & { fixtureId: string }): TeamObservation => ({
  fixtureId: over.fixtureId,
  fixturePartitionOn: '2026-01-01',
  competition: { id: '28', name: 'Brasileirão', slug: 'b' },
  edition: { id: '18', seasonLabel: 'S' },
  kickoffAt: over.kickoffAt ?? `2026-01-${String((seq = (seq % 27) + 1)).padStart(2, '0')}T00:00:00.000Z`,
  sequenceIndex: 0,
  opponent: { id: '99', name: 'Opp', slug: 'opp' },
  venueSide: over.venueSide ?? 'home',
  result: over.result ?? 'W',
  goalsFor: over.goalsFor ?? 1,
  goalsAgainst: over.goalsAgainst ?? 0,
  goalMargin: (over.goalsFor ?? 1) - (over.goalsAgainst ?? 0),
  points: over.points ?? (((over.goalsFor ?? 1) > (over.goalsAgainst ?? 0)) ? 3 : (over.goalsFor ?? 1) === (over.goalsAgainst ?? 0) ? 1 : 0),
  cleanSheet: (over.goalsAgainst ?? 0) === 0,
  xg: over.xg ?? null,
  xga: over.xga ?? null,
  provenance: { provider: 'P', retrievedAt: '2026-01-01T00:00:00.000Z' },
  metrics: over.metrics ?? [],
});

const metric = (key: string, value: number | null) => ({ key, value, display: null });

function wrap(observations: TeamObservation[], scope?: Partial<TeamObservationsResponse['scope']>): TeamObservationsResponse {
  return {
    team: { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' },
    scope: { competition: 'all', editionId: null, venue: 'all', order: 'asc', ...scope },
    asOf: '2026-09-20T00:00:00.000Z',
    observationCount: observations.length,
    coverage: { observations: observations.length > 0 ? 'present' : 'absent', metrics: [] },
    observations,
  };
}

describe('metricClass — percentage metrics → MEAN, everything else → SUM', () => {
  test('classification', () => {
    for (const k of PERCENT_METRIC_KEYS) assert.equal(metricClass(k), 'MEAN');
    assert.equal(metricClass('ballPossession'), 'MEAN');
    assert.equal(metricClass('goals'), 'SUM');
    assert.equal(metricClass('shotsOnGoal'), 'SUM');
    assert.equal(metricClass('expectedGoals'), 'SUM');
    assert.equal(metricClass('expectedGoalsAgainst'), 'SUM');
  });
});

describe('aggregateMetric — SUM/MEAN, missing≠zero, coverage', () => {
  const window = [
    obsPoint({ fixtureId: '1', metrics: [metric('shotsOnGoal', 5), metric('ballPossession', 60), metric('expectedGoals', 1.2)] }),
    obsPoint({ fixtureId: '2', metrics: [metric('shotsOnGoal', 3), metric('ballPossession', 40)] }), // xG missing here
    obsPoint({ fixtureId: '3', metrics: [metric('shotsOnGoal', 4), metric('ballPossession', 50), metric('expectedGoals', 0.8)] }),
  ];
  test('SUM count metric sums all present', () => {
    const a = aggregateMetric(window, 'shotsOnGoal');
    assert.equal(a.value, 12); assert.equal(a.observations, 3); assert.equal(a.windowSize, 3);
  });
  test('MEAN percentage metric averages present', () => {
    const a = aggregateMetric(window, 'ballPossession');
    assert.equal(a.value, 50); assert.equal(a.observations, 3);
  });
  test('xG SUM over only the observations that carry it (missing≠zero)', () => {
    const a = aggregateMetric(window, 'expectedGoals');
    assert.equal(a.value, 2); assert.equal(a.observations, 2); assert.equal(a.windowSize, 3); // 1.2 + 0.8, coverage 2/3
  });
  test('absent metric → value null, observations 0 (never zero-filled)', () => {
    const a = aggregateMetric(window, 'redCards');
    assert.equal(a.value, null); assert.equal(a.observations, 0);
  });
  test('xGA sourced from obs.xga', () => {
    const w = [obsPoint({ fixtureId: '1', xga: 1.5 }), obsPoint({ fixtureId: '2', xga: 0.5 })];
    assert.equal(aggregateMetric(w, 'expectedGoalsAgainst').value, 2);
  });
});

describe('aggregateResults — W/D/L, points, GF/GA/GD', () => {
  test('counts + sums', () => {
    const w = [
      obsPoint({ fixtureId: '1', result: 'W', goalsFor: 2, goalsAgainst: 0 }),
      obsPoint({ fixtureId: '2', result: 'D', goalsFor: 1, goalsAgainst: 1 }),
      obsPoint({ fixtureId: '3', result: 'L', goalsFor: 0, goalsAgainst: 2 }),
    ];
    const r = aggregateResults(w);
    assert.deepEqual(r, { wins: 1, draws: 1, losses: 1, points: 4, goalsFor: 3, goalsAgainst: 3, goalDifference: 0 });
  });
});

describe('compareMetric — change, percentage-point vs percentage, direction, availability', () => {
  const prev = [obsPoint({ fixtureId: 'p', metrics: [metric('shotsOnGoal', 3), metric('ballPossession', 48)] })];
  const last = [obsPoint({ fixtureId: 'l', metrics: [metric('shotsOnGoal', 6), metric('ballPossession', 55)] })];
  test('SUM: absolute change + relative %; direction UP', () => {
    const c = compareMetric(prev, last, 'shotsOnGoal');
    assert.equal(c.change, 3); assert.equal(c.changeType, 'absolute');
    assert.equal(c.percentageChange, 100); assert.equal(c.direction, 'UP');
  });
  test('MEAN percentage metric: percentage-point change, no relative %', () => {
    const c = compareMetric(prev, last, 'ballPossession');
    assert.equal(c.change, 7); assert.equal(c.changeType, 'percentage_point');
    assert.equal(c.percentageChange, null); assert.equal(c.direction, 'UP');
  });
  test('previous value 0 → percentageChange null (no divide by zero)', () => {
    const p0 = [obsPoint({ fixtureId: 'p', metrics: [metric('goals', 0)] })];
    const l3 = [obsPoint({ fixtureId: 'l', metrics: [metric('goals', 3)] })];
    const c = compareMetric(p0, l3, 'goals');
    assert.equal(c.change, 3); assert.equal(c.percentageChange, null); assert.equal(c.direction, 'UP');
  });
  test('metric missing in one window → change null, direction UNAVAILABLE', () => {
    const c = compareMetric([obsPoint({ fixtureId: 'p', metrics: [] })], last, 'shotsOnGoal');
    assert.equal(c.change, null); assert.equal(c.direction, 'UNAVAILABLE');
  });
  test('decrease → DOWN, equal → UNCHANGED', () => {
    assert.equal(compareMetric(last, prev, 'shotsOnGoal').direction, 'DOWN');
    assert.equal(compareMetric(prev, prev, 'shotsOnGoal').direction, 'UNCHANGED');
  });
});

describe('assemble — windows, no overlap, sample gate, scope, season', () => {
  const many = Array.from({ length: 12 }, (_, i) => obsPoint({
    fixtureId: String(i + 1), kickoffAt: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    result: 'W', goalsFor: 2, goalsAgainst: 0, xg: 1,
    metrics: [metric('shotsOnGoal', 4), metric('ballPossession', 50), metric('expectedGoals', 1)],
  }));
  test('Last5 = final 5, Previous5 = preceding 5, disjoint, correct fixtureIds', () => {
    const r = assembleTeamTemporalPerformance(wrap(many));
    assert.equal(r.comparisonStatus, 'available');
    assert.deepEqual(r.provenance.last5FixtureIds, ['8', '9', '10', '11', '12']);
    assert.deepEqual(r.provenance.previous5FixtureIds, ['3', '4', '5', '6', '7']);
    const overlap = r.provenance.last5FixtureIds.filter((f) => r.provenance.previous5FixtureIds.includes(f));
    assert.equal(overlap.length, 0);
    assert.equal(r.windows.last5.status, 'complete');
    assert.equal(r.windows.previous5!.status, 'complete');
  });
  test('results comparison + a metric comparison present; xG summed to 5 per window', () => {
    const r = assembleTeamTemporalPerformance(wrap(many));
    assert.deepEqual(r.results.change, { wins: 0, draws: 0, losses: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0 });
    const xg = r.comparisons.find((c) => c.metric === 'expectedGoals')!;
    assert.equal(xg.last5.value, 5); assert.equal(xg.previous5.value, 5); assert.equal(xg.change, 0);
    const shots = r.comparisons.find((c) => c.metric === 'shotsOnGoal')!;
    assert.equal(shots.last5.value, 20);
  });
  test('fewer than 10 observations → insufficient_sample, no previous5 comparison', () => {
    const r = assembleTeamTemporalPerformance(wrap(many.slice(0, 7)));
    assert.equal(r.comparisonStatus, 'insufficient_sample');
    assert.equal(r.windows.previous5!.status, 'insufficient');
    assert.equal(r.results.previous5, null);
    assert.equal(r.results.change, null);
    assert.deepEqual(r.comparisons, []);
    assert.ok(r.results.last5); // recent window still summarised
  });
  test('scope preserved (ALL competitions labelled honestly); season over full series', () => {
    const r = assembleTeamTemporalPerformance(wrap(many));
    assert.equal(r.scope.competition, 'all'); assert.equal(r.scope.label, 'all competitions');
    assert.equal(r.season.observationCount, 12);
    assert.equal(r.season.results.wins, 12);
    const seasonShots = r.season.metrics.find((m) => m.metric === 'shotsOnGoal')!;
    assert.equal(seasonShots.value, 48); assert.equal(seasonShots.total, 12);
  });
  test('edition scope labelled as edition', () => {
    const r = assembleTeamTemporalPerformance(wrap(many, { competition: 'edition', editionId: '18' }));
    assert.equal(r.scope.label, 'edition 18');
    assert.equal(r.season.scopeLabel, 'edition 18');
  });
  test('empty series → insufficient, season zeros, no fabricated windows', () => {
    const r = assembleTeamTemporalPerformance(wrap([]));
    assert.equal(r.comparisonStatus, 'insufficient_sample');
    assert.equal(r.windows.previous5, null);
    assert.equal(r.results.last5, null);
    assert.equal(r.season.observationCount, 0);
    assert.equal(r.aggregation.version, AGGREGATION_VERSION);
  });
  test('exactly 10 observations → comparison available (boundary)', () => {
    const r = assembleTeamTemporalPerformance(wrap(many.slice(0, 10)));
    assert.equal(r.comparisonStatus, 'available');
    assert.deepEqual(r.provenance.previous5FixtureIds, ['1', '2', '3', '4', '5']);
    assert.deepEqual(r.provenance.last5FixtureIds, ['6', '7', '8', '9', '10']);
  });
});

// ── read binding (capture tx) — reuses readTeamObservations ────────────────────
function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: queue[i++] ?? [] }; },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('readTeamTemporalPerformance — 404 passthrough + observation reuse', () => {
  test('unknown team → null (404), only the observation identity query runs', async () => {
    const { tx, calls } = captureTx([[]]); // team identity empty
    const res = await readTeamTemporalPerformance(tx, '999');
    assert.equal(res, null);
    assert.equal(calls.length, 1);
  });
  test('known team, no fixtures → insufficient_sample, empty season', async () => {
    const { tx } = captureTx([[{ id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }], []]);
    const res = await readTeamTemporalPerformance(tx, '72', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.ok(res);
    assert.equal(res!.comparisonStatus, 'insufficient_sample');
    assert.equal(res!.season.observationCount, 0);
    assert.equal(res!.team.id, '72');
  });
});
