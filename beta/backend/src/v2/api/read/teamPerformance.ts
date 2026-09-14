// ─────────────────────────────────────────────────────────────────────────────
// TEAM PERFORMANCE — read model (feature read + pure mapping), evidence-honest
//
// Projects a team's DESCRIPTIVE persisted performance features from
// feature.feature_value (via the context-general readCurrentTeamFeatures). It
// CALCULATES NOTHING: every value, sample count and threshold flag was produced and
// persisted by the feature pipeline. Layers kept strictly distinct:
//
//   PERSISTED FEATURE EVIDENCE — home/away form, momentum, goal-margin volatility,
//     giant-killer PPG (ALL_COMPETITIONS); home/away win rate (COMPETITION_SCOPED).
//   READ-MODEL SHAPING         — selecting the current value per (feature, scope),
//     attaching static registry metadata (unit/direction), and a coverage flag.
//   GOVERNED INTELLIGENCE      — NONE. No verdict, prediction, probability, ranking,
//     readiness, or fabricated sample-quality score. This is descriptive evidence.
//
// Governance rules enforced by construction:
//   • No recalculation, no zero-fill: a missing feature is null.
//   • ALL_COMPETITIONS values populate `overall`; COMPETITION_SCOPED values populate
//     `byCompetition`, matched to the team's GOVERNED editions only — the two scopes
//     are never mixed.
//   • sample is the persisted (matches, meetsThreshold) verbatim — no graded quality.
//   • congestion_index / rest_advantage / travel_* / squad_stability / readiness_score
//     are DELIBERATELY EXCLUDED (condition/readiness/context/governed domains).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readCurrentTeamFeatures, type TeamFeatureValue } from '../../feature/read/currentValues';

// ── contract view types ─────────────────────────────────────────────────────────

export type MetricDirection = 'HIGHER_IS_STRONGER' | 'LOWER_IS_STRONGER' | 'UNSIGNED';

export interface PerformanceMetric {
  readonly value: number;
  readonly unit: string;                     // static registry unit (e.g. 'index')
  readonly direction: MetricDirection;       // static registry direction
  readonly sample: { readonly matches: number; readonly meetsThreshold: boolean };
  readonly asOf: string;                     // ISO-8601
}

export interface TeamPerformanceOverall {
  readonly homeForm: PerformanceMetric | null;
  readonly awayForm: PerformanceMetric | null;
  readonly momentum: PerformanceMetric | null;
  readonly goalMarginVolatility: PerformanceMetric | null;
  readonly giantKillerPpg: PerformanceMetric | null;
}

export interface EditionRef {
  readonly id: string;
  readonly seasonLabel: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
}

export interface CompetitionPerformance {
  readonly edition: EditionRef;
  readonly homeWinRate: PerformanceMetric | null;
  readonly awayWinRate: PerformanceMetric | null;
}

export type PerformanceCoverageState = 'present' | 'partial' | 'absent';
export interface TeamPerformanceCoverage {
  readonly overall: PerformanceCoverageState;
  /** Marks this as descriptive/derived team evidence — NOT a governed reading/verdict. */
  readonly performanceIsDescriptive: true;
}

export interface TeamPerformance {
  readonly overall: TeamPerformanceOverall;
  readonly byCompetition: readonly CompetitionPerformance[];
  readonly coverage: TeamPerformanceCoverage;
}

// ── static registry metadata (facts, not calculation) ────────────────────────────

/** Unit + direction per feature key, mirroring the feature registry. Static facts. */
const METRIC_META: Record<string, { unit: string; direction: MetricDirection }> = {
  'team.home_form': { unit: 'index', direction: 'HIGHER_IS_STRONGER' },
  'team.away_form': { unit: 'index', direction: 'HIGHER_IS_STRONGER' },
  'team.momentum': { unit: 'points', direction: 'HIGHER_IS_STRONGER' },
  'team.goal_margin_volatility': { unit: 'goals', direction: 'UNSIGNED' },
  'team.giant_killer_ppg': { unit: 'ppg', direction: 'HIGHER_IS_STRONGER' },
  'team.home_win_rate': { unit: 'index', direction: 'HIGHER_IS_STRONGER' },
  'team.away_win_rate': { unit: 'index', direction: 'HIGHER_IS_STRONGER' },
};

/** ALL_COMPETITIONS descriptive metrics surfaced under `overall`. */
export const OVERALL_FEATURE_KEYS = [
  'team.home_form', 'team.away_form', 'team.momentum',
  'team.goal_margin_volatility', 'team.giant_killer_ppg',
] as const;

/** COMPETITION_SCOPED metrics surfaced per edition under `byCompetition`. */
export const SCOPED_FEATURE_KEYS = ['team.home_win_rate', 'team.away_win_rate'] as const;

// ── pure mappers/assembly ────────────────────────────────────────────────────────

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Map one persisted feature value to a metric, attaching static unit/direction. Pure. */
export function toPerformanceMetric(v: TeamFeatureValue | undefined): PerformanceMetric | null {
  if (!v) return null;
  const meta = METRIC_META[v.featureKey];
  return {
    value: v.value,
    unit: meta ? meta.unit : 'index',
    direction: meta ? meta.direction : 'UNSIGNED',
    sample: { matches: v.sampleObservationCount, meetsThreshold: v.sampleMeetsThreshold },
    asOf: iso(v.asOf),
  };
}

/**
 * Assemble the performance projection from persisted feature values + the team's
 * governed editions. ALL_COMPETITIONS values populate `overall`; COMPETITION_SCOPED
 * values populate `byCompetition`, matched by edition to the governed list only.
 * Pure and deterministic; recalculates nothing.
 */
export function assembleTeamPerformance(
  values: readonly TeamFeatureValue[],
  editions: readonly EditionRef[],
): TeamPerformance {
  const overallVal = (key: string): TeamFeatureValue | undefined =>
    values.find((v) => v.featureKey === key && v.contextKindCode === 'ALL_COMPETITIONS');

  const overall: TeamPerformanceOverall = {
    homeForm: toPerformanceMetric(overallVal('team.home_form')),
    awayForm: toPerformanceMetric(overallVal('team.away_form')),
    momentum: toPerformanceMetric(overallVal('team.momentum')),
    goalMarginVolatility: toPerformanceMetric(overallVal('team.goal_margin_volatility')),
    giantKillerPpg: toPerformanceMetric(overallVal('team.giant_killer_ppg')),
  };

  const scopedVal = (key: string, editionId: string): TeamFeatureValue | undefined =>
    values.find((v) => v.featureKey === key
      && v.contextKindCode === 'COMPETITION_SCOPED'
      && v.contextCompetitionEditionId === editionId);

  const byCompetition: CompetitionPerformance[] = editions.map((edition) => ({
    edition,
    homeWinRate: toPerformanceMetric(scopedVal('team.home_win_rate', edition.id)),
    awayWinRate: toPerformanceMetric(scopedVal('team.away_win_rate', edition.id)),
  }));

  const overallMetrics = [overall.homeForm, overall.awayForm, overall.momentum, overall.goalMarginVolatility, overall.giantKillerPpg];
  const present = overallMetrics.filter((m) => m !== null).length;
  const overallCoverage: PerformanceCoverageState = present === 0 ? 'absent' : present === overallMetrics.length ? 'present' : 'partial';

  return { overall, byCompetition, coverage: { overall: overallCoverage, performanceIsDescriptive: true } };
}

// ── DB read (reuses the context-general feature reader) ──────────────────────────

export async function readTeamPerformance(tx: PoolClient, teamId: string, editions: readonly EditionRef[]): Promise<TeamPerformance> {
  const values = await readCurrentTeamFeatures(tx, {
    teamIds: [teamId],
    featureKeys: [...OVERALL_FEATURE_KEYS, ...SCOPED_FEATURE_KEYS],
  });
  return assembleTeamPerformance(values, editions);
}
