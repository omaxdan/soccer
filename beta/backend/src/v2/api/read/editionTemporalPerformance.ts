// ─────────────────────────────────────────────────────────────────────────────
// EDITION TEMPORAL PERFORMANCE — read model (descriptive Last-5 vs Previous-5)
//
// "What changed in this edition over the most recent five completed fixtures vs the
// five immediately before them?" — descriptive historical evidence for ONE edition.
// NOT prediction, forecast, expected table, competition-quality/ranking, or causal.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO-TIER METHOD (governance-locked)
//
//   RESULT TIER — cumulative-state DIFFERENCING of the Edition Observation series.
//     Each Edition Observation point is cumulative, so a window = state(endPoint) −
//     state(boundaryPoint). matchesCompleted / wins(home) / draws / losses(away) /
//     goals / cleanSheets are cumulative full-edition counts → safe to difference.
//     Rates (goalsPerMatch, win/draw/loss %) are RE-DERIVED from window counts,
//     never differenced from cumulative percentages. W/D/L == matchesCompleted is
//     asserted (integrity error otherwise).
//
//   STAT TIER — bounded RAW RECONSTRUCTION of the ≤10 window fixtures. Edition
//     Observation exposes cumulative stat VALUES but NO per-point coverage counters,
//     so window stat coverage (fixturesWithMetric/5) is not derivable from the
//     series. Exactly ONE additional bounded team_match_statistic query (the ≤10
//     Last-5 + Previous-5 fixture ids), reusing Edition Observation's EXACT stat
//     machinery (EDITION_STAT_METRICS, collapse + both-side orientation/dedup,
//     fixtureStatMetric). Missing ≠ zero; coverage travels with each metric; a
//     comparison is emitted only when both windows carry a valid value. Edition
//     Observation itself is unchanged — this is read-model composition.
//
// Windows by completed-fixture count (Last5/Previous5, disjoint, ≥10 gate, strict
// asOf inherited from Edition Observation). Direction is RAW (UP/DOWN/UNCHANGED).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import {
  readEditionObservations,
  EDITION_STAT_METRICS, collapseEditionFixtureStats, fixtureStatMetric,
  EDITION_OBSERVATIONS_STATS_SQL,
  type EditionObservationPoint, type EditionObservationsResponse, type EditionObsStatRow,
} from './editionObservations';
import type { Direction, ChangeType } from './teamTemporalPerformance';

export const EDITION_AGGREGATION_VERSION = 'edition-temporal-1';
export const REQUIRED_FOR_COMPARISON = 10;
const WINDOW_SIZE = 5;

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export type EditionComparisonStatus = 'available' | 'insufficient_sample';

export class EditionTemporalPerformanceDataIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'EditionTemporalPerformanceDataIntegrityError'; }
}

export interface EditionWindowMeta {
  readonly status: 'complete' | 'insufficient';
  readonly observationCount: number;
  readonly windowSize: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly fixtureIds: readonly string[];
}

export interface EditionResultWindow {
  readonly matchesCompleted: number;
  readonly homeWins: number;
  readonly draws: number;
  readonly awayWins: number;
  readonly homeWinPct: number; // derived from window counts, 1 dp
  readonly drawPct: number;
  readonly awayWinPct: number;
  readonly goals: { readonly total: number; readonly home: number; readonly away: number; readonly perMatch: number };
  readonly cleanSheets: { readonly home: number; readonly away: number; readonly total: number };
}

export interface EditionResultChange {
  readonly matchesCompleted: number;
  readonly homeWins: number;
  readonly draws: number;
  readonly awayWins: number;
  readonly goalsTotal: number;
  readonly goalsHome: number;
  readonly goalsAway: number;
  readonly cleanSheetsTotal: number;
  readonly goalsPerMatch: number; // rate delta (last − previous), 2 dp
}

export interface EditionStatWindowValue {
  readonly value: number | null;
  readonly observations: number;
  readonly windowSize: number;
}

export interface EditionStatComparison {
  readonly metric: string;
  readonly class: 'SUM';
  readonly previous5: EditionStatWindowValue;
  readonly last5: EditionStatWindowValue;
  readonly change: number | null;
  readonly changeType: ChangeType;
  readonly percentageChange: number | null;
  readonly direction: Direction;
}

export interface EditionCurrentState {
  readonly sequenceIndex: number;
  readonly throughFixtureId: string;
  readonly throughKickoffAt: string;
  readonly matchesCompleted: number;
  readonly goals: { readonly total: number; readonly home: number; readonly away: number };
  readonly cleanSheets: { readonly home: number; readonly away: number; readonly total: number };
}

export interface EditionTemporalPerformanceResponse {
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: { readonly editionId: string; readonly label: string };
  readonly asOf: string;
  readonly aggregation: { readonly version: string };
  readonly comparisonStatus: EditionComparisonStatus;
  readonly sample: { readonly eligibleObservations: number; readonly requiredForComparison: number };
  readonly windows: { readonly last5: EditionWindowMeta; readonly previous5: EditionWindowMeta | null };
  readonly results: { readonly last5: EditionResultWindow | null; readonly previous5: EditionResultWindow | null; readonly change: EditionResultChange | null };
  readonly comparisons: readonly EditionStatComparison[];
  readonly current: EditionCurrentState | null;
  readonly provenance: {
    readonly source: 'editionObservations';
    readonly statSource: 'team_match_statistic (bounded window reconstruction)';
    readonly aggregationVersion: string;
    readonly asOf: string;
    readonly last5FixtureIds: readonly string[];
    readonly previous5FixtureIds: readonly string[];
    readonly boundaries: {
      readonly previousBoundarySequence: number | null; // cumulative point before Previous-5's first fixture (null = zero state)
      readonly previousEndSequence: number;             // == last5 boundary
      readonly lastEndSequence: number;
    };
  };
}

export interface EditionTemporalPerformanceOptions {
  readonly asOf?: Date;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Cumulative-state differencing: window = end − boundary. boundary null = zero state
 *  (window starts at the edition's first fixture). Rates derived from window counts. */
export function resultWindow(end: EditionObservationPoint, boundary: EditionObservationPoint | null): EditionResultWindow {
  const bMatches = boundary ? boundary.matchesCompleted : 0;
  const bHome = boundary ? boundary.results.homeWins : 0;
  const bDraw = boundary ? boundary.results.draws : 0;
  const bAway = boundary ? boundary.results.awayWins : 0;
  const bGT = boundary ? boundary.goals.total : 0;
  const bGH = boundary ? boundary.goals.home : 0;
  const bGA = boundary ? boundary.goals.away : 0;
  const bCSH = boundary ? boundary.cleanSheets.home : 0;
  const bCSA = boundary ? boundary.cleanSheets.away : 0;

  const matchesCompleted = end.matchesCompleted - bMatches;
  const homeWins = end.results.homeWins - bHome;
  const draws = end.results.draws - bDraw;
  const awayWins = end.results.awayWins - bAway;
  if (homeWins + draws + awayWins !== matchesCompleted) {
    throw new EditionTemporalPerformanceDataIntegrityError(
      `window W/D/L (${homeWins}/${draws}/${awayWins}) does not sum to matchesCompleted (${matchesCompleted})`,
    );
  }
  const goalsTotal = end.goals.total - bGT;
  const pct = (v: number): number => (matchesCompleted > 0 ? round1((v / matchesCompleted) * 100) : 0);
  return {
    matchesCompleted, homeWins, draws, awayWins,
    homeWinPct: pct(homeWins), drawPct: pct(draws), awayWinPct: pct(awayWins),
    goals: {
      total: goalsTotal, home: end.goals.home - bGH, away: end.goals.away - bGA,
      perMatch: matchesCompleted > 0 ? round2(goalsTotal / matchesCompleted) : 0,
    },
    cleanSheets: { home: end.cleanSheets.home - bCSH, away: end.cleanSheets.away - bCSA, total: (end.cleanSheets.home - bCSH) + (end.cleanSheets.away - bCSA) },
  };
}

function resultChange(prev: EditionResultWindow, last: EditionResultWindow): EditionResultChange {
  return {
    matchesCompleted: last.matchesCompleted - prev.matchesCompleted,
    homeWins: last.homeWins - prev.homeWins,
    draws: last.draws - prev.draws,
    awayWins: last.awayWins - prev.awayWins,
    goalsTotal: last.goals.total - prev.goals.total,
    goalsHome: last.goals.home - prev.goals.home,
    goalsAway: last.goals.away - prev.goals.away,
    cleanSheetsTotal: last.cleanSheets.total - prev.cleanSheets.total,
    goalsPerMatch: round2(last.goals.perMatch - prev.goals.perMatch),
  };
}

/** Aggregate one stat metric over a window's fixtures (bounded raw reconstruction),
 *  reusing Edition Observation's collapse + both-side aggregation. Missing ≠ zero. */
export function statWindow(
  fixtureIds: readonly string[],
  statsByFixture: ReadonlyMap<string, EditionObsStatRow[]>,
  metric: { key: string; sources: readonly string[] },
): EditionStatWindowValue {
  let sum = 0; let observations = 0;
  for (const fid of fixtureIds) {
    const rows = statsByFixture.get(fid);
    if (!rows || rows.length === 0) continue; // fixture carries no stats → not counted (never zero-filled)
    const collapsed = collapseEditionFixtureStats(rows);
    const fm = fixtureStatMetric(collapsed.byKey, metric);
    if (fm.has) { sum += fm.value; observations += 1; }
  }
  return { value: observations > 0 ? round2(sum) : null, observations, windowSize: WINDOW_SIZE };
}

function directionOf(change: number | null): Direction {
  if (change === null) return 'UNAVAILABLE';
  return change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'UNCHANGED';
}

export function compareStat(
  previousFixtureIds: readonly string[],
  lastFixtureIds: readonly string[],
  statsByFixture: ReadonlyMap<string, EditionObsStatRow[]>,
  metric: { key: string; sources: readonly string[] },
): EditionStatComparison {
  const prev = statWindow(previousFixtureIds, statsByFixture, metric);
  const last = statWindow(lastFixtureIds, statsByFixture, metric);
  let change: number | null = null;
  let percentageChange: number | null = null;
  if (prev.value !== null && last.value !== null) {
    change = round2(last.value - prev.value);
    percentageChange = prev.value !== 0 ? round1(((last.value - prev.value) / prev.value) * 100) : null;
  }
  return { metric: metric.key, class: 'SUM', previous5: prev, last5: last, change, changeType: 'absolute', percentageChange, direction: directionOf(change) };
}

function windowMeta(points: readonly EditionObservationPoint[], size: number): EditionWindowMeta {
  return {
    status: points.length === size ? 'complete' : 'insufficient',
    observationCount: points.length,
    windowSize: size,
    from: points.length > 0 ? points[0].throughKickoffAt : null,
    to: points.length > 0 ? points[points.length - 1].throughKickoffAt : null,
    fixtureIds: points.map((p) => p.throughFixtureId),
  };
}

function currentOf(point: EditionObservationPoint | null): EditionCurrentState | null {
  if (!point) return null;
  return {
    sequenceIndex: point.sequenceIndex,
    throughFixtureId: point.throughFixtureId,
    throughKickoffAt: point.throughKickoffAt,
    matchesCompleted: point.matchesCompleted,
    goals: { total: point.goals.total, home: point.goals.home, away: point.goals.away },
    cleanSheets: { home: point.cleanSheets.home, away: point.cleanSheets.away, total: point.cleanSheets.total },
  };
}

// ── DB read (composition: Edition Observation series + one bounded window-stats query) ──

/** Returns the edition's temporal performance, or null when the edition is unknown
 *  (→ 404, inherited from the Edition Observation reader). Result tier by cumulative
 *  differencing; stat tier by exactly one bounded team_match_statistic query over the
 *  ≤10 window fixtures. No N+1; Edition Observation contract untouched. */
export async function readEditionTemporalPerformance(
  tx: PoolClient,
  editionId: string,
  options: EditionTemporalPerformanceOptions = {},
): Promise<EditionTemporalPerformanceResponse | null> {
  const obs: EditionObservationsResponse | null = await readEditionObservations(tx, editionId, { asOf: options.asOf, order: 'asc' });
  if (obs === null) return null;

  const series = obs.series; // cumulative, chronological asc
  const n = series.length;
  const scopeLabel = `${obs.competition.name} ${obs.edition.seasonLabel}`;
  const comparisonAvailable = n >= REQUIRED_FOR_COMPARISON;

  const lastPoints = series.slice(Math.max(0, n - WINDOW_SIZE));
  const prevPoints = n >= WINDOW_SIZE ? series.slice(Math.max(0, n - 2 * WINDOW_SIZE), n - WINDOW_SIZE) : [];

  let results: EditionTemporalPerformanceResponse['results'] = { last5: null, previous5: null, change: null };
  let comparisons: EditionStatComparison[] = [];
  let previousBoundarySequence: number | null = null;
  let previousEndSequence = 0;
  let lastEndSequence = 0;

  if (comparisonAvailable) {
    const lastEnd = series[n - 1];
    const lastBoundary = series[n - 1 - WINDOW_SIZE];              // point before Last-5's first fixture
    const prevEnd = series[n - 1 - WINDOW_SIZE];                   // == last5 boundary
    const prevBoundaryIdx = n - 1 - 2 * WINDOW_SIZE;
    const prevBoundary = prevBoundaryIdx >= 0 ? series[prevBoundaryIdx] : null; // null = zero state (window at edition start)

    const lastResult = resultWindow(lastEnd, lastBoundary);
    const prevResult = resultWindow(prevEnd, prevBoundary);
    results = { last5: lastResult, previous5: prevResult, change: resultChange(prevResult, lastResult) };

    previousBoundarySequence = prevBoundary ? prevBoundary.sequenceIndex : null;
    previousEndSequence = prevEnd.sequenceIndex;
    lastEndSequence = lastEnd.sequenceIndex;

    // STAT TIER — one bounded query over the ≤10 window fixtures.
    const lastFixtureIds = lastPoints.map((p) => p.throughFixtureId);
    const prevFixtureIds = prevPoints.map((p) => p.throughFixtureId);
    const windowFixtureIds = [...prevFixtureIds, ...lastFixtureIds];
    const statsByFixture = new Map<string, EditionObsStatRow[]>();
    if (windowFixtureIds.length > 0) {
      const statsRes = await tx.query<EditionObsStatRow>(EDITION_OBSERVATIONS_STATS_SQL, [windowFixtureIds]);
      for (const row of statsRes.rows) {
        const bucket = statsByFixture.get(row.fixture_id) ?? [];
        bucket.push(row); statsByFixture.set(row.fixture_id, bucket);
      }
    }
    comparisons = EDITION_STAT_METRICS
      .map((m) => compareStat(prevFixtureIds, lastFixtureIds, statsByFixture, m))
      .filter((c) => c.last5.observations > 0 || c.previous5.observations > 0);
  }

  return {
    edition: obs.edition,
    competition: obs.competition,
    scope: { editionId: obs.edition.id, label: scopeLabel },
    asOf: obs.asOf,
    aggregation: { version: EDITION_AGGREGATION_VERSION },
    comparisonStatus: comparisonAvailable ? 'available' : 'insufficient_sample',
    sample: { eligibleObservations: n, requiredForComparison: REQUIRED_FOR_COMPARISON },
    windows: {
      last5: windowMeta(lastPoints, WINDOW_SIZE),
      previous5: n >= WINDOW_SIZE ? windowMeta(prevPoints, WINDOW_SIZE) : null,
    },
    results,
    comparisons,
    current: currentOf(obs.current),
    provenance: {
      source: 'editionObservations',
      statSource: 'team_match_statistic (bounded window reconstruction)',
      aggregationVersion: EDITION_AGGREGATION_VERSION,
      asOf: obs.asOf,
      last5FixtureIds: lastPoints.map((p) => p.throughFixtureId),
      previous5FixtureIds: prevPoints.map((p) => p.throughFixtureId),
      boundaries: { previousBoundarySequence, previousEndSequence, lastEndSequence },
    },
  };
}
