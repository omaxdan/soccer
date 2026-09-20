// EDITION TEMPORAL PERFORMANCE — read-model tests (DB-free).
//
// Layers:
//   • Result tier: cumulative-state DIFFERENCING (end − boundary), zero-state boundary,
//     rates from window counts, W/D/L consistency integrity.
//   • Stat tier: bounded window reconstruction (statWindow/compareStat) — missing≠zero,
//     coverage N/5, MANDATORY regression that a flat cumulative value is never read as
//     zero activity when coverage did not increase.
//   • Binding: reuses readEditionObservations (404 passthrough) + ONE bounded stat query
//     (no N+1), verified via capture tx.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  resultWindow, statWindow, compareStat, readEditionTemporalPerformance,
  EditionTemporalPerformanceDataIntegrityError, EDITION_AGGREGATION_VERSION,
} from '../editionTemporalPerformance';
import type { EditionObservationPoint, EditionObsStatRow } from '../editionObservations';

// ── point + stat-row builders ─────────────────────────────────────────────────────
const pt = (over: Partial<EditionObservationPoint> & { sequenceIndex: number }): EditionObservationPoint => ({
  sequenceIndex: over.sequenceIndex,
  throughFixtureId: over.throughFixtureId ?? String(1900 + over.sequenceIndex),
  throughKickoffAt: over.throughKickoffAt ?? `2026-02-${String(over.sequenceIndex).padStart(2, '0')}T00:00:00.000Z`,
  matchesCompleted: over.matchesCompleted ?? over.sequenceIndex,
  results: over.results ?? { homeWins: 0, draws: 0, awayWins: 0, homeWinPct: 0, drawPct: 0, awayWinPct: 0 },
  goals: over.goals ?? { total: 0, home: 0, away: 0, perMatch: 0 },
  cleanSheets: over.cleanSheets ?? { home: 0, away: 0, total: 0 },
  statTier: over.statTier ?? { expectedGoals: null, shots: null, shotsOnTarget: null, yellowCards: null, redCards: null, fouls: null, kilometersCovered: null, numberOfSprints: null },
});

const statRow = (over: Partial<EditionObsStatRow> & { fixture_id: string; statistic_key: string }): EditionObsStatRow => ({
  group_name: 'Match overview', home_value: null, away_value: null, value_type: 'number',
  provider_code: 'SPORTSAPI_API', retrieved_at: '2026-08-23T21:00:00.000Z', ...over,
});

describe('resultWindow — cumulative differencing, zero-state boundary, rates from counts', () => {
  const end = pt({ sequenceIndex: 10, matchesCompleted: 10, results: { homeWins: 5, draws: 3, awayWins: 2, homeWinPct: 50, drawPct: 30, awayWinPct: 20 }, goals: { total: 27, home: 15, away: 12, perMatch: 2.7 }, cleanSheets: { home: 4, away: 3, total: 7 } });
  const boundary = pt({ sequenceIndex: 5, matchesCompleted: 5, results: { homeWins: 3, draws: 1, awayWins: 1, homeWinPct: 60, drawPct: 20, awayWinPct: 20 }, goals: { total: 14, home: 8, away: 6, perMatch: 2.8 }, cleanSheets: { home: 2, away: 1, total: 3 } });
  test('window = end − boundary; rates re-derived from window counts', () => {
    const w = resultWindow(end, boundary);
    assert.equal(w.matchesCompleted, 5);
    assert.deepEqual({ h: w.homeWins, d: w.draws, a: w.awayWins }, { h: 2, d: 2, a: 1 });
    assert.equal(w.homeWinPct, 40); assert.equal(w.drawPct, 40); assert.equal(w.awayWinPct, 20); // 2/5,2/5,1/5
    assert.equal(w.goals.total, 13); assert.equal(w.goals.home, 7); assert.equal(w.goals.away, 6);
    assert.equal(w.goals.perMatch, 2.6); // 13/5, NOT differenced from cumulative perMatch
    assert.equal(w.cleanSheets.total, 4); // (4-2)+(3-1)
  });
  test('null boundary = zero state (window at edition start)', () => {
    const w = resultWindow(boundary, null);
    assert.equal(w.matchesCompleted, 5); assert.equal(w.goals.total, 14);
  });
  test('W/D/L must sum to matchesCompleted — integrity error otherwise', () => {
    const bad = pt({ sequenceIndex: 10, matchesCompleted: 10, results: { homeWins: 9, draws: 3, awayWins: 2, homeWinPct: 0, drawPct: 0, awayWinPct: 0 } });
    assert.throws(() => resultWindow(bad, boundary), EditionTemporalPerformanceDataIntegrityError);
  });
});

describe('statWindow / compareStat — bounded reconstruction, missing≠zero, coverage', () => {
  const XG = { key: 'expectedGoals', sources: ['expectedGoals'] };
  // 5 last-window fixtures: 3 carry xG (both sides), 2 carry none.
  const statsByFixture = new Map<string, EditionObsStatRow[]>([
    ['1', [statRow({ fixture_id: '1', statistic_key: 'expectedGoals', home_value: '1.2', away_value: '0.8' })]],
    ['2', [statRow({ fixture_id: '2', statistic_key: 'expectedGoals', home_value: '1.0', away_value: '1.0' })]],
    ['3', [statRow({ fixture_id: '3', statistic_key: 'expectedGoals', home_value: '0.5', away_value: '0.4' })]],
    // '4','5' → no stat rows
  ]);
  test('window value sums both sides over covered fixtures; coverage = 3/5, not zero-filled', () => {
    const w = statWindow(['1', '2', '3', '4', '5'], statsByFixture, XG);
    assert.equal(w.value, 4.9); // (2.0)+(2.0)+(0.9)
    assert.equal(w.observations, 3); assert.equal(w.windowSize, 5); // 2 missing NOT counted as zero
  });
  test('window with no stat rows → value null, coverage 0/5', () => {
    const w = statWindow(['4', '5'], statsByFixture, XG);
    assert.deepEqual(w, { value: null, observations: 0, windowSize: 5 });
  });
  test('compareStat: change only when both windows valid; coverage preserved', () => {
    const prevStats = new Map<string, EditionObsStatRow[]>([
      ['p1', [statRow({ fixture_id: 'p1', statistic_key: 'expectedGoals', home_value: '0.7', away_value: '0.3' })]],
    ]);
    const merged = new Map([...statsByFixture, ...prevStats]);
    const c = compareStat(['p1', 'p2', 'p3', 'p4', 'p5'], ['1', '2', '3', '4', '5'], merged, XG);
    assert.equal(c.previous5.value, 1); assert.equal(c.previous5.observations, 1);
    assert.equal(c.last5.value, 4.9); assert.equal(c.last5.observations, 3);
    assert.equal(c.change, 3.9); assert.equal(c.changeType, 'absolute'); assert.equal(c.direction, 'UP');
    assert.equal(c.percentageChange, 390); // (4.9-1)/1*100
  });
  test('previous window has no evidence → change null, UNAVAILABLE (never 0→value)', () => {
    const c = compareStat(['x1', 'x2'], ['1', '2', '3'], statsByFixture, XG);
    assert.equal(c.previous5.value, null); assert.equal(c.change, null); assert.equal(c.direction, 'UNAVAILABLE');
  });
});

// ── MANDATORY §30 regression: flat cumulative stat value is NOT zero activity ──────
describe('MANDATORY — flat cumulative stat value across points is NOT read as zero window activity', () => {
  test('stat windows come from raw fixtures, not cumulative deltas; unchanged cumulative ≠ 0 activity', async () => {
    // Build a 10-point cumulative series whose statTier.expectedGoals is FLAT (e.g. stays 3.99)
    // across the last window because those fixtures carry no xG evidence — a cumulative delta
    // would wrongly read 0, but the stat tier is reconstructed from raw fixtures with coverage.
    const series: EditionObservationPoint[] = Array.from({ length: 10 }, (_, i) => pt({
      sequenceIndex: i + 1, throughFixtureId: String(i + 1), matchesCompleted: i + 1,
      results: { homeWins: i + 1, draws: 0, awayWins: 0, homeWinPct: 0, drawPct: 0, awayWinPct: 0 },
      goals: { total: (i + 1) * 2, home: (i + 1) * 2, away: 0, perMatch: 2 },
      cleanSheets: { home: i + 1, away: 0, total: i + 1 },
      statTier: { expectedGoals: 3.99, shots: null, shotsOnTarget: null, yellowCards: null, redCards: null, fouls: null, kilometersCovered: null, numberOfSprints: null }, // FLAT
    }));
    const idRow = { edition_id: '18', season_label: 'S', competition_id: '28', competition_name: 'B', competition_slug: 'b', matches_scheduled: 250 };
    // readEditionObservations internals: identity, fixtures (10 completed), all-stats (empty here).
    const fixtureRows = series.map((p) => ({ fixture_id: p.throughFixtureId, kickoff_at: p.throughKickoffAt, home_goals: 2, away_goals: 0 }));
    // Edition Temporal's OWN bounded window-stats query returns real xG only for last-window fixtures 8,9,10.
    const windowStatRows = [
      statRow({ fixture_id: '8', statistic_key: 'expectedGoals', home_value: '1.1', away_value: '0.6' }),
      statRow({ fixture_id: '9', statistic_key: 'expectedGoals', home_value: '0.9', away_value: '0.4' }),
      statRow({ fixture_id: '10', statistic_key: 'expectedGoals', home_value: '1.2', away_value: '0.8' }),
    ];
    // capture tx queue: [identity], [fixtures], [all-stats(empty)], [window-stats]
    const queue: unknown[][] = [[idRow], fixtureRows, [], windowStatRows];
    let i = 0;
    const tx = { query: async () => ({ rows: queue[i++] ?? [] }) } as unknown as PoolClient;

    const res = await readEditionTemporalPerformance(tx, '18', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.ok(res); assert.equal(res!.comparisonStatus, 'available');
    const xg = res!.comparisons.find((c) => c.metric === 'expectedGoals')!;
    // last-5 xG reconstructed from raw = (1.7)+(1.3)+(2.0) = 5.0 over fixtures 8,9,10 → coverage 3/5
    assert.equal(xg.last5.value, 5); assert.equal(xg.last5.observations, 3);
    // previous-5 fixtures (3..7) had NO window stat rows → value null, coverage 0/5 (NOT zero from flat cumulative)
    assert.equal(xg.previous5.value, null); assert.equal(xg.previous5.observations, 0);
    assert.equal(xg.change, null); assert.equal(xg.direction, 'UNAVAILABLE');
  });
});

// ── binding: 404, no N+1 ──────────────────────────────────────────────────────────
describe('readEditionTemporalPerformance — binding + 404 + no N+1', () => {
  const idRow = { edition_id: '18', season_label: 'S', competition_id: '28', competition_name: 'B', competition_slug: 'b', matches_scheduled: 250 };
  test('unknown edition → null (404), only identity query runs (via observation reader)', async () => {
    let i = 0; const queue: unknown[][] = [[]];
    const tx = { query: async () => ({ rows: queue[i++] ?? [] }) } as unknown as PoolClient;
    const res = await readEditionTemporalPerformance(tx, '999');
    assert.equal(res, null);
  });
  test('fewer than 10 observations → insufficient_sample, no stat query, no comparisons', async () => {
    const fixtureRows = Array.from({ length: 6 }, (_, k) => ({ fixture_id: String(k + 1), kickoff_at: `2026-02-0${k + 1}T00:00:00Z`, home_goals: 1, away_goals: 0 }));
    const calls: unknown[][] = []; let i = 0;
    const queue: unknown[][] = [[idRow], fixtureRows, []]; // identity, fixtures, all-stats — NO 4th (window) query expected
    const tx = { query: async (_sql: string, params: unknown[] = []) => { calls.push(params); return { rows: queue[i++] ?? [] }; } } as unknown as PoolClient;
    const res = await readEditionTemporalPerformance(tx, '18', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.ok(res);
    assert.equal(res!.comparisonStatus, 'insufficient_sample');
    assert.deepEqual(res!.comparisons, []);
    assert.equal(res!.results.last5, null);
    assert.equal(calls.length, 3); // identity + fixtures + all-stats only; NO window-stats query when insufficient
    assert.equal(res!.aggregation.version, EDITION_AGGREGATION_VERSION);
  });
  test('>=10 observations → exactly ONE additional bounded window-stats query (no N+1)', async () => {
    const fixtureRows = Array.from({ length: 12 }, (_, k) => ({ fixture_id: String(k + 1), kickoff_at: `2026-02-${String(k + 1).padStart(2, '0')}T00:00:00Z`, home_goals: 2, away_goals: 1 }));
    const calls: unknown[][] = []; let i = 0;
    const queue: unknown[][] = [[idRow], fixtureRows, [], []]; // identity, fixtures, all-stats, window-stats
    const tx = { query: async (_sql: string, params: unknown[] = []) => { calls.push(params); return { rows: queue[i++] ?? [] }; } } as unknown as PoolClient;
    const res = await readEditionTemporalPerformance(tx, '18', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.ok(res); assert.equal(res!.comparisonStatus, 'available');
    assert.equal(calls.length, 4); // identity + fixtures + all-stats + ONE window-stats
    // the 4th query is bounded to the 10 window fixture ids
    const windowIds = calls[3][0] as string[];
    assert.equal(windowIds.length, 10);
    assert.deepEqual(res!.provenance.last5FixtureIds, ['8', '9', '10', '11', '12']);
    assert.deepEqual(res!.provenance.previous5FixtureIds, ['3', '4', '5', '6', '7']);
    assert.equal(res!.provenance.last5FixtureIds.filter((f) => res!.provenance.previous5FixtureIds.includes(f)).length, 0);
  });
});
