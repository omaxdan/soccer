// ─────────────────────────────────────────────────────────────────────────────
// STATISTICAL BENCHMARK — internal read model (stat-tier v1)
//
// The stat-tier sibling of teamBenchmark: "where does this team's per-match
// STATISTICAL signal sit within its competition edition?" Descriptive comparative
// position only (rank / percentile / distribution) — never a quality classification
// (that is statisticalAttributes) and never a prediction.
//
// CANONICAL CHAIN (locked):
//   football.team_match_statistic → Team Observation → statistical benchmark
// The population comes from readEditionTeamMetricValues (Team Observation layer),
// so this module NEVER reads team_match_statistic directly and NEVER re-canonicalizes
// (orientation, group dedup, missing≠zero all happen once, in Team Observation).
//
// GOVERNANCE (reused verbatim from teamBenchmark, single-sourced):
//   • SCOPE: one competition edition; target signal and peer population share it.
//   • TIME: current-to-date (asOf, strict `scheduled_kickoff_at < asOf`), COMPLETED only.
//   • PARTICIPATION FLOOR: a team enters the population with ≥5 completed fixtures.
//   • METHOD: CUME_DIST percentile + descending rank + type-7 median/q1/q3 — the SAME
//     primitives teamBenchmark exports (cumeDist / descendingRank / quantileSorted).
//   • MISSING ≠ ZERO: a team's per-metric value is the MEAN of its USABLE numeric
//     observations; a team with no usable value for a metric is absent from that
//     metric's population (never zero-filled).
//   • DIRECTION is metric orientation, NOT quality (that mapping is governed downstream).
//
// Each team → one value per metric = mean of its usable observations. The peer
// population is the set of those per-team means (eligible teams only). One bounded
// population read + in-memory comparison; no per-team query, no N+1, no provider call.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import {
  BENCHMARK_TARGET_SQL, BENCHMARK_PARTICIPATION_FLOOR,
  cumeDist, descendingRank, quantileSorted, type BenchmarkDirection,
} from './teamBenchmark';
import { readEditionTeamMetricValues } from './teamObservations';

export const STATISTICAL_BENCHMARK_VERSION = 'stat-edition-cumedist-v1';

/** The curated V1 stat-tier signals (governance-locked set). DIRECTION here is metric
 *  orientation only (more/less/neutral), NOT quality — the good/bad mapping is declared
 *  in statisticalAttributes and never inferred from the provider or from "higher". */
export const STATISTICAL_BENCHMARK_SIGNAL_KEYS: ReadonlyArray<{ key: string; direction: BenchmarkDirection }> = [
  { key: 'expectedGoals', direction: 'HIGHER_IS_MORE' },
  { key: 'expectedGoalsOnTarget', direction: 'HIGHER_IS_MORE' },
  { key: 'bigChanceCreated', direction: 'HIGHER_IS_MORE' },
  { key: 'bigChanceScored', direction: 'HIGHER_IS_MORE' },
  { key: 'bigChanceMissed', direction: 'HIGHER_IS_MORE' },
  { key: 'errorsLeadToShot', direction: 'HIGHER_IS_MORE' },
  { key: 'ballPossession', direction: 'HIGHER_IS_MORE' },
  { key: 'totalShotsOnGoal', direction: 'HIGHER_IS_MORE' },
  { key: 'shotsOnGoal', direction: 'HIGHER_IS_MORE' },
];

export const STATISTICAL_BENCHMARK_KEYS: readonly string[] = STATISTICAL_BENCHMARK_SIGNAL_KEYS.map((s) => s.key);

const round = (x: number, d = 4): number => Math.round(x * 10 ** d) / 10 ** d;
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface StatisticalBenchmarkSignal {
  readonly signalKey: string;
  readonly signalValue: number;      // the target team's mean over its usable observations
  readonly usableSample: number;     // count of the target's usable observations for this metric
  readonly direction: BenchmarkDirection;
  readonly rank: number;             // 1 = highest mean; ties share
  readonly percentile: number;       // CUME_DIST over per-team means
  readonly median: number;
  readonly quartiles: { readonly q1: number; readonly q3: number };
  readonly populationTeams: number;  // eligible teams contributing a mean for this metric
}

export interface StatisticalBenchmarkResponse {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: 'edition';
  readonly editionId: string;
  readonly asOf: string;
  readonly population: {
    readonly editionId: string;
    readonly teams: number;          // eligible teams (≥ participation floor) in the edition
    readonly excludedTeams: number;  // teams present but below the participation floor
    readonly participationFloor: number;
  };
  readonly sample: { readonly teamFixtures: number }; // the target's completed-fixture count
  readonly benchmarkVersion: string;
  readonly signals: readonly StatisticalBenchmarkSignal[];
  readonly provenance: {
    readonly source: 'teamObservations';
    readonly reconstructed: true;
    readonly immutable: false;       // observation data is mutable in place
  };
}

export interface StatisticalBenchmarkOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
}

/** Pure assembly: from the edition population (per-team usable values) and the resolved
 *  target, compute one comparative signal per curated metric. A metric with no usable
 *  target value, or an empty peer population, is omitted (never fabricated). */
export function assembleStatisticalBenchmark(
  team: { id: string; name: string; slug: string },
  editionId: string,
  asOf: Date,
  targetFixtures: number,
  byTeam: ReadonlyMap<string, ReadonlyMap<string, number[]>>,
  fixtureCountByTeam: ReadonlyMap<string, number>,
  teamId: string,
): StatisticalBenchmarkResponse {
  // Eligible teams: ≥ participation floor completed fixtures in this edition.
  const eligibleTeamIds = [...fixtureCountByTeam.entries()]
    .filter(([, n]) => n >= BENCHMARK_PARTICIPATION_FLOOR)
    .map(([id]) => id);
  const eligibleSet = new Set(eligibleTeamIds);
  const excludedTeams = fixtureCountByTeam.size - eligibleTeamIds.length;

  const signals: StatisticalBenchmarkSignal[] = [];
  for (const { key, direction } of STATISTICAL_BENCHMARK_SIGNAL_KEYS) {
    const targetValues = byTeam.get(teamId)?.get(key) ?? [];
    if (targetValues.length === 0) continue; // no usable target observation → never fabricate
    const targetMean = round(mean(targetValues));

    // Peer population: each eligible team's mean over its usable observations for this metric.
    const populationMeans: number[] = [];
    for (const tid of eligibleTeamIds) {
      const vals = byTeam.get(tid)?.get(key) ?? [];
      if (vals.length === 0) continue; // team has no usable value for this metric → absent, not zero
      populationMeans.push(mean(vals));
    }
    if (populationMeans.length === 0) continue;

    const sortedAsc = [...populationMeans].sort((a, b) => a - b);
    signals.push({
      signalKey: key,
      signalValue: targetMean,
      usableSample: targetValues.length,
      direction,
      rank: descendingRank(populationMeans, targetMean),
      percentile: cumeDist(populationMeans, targetMean),
      median: round(quantileSorted(sortedAsc, 0.5)),
      quartiles: { q1: round(quantileSorted(sortedAsc, 0.25)), q3: round(quantileSorted(sortedAsc, 0.75)) },
      populationTeams: populationMeans.length,
    });
  }

  return {
    team, scope: 'edition', editionId, asOf: asOf.toISOString(),
    population: { editionId, teams: eligibleSet.size, excludedTeams, participationFloor: BENCHMARK_PARTICIPATION_FLOOR },
    sample: { teamFixtures: targetFixtures },
    benchmarkVersion: STATISTICAL_BENCHMARK_VERSION,
    signals,
    provenance: { source: 'teamObservations', reconstructed: true, immutable: false },
  };
}

/** Stat-tier, edition-scoped, current-to-date benchmark for one team, or null when the team
 *  has no completed fixtures (unknown/unexposed) or fewer than the participation floor in its
 *  benchmark edition. Resolves the benchmark edition with the SAME target query teamBenchmark
 *  uses, then consumes the Team Observation edition population (canonicalization single-sourced). */
export async function readStatisticalBenchmark(
  tx: PoolClient,
  teamId: string,
  options: StatisticalBenchmarkOptions = {},
): Promise<StatisticalBenchmarkResponse | null> {
  const asOf = options.asOf ?? new Date();

  const tRes = await tx.query<{ id: string; name: string; slug: string; edition_id: string; completed: string }>(
    BENCHMARK_TARGET_SQL, [teamId, asOf, options.editionId ?? null],
  );
  if (tRes.rows.length === 0) return null;
  const t = tRes.rows[0];
  const editionId = t.edition_id;
  const targetFixtures = Number(t.completed);
  if (targetFixtures < BENCHMARK_PARTICIPATION_FLOOR) return null; // target itself below floor

  const pop = await readEditionTeamMetricValues(tx, editionId, STATISTICAL_BENCHMARK_KEYS, { asOf });
  if (!pop.byTeam.has(teamId)) return null; // defensive: target absent from its own edition population

  return assembleStatisticalBenchmark(
    { id: t.id, name: t.name, slug: t.slug }, editionId, asOf, targetFixtures,
    pop.byTeam, pop.fixtureCountByTeam, teamId,
  );
}
