// ─────────────────────────────────────────────────────────────────────────────
// STATISTICAL ATTRIBUTES v1 — DB-free tests
//
// Proves the stat-tier attribute chain end-to-end without a database:
//   team_match_statistic → Team Observation (canonicalization) → stat benchmark
//   → stat attributes. Pure assembly is tested directly; the read chain is tested
//   over a fake PoolClient that routes the three governed queries. MI isolation is
//   asserted by construction (no snapshot/module import of the stat-tier modules).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

import {
  assembleEditionTeamMetricValues, type ObsStatRow,
} from '../teamObservations';
import {
  assembleStatisticalBenchmark, readStatisticalBenchmark,
  STATISTICAL_BENCHMARK_KEYS, STATISTICAL_BENCHMARK_SIGNAL_KEYS,
  type StatisticalBenchmarkResponse,
} from '../statisticalBenchmark';
import {
  assembleStatisticalAttributes, readStatisticalAttributes, STATISTICAL_ATTRIBUTES_VERSION,
} from '../statisticalAttributes';

// ── helpers ───────────────────────────────────────────────────────────────────

function statRow(fixtureId: string, key: string, homeVal: string | null, awayVal: string | null, group = 'g'): ObsStatRow {
  return {
    fixture_id: fixtureId, group_name: group, statistic_key: key, statistic_name: key,
    home_value: homeVal, away_value: awayVal, home_display: homeVal, away_display: awayVal,
    value_type: 'event', provider_code: 'SPORTSAPI_API', retrieved_at: '2026-09-10T12:00:00.000Z',
  };
}

const ASOF = new Date('2026-09-20T00:00:00.000Z');

// ═════════════════════════════════════════════════════════════════════════════
// 1. Team Observation population — canonicalization reuse (orientation, dedup, missing≠zero)
// ═════════════════════════════════════════════════════════════════════════════

describe('assembleEditionTeamMetricValues — canonicalization via Team Observation', () => {
  test('orients home/away, skips absent keys and non-numeric values, never zero-fills', () => {
    const fixtures = [
      { fixture_id: 'F1', home_team_id: 'A', away_team_id: 'B' },
      { fixture_id: 'F2', home_team_id: 'B', away_team_id: 'A' },
    ];
    const stats = new Map<string, ObsStatRow[]>([
      ['F1', [statRow('F1', 'expectedGoals', '2.0', '0.5'), statRow('F1', 'ballPossession', '60', '40')]],
      // F2: expectedGoals present; ballPossession non-numeric for home; totalShotsOnGoal absent
      ['F2', [statRow('F2', 'expectedGoals', '1.0', '1.5'), statRow('F2', 'ballPossession', 'n/a', '55')]],
    ]);
    const pop = assembleEditionTeamMetricValues('18', ASOF, STATISTICAL_BENCHMARK_KEYS, fixtures, stats);

    // A: home in F1 (xG 2.0), away in F2 (xG 1.5) → [2.0, 1.5]; possession F1 home 60, F2 away 55 → [60,55]
    assert.deepEqual(pop.byTeam.get('A')!.get('expectedGoals'), [2.0, 1.5]);
    assert.deepEqual(pop.byTeam.get('A')!.get('ballPossession'), [60, 55]);
    // B: away in F1 (xG 0.5), home in F2 (xG 1.0) → [0.5, 1.0]; possession F1 away 40, F2 home 'n/a'→skip → [40]
    assert.deepEqual(pop.byTeam.get('B')!.get('expectedGoals'), [0.5, 1.0]);
    assert.deepEqual(pop.byTeam.get('B')!.get('ballPossession'), [40]); // non-numeric skipped, not 0
    // totalShotsOnGoal never present → omitted entirely (missing ≠ zero)
    assert.equal(pop.byTeam.get('A')!.get('totalShotsOnGoal'), undefined);
    assert.deepEqual([...pop.fixtureCountByTeam.entries()].sort(), [['A', 2], ['B', 2]]);
  });

  test('group duplicates that agree collapse to one value (dedup reuse)', () => {
    const fixtures = [{ fixture_id: 'F1', home_team_id: 'A', away_team_id: 'B' }];
    const stats = new Map<string, ObsStatRow[]>([
      ['F1', [statRow('F1', 'expectedGoals', '2.0', '0.5', 'Match overview'), statRow('F1', 'expectedGoals', '2.0', '0.5', 'Attack')]],
    ]);
    const pop = assembleEditionTeamMetricValues('18', ASOF, ['expectedGoals'], fixtures, stats);
    assert.deepEqual(pop.byTeam.get('A')!.get('expectedGoals'), [2.0]); // one value, not two
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Statistical benchmark — participation floor, per-team mean, ranking, missing≠zero
// ═════════════════════════════════════════════════════════════════════════════

function popFrom(entries: Record<string, Record<string, number[]>>, fixtureCounts: Record<string, number>) {
  const byTeam = new Map<string, Map<string, number[]>>();
  for (const [tid, keys] of Object.entries(entries)) {
    const m = new Map<string, number[]>();
    for (const [k, v] of Object.entries(keys)) m.set(k, v);
    byTeam.set(tid, m);
  }
  return { byTeam, fixtureCountByTeam: new Map(Object.entries(fixtureCounts)) };
}

describe('assembleStatisticalBenchmark', () => {
  test('participation floor 5: a team below 5 completed fixtures is excluded from the population', () => {
    const { byTeam, fixtureCountByTeam } = popFrom(
      { A: { expectedGoals: [2] }, B: { expectedGoals: [1] }, C: { expectedGoals: [3] }, D: { expectedGoals: [4] }, E: { expectedGoals: [5] }, SHORT: { expectedGoals: [99] } },
      { A: 8, B: 8, C: 8, D: 8, E: 8, SHORT: 4 }, // SHORT has 4 < 5
    );
    const bench = assembleStatisticalBenchmark({ id: 'A', name: 'A', slug: 'a' }, '18', ASOF, 8, byTeam, fixtureCountByTeam, 'A');
    const xg = bench.signals.find((s) => s.signalKey === 'expectedGoals')!;
    assert.equal(bench.population.teams, 5);        // SHORT excluded
    assert.equal(bench.population.excludedTeams, 1);
    assert.equal(xg.populationTeams, 5);            // SHORT's 99 does NOT enter the population
    assert.equal(xg.signalValue, 2);               // target mean
  });

  test('a team with no usable value for a metric is absent from THAT metric population (missing≠zero)', () => {
    const { byTeam, fixtureCountByTeam } = popFrom(
      { A: { expectedGoals: [2] }, B: { expectedGoals: [4] }, C: {} }, // C established but no xG usable
      { A: 6, B: 6, C: 6 },
    );
    const bench = assembleStatisticalBenchmark({ id: 'A', name: 'A', slug: 'a' }, '18', ASOF, 6, byTeam, fixtureCountByTeam, 'A');
    const xg = bench.signals.find((s) => s.signalKey === 'expectedGoals')!;
    assert.equal(xg.populationTeams, 2); // A and B only; C not zero-filled
  });

  test('per-team value is the MEAN of usable observations; rank/percentile computed over means', () => {
    const { byTeam, fixtureCountByTeam } = popFrom(
      { A: { expectedGoals: [3, 3] }, B: { expectedGoals: [1, 1] }, C: { expectedGoals: [2, 2] } },
      { A: 5, B: 5, C: 5 },
    );
    const bench = assembleStatisticalBenchmark({ id: 'A', name: 'A', slug: 'a' }, '18', ASOF, 5, byTeam, fixtureCountByTeam, 'A');
    const xg = bench.signals.find((s) => s.signalKey === 'expectedGoals')!;
    assert.equal(xg.signalValue, 3);          // mean of [3,3]
    assert.equal(xg.usableSample, 2);
    assert.equal(xg.rank, 1);                 // highest mean → rank 1
    assert.equal(xg.percentile, 1);           // CUME_DIST 3/3
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Statistical attributes — classification, floor 8, orientation, tendencies
// ═════════════════════════════════════════════════════════════════════════════

function benchWith(signals: Array<{ key: string; value: number; q1: number; q3: number; usable?: number; dir?: 'HIGHER_IS_MORE' | 'LOWER_IS_MORE' | 'NEUTRAL' }>, teamFixtures = 10): StatisticalBenchmarkResponse {
  return {
    team: { id: 'A', name: 'A', slug: 'a' }, scope: 'edition', editionId: '18', asOf: ASOF.toISOString(),
    population: { editionId: '18', teams: 5, excludedTeams: 0, participationFloor: 5 },
    sample: { teamFixtures },
    benchmarkVersion: 'stat-edition-cumedist-v1',
    signals: signals.map((s) => ({
      signalKey: s.key, signalValue: s.value, usableSample: s.usable ?? 10, direction: s.dir ?? 'HIGHER_IS_MORE',
      rank: 1, percentile: 0.9, median: (s.q1 + s.q3) / 2, quartiles: { q1: s.q1, q3: s.q3 }, populationTeams: 5,
    })),
    provenance: { source: 'teamObservations', reconstructed: true, immutable: false },
  };
}

describe('assembleStatisticalAttributes — governed classification', () => {
  test('HIGHER_IS_BETTER: value ≥ q3 → strength; ≤ q1 → weakness; middle → neither', () => {
    const strong = assembleStatisticalAttributes(benchWith([{ key: 'expectedGoals', value: 2.5, q1: 1, q3: 2 }]));
    assert.equal(strong.strengths[0].key, 'expectedGoals');
    assert.equal(strong.strengths[0].type, 'strength');
    assert.equal(strong.strengths[0].qualityOrientation, 'HIGHER_IS_BETTER');
    assert.equal(strong.weaknesses.length, 0);

    const weak = assembleStatisticalAttributes(benchWith([{ key: 'expectedGoals', value: 0.5, q1: 1, q3: 2 }]));
    assert.equal(weak.weaknesses[0].key, 'expectedGoals');
    assert.equal(weak.strengths.length, 0);

    const mid = assembleStatisticalAttributes(benchWith([{ key: 'expectedGoals', value: 1.5, q1: 1, q3: 2 }]));
    assert.equal(mid.strengths.length + mid.weaknesses.length, 0); // MIDDLE emits nothing
  });

  test('LOWER_IS_BETTER: low value is the strength (errorsLeadToShot ≤ q1 → strength)', () => {
    const r = assembleStatisticalAttributes(benchWith([{ key: 'errorsLeadToShot', value: 0.2, q1: 0.5, q3: 1.5, dir: 'HIGHER_IS_MORE' }]));
    assert.equal(r.strengths[0].key, 'errorsLeadToShot');
    assert.equal(r.strengths[0].qualityOrientation, 'LOWER_IS_BETTER');
    // a HIGH error count is the weakness
    const hi = assembleStatisticalAttributes(benchWith([{ key: 'errorsLeadToShot', value: 2.0, q1: 0.5, q3: 1.5 }]));
    assert.equal(hi.weaknesses[0].key, 'errorsLeadToShot');
  });

  test('NEUTRAL metrics are tendencies only — never strength/weakness', () => {
    const r = assembleStatisticalAttributes(benchWith([{ key: 'ballPossession', value: 65, q1: 45, q3: 55, dir: 'NEUTRAL' }]));
    assert.equal(r.strengths.length, 0);
    assert.equal(r.weaknesses.length, 0);
    assert.equal(r.tendencies[0].key, 'ballPossession');
    assert.equal(r.tendencies[0].qualityOrientation, 'NEUTRAL');
    assert.equal(r.tendencies[0].type, 'tendency');
  });

  test('classification floor 8: a metric with < 8 usable observations is omitted (missing≠zero)', () => {
    const r = assembleStatisticalAttributes(benchWith([{ key: 'expectedGoals', value: 2.5, q1: 1, q3: 2, usable: 7 }]));
    assert.equal(r.strengths.length, 0); // usableSample 7 < 8 → not classified
  });

  test('ONLY the curated set is classified — an uncurated high-coverage key is ignored', () => {
    const r = assembleStatisticalAttributes(benchWith([
      { key: 'expectedGoals', value: 2.5, q1: 1, q3: 2 },
      { key: 'goalkeeperSaves', value: 9, q1: 2, q3: 4 }, // uncurated — must NOT surface
      { key: 'totalTackle', value: 30, q1: 10, q3: 20 },  // uncurated
    ]));
    const allKeys = [...r.strengths, ...r.weaknesses, ...r.tendencies].map((a) => a.key);
    assert.deepEqual(allKeys, ['expectedGoals']);
    assert.ok(!allKeys.includes('goalkeeperSaves') && !allKeys.includes('totalTackle'));
  });

  test('deterministic ordering follows the curated spec order', () => {
    const r = assembleStatisticalAttributes(benchWith([
      { key: 'bigChanceScored', value: 3, q1: 1, q3: 2 },
      { key: 'expectedGoals', value: 3, q1: 1, q3: 2 },
      { key: 'expectedGoalsOnTarget', value: 3, q1: 1, q3: 2 },
    ]));
    assert.deepEqual(r.strengths.map((s) => s.key), ['expectedGoals', 'expectedGoalsOnTarget', 'bigChanceScored']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Read chain over a fake tx — source usage, edition scope, asOf, insufficientSample
// ═════════════════════════════════════════════════════════════════════════════

function fakeTx(data: {
  target: { id: string; name: string; slug: string; edition_id: string; completed: string } | null;
  fixtures: Array<{ fixture_id: string; home_team_id: string; away_team_id: string }>;
  stats: ObsStatRow[];
}): { tx: PoolClient; sawStatsQuery: () => boolean; asOfParam: () => unknown } {
  let statsQueried = false;
  let asOfSeen: unknown = null;
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('team_match_statistic tms')) {
      statsQueried = true;
      const ids = new Set(params[0] as string[]);
      return { rows: data.stats.filter((s) => ids.has(s.fixture_id)), rowCount: 0 };
    }
    if (sql.includes('FROM football.team t')) { // BENCHMARK_TARGET_SQL
      asOfSeen = params[1];
      return { rows: data.target ? [data.target] : [], rowCount: 0 };
    }
    if (sql.includes('AS home_team_id')) {      // EDITION_OBSERVATION_FIXTURES_SQL
      return { rows: data.fixtures, rowCount: 0 };
    }
    throw new Error(`unrouted SQL: ${sql.slice(0, 70)}`);
  };
  return { tx: { query } as unknown as PoolClient, sawStatsQuery: () => statsQueried, asOfParam: () => asOfSeen };
}

describe('readStatisticalBenchmark / readStatisticalAttributes — wiring', () => {
  // A 5-team edition; every team has 5 completed fixtures. Target A below the classification
  // floor of 8 → block builds (participation 5) but is insufficientSample.
  const fixtures = [
    { fixture_id: 'F1', home_team_id: 'A', away_team_id: 'B' },
    { fixture_id: 'F2', home_team_id: 'A', away_team_id: 'C' },
    { fixture_id: 'F3', home_team_id: 'A', away_team_id: 'D' },
    { fixture_id: 'F4', home_team_id: 'A', away_team_id: 'E' },
    { fixture_id: 'F5', home_team_id: 'B', away_team_id: 'A' },
  ];
  const stats = fixtures.flatMap((f) => [
    statRow(f.fixture_id, 'expectedGoals', '2.0', '1.0'),
    statRow(f.fixture_id, 'ballPossession', '55', '45'),
  ]);
  const target = { id: 'A', name: 'Team A', slug: 'team-a', edition_id: '18', completed: '5' };

  test('consumes Team Observation (queries team_match_statistic), edition-scoped, strict asOf flows', async () => {
    const f = fakeTx({ target, fixtures, stats });
    const bench = await readStatisticalBenchmark(f.tx, 'A', { asOf: ASOF, editionId: '18' });
    assert.ok(bench !== null);
    assert.equal(bench!.editionId, '18');
    assert.equal(bench!.scope, 'edition');
    assert.equal(bench!.provenance.source, 'teamObservations');
    assert.ok(f.sawStatsQuery(), 'the population came through the team_match_statistic-backed observation reader');
    assert.equal(f.asOfParam(), ASOF, 'asOf is passed to the strict-< target query');
    const xg = bench!.signals.find((s) => s.signalKey === 'expectedGoals')!;
    assert.equal(xg.signalValue, 1.8); // A home in F1-F4 (2.0), away in F5 (1.0) → mean of [2,2,2,2,1] = 1.8
    assert.equal(xg.usableSample, 5);
  });

  test('below the classification floor of 8 completed fixtures → insufficientSample, never zero-filled', async () => {
    const f = fakeTx({ target, fixtures, stats });
    const block = await readStatisticalAttributes(f.tx, 'A', { asOf: ASOF, editionId: '18' });
    assert.ok(block !== null);
    assert.equal(block!.insufficientSample, true);
    assert.deepEqual([block!.strengths.length, block!.weaknesses.length, block!.tendencies.length], [0, 0, 0]);
    assert.equal(block!.sample.completedFixtures, 5);
    assert.equal(block!.sample.classificationFloor, 8);
    assert.equal(block!.benchmarkVersion, 'stat-edition-cumedist-v1');
  });

  test('a team below the participation floor (completed < 5) yields a null block', async () => {
    const f = fakeTx({ target: { ...target, completed: '4' }, fixtures, stats });
    const block = await readStatisticalAttributes(f.tx, 'A', { asOf: ASOF, editionId: '18' });
    assert.equal(block, null);
  });

  test('an unknown team (no target row) yields null', async () => {
    const f = fakeTx({ target: null, fixtures: [], stats: [] });
    assert.equal(await readStatisticalAttributes(f.tx, 'ZZZ', { asOf: ASOF }), null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Governance invariants & MI isolation
// ═════════════════════════════════════════════════════════════════════════════

describe('statistical attributes — governance invariants', () => {
  test('the curated V1 set is exactly the 9 locked metrics', () => {
    assert.deepEqual([...STATISTICAL_BENCHMARK_KEYS].sort(), [
      'ballPossession', 'bigChanceCreated', 'bigChanceMissed', 'bigChanceScored',
      'errorsLeadToShot', 'expectedGoals', 'expectedGoalsOnTarget', 'shotsOnGoal', 'totalShotsOnGoal',
    ]);
    assert.equal(STATISTICAL_BENCHMARK_SIGNAL_KEYS.length, 9);
    assert.equal(STATISTICAL_ATTRIBUTES_VERSION, 'team-attributes-stat-tier-v1');
  });

  test('no confidence/probability/prediction/risk FIELDS exist on the DTOs', () => {
    const src = readFileSync(resolve(__dirname, '..', 'statisticalAttributes.ts'), 'utf8');
    // Match a TS property declaration (word optionally-optional then colon), so the header
    // comment promising their absence does not itself trip the check.
    for (const banned of ['confidence', 'probability', 'prediction', 'riskScore', 'verdict']) {
      assert.ok(!new RegExp(`\\b${banned}\\??\\s*:`).test(src), `stat attributes must not expose a '${banned}' field`);
    }
  });

  test('MI ISOLATION: no snapshot/ or module/ source imports the stat-tier modules', () => {
    const roots = ['snapshot', 'module'].map((d) => resolve(__dirname, '..', '..', '..', d));
    const banned = /statisticalAttributes|statisticalBenchmark/;
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) out = out.concat(walk(p));
        else if (e.name.endsWith('.ts')) out.push(p);
      }
      return out;
    };
    for (const root of roots) {
      for (const file of walk(root)) {
        assert.ok(!banned.test(readFileSync(file, 'utf8')), `${file} must not import stat-tier attributes into MI`);
      }
    }
  });
});
