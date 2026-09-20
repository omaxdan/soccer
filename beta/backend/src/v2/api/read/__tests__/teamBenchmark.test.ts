// BENCHMARK & COMPARATIVE INTELLIGENCE read-model tests (DB-free: pure + captured-tx).
//
// Proves: edition-scoped result-tier population; participation floor = 5 (below-floor
// teams excluded, never zero-filled); CUME_DIST percentile + descending rank + type-7
// quartiles; tie determinism; no future leakage (SQL `< asOf`); no team_match_statistic
// in the population query; deterministic, non-classified output (no Strong/Weak).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  readTeamBenchmark, cumeDist, descendingRank, quantileSorted,
  BENCHMARK_TARGET_SQL, BENCHMARK_POPULATION_SQL, BENCHMARK_PARTICIPATION_FLOOR, TEAM_BENCHMARK_VERSION,
  type BenchmarkSignal,
} from '../teamBenchmark';

// ── pure statistics ─────────────────────────────────────────────────────────

describe('Benchmark · statistics primitives', () => {
  test('cumeDist = fraction ≤ target (includes ties)', () => {
    assert.equal(cumeDist([0, 1, 2, 3, 4, 5], 2), 0.5);
    assert.equal(cumeDist([1, 1, 1, 1, 1, 1], 1), 1);   // all tied → 1.0
  });
  test('descendingRank = 1 + strictly greater (ties share)', () => {
    assert.equal(descendingRank([0, 1, 2, 3, 4, 5], 2), 4);
    assert.equal(descendingRank([1, 1, 1, 1, 1, 1], 1), 1);
  });
  test('quantileSorted type-7', () => {
    const s = [0, 1, 2, 3, 4, 5];
    assert.equal(quantileSorted(s, 0.5), 2.5);
    assert.equal(quantileSorted(s, 0.25), 1.25);
    assert.equal(quantileSorted(s, 0.75), 3.75);
  });
});

// ── read binding: population, floor, rank/percentile ──────────────────────────

function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: queue[i++] ?? [] }; },
  } as unknown as PoolClient;
  return { tx, calls };
}

// 6 eligible teams T0..T5 (5 fixtures each, gf=k, ga=0) + T9 below floor (4 fixtures).
function population() {
  const rows: { team_id: string; gf: number; ga: number; fixture_id: string }[] = [];
  for (let k = 0; k <= 5; k++) for (let i = 0; i < 5; i++) rows.push({ team_id: `T${k}`, gf: k, ga: 0, fixture_id: `f${k}_${i}` });
  for (let i = 0; i < 4; i++) rows.push({ team_id: 'T9', gf: 9, ga: 0, fixture_id: `f9_${i}` }); // below floor
  return rows;
}
const targetRow = (completed: string) => [{ id: 'T2', name: 'Team2', slug: 't2', edition_id: '18', completed }];
const find = (sigs: readonly BenchmarkSignal[], key: string) => sigs.find((s) => s.signalKey === key)!;

describe('readTeamBenchmark — population + rank/percentile', () => {
  test('edition-scoped population, floor excludes T9, deterministic rank/percentile/quartiles', async () => {
    const { tx, calls } = captureTx([targetRow('5'), population()]);
    const res = await readTeamBenchmark(tx, 'T2', { asOf: new Date('2026-06-01T00:00:00Z'), editionId: '18' });
    assert.ok(res);
    assert.equal(calls.length, 2);                       // target resolve + one population query (no N+1)
    assert.equal(res!.population.teams, 6);              // T9 excluded
    assert.equal(res!.population.excludedTeams, 1);
    assert.equal(res!.population.participationFloor, BENCHMARK_PARTICIPATION_FLOOR);
    assert.equal(res!.sample.teamFixtures, 5);
    assert.equal(res!.scope, 'edition');
    assert.equal(res!.editionId, '18');
    assert.equal(res!.benchmarkVersion, TEAM_BENCHMARK_VERSION);
    assert.equal(res!.provenance.immutable, false);

    // goals_per_match: values [0,1,2,3,4,5], target T2 = 2 (T9's 9 must NOT leak in)
    const g = find(res!.signals, 'goals_per_match');
    assert.equal(g.signalValue, 2);
    assert.equal(g.rank, 4);
    assert.equal(g.percentile, 0.5);
    assert.equal(g.median, 2.5);
    assert.deepEqual(g.quartiles, { q1: 1.25, q3: 3.75 });
    assert.equal(g.direction, 'HIGHER_IS_MORE');
  });

  test('tie behaviour: all teams keep clean sheets → percentile 1.0, rank 1', async () => {
    const { tx } = captureTx([targetRow('5'), population()]);
    const res = await readTeamBenchmark(tx, 'T2', { asOf: new Date('2026-06-01T00:00:00Z'), editionId: '18' });
    const cs = find(res!.signals, 'clean_sheet_rate');
    assert.equal(cs.signalValue, 1);
    assert.equal(cs.percentile, 1);
    assert.equal(cs.rank, 1);
    assert.deepEqual(cs.quartiles, { q1: 1, q3: 1 });
  });

  test('no Strong/Weak/quality label anywhere in the output', async () => {
    const { tx } = captureTx([targetRow('5'), population()]);
    const res = await readTeamBenchmark(tx, 'T2', { asOf: new Date('2026-06-01T00:00:00Z'), editionId: '18' });
    assert.doesNotMatch(JSON.stringify(res), /STRONG|WEAK|elite|strong|weak/i);
  });
});

describe('readTeamBenchmark — gates', () => {
  test('unknown team (no completed fixtures) → null', async () => {
    const { tx, calls } = captureTx([[]]);
    const res = await readTeamBenchmark(tx, '999', { asOf: new Date() });
    assert.equal(res, null);
    assert.equal(calls.length, 1); // population query never runs
  });
  test('target below participation floor → null (never zero-filled)', async () => {
    const { tx } = captureTx([targetRow('4'), population()]);
    const res = await readTeamBenchmark(tx, 'T2', { asOf: new Date(), editionId: '18' });
    assert.equal(res, null);
  });
});

// ── SQL shape (leakage control, result-tier only) ─────────────────────────────

describe('Benchmark · SQL shape', () => {
  test('target SQL: strict `< $2`, edition-optional, completed only, read-only', () => {
    const s = BENCHMARK_TARGET_SQL;
    assert.match(s, /f\.scheduled_kickoff_at < \$2::timestamptz/);
    assert.doesNotMatch(s, /scheduled_kickoff_at <= /);
    assert.match(s, /lifecycle_state_code = 'COMPLETED'/);
    assert.match(s, /\$3::bigint IS NULL OR ce\.id = \$3::bigint/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  });
  test('population SQL: edition-scoped, strict `< $2`, result join, NO team_match_statistic, read-only', () => {
    const s = BENCHMARK_POPULATION_SQL;
    assert.match(s, /competition_edition_id = \$1::bigint/);
    assert.match(s, /f\.scheduled_kickoff_at < \$2::timestamptz/g);
    assert.match(s, /JOIN football\.result r/);
    assert.doesNotMatch(s, /team_match_statistic/); // result tier only — no partial stat population
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  });
});
