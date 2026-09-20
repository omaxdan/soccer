// EDITION MATCH-PERFORMANCE OBSERVATIONS — read-model tests (DB-free).
//
// Layers:
//   • Pure-logic: cumulative result aggregation (W/D/L, goals, clean sheets, %),
//     both-side stat sums, dedup + both-side integrity, coverage tiers, provenance,
//     current, sequenceIndex preservation under desc/slice.
//   • SQL-shape: strict `< $asOf`, COMPLETED + result join, ALL period, no LIMIT on
//     Query A, ANY($ids) on Query B, read-only.
//   • tx-capture binding: 404, empty (no Query B), populated (one Query B, no N+1).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  numericOrNull, collapseEditionFixtureStats, fixtureStatMetric, assembleEditionObservations,
  readEditionObservations, EditionObservationDataIntegrityError,
  EDITION_STAT_METRICS, EDITION_STAT_SOURCE_KEYS,
  EDITION_OBSERVATIONS_FIXTURES_SQL, EDITION_OBSERVATIONS_STATS_SQL,
  type EditionObsFixtureRow, type EditionObsStatRow,
} from '../editionObservations';

const IDENTITY = {
  edition: { id: '18', seasonLabel: 'Brasileiro Serie A 2026' },
  competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
  matchesScheduled: 250,
};
const OPTS = { asOf: new Date('2026-09-20T00:00:00.000Z'), order: 'asc' as const, limit: null, offset: null };

const fx = (id: string, home: number | null, away: number | null, kickoff: string): EditionObsFixtureRow =>
  ({ fixture_id: id, kickoff_at: kickoff, home_goals: home, away_goals: away });

const statRow = (over: Partial<EditionObsStatRow> & { fixture_id: string; statistic_key: string }): EditionObsStatRow => ({
  group_name: 'Match overview', home_value: null, away_value: null, value_type: 'number',
  provider_code: 'SPORTSAPI_API', retrieved_at: '2026-08-23T21:00:00.000Z', ...over,
});

describe('numericOrNull — missing never becomes zero, real zero preserved', () => {
  test('numbers / 0 / null / empty / non-numeric', () => {
    assert.equal(numericOrNull('1.5'), 1.5);
    assert.equal(numericOrNull('0'), 0);
    assert.equal(numericOrNull(null), null);
    assert.equal(numericOrNull(''), null);
    assert.equal(numericOrNull('x'), null);
    assert.equal(numericOrNull(3), 3);
  });
});

describe('cumulative result aggregation', () => {
  test('W/D/L, goals, clean sheets, percentages, goalsPerMatch accumulate correctly', () => {
    const fixtures = [
      fx('1', 2, 0, '2026-01-01T00:00:00Z'), // home win, home CS
      fx('2', 1, 1, '2026-01-02T00:00:00Z'), // draw
      fx('3', 0, 3, '2026-01-03T00:00:00Z'), // away win, away CS
    ];
    const res = assembleEditionObservations(IDENTITY, fixtures, new Map(), OPTS);
    assert.equal(res.observationCount, 3);
    assert.deepEqual(res.series.map((p) => p.sequenceIndex), [1, 2, 3]);
    const p3 = res.series[2];
    assert.equal(p3.matchesCompleted, 3);
    assert.deepEqual({ hw: p3.results.homeWins, d: p3.results.draws, aw: p3.results.awayWins }, { hw: 1, d: 1, aw: 1 });
    assert.equal(p3.results.homeWinPct, 33.3);
    assert.equal(p3.goals.total, 7); assert.equal(p3.goals.home, 3); assert.equal(p3.goals.away, 4);
    assert.equal(p3.goals.perMatch, 2.33);
    assert.equal(p3.cleanSheets.home, 1); assert.equal(p3.cleanSheets.away, 1); assert.equal(p3.cleanSheets.total, 2);
    // cumulative intermediate point
    assert.equal(res.series[0].results.homeWins, 1);
    assert.equal(res.series[0].results.homeWinPct, 100);
  });
});

describe('collapseEditionFixtureStats — dedup + both-side integrity', () => {
  test('same key in two groups, both sides agree → one canonical row (smallest group_name)', () => {
    const rows = [
      statRow({ fixture_id: '1', statistic_key: 'expectedGoals', group_name: 'Expected', home_value: '1.2', away_value: '0.8' }),
      statRow({ fixture_id: '1', statistic_key: 'expectedGoals', group_name: 'Attacking', home_value: '1.2', away_value: '0.8' }),
    ];
    const c = collapseEditionFixtureStats(rows);
    assert.equal(c.byKey.size, 1);
    assert.deepEqual(c.byKey.get('expectedGoals'), { home_value: '1.2', away_value: '0.8' });
  });
  test('home_value disagreement across groups → integrity error', () => {
    const rows = [
      statRow({ fixture_id: '1', statistic_key: 'expectedGoals', group_name: 'Expected', home_value: '1.2', away_value: '0.8' }),
      statRow({ fixture_id: '1', statistic_key: 'expectedGoals', group_name: 'Attacking', home_value: '1.3', away_value: '0.8' }),
    ];
    assert.throws(() => collapseEditionFixtureStats(rows), EditionObservationDataIntegrityError);
  });
  test('away_value disagreement across groups → integrity error', () => {
    const rows = [
      statRow({ fixture_id: '1', statistic_key: 'fouls', group_name: 'A', home_value: '10', away_value: '11' }),
      statRow({ fixture_id: '1', statistic_key: 'fouls', group_name: 'B', home_value: '10', away_value: '12' }),
    ];
    assert.throws(() => collapseEditionFixtureStats(rows), EditionObservationDataIntegrityError);
  });
});

describe('fixtureStatMetric — both-side sum, composed shots, missing≠zero', () => {
  const byKey = new Map<string, { home_value: string | null; away_value: string | null }>([
    ['expectedGoals', { home_value: '1.2', away_value: '0.8' }],
    ['shotsOnGoal', { home_value: '5', away_value: '3' }],
    ['shotsOffGoal', { home_value: '4', away_value: '2' }],
  ]);
  test('expectedGoals sums both sides', () => {
    const r = fixtureStatMetric(byKey, { key: 'expectedGoals', sources: ['expectedGoals'] });
    assert.equal(r.has, true); assert.equal(r.value, 2);
  });
  test('shots = shotsOnGoal + shotsOffGoal, both sides', () => {
    const r = fixtureStatMetric(byKey, { key: 'shots', sources: ['shotsOnGoal', 'shotsOffGoal'] });
    assert.equal(r.value, 14); // 5+3+4+2
  });
  test('shotsOnTarget = shotsOnGoal both sides', () => {
    const r = fixtureStatMetric(byKey, { key: 'shotsOnTarget', sources: ['shotsOnGoal'] });
    assert.equal(r.value, 8);
  });
  test('absent source → has=false (contributes nothing; not zero)', () => {
    const r = fixtureStatMetric(byKey, { key: 'fouls', sources: ['fouls'] });
    assert.equal(r.has, false); assert.equal(r.value, 0);
  });
  test('one side present, other null → sums present side only', () => {
    const bk = new Map([['yellowCards', { home_value: '3', away_value: null }]]);
    const r = fixtureStatMetric(bk, { key: 'yellowCards', sources: ['yellowCards'] });
    assert.equal(r.has, true); assert.equal(r.value, 3);
  });
  test('stored zero preserved as a real contribution', () => {
    const bk = new Map([['redCards', { home_value: '0', away_value: '0' }]]);
    const r = fixtureStatMetric(bk, { key: 'redCards', sources: ['redCards'] });
    assert.equal(r.has, true); assert.equal(r.value, 0);
  });
});

describe('stat tier cumulative + coverage tiers + provenance', () => {
  test('stat present on 2 of 3 fixtures → enriched-cohort coverage 2/3; result full-edition', () => {
    const fixtures = [fx('1', 1, 0, '2026-01-01T00:00:00Z'), fx('2', 2, 2, '2026-01-02T00:00:00Z'), fx('3', 0, 1, '2026-01-03T00:00:00Z')];
    const stats = new Map<string, EditionObsStatRow[]>([
      ['1', [statRow({ fixture_id: '1', statistic_key: 'expectedGoals', home_value: '1.0', away_value: '0.5', retrieved_at: '2026-01-01T05:00:00Z' })]],
      ['3', [statRow({ fixture_id: '3', statistic_key: 'expectedGoals', home_value: '0.3', away_value: '1.4', retrieved_at: '2026-01-03T05:00:00Z' })]],
    ]);
    const res = assembleEditionObservations(IDENTITY, fixtures, stats, OPTS);
    // cumulative xG at each point: 1.5, 1.5 (fixture 2 no stats), 3.2
    assert.equal(res.series[0].statTier.expectedGoals, 1.5);
    assert.equal(res.series[1].statTier.expectedGoals, 1.5);
    assert.equal(round4(res.series[2].statTier.expectedGoals!), 3.2);
    // fixture 2 (no stats) still counts for result metrics
    assert.equal(res.series[1].matchesCompleted, 2);
    // coverage: result full-edition; xG enriched 2/3
    assert.equal(res.coverage.resultMetrics.class, 'full-edition');
    assert.equal(res.coverage.resultMetrics.matchesCompleted, 3);
    assert.equal(res.coverage.resultMetrics.matchesScheduled, 250);
    const xgCov = res.coverage.statMetrics.find((s) => s.key === 'expectedGoals')!;
    assert.equal(xgCov.class, 'enriched-cohort');
    assert.equal(xgCov.eligibleFixtures, 3); assert.equal(xgCov.fixturesWithMetric, 2);
    assert.equal(xgCov.coveragePct, 66.7);
    // metric never seen anywhere → cumulative null throughout + coverage 0
    assert.equal(res.series[2].statTier.fouls, null);
    const foulsCov = res.coverage.statMetrics.find((s) => s.key === 'fouls')!;
    assert.equal(foulsCov.fixturesWithMetric, 0); assert.equal(foulsCov.coveragePct, 0);
    // provenance: latest retrievedAt across contributing rows
    assert.equal(res.provenance.statTier!.provider, 'SPORTSAPI_API');
    assert.equal(res.provenance.statTier!.retrievedAt, '2026-01-03T05:00:00.000Z');
  });
  test('no stat rows at all → statTier provenance null, all stat metrics null/0-coverage', () => {
    const res = assembleEditionObservations(IDENTITY, [fx('1', 1, 0, '2026-01-01T00:00:00Z')], new Map(), OPTS);
    assert.equal(res.provenance.statTier, null);
    assert.equal(res.series[0].statTier.expectedGoals, null);
  });
});

describe('empty edition', () => {
  test('no eligible fixtures → count 0, series [], current null', () => {
    const res = assembleEditionObservations(IDENTITY, [], new Map(), OPTS);
    assert.equal(res.observationCount, 0);
    assert.deepEqual(res.series, []);
    assert.equal(res.current, null);
    assert.equal(res.coverage.resultMetrics.matchesCompleted, 0);
    assert.equal(res.coverage.resultMetrics.matchesScheduled, 250);
  });
});

describe('current + ordering + slicing (the critical slice test)', () => {
  const fixtures = [
    fx('1', 1, 1, '2026-01-01T00:00:00Z'), // total goals cumulative: 2
    fx('2', 2, 1, '2026-01-02T00:00:00Z'), // 5
    fx('3', 2, 0, '2026-01-03T00:00:00Z'), // 7
  ];
  test('current is the final chronological cumulative point', () => {
    const res = assembleEditionObservations(IDENTITY, fixtures, new Map(), OPTS);
    assert.equal(res.current!.sequenceIndex, 3);
    assert.equal(res.current!.goals.total, 7);
  });
  test('order=desc + limit=2 → points 3 then 2; sequenceIndex preserved; current unchanged', () => {
    const res = assembleEditionObservations(IDENTITY, fixtures, new Map(), { asOf: OPTS.asOf, order: 'desc', limit: 2, offset: null });
    assert.deepEqual(res.series.map((p) => p.sequenceIndex), [3, 2]); // preserved canonical indices
    assert.deepEqual(res.series.map((p) => p.goals.total), [7, 5]);
    assert.equal(res.current!.sequenceIndex, 3); // current is final chronological, not sliced away
    assert.equal(res.current!.goals.total, 7);
    assert.equal(res.observationCount, 3); // full eligible count, not the sliced length
  });
  test('offset after aggregation does not corrupt cumulative totals', () => {
    const res = assembleEditionObservations(IDENTITY, fixtures, new Map(), { asOf: OPTS.asOf, order: 'asc', limit: null, offset: 1 });
    assert.deepEqual(res.series.map((p) => p.sequenceIndex), [2, 3]);
    assert.equal(res.series[0].goals.total, 5); // fixture 2 cumulative, not recomputed from offset
  });
});

describe('canonical stat metric definitions', () => {
  test('source keys are the union of metric sources; composed shots present', () => {
    assert.ok(EDITION_STAT_SOURCE_KEYS.includes('shotsOnGoal'));
    assert.ok(EDITION_STAT_SOURCE_KEYS.includes('shotsOffGoal'));
    assert.equal(EDITION_STAT_METRICS.find((m) => m.key === 'shots')!.sources.join('+'), 'shotsOnGoal+shotsOffGoal');
    assert.equal(EDITION_STAT_METRICS.find((m) => m.key === 'shotsOnTarget')!.sources.join(''), 'shotsOnGoal');
  });
});

// ── SQL shape ─────────────────────────────────────────────────────────────────
describe('SQL shape', () => {
  test('fixtures SQL: strict `< $2`, COMPLETED, result join, chronological order, NO LIMIT, read-only', () => {
    const s = EDITION_OBSERVATIONS_FIXTURES_SQL;
    assert.match(s, /f\.scheduled_kickoff_at < \$2::timestamptz/);
    assert.doesNotMatch(s, /scheduled_kickoff_at <= /);
    assert.match(s, /f\.lifecycle_state_code = 'COMPLETED'/);
    assert.match(s, /JOIN football\.result r\s+ON r\.fixture_id = f\.id AND r\.fixture_partition_on = f\.fixture_partition_on/);
    assert.match(s, /ORDER BY f\.scheduled_kickoff_at ASC, f\.id ASC/);
    assert.doesNotMatch(s, /\bLIMIT\b/i);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  });
  test('stats SQL: ALL period, fixture-id array, read-only', () => {
    assert.match(EDITION_OBSERVATIONS_STATS_SQL, /tms\.period = 'ALL'/);
    assert.match(EDITION_OBSERVATIONS_STATS_SQL, /tms\.fixture_id = ANY\(\$1::bigint\[\]\)/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(EDITION_OBSERVATIONS_STATS_SQL));
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
const idRow = { edition_id: '18', season_label: 'Brasileiro Serie A 2026', competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325', matches_scheduled: 250 };

describe('readEditionObservations — binding + 404 + no N+1', () => {
  test('unknown edition → null (404), only identity query runs', async () => {
    const { tx, calls } = captureTx([[]]);
    const res = await readEditionObservations(tx, '999');
    assert.equal(res, null);
    assert.equal(calls.length, 1);
  });
  test('known edition, no fixtures → empty series; identity + fixtures only (no Query B)', async () => {
    const { tx, calls } = captureTx([[idRow], []]);
    const res = await readEditionObservations(tx, '18', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.ok(res); assert.equal(res!.observationCount, 0);
    assert.equal(res!.coverage.resultMetrics.matchesScheduled, 250);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].params[0], '18');
    assert.ok(calls[1].params[1] instanceof Date);
  });
  test('known edition with fixtures → identity + fixtures + ONE stats query (no N+1)', async () => {
    const { tx, calls } = captureTx([
      [idRow],
      [fx('1', 1, 0, '2026-01-01T00:00:00Z'), fx('2', 2, 2, '2026-01-02T00:00:00Z')],
      [statRow({ fixture_id: '1', statistic_key: 'expectedGoals', home_value: '1.0', away_value: '0.5' })],
    ]);
    const res = await readEditionObservations(tx, '18', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2].params[0], ['1', '2']);
    assert.equal(res!.observationCount, 2);
    assert.deepEqual(res!.series.map((p) => p.sequenceIndex), [1, 2]);
  });
});

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
