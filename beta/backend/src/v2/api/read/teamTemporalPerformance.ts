// ─────────────────────────────────────────────────────────────────────────────
// TEAM TEMPORAL PERFORMANCE — read model (descriptive Last-5 vs Previous-5 + Season)
//
// Transforms the chronological Team Observation series into simple, evidence-backed
// comparisons: "what changed in the team's OBSERVED performance over time?".
// It is a THIN derived layer over the frozen Team Observation contract — it consumes
// `readTeamObservations` at the application layer (no duplicate raw querying, no
// backend→backend HTTP) and never mutates it.
//
// It is DESCRIPTIVE historical comparison, NOT prediction, forecast, recommendation,
// causal inference, betting, or team-quality ranking. Direction is RAW (UP/DOWN/
// UNCHANGED) — never good/bad/better/worse (metric polarity is not governed here).
//
// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED SEMANTICS (v1)
//   • WINDOWS by observation count only: LAST_5 = 5 most-recent eligible observations;
//     PREVIOUS_5 = the 5 immediately preceding. No overlap. Never days/rounds/matchday.
//   • SAMPLE GATE: a full comparison requires 5 AND 5 (≥10 eligible). Fewer →
//     comparisonStatus 'insufficient_sample' (never a fabricated partial Previous 5).
//   • STRICT as_of + scope inherited from Team Observation (ALL-COMPETITIONS unless an
//     edition filter is supplied — labelled honestly, never silently a "league season").
//   • METRIC CLASSES: percentage metrics (ballPossession + *Percent/*Percentage) use the
//     MEAN across the window and a PERCENTAGE-POINT change; every other canonical metric
//     is a COUNT → SUM over the window with an absolute change (+ relative % when the
//     previous value is non-zero). xG (expectedGoals) is SUM (total over 5). xGA is the
//     SUM of opponent xG (expectedGoalsAgainst).
//   • MISSING ≠ ZERO: a metric absent from an observation contributes nothing; per
//     window we expose observations/windowSize (e.g. 4/5); change is emitted only when
//     BOTH windows carry a value.
//   • RECONSTRUCT-THEN-SELECT: windows are chosen from the FULL eligible series; nothing
//     paginates before window selection.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readTeamObservations, type TeamObservation, type TeamObservationsResponse, CANONICAL_OBSERVATION_METRIC_KEYS } from './teamObservations';

// Percentage-valued canonical metrics → MEAN + percentage-point change. Everything
// else in the canonical set is a count → SUM.
export const PERCENT_METRIC_KEYS: ReadonlySet<string> = new Set([
  'ballPossession', 'wonTacklePercent', 'duelWonPercent',
  'groundDuelsPercentage', 'aerialDuelsPercentage', 'dribblesPercentage',
]);

export type MetricClass = 'SUM' | 'MEAN';
export function metricClass(key: string): MetricClass {
  return PERCENT_METRIC_KEYS.has(key) ? 'MEAN' : 'SUM';
}

export const AGGREGATION_VERSION = 'temporal-1';
export const REQUIRED_FOR_COMPARISON = 10;
const WINDOW_SIZE = 5;

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export type ComparisonStatus = 'available' | 'insufficient_sample';
export type Direction = 'UP' | 'DOWN' | 'UNCHANGED' | 'UNAVAILABLE';
export type ChangeType = 'absolute' | 'percentage_point';

export interface WindowMeta {
  readonly status: 'complete' | 'insufficient';
  readonly observationCount: number;
  readonly windowSize: number;
  readonly from: string | null;   // ISO kickoff of the window's earliest observation
  readonly to: string | null;     // ISO kickoff of the window's latest observation
  readonly fixtureIds: readonly string[];
}

export interface ResultBlock {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly points: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
}

export interface ResultChange {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly points: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
}

export interface MetricWindowValue {
  readonly value: number | null;   // null = unavailable (no observation carried it)
  readonly observations: number;   // observations with a non-null value
  readonly windowSize: number;
}

export interface MetricComparison {
  readonly metric: string;
  readonly class: MetricClass;
  readonly previous5: MetricWindowValue;
  readonly last5: MetricWindowValue;
  readonly change: number | null;          // last5.value − previous5.value (both valid), else null
  readonly changeType: ChangeType;
  readonly percentageChange: number | null; // SUM metrics only, null when previous=0 or unavailable
  readonly direction: Direction;
}

export interface SeasonMetric {
  readonly metric: string;
  readonly class: MetricClass;
  readonly value: number | null;
  readonly observations: number;
  readonly total: number; // total season observations
}

export interface TeamTemporalPerformanceResponse {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: {
    readonly competition: 'all' | 'edition';
    readonly editionId: string | null;
    readonly label: string; // human/analyst-facing scope note ('all competitions' | 'edition <id>')
  };
  readonly asOf: string;
  readonly aggregation: { readonly version: string };
  readonly comparisonStatus: ComparisonStatus;
  readonly sample: { readonly eligibleObservations: number; readonly requiredForComparison: number };
  readonly windows: { readonly last5: WindowMeta; readonly previous5: WindowMeta | null };
  readonly results: { readonly last5: ResultBlock | null; readonly previous5: ResultBlock | null; readonly change: ResultChange | null };
  readonly comparisons: readonly MetricComparison[]; // only when comparisonStatus = 'available'
  readonly season: {
    readonly observationCount: number;
    readonly scopeLabel: string;
    readonly results: ResultBlock;
    readonly metrics: readonly SeasonMetric[];
  };
  readonly provenance: {
    readonly source: 'teamObservations';
    readonly aggregationVersion: string;
    readonly asOf: string;
    readonly last5FixtureIds: readonly string[];
    readonly previous5FixtureIds: readonly string[];
  };
}

export interface TeamTemporalPerformanceOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }

/** Extra derived metrics beyond the canonical metrics[] array: opponent xG total. */
const XGA_METRIC = 'expectedGoalsAgainst';
/** The metric keys compared, in a stable order: canonical set + derived xGA. */
export const TEMPORAL_METRIC_KEYS: readonly string[] = [...CANONICAL_OBSERVATION_METRIC_KEYS, XGA_METRIC];

/** Collect a metric's per-observation values across a window (nulls skipped). */
function collectMetricValues(window: readonly TeamObservation[], key: string): number[] {
  const out: number[] = [];
  for (const o of window) {
    if (key === XGA_METRIC) {
      if (o.xga !== null) out.push(o.xga);
      continue;
    }
    const m = o.metrics.find((x) => x.key === key);
    if (m && m.value !== null) out.push(m.value);
  }
  return out;
}

/** Aggregate one metric over a window per its class. */
export function aggregateMetric(window: readonly TeamObservation[], key: string): MetricWindowValue {
  const values = collectMetricValues(window, key);
  const observations = values.length;
  if (observations === 0) return { value: null, observations: 0, windowSize: window.length };
  const sum = values.reduce((s, v) => s + v, 0);
  const value = metricClass(key) === 'MEAN' ? round2(sum / observations) : round2(sum);
  return { value, observations, windowSize: window.length };
}

/** Result block (counts) over a window — always fully covered (every observation has a result). */
export function aggregateResults(window: readonly TeamObservation[]): ResultBlock {
  let wins = 0, draws = 0, losses = 0, points = 0, gf = 0, ga = 0;
  for (const o of window) {
    if (o.result === 'W') wins += 1; else if (o.result === 'D') draws += 1; else losses += 1;
    points += o.points; gf += o.goalsFor; ga += o.goalsAgainst;
  }
  return { wins, draws, losses, points, goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga };
}

function directionOf(change: number | null): Direction {
  if (change === null) return 'UNAVAILABLE';
  return change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'UNCHANGED';
}

/** Build one metric comparison from the two windows. Change only when both sides valid. */
export function compareMetric(previous5: readonly TeamObservation[], last5: readonly TeamObservation[], key: string): MetricComparison {
  const cls = metricClass(key);
  const prev = aggregateMetric(previous5, key);
  const last = aggregateMetric(last5, key);
  let change: number | null = null;
  let percentageChange: number | null = null;
  const changeType: ChangeType = cls === 'MEAN' ? 'percentage_point' : 'absolute';
  if (prev.value !== null && last.value !== null) {
    change = round2(last.value - prev.value);
    if (cls === 'SUM') percentageChange = prev.value !== 0 ? round1(((last.value - prev.value) / prev.value) * 100) : null;
  }
  return {
    metric: key, class: cls, previous5: prev, last5: last,
    change, changeType, percentageChange, direction: directionOf(change),
  };
}

function windowMeta(window: readonly TeamObservation[], size: number): WindowMeta {
  return {
    status: window.length === size ? 'complete' : 'insufficient',
    observationCount: window.length,
    windowSize: size,
    from: window.length > 0 ? window[0].kickoffAt : null,
    to: window.length > 0 ? window[window.length - 1].kickoffAt : null,
    fixtureIds: window.map((o) => o.fixtureId),
  };
}

function resultChange(prev: ResultBlock, last: ResultBlock): ResultChange {
  return {
    wins: last.wins - prev.wins, draws: last.draws - prev.draws, losses: last.losses - prev.losses,
    points: last.points - prev.points, goalsFor: last.goalsFor - prev.goalsFor,
    goalsAgainst: last.goalsAgainst - prev.goalsAgainst, goalDifference: last.goalDifference - prev.goalDifference,
  };
}

/** Assemble the temporal-performance response from a Team Observation series. Pure. */
export function assembleTeamTemporalPerformance(obs: TeamObservationsResponse): TeamTemporalPerformanceResponse {
  const series = [...obs.observations]; // already chronological asc
  const n = series.length;

  // Windows selected from the FULL series (reconstruct-then-select).
  const last5 = series.slice(Math.max(0, n - WINDOW_SIZE));
  const previous5 = n >= WINDOW_SIZE ? series.slice(Math.max(0, n - 2 * WINDOW_SIZE), n - WINDOW_SIZE) : [];
  const comparisonAvailable = last5.length === WINDOW_SIZE && previous5.length === WINDOW_SIZE;

  const scopeLabel = obs.scope.competition === 'edition' ? `edition ${obs.scope.editionId}` : 'all competitions';

  const lastResults = last5.length > 0 ? aggregateResults(last5) : null;
  const prevResults = previous5.length > 0 ? aggregateResults(previous5) : null;

  const comparisons: MetricComparison[] = comparisonAvailable
    ? TEMPORAL_METRIC_KEYS.map((k) => compareMetric(previous5, last5, k))
        // Emit only metrics observed in at least one window (honest; avoids 48 all-null rows).
        .filter((c) => c.last5.observations > 0 || c.previous5.observations > 0)
    : [];

  const seasonResults = aggregateResults(series);
  const seasonMetrics: SeasonMetric[] = TEMPORAL_METRIC_KEYS.map((k) => {
    const agg = aggregateMetric(series, k);
    return { metric: k, class: metricClass(k), value: agg.value, observations: agg.observations, total: n };
  }).filter((m) => m.observations > 0);

  return {
    team: obs.team,
    scope: { competition: obs.scope.competition, editionId: obs.scope.editionId, label: scopeLabel },
    asOf: obs.asOf,
    aggregation: { version: AGGREGATION_VERSION },
    comparisonStatus: comparisonAvailable ? 'available' : 'insufficient_sample',
    sample: { eligibleObservations: n, requiredForComparison: REQUIRED_FOR_COMPARISON },
    windows: {
      last5: windowMeta(last5, WINDOW_SIZE),
      previous5: n >= WINDOW_SIZE ? windowMeta(previous5, WINDOW_SIZE) : null,
    },
    results: {
      last5: lastResults,
      previous5: comparisonAvailable ? prevResults : null,
      change: comparisonAvailable && lastResults && prevResults ? resultChange(prevResults, lastResults) : null,
    },
    comparisons,
    season: { observationCount: n, scopeLabel, results: seasonResults, metrics: seasonMetrics },
    provenance: {
      source: 'teamObservations',
      aggregationVersion: AGGREGATION_VERSION,
      asOf: obs.asOf,
      last5FixtureIds: last5.map((o) => o.fixtureId),
      previous5FixtureIds: previous5.map((o) => o.fixtureId),
    },
  };
}

// ── DB read (reuses the Team Observation reader; no duplicate raw querying) ──────

/** Returns the team's temporal performance, or null when the team does not exist
 *  (→ 404, inherited from the Team Observation reader). Consumes the full chronological
 *  observation series (order asc, no pagination) and derives windows/comparisons/season
 *  in memory. */
export async function readTeamTemporalPerformance(
  tx: PoolClient,
  teamId: string,
  options: TeamTemporalPerformanceOptions = {},
): Promise<TeamTemporalPerformanceResponse | null> {
  const obs = await readTeamObservations(tx, teamId, {
    asOf: options.asOf,
    editionId: options.editionId ?? null,
    order: 'asc',
  });
  if (obs === null) return null;
  return assembleTeamTemporalPerformance(obs);
}
