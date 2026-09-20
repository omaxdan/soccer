// TEAM ATTRIBUTES read-model tests (DB-free: pure classification + captured-tx wiring).
//
// Proves the governed chain OBSERVED FACT → SIGNAL → BENCHMARK → QUARTILE → QUALITY
// ORIENTATION → ATTRIBUTE: quartile membership from the benchmark's own Q1/Q3 (no invented
// threshold, no VERY_STRONG levels); quality orientation declared per signal (a HIGH
// conceded value becomes a WEAKNESS, a HIGH scored value a STRENGTH); neutral metrics are
// tendencies only; classification floor = 8 (below → insufficientSample, never zero-filled);
// inclusive Q1/Q3 ties; edition scope; no future leakage (inherited from the benchmark).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  classifyQuartile, assembleTeamAttributes, readTeamAttributes,
  ATTRIBUTE_CLASSIFICATION_FLOOR, TEAM_ATTRIBUTES_VERSION,
} from '../teamAttributes';
import type { TeamBenchmarkResponse, BenchmarkSignal } from '../teamBenchmark';

// ── pure classifyQuartile ─────────────────────────────────────────────────────

describe('Team Attributes · classifyQuartile', () => {
  test('HIGHER_IS_BETTER: ≥Q3 top, ≤Q1 bottom, else middle (inclusive)', () => {
    assert.equal(classifyQuartile(3, 1, 2, 'HIGHER_IS_BETTER'), 'TOP_QUARTILE');
    assert.equal(classifyQuartile(0.5, 1, 2, 'HIGHER_IS_BETTER'), 'BOTTOM_QUARTILE');
    assert.equal(classifyQuartile(1.5, 1, 2, 'HIGHER_IS_BETTER'), 'MIDDLE');
    assert.equal(classifyQuartile(2, 1, 2, 'HIGHER_IS_BETTER'), 'TOP_QUARTILE');    // Q3 inclusive
    assert.equal(classifyQuartile(1, 1, 2, 'HIGHER_IS_BETTER'), 'BOTTOM_QUARTILE'); // Q1 inclusive
  });
  test('LOWER_IS_BETTER inverts: ≤Q1 top (good), ≥Q3 bottom (bad)', () => {
    assert.equal(classifyQuartile(0.5, 1, 2, 'LOWER_IS_BETTER'), 'TOP_QUARTILE');
    assert.equal(classifyQuartile(3, 1, 2, 'LOWER_IS_BETTER'), 'BOTTOM_QUARTILE');
    assert.equal(classifyQuartile(1.5, 1, 2, 'LOWER_IS_BETTER'), 'MIDDLE');
  });
  test('NEUTRAL: high value = TOP position (a tendency, not a quality)', () => {
    assert.equal(classifyQuartile(3, 1, 2, 'NEUTRAL'), 'TOP_QUARTILE');
    assert.equal(classifyQuartile(0.5, 1, 2, 'NEUTRAL'), 'BOTTOM_QUARTILE');
  });
});

// ── pure assembly: the critical direction→quality flip ────────────────────────

function sig(signalKey: string, signalValue: number, q1: number, q3: number, direction: BenchmarkSignal['direction'] = 'HIGHER_IS_MORE'): BenchmarkSignal {
  return { signalKey, signalValue, direction, rank: 1, percentile: 0.9, median: (q1 + q3) / 2, quartiles: { q1, q3 } };
}
function bench(signals: BenchmarkSignal[], teamFixtures = 20): TeamBenchmarkResponse {
  return {
    team: { id: '72', name: 'Palmeiras', slug: 'palmeiras' }, scope: 'edition', editionId: '18',
    asOf: '2026-09-20T00:00:00.000Z',
    population: { editionId: '18', teams: 20, excludedTeams: 0, participationFloor: 5 },
    sample: { teamFixtures }, benchmarkVersion: 'result-edition-cumedist-v1', signals,
    provenance: { source: 'teamPerformanceSignals+fixtures', reconstructed: true, immutable: false },
  };
}

describe('Team Attributes · assemble (governed quality mapping)', () => {
  test('HIGH scored = strength; HIGH conceded = WEAKNESS (LOWER_IS_BETTER flip)', () => {
    const { strengths, weaknesses, tendencies } = assembleTeamAttributes(bench([
      sig('goals_per_match', 1.76, 1.08, 1.48),          // HIGHER_IS_BETTER, ≥Q3 → strength
      sig('goals_conceded_per_match', 1.5, 0.7, 1.2),    // LOWER_IS_BETTER, ≥Q3 → weakness (the flip)
      sig('clean_sheet_rate', 0.10, 0.2, 0.4),           // HIGHER_IS_BETTER, ≤Q1 → weakness
      sig('win_rate', 0.5, 0.3, 0.6),                    // MIDDLE → emitted nowhere
      sig('btts_rate', 0.7, 0.4, 0.6),                   // NEUTRAL, ≥Q3 → tendency
    ]));
    assert.deepEqual(strengths.map((a) => a.key), ['goals_per_match']);
    assert.equal(strengths[0].type, 'strength');
    assert.equal(strengths[0].level, 'TOP_QUARTILE');
    const wKeys = weaknesses.map((a) => a.key).sort();
    assert.deepEqual(wKeys, ['clean_sheet_rate', 'goals_conceded_per_match']);
    const conceded = weaknesses.find((a) => a.key === 'goals_conceded_per_match')!;
    assert.equal(conceded.type, 'weakness');
    assert.equal(conceded.qualityOrientation, 'LOWER_IS_BETTER');
    assert.equal(conceded.level, 'BOTTOM_QUARTILE');
    assert.deepEqual(tendencies.map((a) => a.key), ['btts_rate']);
    assert.equal(tendencies[0].type, 'tendency');
    // win_rate (MIDDLE) appears in no bucket
    assert.ok(![...strengths, ...weaknesses, ...tendencies].some((a) => a.key === 'win_rate'));
  });

  test('evidence links to the benchmark (rank/percentile/median/q1/q3) — no opaque level, no 5-band', () => {
    const { strengths } = assembleTeamAttributes(bench([sig('goals_per_match', 1.76, 1.08, 1.48)]));
    const e = strengths[0].evidence;
    assert.equal(e.signalKey, 'goals_per_match');
    assert.equal(e.signalValue, 1.76);
    assert.equal(e.benchmark.q3, 1.48);
    assert.equal(e.teamFixtures, 20);
    assert.doesNotMatch(JSON.stringify(strengths), /VERY_STRONG|STRONG"|WEAK"/);
  });
});

// ── end-to-end via the benchmark reader (captured tx) ─────────────────────────

function captureTx(queue: unknown[][]) {
  let i = 0;
  return { query: async (_s: string, _p: unknown[] = []) => ({ rows: queue[i++] ?? [] }) } as unknown as PoolClient;
}
function fixtures(teamId: string, gf: number, ga: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({ team_id: teamId, gf, ga, fixture_id: `${teamId}_${i}` }));
}
const target = (completed: string) => [{ id: '72', name: 'Palmeiras', slug: 'palmeiras', edition_id: '18', completed }];

describe('readTeamAttributes — floor + wiring', () => {
  test('unknown team (benchmark null) → null', async () => {
    const res = await readTeamAttributes(captureTx([[]]), '999', { editionId: '18' });
    assert.equal(res, null);
  });

  test('benchmarkable but < attribute floor (7 < 8) → insufficientSample, no classification', async () => {
    const pop = [...fixtures('72', 2, 1, 7), ...fixtures('A', 1, 1, 6)];
    const res = await readTeamAttributes(captureTx([target('7'), pop]), '72', { editionId: '18' });
    assert.ok(res);
    assert.equal(res!.insufficientSample, true);
    assert.equal(res!.sample.completedFixtures, 7);
    assert.equal(res!.sample.classificationFloor, ATTRIBUTE_CLASSIFICATION_FLOOR);
    assert.deepEqual(res!.strengths, []);
    assert.deepEqual(res!.weaknesses, []);
  });

  test('≥8 fixtures → classified; a clear top-scoring team surfaces a scoring strength', async () => {
    // 72 scores 3/match; peers score 0/1/1/1 → 72 is top-quartile on goals_per_match.
    const pop = [
      ...fixtures('72', 3, 0, 8), ...fixtures('A', 0, 0, 8), ...fixtures('B', 1, 0, 8),
      ...fixtures('C', 1, 0, 8), ...fixtures('D', 1, 0, 8),
    ];
    const res = await readTeamAttributes(captureTx([target('8'), pop]), '72', { editionId: '18' });
    assert.ok(res);
    assert.equal(res!.insufficientSample, false);
    assert.equal(res!.scope.type, 'edition');
    assert.equal(res!.context, 'current edition, completed matches to date');
    assert.ok(res!.benchmarkVersion.length > 0 && TEAM_ATTRIBUTES_VERSION.length > 0); // present
    assert.ok(res!.strengths.some((a) => a.key === 'goals_per_match' && a.level === 'TOP_QUARTILE'));
  });
});
