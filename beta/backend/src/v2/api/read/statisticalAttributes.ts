// ─────────────────────────────────────────────────────────────────────────────
// STATISTICAL ATTRIBUTES — read model (stat-tier v1, governed classification)
//
// The stat-tier sibling of teamAttributes. SAME governance, SAME classification
// machinery — only the signal SOURCE differs (statistical benchmark, not result):
//   TEAM OBSERVATION STAT → EDITION STAT BENCHMARK → QUARTILE POSITION
//   → GOVERNED QUALITY ORIENTATION → STATISTICAL ATTRIBUTE.
//
// GOVERNANCE (reused verbatim from teamAttributes — never a second system):
//   • classifyQuartile with the benchmark's OWN Q1/Q3, inclusive, ties share.
//   • TOP_QUARTILE = strength, BOTTOM_QUARTILE = weakness, MIDDLE emits nothing;
//     NEUTRAL metrics are tendencies, never S/W.
//   • QUALITY ORIENTATION is DECLARED per metric below — never inferred from the
//     provider's statistics_type and never from "higher".
//   • FLOOR: the classification floor (8). A metric is classified for a team only
//     when the team has ≥8 USABLE numeric observations of it; below that the metric
//     is omitted (missing ≠ zero, never zero-filled). The whole block is
//     insufficientSample when the team's completed-fixture count is below the floor.
//   • SCOPE: edition, current-to-date (asOf) — the benchmark enforces both.
//
// V1 CURATED SET (locked — do NOT auto-promote the other high-coverage metrics):
//   classified: expectedGoals, expectedGoalsOnTarget, bigChanceCreated,
//               bigChanceScored (HIGHER_IS_BETTER); bigChanceMissed, errorsLeadToShot
//               (LOWER_IS_BETTER).
//   tendencies (NEUTRAL): ballPossession, totalShotsOnGoal, shotsOnGoal.
//
// Descriptive team intelligence ONLY — never a sealed MI contribution, never a
// verdict input, no confidence/probability/prediction.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import {
  classifyQuartile, ATTRIBUTE_CLASSIFICATION_FLOOR,
  type QualityOrientation, type QuartileLevel, type AttributeType,
} from './teamAttributes';
import {
  readStatisticalBenchmark, type StatisticalBenchmarkResponse, type StatisticalBenchmarkOptions,
} from './statisticalBenchmark';
import type { BenchmarkDirection } from './teamBenchmark';

export const STATISTICAL_ATTRIBUTES_VERSION = 'team-attributes-stat-tier-v1';

/** Classified stat signals with GOVERNED quality orientation (declared, never inferred). */
const CLASSIFIED_SPECS: ReadonlyArray<{ key: string; label: string; quality: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' }> = [
  { key: 'expectedGoals', label: 'Expected goals (xG)', quality: 'HIGHER_IS_BETTER' },
  { key: 'expectedGoalsOnTarget', label: 'Expected goals on target', quality: 'HIGHER_IS_BETTER' },
  { key: 'bigChanceCreated', label: 'Big chances created', quality: 'HIGHER_IS_BETTER' },
  { key: 'bigChanceScored', label: 'Big chances scored', quality: 'HIGHER_IS_BETTER' },
  { key: 'bigChanceMissed', label: 'Big chances missed', quality: 'LOWER_IS_BETTER' },
  { key: 'errorsLeadToShot', label: 'Errors leading to a shot', quality: 'LOWER_IS_BETTER' },
];

/** Neutral tendencies — descriptive style/volume, never a strength/weakness. */
const TENDENCY_SPECS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'ballPossession', label: 'Ball possession' },
  { key: 'totalShotsOnGoal', label: 'Total shots' },
  { key: 'shotsOnGoal', label: 'Shots on target' },
];

export interface StatisticalAttributeEvidence {
  readonly signalKey: string;
  readonly signalValue: number;
  readonly benchmark: {
    readonly rank: number;
    readonly teams: number;
    readonly percentile: number;
    readonly median: number;
    readonly q1: number;
    readonly q3: number;
  };
  readonly usableSample: number; // usable numeric observations behind the team's value
}

export interface StatisticalAttribute {
  readonly key: string;
  readonly label: string;
  readonly type: AttributeType;
  readonly level: QuartileLevel;
  readonly direction: BenchmarkDirection;
  readonly qualityOrientation: QualityOrientation;
  readonly evidence: StatisticalAttributeEvidence;
}

export interface StatisticalAttributesBlock {
  readonly scope: { readonly type: 'edition'; readonly editionId: string; readonly label: string };
  readonly asOf: string;
  readonly context: string;
  readonly sample: { readonly completedFixtures: number; readonly classificationFloor: number };
  readonly insufficientSample: boolean;
  readonly strengths: readonly StatisticalAttribute[];
  readonly weaknesses: readonly StatisticalAttribute[];
  readonly tendencies: readonly StatisticalAttribute[];
  readonly benchmarkVersion: string;
  readonly provenance: { readonly source: 'teamObservations'; readonly reconstructed: true; readonly immutable: false };
}

const CONTEXT_NOTE = 'current edition, completed matches to date';

function evidenceOf(sig: StatisticalBenchmarkResponse['signals'][number], teams: number): StatisticalAttributeEvidence {
  return {
    signalKey: sig.signalKey,
    signalValue: sig.signalValue,
    benchmark: { rank: sig.rank, teams, percentile: sig.percentile, median: sig.median, q1: sig.quartiles.q1, q3: sig.quartiles.q3 },
    usableSample: sig.usableSample,
  };
}

/** Assemble strengths/weaknesses/tendencies from the statistical benchmark. A classified
 *  metric is included only when the team has ≥ the classification floor of USABLE
 *  observations of it (missing ≠ zero); MIDDLE emits nothing; NEUTRAL emits tendency only. Pure. */
export function assembleStatisticalAttributes(
  bench: StatisticalBenchmarkResponse,
): { strengths: StatisticalAttribute[]; weaknesses: StatisticalAttribute[]; tendencies: StatisticalAttribute[] } {
  const byKey = new Map(bench.signals.map((s) => [s.signalKey, s]));
  const teams = bench.population.teams;
  const strengths: StatisticalAttribute[] = [];
  const weaknesses: StatisticalAttribute[] = [];
  const tendencies: StatisticalAttribute[] = [];

  for (const spec of CLASSIFIED_SPECS) {
    const sig = byKey.get(spec.key);
    if (!sig) continue;
    if (sig.usableSample < ATTRIBUTE_CLASSIFICATION_FLOOR) continue; // per-metric floor; honest omission
    const level = classifyQuartile(sig.signalValue, sig.quartiles.q1, sig.quartiles.q3, spec.quality);
    if (level === 'MIDDLE') continue;
    const attr: StatisticalAttribute = {
      key: spec.key, label: spec.label,
      type: level === 'TOP_QUARTILE' ? 'strength' : 'weakness',
      level, direction: sig.direction, qualityOrientation: spec.quality,
      evidence: evidenceOf(sig, teams),
    };
    (level === 'TOP_QUARTILE' ? strengths : weaknesses).push(attr);
  }

  for (const spec of TENDENCY_SPECS) {
    const sig = byKey.get(spec.key);
    if (!sig) continue;
    if (sig.usableSample < ATTRIBUTE_CLASSIFICATION_FLOOR) continue;
    const level = classifyQuartile(sig.signalValue, sig.quartiles.q1, sig.quartiles.q3, 'NEUTRAL');
    if (level === 'MIDDLE') continue;
    tendencies.push({
      key: spec.key, label: spec.label, type: 'tendency', level,
      direction: sig.direction, qualityOrientation: 'NEUTRAL', evidence: evidenceOf(sig, teams),
    });
  }

  return { strengths, weaknesses, tendencies };
}

/** Stat-tier Team Attributes block for one team, edition-scoped and current-to-date, or null
 *  when the statistical benchmark cannot be built (team unknown / below participation floor).
 *  A team below the classification floor of completed fixtures returns an UNCLASSIFIED block
 *  (insufficientSample: true) — never zero-filled. Consumes the statistical benchmark only. */
export async function readStatisticalAttributes(
  tx: PoolClient,
  teamId: string,
  options: StatisticalBenchmarkOptions = {},
): Promise<StatisticalAttributesBlock | null> {
  const bench = await readStatisticalBenchmark(tx, teamId, { asOf: options.asOf, editionId: options.editionId ?? null });
  if (bench === null) return null;

  const completedFixtures = bench.sample.teamFixtures;
  const base = {
    scope: { type: 'edition' as const, editionId: bench.editionId, label: `edition ${bench.editionId}` },
    asOf: bench.asOf,
    context: CONTEXT_NOTE,
    sample: { completedFixtures, classificationFloor: ATTRIBUTE_CLASSIFICATION_FLOOR },
    benchmarkVersion: bench.benchmarkVersion,
    provenance: { source: 'teamObservations' as const, reconstructed: true as const, immutable: false as const },
  };

  if (completedFixtures < ATTRIBUTE_CLASSIFICATION_FLOOR) {
    return { ...base, insufficientSample: true, strengths: [], weaknesses: [], tendencies: [] };
  }

  const { strengths, weaknesses, tendencies } = assembleStatisticalAttributes(bench);
  return { ...base, insufficientSample: false, strengths, weaknesses, tendencies };
}
