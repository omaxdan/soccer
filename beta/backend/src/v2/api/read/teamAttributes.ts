// ─────────────────────────────────────────────────────────────────────────────
// TEAM ATTRIBUTES — read model (result-tier v1, governed classification)
//
// The governed classification layer over the result-tier Benchmark. The ONLY chain:
//   OBSERVED FACT → PERFORMANCE SIGNAL → EDITION BENCHMARK → QUARTILE POSITION
//   → QUALITY ORIENTATION → TEAM ATTRIBUTE.
// Every attribute is explainable from that chain. No opaque score, no invented
// threshold, no prediction, no tactical fabrication, no future leakage, no scope mismatch.
//
// GOVERNANCE (locked):
//   • MODEL: quartile membership using the benchmark's OWN Q1/Q3 — no invented cutoff,
//     no VERY_STRONG…VERY_WEAK 5-level scheme.
//   • LEVEL: TOP_QUARTILE / MIDDLE / BOTTOM_QUARTILE, quality-adjusted (TOP = the good
//     side of the metric). Strengths = TOP_QUARTILE; weaknesses = BOTTOM_QUARTILE;
//     MIDDLE emits no strength/weakness. NEUTRAL metrics are tendencies, never S/W.
//   • QUALITY ORIENTATION is declared per signal (never inferred from "higher").
//   • FLOORS: benchmark participation ≥5 (upstream); attribute classification ≥8 — a
//     team below 8 completed fixtures gets NO classified attribute (insufficientSample),
//     never zero-filled.
//   • BOUNDARIES inclusive at Q1/Q3; exact ties share classification (a quartile may hold
//     >25% of teams — intentional, deterministic).
//   • SCOPE: edition, current-to-date (asOf). Context: "current edition, completed
//     matches to date" — never a permanent/multi-season/predictive claim.
//
// Consumes readTeamBenchmark only (edition-scoped signal vs edition population); never
// ALL-COMPETITIONS signals against the edition benchmark, never a second population.
// Result-tier only — no xG/stat-tier, no tactical/event attributes.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readTeamBenchmark, type BenchmarkDirection, type TeamBenchmarkResponse } from './teamBenchmark';
// Type-only import → elided at runtime, so no import cycle with statisticalAttributes
// (which imports the classification VALUES from this module). The stat-tier block is an
// ADDITIVE, optional field; result-tier assembly below never reads or produces it.
import type { StatisticalAttributesBlock } from './statisticalAttributes';

export const TEAM_ATTRIBUTES_VERSION = 'team-attributes-result-tier-v1';
export const ATTRIBUTE_CLASSIFICATION_FLOOR = 8;

export type QualityOrientation = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'NEUTRAL';
export type QuartileLevel = 'TOP_QUARTILE' | 'MIDDLE' | 'BOTTOM_QUARTILE';
export type AttributeType = 'strength' | 'weakness' | 'tendency';

/** Classified (strength/weakness) signals — a small, non-redundant result-tier set, each
 *  with an explicitly GOVERNED quality orientation (never inferred from the word "higher"). */
const CLASSIFIED_SPECS: ReadonlyArray<{ key: string; label: string; quality: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' }> = [
  { key: 'goals_per_match', label: 'Goals scored per match', quality: 'HIGHER_IS_BETTER' },
  { key: 'scored_in_match_rate', label: 'Scoring consistency', quality: 'HIGHER_IS_BETTER' },
  { key: 'goals_conceded_per_match', label: 'Goals conceded per match', quality: 'LOWER_IS_BETTER' },
  { key: 'clean_sheet_rate', label: 'Clean-sheet frequency', quality: 'HIGHER_IS_BETTER' },
  { key: 'win_rate', label: 'Win rate', quality: 'HIGHER_IS_BETTER' },
  { key: 'points_per_match', label: 'Points per match', quality: 'HIGHER_IS_BETTER' },
  { key: 'negative_goal_difference_fixture_rate', label: 'Losing-margin fixture frequency', quality: 'LOWER_IS_BETTER' },
];

/** Neutral tendencies — descriptive position only, never a strength/weakness. */
const TENDENCY_SPECS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'btts_rate', label: 'Both Teams Scored' },
  { key: 'total_goals_3plus_rate', label: '3+ Total Goals' },
  { key: 'one_nil_win_rate', label: '1-0 wins' },
];

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export interface AttributeEvidence {
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
  readonly teamFixtures: number;
}

export interface TeamAttribute {
  readonly key: string;
  readonly label: string;
  readonly type: AttributeType;
  readonly level: QuartileLevel;
  readonly direction: BenchmarkDirection;      // metric orientation (from benchmark)
  readonly qualityOrientation: QualityOrientation; // governed good/bad mapping
  readonly evidence: AttributeEvidence;
}

export interface TeamAttributesResponse {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: { readonly type: 'edition'; readonly editionId: string; readonly label: string };
  readonly asOf: string;
  readonly context: string; // "current edition, completed matches to date"
  readonly sample: { readonly completedFixtures: number; readonly classificationFloor: number };
  readonly insufficientSample: boolean; // true → no classification (below the floor)
  readonly strengths: readonly TeamAttribute[];
  readonly weaknesses: readonly TeamAttribute[];
  readonly tendencies: readonly TeamAttribute[];
  readonly benchmarkVersion: string;
  readonly provenance: {
    readonly source: 'teamBenchmark';
    readonly reconstructed: true;
    readonly immutable: false;
  };
  /** ADDITIVE stat-tier block (statisticalAttributes v1), attached by the handler.
   *  Optional so existing result-tier consumers and this module's own assembly are
   *  unaffected; null when the stat benchmark cannot be built for the team. */
  readonly statistical?: StatisticalAttributesBlock | null;
}

export interface TeamAttributesOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
}

const CONTEXT_NOTE = 'current edition, completed matches to date';

// ── pure classification ───────────────────────────────────────────────────────

/** Quality-adjusted quartile membership. Boundaries inclusive; TOP = the good side of
 *  the metric per its quality orientation. For NEUTRAL, TOP/BOTTOM denote raw high/low
 *  position (a tendency, not a quality). Pure. */
export function classifyQuartile(value: number, q1: number, q3: number, quality: QualityOrientation): QuartileLevel {
  if (quality === 'LOWER_IS_BETTER') {
    if (value <= q1) return 'TOP_QUARTILE';
    if (value >= q3) return 'BOTTOM_QUARTILE';
    return 'MIDDLE';
  }
  // HIGHER_IS_BETTER and NEUTRAL both read high value as TOP position.
  if (value >= q3) return 'TOP_QUARTILE';
  if (value <= q1) return 'BOTTOM_QUARTILE';
  return 'MIDDLE';
}

function evidenceOf(sig: TeamBenchmarkResponse['signals'][number], teams: number, teamFixtures: number): AttributeEvidence {
  return {
    signalKey: sig.signalKey,
    signalValue: sig.signalValue,
    benchmark: { rank: sig.rank, teams, percentile: sig.percentile, median: sig.median, q1: sig.quartiles.q1, q3: sig.quartiles.q3 },
    teamFixtures,
  };
}

/** Assemble strengths/weaknesses/tendencies from the benchmark. Pure. */
export function assembleTeamAttributes(
  bench: TeamBenchmarkResponse,
): { strengths: TeamAttribute[]; weaknesses: TeamAttribute[]; tendencies: TeamAttribute[] } {
  const byKey = new Map(bench.signals.map((s) => [s.signalKey, s]));
  const teams = bench.population.teams;
  const teamFixtures = bench.sample.teamFixtures;
  const strengths: TeamAttribute[] = [];
  const weaknesses: TeamAttribute[] = [];
  const tendencies: TeamAttribute[] = [];

  for (const spec of CLASSIFIED_SPECS) {
    const sig = byKey.get(spec.key);
    if (!sig) continue;
    const level = classifyQuartile(sig.signalValue, sig.quartiles.q1, sig.quartiles.q3, spec.quality);
    if (level === 'MIDDLE') continue; // no middle strength/weakness
    const attr: TeamAttribute = {
      key: spec.key, label: spec.label,
      type: level === 'TOP_QUARTILE' ? 'strength' : 'weakness',
      level, direction: sig.direction, qualityOrientation: spec.quality,
      evidence: evidenceOf(sig, teams, teamFixtures),
    };
    (level === 'TOP_QUARTILE' ? strengths : weaknesses).push(attr);
  }

  for (const spec of TENDENCY_SPECS) {
    const sig = byKey.get(spec.key);
    if (!sig) continue;
    const level = classifyQuartile(sig.signalValue, sig.quartiles.q1, sig.quartiles.q3, 'NEUTRAL');
    if (level === 'MIDDLE') continue; // only notable (high/low) tendencies surface
    tendencies.push({
      key: spec.key, label: spec.label, type: 'tendency', level,
      direction: sig.direction, qualityOrientation: 'NEUTRAL',
      evidence: evidenceOf(sig, teams, teamFixtures),
    });
  }

  return { strengths, weaknesses, tendencies };
}

// ── DB read ─────────────────────────────────────────────────────────────────────

/** Result-tier Team Attributes for one team, edition-scoped and current-to-date, or null
 *  when the benchmark cannot be built (team unknown / below benchmark floor). A team with
 *  fewer than the attribute-classification floor (8) completed fixtures returns an
 *  UNCLASSIFIED response (insufficientSample: true) — never zero-filled. Consumes
 *  readTeamBenchmark only (no second population, no N+1, no provider calls). */
export async function readTeamAttributes(
  tx: PoolClient,
  teamId: string,
  options: TeamAttributesOptions = {},
): Promise<TeamAttributesResponse | null> {
  const bench = await readTeamBenchmark(tx, teamId, { asOf: options.asOf, editionId: options.editionId ?? null });
  if (bench === null) return null;

  const completedFixtures = bench.sample.teamFixtures;
  const base = {
    team: bench.team,
    scope: { type: 'edition' as const, editionId: bench.editionId, label: `edition ${bench.editionId}` },
    asOf: bench.asOf,
    context: CONTEXT_NOTE,
    sample: { completedFixtures, classificationFloor: ATTRIBUTE_CLASSIFICATION_FLOOR },
    benchmarkVersion: bench.benchmarkVersion,
    provenance: { source: 'teamBenchmark' as const, reconstructed: true as const, immutable: false as const },
  };

  if (completedFixtures < ATTRIBUTE_CLASSIFICATION_FLOOR) {
    return { ...base, insufficientSample: true, strengths: [], weaknesses: [], tendencies: [] };
  }

  const { strengths, weaknesses, tendencies } = assembleTeamAttributes(bench);
  return { ...base, insufficientSample: false, strengths, weaknesses, tendencies };
}
