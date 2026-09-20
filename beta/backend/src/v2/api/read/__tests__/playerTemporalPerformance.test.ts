// PLAYER TEMPORAL PERFORMANCE — read-model tests (DB-free).
//
// Layers:
//   • Pure-logic: player metric classification (SUM vs topSpeed MEAN, no percentages),
//     window selection (Last5/Previous5, no overlap), SUM aggregation, topSpeed MEAN,
//     xG sum, minutes sum, missing≠zero + coverage, change/percentage/zero-previous,
//     direction (raw), participation counts (not absence), sample gate, scope, season.
//   • Binding: reuses readPlayerObservations (404 passthrough; single observation read).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  playerMetricClass, aggregateMetric, aggregateParticipation, compareMetric,
  assemblePlayerTemporalPerformance, readPlayerTemporalPerformance,
  MEAN_METRIC_KEYS, PLAYER_AGGREGATION_VERSION,
} from '../playerTemporalPerformance';
import type { PlayerObservation, PlayerObservationsResponse, PlayerParticipation } from '../playerObservations';

const metric = (key: string, value: number | null) => ({ key, value, display: null });

const obsPoint = (over: Partial<PlayerObservation> & { fixtureId: string }): PlayerObservation => ({
  fixtureId: over.fixtureId,
  fixturePartitionOn: '2026-01-01',
  competition: { id: '28', name: 'B', slug: 'b' },
  edition: { id: '18', seasonLabel: 'S' },
  kickoffAt: over.kickoffAt ?? '2026-01-01T00:00:00.000Z',
  sequenceIndex: 0,
  team: over.team ?? { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' },
  opponent: { id: '99', name: 'Opp', slug: 'opp' },
  venueSide: 'home',
  participation: (over.participation ?? 'STARTED') as PlayerParticipation,
  result: 'W',
  goalsFor: 1, goalsAgainst: 0, goalMargin: 1, points: 3, cleanSheet: true,
  xg: over.xg ?? null,
  provenance: { provider: 'P', retrievedAt: '2026-01-01T00:00:00.000Z' },
  metrics: over.metrics ?? [],
});

function wrap(observations: PlayerObservation[], scope?: Partial<PlayerObservationsResponse['scope']>): PlayerObservationsResponse {
  return {
    player: { id: '1116', fullName: 'Vitor Roque', slug: 'vitor-roque-1150391' },
    scope: { competition: 'all', editionId: null, venue: 'all', order: 'asc', ...scope },
    asOf: '2026-09-20T00:00:00.000Z',
    observationCount: observations.length,
    coverage: { observations: observations.length > 0 ? 'present' : 'absent', metrics: [] },
    observations,
  };
}

describe('playerMetricClass — topSpeed MEAN, everything else SUM (no percentages)', () => {
  test('classification', () => {
    assert.deepEqual([...MEAN_METRIC_KEYS], ['topSpeed']);
    assert.equal(playerMetricClass('topSpeed'), 'MEAN');
    assert.equal(playerMetricClass('goals'), 'SUM');
    assert.equal(playerMetricClass('minutesPlayed'), 'SUM');
    assert.equal(playerMetricClass('expectedGoals'), 'SUM');
    assert.equal(playerMetricClass('kilometersCovered'), 'SUM');
  });
});

describe('aggregateMetric — SUM total, topSpeed MEAN, missing≠zero', () => {
  const window = [
    obsPoint({ fixtureId: '1', metrics: [metric('goals', 1), metric('minutesPlayed', 90), metric('topSpeed', 33.2), metric('expectedGoals', 0.4)] }),
    obsPoint({ fixtureId: '2', metrics: [metric('goals', 0), metric('minutesPlayed', 70), metric('topSpeed', 34.6)] }), // xG missing
    obsPoint({ fixtureId: '3', metrics: [metric('goals', 2), metric('minutesPlayed', 88), metric('topSpeed', 32.0), metric('expectedGoals', 0.9)] }),
  ];
  test('SUM counts + durations sum all present', () => {
    assert.equal(aggregateMetric(window, 'goals').value, 3);
    assert.equal(aggregateMetric(window, 'minutesPlayed').value, 248);
  });
  test('topSpeed MEAN = average peak', () => {
    const a = aggregateMetric(window, 'topSpeed');
    assert.equal(a.value, 33.27); assert.equal(a.observations, 3); // (33.2+34.6+32.0)/3
  });
  test('xG SUM over only the observations that carry it (coverage 2/3, not zero-filled)', () => {
    const a = aggregateMetric(window, 'expectedGoals');
    assert.equal(a.value, 1.3); assert.equal(a.observations, 2); assert.equal(a.windowSize, 3);
  });
  test('absent metric → null / 0 observations', () => {
    assert.deepEqual(aggregateMetric(window, 'saves'), { value: null, observations: 0, windowSize: 3 });
  });
});

describe('aggregateParticipation — observed STARTED/BENCH/UNKNOWN counts (never absence)', () => {
  test('counts', () => {
    const w = [
      obsPoint({ fixtureId: '1', participation: 'STARTED' }),
      obsPoint({ fixtureId: '2', participation: 'BENCH' }),
      obsPoint({ fixtureId: '3', participation: 'STARTED' }),
      obsPoint({ fixtureId: '4', participation: 'UNKNOWN' }),
    ];
    assert.deepEqual(aggregateParticipation(w), { started: 2, bench: 1, unknown: 1 });
  });
});

describe('compareMetric — change, relative % (SUM), zero-previous, MEAN no relative %, direction', () => {
  const prev = [obsPoint({ fixtureId: 'p', metrics: [metric('goals', 1), metric('topSpeed', 33)] })];
  const last = [obsPoint({ fixtureId: 'l', metrics: [metric('goals', 3), metric('topSpeed', 34)] })];
  test('SUM: absolute change + relative %; direction UP', () => {
    const c = compareMetric(prev, last, 'goals');
    assert.equal(c.change, 2); assert.equal(c.changeType, 'absolute'); assert.equal(c.percentageChange, 200); assert.equal(c.direction, 'UP');
  });
  test('topSpeed MEAN: absolute change, no relative %', () => {
    const c = compareMetric(prev, last, 'topSpeed');
    assert.equal(c.change, 1); assert.equal(c.changeType, 'absolute'); assert.equal(c.percentageChange, null); assert.equal(c.direction, 'UP');
  });
  test('previous 0 → percentageChange null (no divide by zero)', () => {
    const p0 = [obsPoint({ fixtureId: 'p', metrics: [metric('goals', 0)] })];
    const c = compareMetric(p0, last, 'goals');
    assert.equal(c.change, 3); assert.equal(c.percentageChange, null); assert.equal(c.direction, 'UP');
  });
  test('metric missing one side → change null, direction UNAVAILABLE', () => {
    const c = compareMetric([obsPoint({ fixtureId: 'p', metrics: [] })], last, 'goals');
    assert.equal(c.change, null); assert.equal(c.direction, 'UNAVAILABLE');
  });
});

describe('assemble — windows, no overlap, participation, sample gate, scope, season', () => {
  const many = Array.from({ length: 12 }, (_, i) => obsPoint({
    fixtureId: String(i + 1), kickoffAt: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    participation: i % 2 === 0 ? 'STARTED' : 'BENCH',
    metrics: [metric('goals', 1), metric('minutesPlayed', 80), metric('topSpeed', 33), metric('expectedGoals', 0.5)],
  }));
  test('Last5 = final 5, Previous5 = preceding 5, disjoint', () => {
    const r = assemblePlayerTemporalPerformance(wrap(many));
    assert.equal(r.comparisonStatus, 'available');
    assert.deepEqual(r.provenance.last5FixtureIds, ['8', '9', '10', '11', '12']);
    assert.deepEqual(r.provenance.previous5FixtureIds, ['3', '4', '5', '6', '7']);
    assert.equal(r.provenance.last5FixtureIds.filter((f) => r.provenance.previous5FixtureIds.includes(f)).length, 0);
  });
  test('metric comparisons: goals summed to 5, minutes to 400, xG to 2.5, topSpeed mean 33', () => {
    const r = assemblePlayerTemporalPerformance(wrap(many));
    const goals = r.comparisons.find((c) => c.metric === 'goals')!;
    assert.equal(goals.last5.value, 5); assert.equal(goals.previous5.value, 5); assert.equal(goals.change, 0);
    assert.equal(r.comparisons.find((c) => c.metric === 'minutesPlayed')!.last5.value, 400);
    assert.equal(r.comparisons.find((c) => c.metric === 'expectedGoals')!.last5.value, 2.5);
    assert.equal(r.comparisons.find((c) => c.metric === 'topSpeed')!.last5.value, 33);
  });
  test('participation block: observed counts + change; NO results/W-D-L block exists', () => {
    const r = assemblePlayerTemporalPerformance(wrap(many));
    // fixtures 8,10,12 STARTED (even index i=7,9,11 → odd → BENCH? recompute): i%2===0 STARTED
    // last5 = fixtures 8..12 → indices 7..11 → STARTED at i=8,10 (fixtureId 9,11)… count via helper
    assert.ok(r.participation.last5);
    assert.equal(r.participation.last5!.started + r.participation.last5!.bench + r.participation.last5!.unknown, 5);
    assert.ok(r.participation.change);
    assert.equal((r as unknown as { results?: unknown }).results, undefined); // player has no W/D/L block
  });
  test('fewer than 10 → insufficient_sample, no previous5 / comparisons', () => {
    const r = assemblePlayerTemporalPerformance(wrap(many.slice(0, 7)));
    assert.equal(r.comparisonStatus, 'insufficient_sample');
    assert.equal(r.participation.previous5, null);
    assert.equal(r.participation.change, null);
    assert.deepEqual(r.comparisons, []);
    assert.ok(r.participation.last5); // recent participation still summarised
  });
  test('scope preserved (ALL competitions labelled); season over full series', () => {
    const r = assemblePlayerTemporalPerformance(wrap(many));
    assert.equal(r.scope.label, 'all competitions');
    assert.equal(r.season.observationCount, 12);
    assert.equal(r.season.participation.started + r.season.participation.bench, 12);
    assert.equal(r.season.metrics.find((m) => m.metric === 'goals')!.value, 12);
    assert.equal(r.season.metrics.find((m) => m.metric === 'topSpeed')!.value, 33); // mean of all-33
  });
  test('edition scope labelled as edition', () => {
    const r = assemblePlayerTemporalPerformance(wrap(many, { competition: 'edition', editionId: '18' }));
    assert.equal(r.scope.label, 'edition 18');
  });
  test('empty series → insufficient, season zeros, version tag', () => {
    const r = assemblePlayerTemporalPerformance(wrap([]));
    assert.equal(r.comparisonStatus, 'insufficient_sample');
    assert.equal(r.participation.last5, null);
    assert.equal(r.season.observationCount, 0);
    assert.equal(r.aggregation.version, PLAYER_AGGREGATION_VERSION);
  });
  test('exactly 10 → available (boundary)', () => {
    const r = assemblePlayerTemporalPerformance(wrap(many.slice(0, 10)));
    assert.equal(r.comparisonStatus, 'available');
    assert.deepEqual(r.provenance.previous5FixtureIds, ['1', '2', '3', '4', '5']);
    assert.deepEqual(r.provenance.last5FixtureIds, ['6', '7', '8', '9', '10']);
  });
});

describe('multiple team contexts preserved (player observation carries team per fixture)', () => {
  test('observations retain their own team; temporal layer does not merge/relabel', () => {
    const mixed = [
      obsPoint({ fixtureId: '1', team: { id: '72', name: 'Palmeiras', slug: 'p' }, metrics: [metric('goals', 1)] }),
      obsPoint({ fixtureId: '2', team: { id: '58', name: 'Vasco', slug: 'v' }, metrics: [metric('goals', 2)] }),
    ];
    const r = assemblePlayerTemporalPerformance(wrap(mixed));
    // temporal layer aggregates player-wide (scope), team context stays on the observations
    assert.equal(r.season.metrics.find((m) => m.metric === 'goals')!.value, 3);
    assert.equal(r.season.observationCount, 2);
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

describe('readPlayerTemporalPerformance — 404 passthrough + observation reuse', () => {
  test('unknown/unexposed player → null (404), only the identity query runs', async () => {
    const { tx, calls } = captureTx([[]]); // player identity empty
    const res = await readPlayerTemporalPerformance(tx, '999');
    assert.equal(res, null);
    assert.equal(calls.length, 1);
  });
  test('known player, no fixtures → insufficient_sample, empty season', async () => {
    const { tx } = captureTx([[{ id: '1116', full_name: 'Vitor Roque', slug: 'vitor-roque-1150391' }], []]);
    const res = await readPlayerTemporalPerformance(tx, '1116', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.ok(res);
    assert.equal(res!.comparisonStatus, 'insufficient_sample');
    assert.equal(res!.season.observationCount, 0);
    assert.equal(res!.player.fullName, 'Vitor Roque');
  });
});
