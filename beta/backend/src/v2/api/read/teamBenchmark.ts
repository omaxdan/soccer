// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK & COMPARATIVE INTELLIGENCE — internal read model (result-tier v1)
//
// "Where does this team's RESULT-TIER signal sit within its competition edition?"
// Descriptive comparative CONTEXT only — a relative position (rank / percentile /
// distribution), NEVER a Strong/Weak/quality classification (that is the future
// Team Attributes governance layer) and NEVER a prediction.
//
// GOVERNANCE (locked, evidence-backed):
//   • SCOPE: one competition edition. Target signal and peer population share the
//     SAME edition (never ALL-COMPETITIONS signal vs edition population).
//   • TIME: current-to-date (asOf, strict `scheduled_kickoff_at < asOf`). asOf is
//     carried throughout so historical-asOf can be added later without redesign.
//   • PARTICIPATION FLOOR: a team enters the population only with ≥5 completed
//     fixtures. Below-floor teams are EXCLUDED (never zero-filled, never missing=0).
//   • METHOD: CUME_DIST percentile (fraction of population with value ≤ target) +
//     explicit competition rank (1 + #strictly-greater) + median/q1/q3 (type-7).
//   • RESULT-TIER ONLY: full-coverage /n signals. xG/shots/possession/stat-tier are
//     EXCLUDED (edition xG coverage ~15%, concentrated → non-representative).
//   • DIRECTION is metric orientation (HIGHER_IS_MORE / LOWER_IS_MORE / NEUTRAL),
//     NOT quality. No good/bad/strong/weak.
//
// Reuses the frozen Performance-Signals result-tier formulas verbatim (buildWindowSignals
// over each team's edition observations) — no formula duplication. ONE bounded set-based
// population query, then in-memory comparison; NO per-team query, NO N+1, NO backend HTTP.
// Internal read model — no public endpoint in v1 (future consumer: Team Attributes).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { buildWindowSignals } from './teamPerformanceSignals';
import type { TeamObservation, ObservationMetric } from './teamObservations';

export const TEAM_BENCHMARK_VERSION = 'result-edition-cumedist-v1';
export const BENCHMARK_PARTICIPATION_FLOOR = 5;

export type BenchmarkDirection = 'HIGHER_IS_MORE' | 'LOWER_IS_MORE' | 'NEUTRAL';

/** Result-tier signals admitted to the benchmark: unconditional `/n` (or per-match)
 *  metrics, so every eligible team carries a non-null value → one uniform population.
 *  Conditional-population signals (one-goal-win-rate = /wins, avg margins) and all
 *  stat-tier signals are deliberately excluded (see module header). */
export const BENCHMARK_SIGNAL_KEYS: ReadonlyArray<{ key: string; direction: BenchmarkDirection }> = [
  { key: 'goals_per_match', direction: 'HIGHER_IS_MORE' },
  { key: 'goals_conceded_per_match', direction: 'HIGHER_IS_MORE' },
  { key: 'scored_in_match_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'scored_2plus_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'failed_to_score_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'conceded_in_match_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'conceded_2plus_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'clean_sheet_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'total_goals_2plus_rate', direction: 'NEUTRAL' },
  { key: 'total_goals_3plus_rate', direction: 'NEUTRAL' },
  { key: 'average_total_goals', direction: 'NEUTRAL' },
  { key: 'btts_rate', direction: 'NEUTRAL' },
  { key: 'win_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'draw_rate', direction: 'NEUTRAL' },
  { key: 'loss_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'points_per_match', direction: 'HIGHER_IS_MORE' },
  { key: 'one_nil_win_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'positive_goal_difference_fixture_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'negative_goal_difference_fixture_rate', direction: 'HIGHER_IS_MORE' },
  { key: 'zero_goal_difference_fixture_rate', direction: 'NEUTRAL' },
];

// ── wire DTOs (internal) ─────────────────────────────────────────────────────────

export interface BenchmarkSignal {
  readonly signalKey: string;
  readonly signalValue: number;
  readonly direction: BenchmarkDirection;
  readonly rank: number;          // competition rank by descending value (1 = highest); ties share
  readonly percentile: number;    // CUME_DIST: fraction of population with value ≤ target
  readonly median: number;
  readonly quartiles: { readonly q1: number; readonly q3: number };
}

export interface TeamBenchmarkResponse {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: 'edition';
  readonly editionId: string;
  readonly asOf: string;
  readonly population: {
    readonly editionId: string;
    readonly teams: number;            // eligible teams (≥ floor) in the population
    readonly excludedTeams: number;    // teams present but below the participation floor
    readonly participationFloor: number;
  };
  readonly sample: { readonly teamFixtures: number }; // the target team's completed-fixture count
  readonly benchmarkVersion: string;
  readonly signals: readonly BenchmarkSignal[];
  readonly provenance: {
    readonly source: 'teamPerformanceSignals+fixtures';
    readonly reconstructed: true;
    readonly immutable: false; // fixture/result data is mutable in place
  };
}

export interface TeamBenchmarkOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

const round = (x: number, d = 4): number => Math.round(x * 10 ** d) / 10 ** d;

function numericOrZero(v: number | string | null): number {
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** CUME_DIST: fraction of the population (including the target and ties) with value ≤ v. */
export function cumeDist(values: readonly number[], v: number): number {
  if (values.length === 0) return 0;
  const le = values.reduce((n, x) => n + (x <= v ? 1 : 0), 0);
  return round(le / values.length);
}
/** Competition rank by DESCENDING value: 1 + count strictly greater (ties share a rank). */
export function descendingRank(values: readonly number[], v: number): number {
  return 1 + values.reduce((n, x) => n + (x > v ? 1 : 0), 0);
}
/** Type-7 (linear-interpolation) quantile over an ascending-sorted array. */
export function quantileSorted(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/** Minimal result-tier observation for reuse of the frozen Performance-Signals builders.
 *  Only result-tier fields are meaningful; xg/xga null and metrics empty so stat-tier
 *  families produce nulls (ignored). */
function resultObservation(fixtureId: string, gf: number, ga: number): TeamObservation {
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
  const metrics: readonly ObservationMetric[] = [];
  return {
    fixtureId, fixturePartitionOn: '', competition: { id: '', name: '', slug: '' },
    edition: { id: '', seasonLabel: '' }, kickoffAt: '', sequenceIndex: 0,
    opponent: { id: '', name: '', slug: '' }, venueSide: 'home',
    result, goalsFor: gf, goalsAgainst: ga, goalMargin: gf - ga,
    points: result === 'W' ? 3 : result === 'D' ? 1 : 0, cleanSheet: ga === 0,
    xg: null, xga: null, provenance: { provider: null, retrievedAt: null }, metrics,
  };
}

/** Flatten the result-tier families and index by key → value. Stat/streak families ignored. */
function resultSignalValues(observations: readonly TeamObservation[]): Map<string, number | null> {
  const w = buildWindowSignals(observations);
  const flat = [...w.scoring, ...w.conceding, ...w.totalGoals, ...w.btts, ...w.result, ...w.margin];
  const m = new Map<string, number | null>();
  for (const s of flat) m.set(s.key, s.value);
  return m;
}

/** Build the benchmark from the target's per-signal values and the eligible-team value
 *  arrays (one array per signal, non-null only). Pure. */
export function assembleTeamBenchmark(
  team: { id: string; name: string; slug: string },
  editionId: string,
  asOf: Date,
  targetFixtures: number,
  eligibleValuesByKey: ReadonlyMap<string, number[]>,
  targetValuesByKey: ReadonlyMap<string, number | null>,
  populationTeams: number,
  excludedTeams: number,
): TeamBenchmarkResponse {
  const signals: BenchmarkSignal[] = [];
  for (const { key, direction } of BENCHMARK_SIGNAL_KEYS) {
    const targetVal = targetValuesByKey.get(key);
    const values = eligibleValuesByKey.get(key) ?? [];
    if (targetVal === null || targetVal === undefined || values.length === 0) continue; // never fabricate
    const sortedAsc = [...values].sort((a, b) => a - b);
    signals.push({
      signalKey: key, signalValue: targetVal, direction,
      rank: descendingRank(values, targetVal),
      percentile: cumeDist(values, targetVal),
      median: round(quantileSorted(sortedAsc, 0.5)),
      quartiles: { q1: round(quantileSorted(sortedAsc, 0.25)), q3: round(quantileSorted(sortedAsc, 0.75)) },
    });
  }
  return {
    team, scope: 'edition', editionId, asOf: asOf.toISOString(),
    population: { editionId, teams: populationTeams, excludedTeams, participationFloor: BENCHMARK_PARTICIPATION_FLOOR },
    sample: { teamFixtures: targetFixtures },
    benchmarkVersion: TEAM_BENCHMARK_VERSION,
    signals,
    provenance: { source: 'teamPerformanceSignals+fixtures', reconstructed: true, immutable: false },
  };
}

// ── SQL (read-only) ─────────────────────────────────────────────────────────────

/** Resolve the target team's identity and benchmark edition (given, or the edition where
 *  the team has the most completed fixtures before asOf), plus its completed count.
 *  $1 team · $2 asOf (strict <) · $3 editionId|null. */
export const BENCHMARK_TARGET_SQL = `
  SELECT t.id::text AS id, t.name AS name, t.slug AS slug,
         ce.id::text AS edition_id, count(*) AS completed
    FROM football.team t
    JOIN football.fixture f
      ON (f.home_team_id = t.id OR f.away_team_id = t.id)
     AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
    JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
   WHERE t.id = $1::bigint
     AND ($3::bigint IS NULL OR ce.id = $3::bigint)
   GROUP BY t.id, t.name, t.slug, ce.id
   ORDER BY count(*) DESC, ce.id ASC
   LIMIT 1
`;

/** Every completed edition fixture before asOf, oriented per team (two rows per fixture).
 *  Result tier only — no team_match_statistic. $1 editionId · $2 asOf (strict <). */
export const BENCHMARK_POPULATION_SQL = `
  SELECT f.home_team_id::text AS team_id, r.home_goals AS gf, r.away_goals AS ga, f.id::text AS fixture_id
    FROM football.fixture f
    JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE f.competition_edition_id = $1::bigint AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
  UNION ALL
  SELECT f.away_team_id::text, r.away_goals, r.home_goals, f.id::text
    FROM football.fixture f
    JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE f.competition_edition_id = $1::bigint AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
`;

interface PopulationRow { team_id: string; gf: number | string | null; ga: number | string | null; fixture_id: string }

// ── DB read ─────────────────────────────────────────────────────────────────────

/** Result-tier, edition-scoped, current-to-date benchmark for one team, or null when the
 *  team has no completed fixtures (unknown/unexposed) or fewer than the participation floor
 *  in its benchmark edition. Two bounded queries (target resolve + population); all peer
 *  signals are computed in memory from ONE population query — no per-team query, no N+1. */
export async function readTeamBenchmark(
  tx: PoolClient,
  teamId: string,
  options: TeamBenchmarkOptions = {},
): Promise<TeamBenchmarkResponse | null> {
  const asOf = options.asOf ?? new Date();

  const tRes = await tx.query<{ id: string; name: string; slug: string; edition_id: string; completed: string }>(
    BENCHMARK_TARGET_SQL, [teamId, asOf, options.editionId ?? null],
  );
  if (tRes.rows.length === 0) return null;
  const t = tRes.rows[0];
  const editionId = t.edition_id;
  const targetFixtures = Number(t.completed);
  if (targetFixtures < BENCHMARK_PARTICIPATION_FLOOR) return null; // target itself below floor

  const pRes = await tx.query<PopulationRow>(BENCHMARK_POPULATION_SQL, [editionId, asOf]);

  // Group oriented rows by team.
  const byTeam = new Map<string, TeamObservation[]>();
  for (const row of pRes.rows) {
    const obs = resultObservation(row.fixture_id, numericOrZero(row.gf), numericOrZero(row.ga));
    const bucket = byTeam.get(row.team_id) ?? [];
    bucket.push(obs);
    byTeam.set(row.team_id, bucket);
  }

  const totalTeams = byTeam.size;
  const eligible = [...byTeam.entries()].filter(([, obs]) => obs.length >= BENCHMARK_PARTICIPATION_FLOOR);
  const excludedTeams = totalTeams - eligible.length;

  // Per-signal value arrays across eligible teams (non-null by construction of the set).
  const eligibleValuesByKey = new Map<string, number[]>();
  let targetValuesByKey = new Map<string, number | null>();
  for (const [tid, obs] of eligible) {
    const values = resultSignalValues(obs);
    if (tid === teamId) targetValuesByKey = values;
    for (const { key } of BENCHMARK_SIGNAL_KEYS) {
      const v = values.get(key);
      if (v === null || v === undefined) continue;
      const arr = eligibleValuesByKey.get(key) ?? [];
      arr.push(v);
      eligibleValuesByKey.set(key, arr);
    }
  }
  if (targetValuesByKey.size === 0) return null; // target not in eligible population (defensive)

  return assembleTeamBenchmark(
    { id: t.id, name: t.name, slug: t.slug }, editionId, asOf, targetFixtures,
    eligibleValuesByKey, targetValuesByKey, eligible.length, excludedTeams,
  );
}
