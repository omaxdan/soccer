// ─────────────────────────────────────────────────────────────────────────────
// PLAYER TEMPORAL PERFORMANCE — read model (descriptive Last-5 vs Previous-5 + Season)
//
// Transforms the chronological Player Observation series into simple, evidence-backed
// comparisons: "what changed in this player's OBSERVED match contribution over time?".
// A THIN derived layer over the frozen Player Observation contract — it consumes
// `readPlayerObservations` at the application layer (no duplicate raw querying, no
// backend→backend HTTP) and never mutates it.
//
// DESCRIPTIVE historical comparison only — NOT prediction, expected future output,
// selection recommendation, betting, player ranking, quality/form score, or causal
// explanation. Direction is RAW (UP/DOWN/UNCHANGED); never good/bad/better/worse.
//
// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED SEMANTICS (v1)
//   • WINDOWS by observation count only: LAST_5 = 5 most-recent eligible observations;
//     PREVIOUS_5 = the 5 immediately preceding. No overlap. Never days/rounds/matchday.
//   • SAMPLE GATE: full comparison needs 5 AND 5 (≥10 eligible) else 'insufficient_sample'.
//   • STRICT as_of + scope inherited from Player Observation (ALL-COMPETITIONS unless an
//     edition filter — labelled honestly, never silently a "league season").
//   • METRIC CLASSES (player-specific; Player Observation has NO percentage metrics, so
//     the Team percentage-point rule does NOT apply): every canonical metric is an
//     additive SUM (counts, durations like minutesPlayed, distances, xG) EXCEPT
//     `topSpeed`, a per-match PEAK → MEAN (average peak). SUM change = absolute (+ relative
//     % when previous ≠ 0); MEAN change = absolute (no relative %).
//   • PARTICIPATION: observed STARTED/BENCH/UNKNOWN counts per window (descriptive; never
//     infers ABSENT/NOT_SELECTED). NO player W/D/L block — the observation's result is the
//     TEAM's result, not a player metric (kept out per governance).
//   • MISSING ≠ ZERO: per window we expose observations/windowSize; change only when BOTH
//     windows carry a value.
//   • RECONSTRUCT-THEN-SELECT: windows chosen from the FULL eligible series.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readPlayerObservations, type PlayerObservation, type PlayerObservationsResponse, type PlayerParticipation, CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS } from './playerObservations';
import type { MetricClass, Direction, ChangeType } from './teamTemporalPerformance';

// The only non-additive canonical player metric: a per-match peak speed → MEAN.
export const MEAN_METRIC_KEYS: ReadonlySet<string> = new Set(['topSpeed']);
export function playerMetricClass(key: string): MetricClass {
  return MEAN_METRIC_KEYS.has(key) ? 'MEAN' : 'SUM';
}

export const PLAYER_AGGREGATION_VERSION = 'player-temporal-1';
export const REQUIRED_FOR_COMPARISON = 10;
const WINDOW_SIZE = 5;

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export type PlayerComparisonStatus = 'available' | 'insufficient_sample';

export interface PlayerWindowMeta {
  readonly status: 'complete' | 'insufficient';
  readonly observationCount: number;
  readonly windowSize: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly fixtureIds: readonly string[];
}

export interface PlayerParticipationCounts {
  readonly started: number;
  readonly bench: number;
  readonly unknown: number;
}

export interface PlayerMetricWindowValue {
  readonly value: number | null;
  readonly observations: number;
  readonly windowSize: number;
}

export interface PlayerMetricComparison {
  readonly metric: string;
  readonly class: MetricClass;
  readonly previous5: PlayerMetricWindowValue;
  readonly last5: PlayerMetricWindowValue;
  readonly change: number | null;
  readonly changeType: ChangeType;
  readonly percentageChange: number | null; // SUM metrics only, null when previous = 0 / unavailable
  readonly direction: Direction;
}

export interface PlayerSeasonMetric {
  readonly metric: string;
  readonly class: MetricClass;
  readonly value: number | null;
  readonly observations: number;
  readonly total: number;
}

export interface PlayerTemporalPerformanceResponse {
  readonly player: { readonly id: string; readonly fullName: string; readonly slug: string };
  readonly scope: {
    readonly competition: 'all' | 'edition';
    readonly editionId: string | null;
    readonly label: string;
  };
  readonly asOf: string;
  readonly aggregation: { readonly version: string };
  readonly comparisonStatus: PlayerComparisonStatus;
  readonly sample: { readonly eligibleObservations: number; readonly requiredForComparison: number };
  readonly windows: { readonly last5: PlayerWindowMeta; readonly previous5: PlayerWindowMeta | null };
  readonly participation: {
    readonly last5: PlayerParticipationCounts | null;
    readonly previous5: PlayerParticipationCounts | null;
    readonly change: PlayerParticipationCounts | null;
  };
  readonly comparisons: readonly PlayerMetricComparison[];
  readonly season: {
    readonly observationCount: number;
    readonly scopeLabel: string;
    readonly participation: PlayerParticipationCounts;
    readonly metrics: readonly PlayerSeasonMetric[];
  };
  readonly provenance: {
    readonly source: 'playerObservations';
    readonly aggregationVersion: string;
    readonly asOf: string;
    readonly last5FixtureIds: readonly string[];
    readonly previous5FixtureIds: readonly string[];
  };
}

export interface PlayerTemporalPerformanceOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }

function collectMetricValues(window: readonly PlayerObservation[], key: string): number[] {
  const out: number[] = [];
  for (const o of window) {
    const m = o.metrics.find((x) => x.key === key);
    if (m && m.value !== null) out.push(m.value);
  }
  return out;
}

export function aggregateMetric(window: readonly PlayerObservation[], key: string): PlayerMetricWindowValue {
  const values = collectMetricValues(window, key);
  const observations = values.length;
  if (observations === 0) return { value: null, observations: 0, windowSize: window.length };
  const sum = values.reduce((s, v) => s + v, 0);
  const value = playerMetricClass(key) === 'MEAN' ? round2(sum / observations) : round2(sum);
  return { value, observations, windowSize: window.length };
}

export function aggregateParticipation(window: readonly PlayerObservation[]): PlayerParticipationCounts {
  let started = 0, bench = 0, unknown = 0;
  for (const o of window) {
    const p: PlayerParticipation = o.participation;
    if (p === 'STARTED') started += 1; else if (p === 'BENCH') bench += 1; else unknown += 1;
  }
  return { started, bench, unknown };
}

function directionOf(change: number | null): Direction {
  if (change === null) return 'UNAVAILABLE';
  return change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'UNCHANGED';
}

export function compareMetric(previous5: readonly PlayerObservation[], last5: readonly PlayerObservation[], key: string): PlayerMetricComparison {
  const cls = playerMetricClass(key);
  const prev = aggregateMetric(previous5, key);
  const last = aggregateMetric(last5, key);
  let change: number | null = null;
  let percentageChange: number | null = null;
  // No player metric is a percentage; both SUM and the MEAN peak use an absolute change.
  const changeType: ChangeType = 'absolute';
  if (prev.value !== null && last.value !== null) {
    change = round2(last.value - prev.value);
    if (cls === 'SUM') percentageChange = prev.value !== 0 ? round1(((last.value - prev.value) / prev.value) * 100) : null;
  }
  return { metric: key, class: cls, previous5: prev, last5: last, change, changeType, percentageChange, direction: directionOf(change) };
}

function windowMeta(window: readonly PlayerObservation[], size: number): PlayerWindowMeta {
  return {
    status: window.length === size ? 'complete' : 'insufficient',
    observationCount: window.length,
    windowSize: size,
    from: window.length > 0 ? window[0].kickoffAt : null,
    to: window.length > 0 ? window[window.length - 1].kickoffAt : null,
    fixtureIds: window.map((o) => o.fixtureId),
  };
}

function participationChange(prev: PlayerParticipationCounts, last: PlayerParticipationCounts): PlayerParticipationCounts {
  return { started: last.started - prev.started, bench: last.bench - prev.bench, unknown: last.unknown - prev.unknown };
}

/** Assemble the player temporal-performance response from a Player Observation series. Pure. */
export function assemblePlayerTemporalPerformance(obs: PlayerObservationsResponse): PlayerTemporalPerformanceResponse {
  const series = [...obs.observations]; // chronological asc
  const n = series.length;

  const last5 = series.slice(Math.max(0, n - WINDOW_SIZE));
  const previous5 = n >= WINDOW_SIZE ? series.slice(Math.max(0, n - 2 * WINDOW_SIZE), n - WINDOW_SIZE) : [];
  const comparisonAvailable = last5.length === WINDOW_SIZE && previous5.length === WINDOW_SIZE;

  const scopeLabel = obs.scope.competition === 'edition' ? `edition ${obs.scope.editionId}` : 'all competitions';

  const lastPart = last5.length > 0 ? aggregateParticipation(last5) : null;
  const prevPart = previous5.length > 0 ? aggregateParticipation(previous5) : null;

  const comparisons: PlayerMetricComparison[] = comparisonAvailable
    ? CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS.map((k) => compareMetric(previous5, last5, k))
        .filter((c) => c.last5.observations > 0 || c.previous5.observations > 0)
    : [];

  const seasonMetrics: PlayerSeasonMetric[] = CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS.map((k) => {
    const agg = aggregateMetric(series, k);
    return { metric: k, class: playerMetricClass(k), value: agg.value, observations: agg.observations, total: n };
  }).filter((m) => m.observations > 0);

  return {
    player: obs.player,
    scope: { competition: obs.scope.competition, editionId: obs.scope.editionId, label: scopeLabel },
    asOf: obs.asOf,
    aggregation: { version: PLAYER_AGGREGATION_VERSION },
    comparisonStatus: comparisonAvailable ? 'available' : 'insufficient_sample',
    sample: { eligibleObservations: n, requiredForComparison: REQUIRED_FOR_COMPARISON },
    windows: {
      last5: windowMeta(last5, WINDOW_SIZE),
      previous5: n >= WINDOW_SIZE ? windowMeta(previous5, WINDOW_SIZE) : null,
    },
    participation: {
      last5: lastPart,
      previous5: comparisonAvailable ? prevPart : null,
      change: comparisonAvailable && lastPart && prevPart ? participationChange(prevPart, lastPart) : null,
    },
    comparisons,
    season: {
      observationCount: n,
      scopeLabel,
      participation: aggregateParticipation(series),
      metrics: seasonMetrics,
    },
    provenance: {
      source: 'playerObservations',
      aggregationVersion: PLAYER_AGGREGATION_VERSION,
      asOf: obs.asOf,
      last5FixtureIds: last5.map((o) => o.fixtureId),
      previous5FixtureIds: previous5.map((o) => o.fixtureId),
    },
  };
}

// ── DB read (reuses the Player Observation reader; no duplicate raw querying) ────

/** Returns the player's temporal performance, or null when the player is unknown/
 *  unexposed (→ 404, inherited from the Player Observation reader). Consumes the full
 *  chronological series (order asc, no pagination) and derives windows/comparisons in
 *  memory. */
export async function readPlayerTemporalPerformance(
  tx: PoolClient,
  playerId: string,
  options: PlayerTemporalPerformanceOptions = {},
): Promise<PlayerTemporalPerformanceResponse | null> {
  const obs = await readPlayerObservations(tx, playerId, {
    asOf: options.asOf,
    editionId: options.editionId ?? null,
    order: 'asc',
  });
  if (obs === null) return null;
  return assemblePlayerTemporalPerformance(obs);
}
