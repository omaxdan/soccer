// TEAM PERFORMANCE SIGNALS read-model tests (DB-free: pure builders + captured-tx).
//
// Proves transparent, coverage-aware, non-opaque signals over the Team Observation
// series: result-tier rates/margins/streaks at full coverage; xG/stat signals over a
// COMMON COHORT with coverage exposed; missing≠zero; zero-denominator→null; deterministic
// streaks; and — critically — that duplicate team_match_statistic group_name rows do NOT
// double-count, because signals go through readTeamObservations' canonicalization.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  buildWindowSignals, buildTrajectory, readTeamPerformanceSignals,
  type PerformanceSignal,
} from '../teamPerformanceSignals';
import type { TeamObservation, ObservationMetric } from '../teamObservations';

// ── fixtures ──────────────────────────────────────────────────────────────────

const ref = (n: number) => ({ id: String(n), name: `T${n}`, slug: `t${n}` });
const metric = (key: string, value: number | null): ObservationMetric => ({ key, value, display: null });

interface ObsOver {
  gf: number; ga: number; xg?: number | null; xga?: number | null;
  shots?: number | null; sot?: number | null; possession?: number | null; f3?: number | null;
  home?: boolean;
}
function obs(fixtureId: string, over: ObsOver): TeamObservation {
  const { gf, ga } = over;
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
  const metrics: ObservationMetric[] = [];
  if (over.shots !== undefined && over.shots !== null) metrics.push(metric('totalShotsOnGoal', over.shots));
  if (over.sot !== undefined && over.sot !== null) metrics.push(metric('shotsOnGoal', over.sot));
  if (over.possession !== undefined && over.possession !== null) metrics.push(metric('ballPossession', over.possession));
  if (over.f3 !== undefined && over.f3 !== null) metrics.push(metric('finalThirdEntries', over.f3));
  return {
    fixtureId, fixturePartitionOn: '2026-01-01',
    competition: { id: '28', name: 'L', slug: 'l' }, edition: { id: '18', seasonLabel: 'S' },
    kickoffAt: '2026-02-01T00:00:00.000Z', sequenceIndex: 1, opponent: ref(99),
    venueSide: over.home === false ? 'away' : 'home',
    result, goalsFor: gf, goalsAgainst: ga, goalMargin: gf - ga, points: result === 'W' ? 3 : result === 'D' ? 1 : 0,
    cleanSheet: ga === 0,
    xg: over.xg === undefined ? null : over.xg, xga: over.xga === undefined ? null : over.xga,
    provenance: { provider: 'P', retrievedAt: null }, metrics,
  };
}

// A rich 5-fixture window (chronological ASC).
const WINDOW: TeamObservation[] = [
  obs('f1', { gf: 2, ga: 1, xg: 1.5, xga: 1.0, shots: 10, sot: 4 }),   // W margin1, BTTS, total3
  obs('f2', { gf: 0, ga: 0, xg: 0.5, xga: 0.3, shots: 8, sot: 2 }),    // D, clean sheet, failed to score
  obs('f3', { gf: 1, ga: 0 }),                                          // W 1-0, xg/shots MISSING
  obs('f4', { gf: 3, ga: 3, xg: 2.0, xga: 2.5, shots: 12, sot: 6 }),   // D, BTTS, total6
  obs('f5', { gf: 0, ga: 2, xg: 0.4, xga: 1.8, shots: 5, sot: 1 }),    // L margin-2, conceded2+
];

const val = (sigs: readonly PerformanceSignal[], key: string): number | null => {
  const s = sigs.find((x) => x.key === key);
  if (!s) throw new Error(`no signal ${key}`);
  return s.value;
};
const sig = (sigs: readonly PerformanceSignal[], key: string): PerformanceSignal =>
  sigs.find((x) => x.key === key)!;

// ── result-tier signals (full coverage) ──────────────────────────────────────

describe('Performance Signals · result-tier (full coverage)', () => {
  const w = buildWindowSignals(WINDOW);
  test('scoring rates + goals per match', () => {
    assert.equal(val(w.scoring, 'goals_per_match'), 1.2);
    assert.equal(val(w.scoring, 'scored_in_match_rate'), 0.6);
    assert.equal(val(w.scoring, 'scored_2plus_rate'), 0.4);
    assert.equal(val(w.scoring, 'failed_to_score_rate'), 0.4);
  });
  test('conceding + clean sheets', () => {
    assert.equal(val(w.conceding, 'goals_conceded_per_match'), 1.2);
    assert.equal(val(w.conceding, 'clean_sheet_rate'), 0.4);
    assert.equal(val(w.conceding, 'conceded_2plus_rate'), 0.4);
  });
  test('total goals + BTTS', () => {
    assert.equal(val(w.totalGoals, 'total_goals_3plus_rate'), 0.4);
    assert.equal(val(w.totalGoals, 'average_total_goals'), 2.4);
    assert.equal(val(w.btts, 'btts_rate'), 0.4);
    assert.equal(val(w.btts, 'btts_win_rate'), 0.2);
  });
  test('result profile', () => {
    assert.equal(val(w.result, 'win_rate'), 0.4);
    assert.equal(val(w.result, 'points_per_match'), 1.6);
  });
  test('margin / grind profile', () => {
    assert.equal(val(w.margin, 'one_nil_wins'), 1);
    assert.equal(val(w.margin, 'one_goal_win_rate'), 1);       // 2 one-goal wins / 2 wins
    assert.equal(val(w.margin, 'two_plus_goal_win_rate'), 0);
    assert.equal(val(w.margin, 'average_winning_margin'), 1);
    assert.equal(val(w.margin, 'maximum_losing_margin'), 2);
    assert.equal(val(w.margin, 'two_plus_goal_loss_rate'), 1); // 1 of 1 loss by 2+
    assert.equal(val(w.margin, 'average_losing_margin'), 2);
    assert.equal(val(w.margin, 'positive_goal_difference_fixture_rate'), 0.4);
    assert.equal(val(w.margin, 'zero_goal_difference_fixture_rate'), 0.4);
  });
});

// ── xG / stat signals (common cohort, coverage) ───────────────────────────────

describe('Performance Signals · xG/stat common-cohort + coverage', () => {
  const w = buildWindowSignals(WINDOW);
  test('goals − xG over the goals∩xg cohort (f3 excluded, coverage 4/5)', () => {
    const s = sig(w.attack, 'goals_minus_xg');
    assert.equal(s.value, 0.6);                       // 5 goals − 4.4 xG over 4 fixtures
    assert.deepEqual(s.coverage, { commonFixtures: 4, windowSize: 5, rate: 0.8 });
    assert.deepEqual(s.evidence.fixtureIds, ['f1', 'f2', 'f4', 'f5']); // f3 (missing xg) excluded
    assert.equal(val(w.attack, 'goals_minus_xg_per_match'), 0.15);
    assert.equal(val(w.attack, 'xg_per_match'), 1.1);
  });
  test('defensive xG differential per match', () => {
    assert.equal(val(w.defensiveXg, 'xga_per_match'), 1.4);
    assert.equal(val(w.defensiveXg, 'xg_differential_per_match'), -0.3);
  });
  test('conversion & xG/shot over common cohorts', () => {
    assert.equal(val(w.creation, 'shots_per_match'), 8.75);
    assert.equal(val(w.creation, 'shots_on_target_per_match'), 3.25);
    assert.equal(val(w.creation, 'conversion_rate'), 0.3846);     // 5 goals / 13 SoT
    assert.equal(val(w.creation, 'xg_per_shot'), 0.1257);         // 4.4 / 35
  });
  test('possession/final-third absent → value null with coverage 0/5 (missing ≠ zero)', () => {
    const p = sig(w.creation, 'possession');
    assert.equal(p.value, null);
    assert.deepEqual(p.coverage, { commonFixtures: 0, windowSize: 5, rate: 0 });
  });
});

// ── zero denominators & empty window ──────────────────────────────────────────

describe('Performance Signals · zero-denominator → null', () => {
  test('no wins/losses → conditional rates & avg margins null (never 0)', () => {
    const w = buildWindowSignals([obs('d1', { gf: 0, ga: 0 }), obs('d2', { gf: 1, ga: 1 })]); // 2 draws
    assert.equal(val(w.margin, 'one_goal_win_rate'), null);
    assert.equal(val(w.margin, 'average_winning_margin'), null);
    assert.equal(val(w.margin, 'two_plus_goal_loss_rate'), null);
    assert.equal(val(w.margin, 'average_losing_margin'), null);
  });
  test('SoT sum 0 → conversion null', () => {
    const w = buildWindowSignals([obs('z1', { gf: 0, ga: 0, sot: 0 })]);
    assert.equal(val(w.creation, 'conversion_rate'), null);
  });
  test('empty window → rates null, streaks length 0', () => {
    const w = buildWindowSignals([]);
    assert.equal(val(w.scoring, 'goals_per_match'), null);
    assert.equal(val(w.scoring, 'scored_in_match_rate'), null);
    const cur = w.streaks.find((s) => s.key === 'current_scoring_streak')!;
    assert.deepEqual({ length: cur.length, ids: cur.fixtureIds }, { length: 0, ids: [] });
  });
});

// ── streaks (deterministic, current = ending at newest) ───────────────────────

describe('Performance Signals · streaks', () => {
  const w = buildWindowSignals(WINDOW);
  const st = (key: string) => w.streaks.find((s) => s.key === key)!;
  test('current conceding = run ending at newest (f4,f5); longest scoring = 2 (f3,f4)', () => {
    assert.deepEqual(st('current_conceding_streak').fixtureIds, ['f4', 'f5']);
    assert.equal(st('longest_scoring_streak').length, 2);
    assert.deepEqual(st('longest_scoring_streak').fixtureIds, ['f3', 'f4']);
  });
  test('current scoreless = 1 (f5 only); current clean-sheet = 0 (f5 conceded)', () => {
    assert.equal(st('current_scoreless_streak').length, 1);
    assert.deepEqual(st('current_scoreless_streak').fixtureIds, ['f5']);
    assert.equal(st('current_clean_sheet_streak').length, 0);
  });
});

// ── trajectory (aligned deltas) ───────────────────────────────────────────────

describe('Performance Signals · trajectory', () => {
  test('goals−xG Last5 vs Previous5 change = difference of aligned per-match values', () => {
    const last5 = WINDOW;                                             // per-match goals−xG = 0.15
    const previous5 = [obs('p1', { gf: 1, ga: 1, xg: 1.0, xga: 1.0 })]; // 1 goal − 1.0 xg = 0.0
    const traj = buildTrajectory(last5, previous5);
    const gmx = traj.find((t) => t.key === 'goals_minus_xg_trajectory')!;
    assert.equal(gmx.last5.value, 0.15);
    assert.equal(gmx.previous5.value, 0);
    assert.equal(gmx.change, 0.15);
  });
});

// ── group_name double-count regression (through the real reader) ──────────────

function captureTx(queue: unknown[][]) {
  let i = 0;
  const tx = { query: async (_sql: string, _p: unknown[] = []) => ({ rows: queue[i++] ?? [] }) } as unknown as PoolClient;
  return tx;
}

describe('Performance Signals · group_name dedup (no double-count)', () => {
  test('duplicate group_name stat rows collapse via readTeamObservations → shots not doubled', async () => {
    const identity = [{ id: '72', name: 'Palmeiras', slug: 'palmeiras' }];
    const fixtures = [{
      fixture_id: '100', fixture_partition_on: '2026-01-01', kickoff_at: '2026-02-01T00:00:00.000Z', is_home: true,
      edition_id: '18', season_label: 'S', competition_id: '28', competition_name: 'L', competition_slug: 'l',
      opponent_id: '9', opponent_name: 'O', opponent_slug: 'o', home_goals: 2, away_goals: 1,
    }];
    // TWO group_name rows for the same fixture+statistic, SAME oriented value (10) → must collapse to one.
    const stats = [
      { fixture_id: '100', group_name: 'all', statistic_key: 'totalShotsOnGoal', statistic_name: 'Total shots', home_value: '10', away_value: '7', home_display: null, away_display: null, value_type: 'number', provider_code: 'P', retrieved_at: '2026-02-02T00:00:00.000Z' },
      { fixture_id: '100', group_name: 'attack', statistic_key: 'totalShotsOnGoal', statistic_name: 'Total shots', home_value: '10', away_value: '7', home_display: null, away_display: null, value_type: 'number', provider_code: 'P', retrieved_at: '2026-02-02T00:00:00.000Z' },
    ];
    const tx = captureTx([identity, fixtures, stats]);
    const res = await readTeamPerformanceSignals(tx, '72', { id: '72', name: 'Palmeiras', slug: 'palmeiras' });
    assert.ok(res);
    assert.equal(res!.windows.season.windowSize, 1);
    // shots_per_match over ONE fixture must be 10 (the deduped value), NOT 20.
    assert.equal(val(res!.windows.season.creation, 'shots_per_match'), 10);
    // and the fixture reconciles as a home win 2-1.
    assert.equal(val(res!.windows.season.scoring, 'goals_per_match'), 2);
    assert.equal(val(res!.windows.season.result, 'win_rate'), 1);
  });
});
