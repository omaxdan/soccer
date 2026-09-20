// ─────────────────────────────────────────────────────────────────────────────
// TEAM PERFORMANCE SIGNALS — read model (transparent, formula-based, coverage-aware)
//
// "What transparent relationships does the observed evidence reveal?" for ONE team.
// Every signal is a named FORMULA over the frozen Team Observation series — never an
// opaque score, never prediction, never a causal/quality label.
//
// HARD SUBSTRATE RULE: signals are reconstructed ONLY through readTeamObservations
// (which collapses team_match_statistic group_name duplicates at period='ALL' and
// asserts cross-group agreement). This model NEVER queries team_match_statistic
// directly — doing so silently double-counts (proven live: a raw join fanned a 5-fixture
// window to 10). One Observation read → deterministic in-memory transformation.
//
// WINDOWS: Last5 / Previous5 / Season (all eligible), plus Season Home / Season Away
// (each over the team's ACTUAL home/away completed fixtures — never a relabelled overall
// window). Scope ALL-COMPETITIONS by default (optional editionId), strict asOf < inherited
// from Team Observation. MISSING ≠ ZERO; combined metrics use a COMMON COHORT with
// coverage exposed; undefined ratios (zero denominator) → null, never 0.
//
// Duplication boundary: Team Temporal owns raw window W/D/L/points/goals/GA/GD totals.
// This layer adds rates, distribution buckets, BTTS, margin/grind profile, streaks, and
// common-cohort-aligned xG gaps (which Temporal cannot compute). goal_margin_volatility
// remains a separate governed feature and is neither reused nor reimplemented here.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readTeamObservations, type TeamObservation } from './teamObservations';

export const TEAM_PERFORMANCE_SIGNALS_VERSION = 'team-performance-signals-1';

// Canonical metric keys consumed (semantics proven via statistic_name):
//   totalShotsOnGoal = "Total shots" · shotsOnGoal = "Shots on target"
const K_SHOTS = 'totalShotsOnGoal';
const K_SOT = 'shotsOnGoal';
const K_POSSESSION = 'ballPossession';
const K_FINAL_THIRD = 'finalThirdEntries';

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export interface SignalCoverage {
  readonly commonFixtures: number;
  readonly windowSize: number;
  readonly rate: number; // commonFixtures / windowSize (0 when windowSize 0)
}

export interface SignalEvidence {
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly fixtureIds: readonly string[] | null;
}

export interface PerformanceSignal {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;         // null = undefined (zero denominator / empty cohort); never fabricated
  readonly displayValue: string | null;
  readonly formula: string;
  readonly coverage: SignalCoverage | null; // present for partial (xG/stat) signals; null for full-coverage result tier
  readonly evidence: SignalEvidence;
}

export interface StreakSignal {
  readonly key: string;
  readonly label: string;
  readonly length: number;
  readonly fixtureIds: readonly string[];
}

export interface WindowSignals {
  readonly windowSize: number;
  readonly fixtureIds: readonly string[];
  readonly scoring: readonly PerformanceSignal[];
  readonly conceding: readonly PerformanceSignal[];
  readonly totalGoals: readonly PerformanceSignal[];
  readonly btts: readonly PerformanceSignal[];
  readonly result: readonly PerformanceSignal[];
  readonly margin: readonly PerformanceSignal[];
  readonly attack: readonly PerformanceSignal[];
  readonly defensiveXg: readonly PerformanceSignal[];
  readonly creation: readonly PerformanceSignal[];
  readonly streaks: readonly StreakSignal[];
}

export interface TrajectorySignal {
  readonly key: string;
  readonly label: string;
  readonly last5: PerformanceSignal;
  readonly previous5: PerformanceSignal;
  readonly change: number | null; // last5.value − previous5.value, null when either side null
}

export interface PerformanceSignalsResponse {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: { readonly competition: 'all' | 'edition'; readonly editionId: string | null; readonly label: string };
  readonly asOf: string;
  readonly windows: {
    readonly last5: WindowSignals;
    readonly previous5: WindowSignals;
    readonly season: WindowSignals;
    readonly seasonHome: WindowSignals;
    readonly seasonAway: WindowSignals;
  };
  readonly trajectory: readonly TrajectorySignal[];
  readonly provenance: {
    readonly source: 'teamObservations';
    readonly readModel: string;
    readonly asOf: string;
    readonly scope: 'all' | 'edition';
    readonly editionId: string | null;
  };
}

export interface TeamPerformanceSignalsOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
}

// ── numeric helpers ─────────────────────────────────────────────────────────────

const round = (x: number, d = 4): number => Math.round(x * 10 ** d) / 10 ** d;
const pct = (v: number): string => `${round(v * 100, 1)}%`;
const fixed = (v: number): string => v.toFixed(2);
const idsOf = (w: readonly TeamObservation[]): string[] => w.map((o) => o.fixtureId);
const metricVal = (o: TeamObservation, key: string): number | null => {
  const m = o.metrics.find((x) => x.key === key);
  return m ? m.value : null;
};

/** A full-coverage result-tier rate: numerator/denominator over the whole window. */
function rateSig(key: string, label: string, formula: string, num: number, n: number): PerformanceSignal {
  const value = n > 0 ? round(num / n) : null;
  return { key, label, value, displayValue: value === null ? null : pct(value), formula,
    coverage: null, evidence: { numerator: num, denominator: n, fixtureIds: null } };
}

/** A full-coverage per-match mean (value/n). */
function perMatchSig(key: string, label: string, formula: string, sum: number, n: number, display: (v: number) => string = fixed): PerformanceSignal {
  const value = n > 0 ? round(sum / n) : null;
  return { key, label, value, displayValue: value === null ? null : display(value), formula,
    coverage: null, evidence: { numerator: round(sum), denominator: n, fixtureIds: null } };
}

/** A full-coverage raw count/total. */
function countSig(key: string, label: string, formula: string, count: number): PerformanceSignal {
  return { key, label, value: count, displayValue: String(count), formula,
    coverage: null, evidence: { numerator: count, denominator: null, fixtureIds: null } };
}

/** A conditional rate over a sub-population (e.g. wins-only). Null when denominator 0. */
function condRateSig(key: string, label: string, formula: string, num: number, den: number): PerformanceSignal {
  const value = den > 0 ? round(num / den) : null;
  return { key, label, value, displayValue: value === null ? null : pct(value), formula,
    coverage: null, evidence: { numerator: num, denominator: den, fixtureIds: null } };
}

/** A partial (xG/stat) signal over a common cohort, with explicit coverage. `value` is
 *  computed by `fn` from the cohort totals, or null when the cohort/denominator is empty. */
function statSig(
  key: string, label: string, formula: string,
  window: readonly TeamObservation[], present: (o: TeamObservation) => boolean,
  value: number | null, num: number | null, den: number | null,
  display: (v: number) => string = fixed,
): PerformanceSignal {
  const cohort = window.filter(present);
  const windowSize = window.length;
  return {
    key, label, value: value === null ? null : round(value),
    displayValue: value === null ? null : display(round(value)), formula,
    coverage: { commonFixtures: cohort.length, windowSize, rate: windowSize > 0 ? round(cohort.length / windowSize) : 0 },
    evidence: { numerator: num === null ? null : round(num), denominator: den === null ? null : round(den), fixtureIds: idsOf(cohort) },
  };
}

// ── streak helpers ──────────────────────────────────────────────────────────────

type Pred = (o: TeamObservation) => boolean;

/** Run ending at the newest fixture of the (chronological ASC) window. */
function currentRun(window: readonly TeamObservation[], pred: Pred): string[] {
  const ids: string[] = [];
  for (let i = window.length - 1; i >= 0; i--) {
    if (pred(window[i])) ids.unshift(window[i].fixtureId); else break;
  }
  return ids;
}
/** Longest run anywhere in the (chronological ASC) window. */
function longestRun(window: readonly TeamObservation[], pred: Pred): string[] {
  let best: string[] = []; let cur: string[] = [];
  for (const o of window) {
    if (pred(o)) { cur.push(o.fixtureId); if (cur.length > best.length) best = [...cur]; }
    else cur = [];
  }
  return best;
}
function streakPair(base: string, label: string, window: readonly TeamObservation[], pred: Pred): StreakSignal[] {
  const cur = currentRun(window, pred); const lng = longestRun(window, pred);
  return [
    { key: `current_${base}`, label: `Current ${label}`, length: cur.length, fixtureIds: cur },
    { key: `longest_${base}`, label: `Longest ${label}`, length: lng.length, fixtureIds: lng },
  ];
}

// ── predicates ──────────────────────────────────────────────────────────────────

const scored = (o: TeamObservation) => o.goalsFor >= 1;
const scoreless = (o: TeamObservation) => o.goalsFor === 0;
const conceded = (o: TeamObservation) => o.goalsAgainst >= 1;
const clean = (o: TeamObservation) => o.goalsAgainst === 0;
const totalGoals = (o: TeamObservation) => o.goalsFor + o.goalsAgainst;
const isWin = (o: TeamObservation) => o.result === 'W';
const isLoss = (o: TeamObservation) => o.result === 'L';

// ── window signal builders ────────────────────────────────────────────────────

function sumBy(w: readonly TeamObservation[], f: (o: TeamObservation) => number): number {
  return w.reduce((s, o) => s + f(o), 0);
}
function countBy(w: readonly TeamObservation[], p: Pred): number {
  return w.reduce((n, o) => n + (p(o) ? 1 : 0), 0);
}

function scoringSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const n = w.length;
  return [
    perMatchSig('goals_per_match', 'Goals per match', 'SUM(goalsFor) / n', sumBy(w, (o) => o.goalsFor), n),
    rateSig('scored_in_match_rate', 'Scored in', 'count(goalsFor≥1) / n', countBy(w, scored), n),
    rateSig('scored_2plus_rate', 'Scored 2+', 'count(goalsFor≥2) / n', countBy(w, (o) => o.goalsFor >= 2), n),
    rateSig('scored_3plus_rate', 'Scored 3+', 'count(goalsFor≥3) / n', countBy(w, (o) => o.goalsFor >= 3), n),
    rateSig('failed_to_score_rate', 'Failed to score', 'count(goalsFor=0) / n', countBy(w, scoreless), n),
  ];
}

function concedingSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const n = w.length;
  return [
    perMatchSig('goals_conceded_per_match', 'Goals conceded per match', 'SUM(goalsAgainst) / n', sumBy(w, (o) => o.goalsAgainst), n),
    rateSig('conceded_in_match_rate', 'Conceded in', 'count(goalsAgainst≥1) / n', countBy(w, conceded), n),
    rateSig('conceded_2plus_rate', 'Conceded 2+', 'count(goalsAgainst≥2) / n', countBy(w, (o) => o.goalsAgainst >= 2), n),
    rateSig('conceded_3plus_rate', 'Conceded 3+', 'count(goalsAgainst≥3) / n', countBy(w, (o) => o.goalsAgainst >= 3), n),
    rateSig('clean_sheet_rate', 'Clean sheets', 'count(goalsAgainst=0) / n', countBy(w, clean), n),
  ];
}

function totalGoalsSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const n = w.length;
  return [
    rateSig('total_goals_2plus_rate', '2+ Total Goals', 'count(gf+ga≥2) / n', countBy(w, (o) => totalGoals(o) >= 2), n),
    rateSig('total_goals_3plus_rate', '3+ Total Goals', 'count(gf+ga≥3) / n', countBy(w, (o) => totalGoals(o) >= 3), n),
    rateSig('total_goals_4plus_rate', '4+ Total Goals', 'count(gf+ga≥4) / n', countBy(w, (o) => totalGoals(o) >= 4), n),
    rateSig('total_goals_5plus_rate', '5+ Total Goals', 'count(gf+ga≥5) / n', countBy(w, (o) => totalGoals(o) >= 5), n),
    perMatchSig('average_total_goals', 'Average total goals', 'SUM(gf+ga) / n', sumBy(w, totalGoals), n),
  ];
}

function bttsSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const n = w.length;
  const btts = (o: TeamObservation) => o.goalsFor >= 1 && o.goalsAgainst >= 1;
  return [
    rateSig('btts_rate', 'Both Teams Scored', 'count(gf≥1 ∧ ga≥1) / n', countBy(w, btts), n),
    rateSig('btts_win_rate', 'BTTS + Win', 'count(BTTS ∧ W) / n', countBy(w, (o) => btts(o) && isWin(o)), n),
    rateSig('btts_draw_rate', 'BTTS + Draw', 'count(BTTS ∧ D) / n', countBy(w, (o) => btts(o) && o.result === 'D'), n),
    rateSig('btts_loss_rate', 'BTTS + Loss', 'count(BTTS ∧ L) / n', countBy(w, (o) => btts(o) && isLoss(o)), n),
  ];
}

function resultSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const n = w.length;
  return [
    rateSig('win_rate', 'Win rate', 'count(W) / n', countBy(w, isWin), n),
    rateSig('draw_rate', 'Draw rate', 'count(D) / n', countBy(w, (o) => o.result === 'D'), n),
    rateSig('loss_rate', 'Loss rate', 'count(L) / n', countBy(w, isLoss), n),
    perMatchSig('points_per_match', 'Points per match', 'SUM(points) / n', sumBy(w, (o) => o.points), n),
  ];
}

function marginSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const n = w.length;
  const wins = w.filter(isWin);
  const losses = w.filter(isLoss);
  const winMargins = wins.map((o) => o.goalMargin);
  const lossMargins = losses.map((o) => Math.abs(o.goalMargin));
  const oneNil = countBy(w, (o) => o.goalsFor === 1 && o.goalsAgainst === 0);
  const winsBy1 = countBy(wins, (o) => o.goalMargin === 1);
  const winsBy2 = countBy(wins, (o) => o.goalMargin >= 2);
  const lossBy1 = countBy(losses, (o) => o.goalMargin === -1);
  const lossBy2 = countBy(losses, (o) => o.goalMargin <= -2);
  const avg = (xs: number[]): PerformanceSignal | number | null => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgWin = winMargins.length ? winMargins.reduce((a, b) => a + b, 0) / winMargins.length : null;
  const avgLoss = lossMargins.length ? lossMargins.reduce((a, b) => a + b, 0) / lossMargins.length : null;
  return [
    countSig('one_nil_wins', '1-0 wins', 'count(gf=1 ∧ ga=0)', oneNil),
    rateSig('one_nil_win_rate', '1-0 win rate', 'count(1-0 wins) / n', oneNil, n),
    condRateSig('one_goal_win_rate', 'One-goal win rate', 'wins by 1 / total wins', winsBy1, wins.length),
    condRateSig('two_plus_goal_win_rate', '2+ goal win rate', 'wins by ≥2 / total wins', winsBy2, wins.length),
    { key: 'average_winning_margin', label: 'Average winning margin', value: avgWin === null ? null : round(avgWin), displayValue: avgWin === null ? null : fixed(round(avgWin)), formula: 'mean(goalMargin | W)', coverage: null, evidence: { numerator: null, denominator: wins.length, fixtureIds: idsOf(wins) } },
    { key: 'maximum_winning_margin', label: 'Maximum winning margin', value: winMargins.length ? Math.max(...winMargins) : null, displayValue: winMargins.length ? String(Math.max(...winMargins)) : null, formula: 'max(goalMargin | W)', coverage: null, evidence: { numerator: null, denominator: wins.length, fixtureIds: null } },
    condRateSig('one_goal_loss_rate', 'One-goal loss rate', 'losses by 1 / total losses', lossBy1, losses.length),
    condRateSig('two_plus_goal_loss_rate', '2+ goal loss rate', 'losses by ≥2 / total losses', lossBy2, losses.length),
    { key: 'average_losing_margin', label: 'Average losing margin', value: avgLoss === null ? null : round(avgLoss), displayValue: avgLoss === null ? null : fixed(round(avgLoss)), formula: 'mean(|goalMargin| | L)', coverage: null, evidence: { numerator: null, denominator: losses.length, fixtureIds: idsOf(losses) } },
    { key: 'maximum_losing_margin', label: 'Maximum losing margin', value: lossMargins.length ? Math.max(...lossMargins) : null, displayValue: lossMargins.length ? String(Math.max(...lossMargins)) : null, formula: 'max(|goalMargin| | L)', coverage: null, evidence: { numerator: null, denominator: losses.length, fixtureIds: null } },
    rateSig('positive_goal_difference_fixture_rate', 'Positive GD fixtures', 'count(goalMargin>0) / n', countBy(w, (o) => o.goalMargin > 0), n),
    rateSig('negative_goal_difference_fixture_rate', 'Negative GD fixtures', 'count(goalMargin<0) / n', countBy(w, (o) => o.goalMargin < 0), n),
    rateSig('zero_goal_difference_fixture_rate', 'Level GD fixtures', 'count(goalMargin=0) / n', countBy(w, (o) => o.goalMargin === 0), n),
  ];
}

// xG attack (common cohorts, coverage exposed)
function attackSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const hasXg = (o: TeamObservation) => o.xg !== null;
  const xgCohort = w.filter(hasXg);
  const gmxSum = sumBy(xgCohort, (o) => o.goalsFor - (o.xg as number));
  const xgSum = sumBy(xgCohort, (o) => o.xg as number);
  return [
    statSig('goals_minus_xg', 'Goals − xG', 'SUM(goalsFor − xg) over goals∩xg cohort', w, hasXg,
      xgCohort.length ? gmxSum : null, xgCohort.length ? sumBy(xgCohort, (o) => o.goalsFor) : null, xgCohort.length ? xgSum : null,
      (v) => (v >= 0 ? `+${fixed(v)}` : fixed(v))),
    statSig('goals_minus_xg_per_match', 'Goals − xG per match', 'SUM(goalsFor − xg) / cohort', w, hasXg,
      xgCohort.length ? gmxSum / xgCohort.length : null, null, xgCohort.length || null,
      (v) => (v >= 0 ? `+${fixed(v)}` : fixed(v))),
    statSig('xg_per_match', 'xG per match', 'SUM(xg) / xg cohort', w, hasXg,
      xgCohort.length ? xgSum / xgCohort.length : null, xgCohort.length ? xgSum : null, xgCohort.length || null),
  ];
}

function defensiveXgSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const hasXga = (o: TeamObservation) => o.xga !== null;
  const hasBoth = (o: TeamObservation) => o.xg !== null && o.xga !== null;
  const xgaCohort = w.filter(hasXga);
  const bothCohort = w.filter(hasBoth);
  const gmxgaSum = sumBy(xgaCohort, (o) => o.goalsAgainst - (o.xga as number));
  const xgaSum = sumBy(xgaCohort, (o) => o.xga as number);
  const diffSum = sumBy(bothCohort, (o) => (o.xg as number) - (o.xga as number));
  const signed = (v: number) => (v >= 0 ? `+${fixed(v)}` : fixed(v));
  return [
    statSig('goals_conceded_minus_xga', 'Goals conceded − xGA', 'SUM(goalsAgainst − xga) over ga∩xga cohort', w, hasXga,
      xgaCohort.length ? gmxgaSum : null, xgaCohort.length ? sumBy(xgaCohort, (o) => o.goalsAgainst) : null, xgaCohort.length ? xgaSum : null, signed),
    statSig('goals_conceded_minus_xga_per_match', 'Goals conceded − xGA per match', 'SUM(goalsAgainst − xga) / cohort', w, hasXga,
      xgaCohort.length ? gmxgaSum / xgaCohort.length : null, null, xgaCohort.length || null, signed),
    statSig('xga_per_match', 'xGA per match', 'SUM(xga) / xga cohort', w, hasXga,
      xgaCohort.length ? xgaSum / xgaCohort.length : null, xgaCohort.length ? xgaSum : null, xgaCohort.length || null),
    statSig('xg_differential', 'xG differential', 'SUM(xg − xga) over xg∩xga cohort', w, hasBoth,
      bothCohort.length ? diffSum : null, null, bothCohort.length || null, signed),
    statSig('xg_differential_per_match', 'xG differential per match', 'SUM(xg − xga) / cohort', w, hasBoth,
      bothCohort.length ? diffSum / bothCohort.length : null, null, bothCohort.length || null, signed),
  ];
}

function creationSignals(w: readonly TeamObservation[]): PerformanceSignal[] {
  const hasShots = (o: TeamObservation) => metricVal(o, K_SHOTS) !== null;
  const hasSot = (o: TeamObservation) => metricVal(o, K_SOT) !== null;
  const hasPoss = (o: TeamObservation) => metricVal(o, K_POSSESSION) !== null;
  const hasF3 = (o: TeamObservation) => metricVal(o, K_FINAL_THIRD) !== null;
  const hasXgAndShots = (o: TeamObservation) => o.xg !== null && metricVal(o, K_SHOTS) !== null;
  const hasGoalsAndSot = hasSot; // goals always present

  const shotsCohort = w.filter(hasShots);
  const sotCohort = w.filter(hasSot);
  const possCohort = w.filter(hasPoss);
  const f3Cohort = w.filter(hasF3);
  const convCohort = w.filter(hasGoalsAndSot);
  const xgShotCohort = w.filter(hasXgAndShots);

  const shotsSum = sumBy(shotsCohort, (o) => metricVal(o, K_SHOTS) as number);
  const sotSum = sumBy(sotCohort, (o) => metricVal(o, K_SOT) as number);
  const convGoals = sumBy(convCohort, (o) => o.goalsFor);
  const convSot = sumBy(convCohort, (o) => metricVal(o, K_SOT) as number);
  const xgShotXg = sumBy(xgShotCohort, (o) => o.xg as number);
  const xgShotShots = sumBy(xgShotCohort, (o) => metricVal(o, K_SHOTS) as number);
  const possMean = possCohort.length ? sumBy(possCohort, (o) => metricVal(o, K_POSSESSION) as number) / possCohort.length : null;

  return [
    statSig('shots_per_match', 'Shots per match', 'SUM(totalShotsOnGoal) / shots cohort', w, hasShots,
      shotsCohort.length ? shotsSum / shotsCohort.length : null, shotsCohort.length ? shotsSum : null, shotsCohort.length || null),
    statSig('shots_on_target_per_match', 'Shots on target per match', 'SUM(shotsOnGoal) / SoT cohort', w, hasSot,
      sotCohort.length ? sotSum / sotCohort.length : null, sotCohort.length ? sotSum : null, sotCohort.length || null),
    statSig('conversion_rate', 'Conversion rate', 'SUM(goalsFor) / SUM(shotsOnGoal), common cohort', w, hasGoalsAndSot,
      convSot > 0 ? convGoals / convSot : null, convGoals, convSot, pct),
    statSig('xg_per_shot', 'xG per shot', 'SUM(xg) / SUM(totalShotsOnGoal), common cohort', w, hasXgAndShots,
      xgShotShots > 0 ? xgShotXg / xgShotShots : null, xgShotXg, xgShotShots, (v) => fixed(v)),
    statSig('possession', 'Possession', 'MEAN(ballPossession) over present cohort', w, hasPoss,
      possMean, null, possCohort.length || null, (v) => `${round(v, 1)}%`),
    statSig('final_third_entries_per_match', 'Final-third entries per match', 'SUM(finalThirdEntries) / present cohort', w, hasF3,
      f3Cohort.length ? sumBy(f3Cohort, (o) => metricVal(o, K_FINAL_THIRD) as number) / f3Cohort.length : null,
      f3Cohort.length ? sumBy(f3Cohort, (o) => metricVal(o, K_FINAL_THIRD) as number) : null, f3Cohort.length || null),
  ];
}

function streakSignals(w: readonly TeamObservation[]): StreakSignal[] {
  return [
    ...streakPair('scoring_streak', 'scoring streak', w, scored),
    ...streakPair('scoreless_streak', 'scoreless streak', w, scoreless),
    ...streakPair('conceding_streak', 'conceding streak', w, conceded),
    ...streakPair('clean_sheet_streak', 'clean-sheet streak', w, clean),
    ...streakPair('2plus_conceded_streak', '2+ conceded streak', w, (o) => o.goalsAgainst >= 2),
    ...streakPair('btts_streak', 'BTTS streak', w, (o) => o.goalsFor >= 1 && o.goalsAgainst >= 1),
    ...streakPair('2plus_total_goal_streak', '2+ total-goal streak', w, (o) => totalGoals(o) >= 2),
    ...streakPair('3plus_total_goal_streak', '3+ total-goal streak', w, (o) => totalGoals(o) >= 3),
  ];
}

/** Build the full signal set for one window (a chronological ASC array of observations). */
export function buildWindowSignals(w: readonly TeamObservation[]): WindowSignals {
  return {
    windowSize: w.length,
    fixtureIds: idsOf(w),
    scoring: scoringSignals(w),
    conceding: concedingSignals(w),
    totalGoals: totalGoalsSignals(w),
    btts: bttsSignals(w),
    result: resultSignals(w),
    margin: marginSignals(w),
    attack: attackSignals(w),
    defensiveXg: defensiveXgSignals(w),
    creation: creationSignals(w),
    streaks: streakSignals(w),
  };
}

/** Aligned cross-window trajectory (Last5 vs Previous5) for signals Team Temporal cannot
 *  compute (common-cohort xG gaps). change = last5 − previous5 when both present. */
export function buildTrajectory(last5: readonly TeamObservation[], previous5: readonly TeamObservation[]): TrajectorySignal[] {
  const pick = (family: (w: readonly TeamObservation[]) => PerformanceSignal[], key: string, w: readonly TeamObservation[]) =>
    family(w).find((s) => s.key === key)!;
  const build = (key: string, label: string, family: (w: readonly TeamObservation[]) => PerformanceSignal[], sub: string): TrajectorySignal => {
    const l = pick(family, sub, last5); const p = pick(family, sub, previous5);
    const change = l.value !== null && p.value !== null ? round(l.value - p.value) : null;
    return { key, label, last5: l, previous5: p, change };
  };
  return [
    build('goals_minus_xg_trajectory', 'Goals − xG (Last5 vs Previous5)', attackSignals, 'goals_minus_xg_per_match'),
    build('xg_differential_trajectory', 'xG differential (Last5 vs Previous5)', defensiveXgSignals, 'xg_differential_per_match'),
  ];
}

// ── DB read ─────────────────────────────────────────────────────────────────────

/** Team Performance Signals over the canonical Team Observation series. The caller
 *  (handler) has applied the governed team exposure gate. ONE observation read; all
 *  windows (Last5/Previous5/Season + venue splits) and signals are derived in memory —
 *  no per-window query, no raw team_match_statistic access, no N+1. Returns null when
 *  the team is unknown (inherited from the Observation reader). */
export async function readTeamPerformanceSignals(
  tx: PoolClient,
  teamId: string,
  team: { id: string; name: string; slug: string },
  options: TeamPerformanceSignalsOptions = {},
): Promise<PerformanceSignalsResponse | null> {
  const asOf = options.asOf ?? new Date();
  const editionId = options.editionId ?? null;

  const obs = await readTeamObservations(tx, teamId, { asOf, editionId, order: 'asc' });
  if (obs === null) return null;
  const series = obs.observations; // chronological ASC, ALL-COMPETITIONS (or edition)

  const last5 = series.slice(Math.max(0, series.length - 5));
  const previous5 = series.slice(Math.max(0, series.length - 10), Math.max(0, series.length - 5));
  const seasonHome = series.filter((o) => o.venueSide === 'home');
  const seasonAway = series.filter((o) => o.venueSide === 'away');

  const scopeKind: 'all' | 'edition' = editionId ? 'edition' : 'all';
  return {
    team,
    scope: { competition: scopeKind, editionId, label: editionId ? `edition ${editionId}` : 'all competitions' },
    asOf: asOf.toISOString(),
    windows: {
      last5: buildWindowSignals(last5),
      previous5: buildWindowSignals(previous5),
      season: buildWindowSignals(series),
      seasonHome: buildWindowSignals(seasonHome),
      seasonAway: buildWindowSignals(seasonAway),
    },
    trajectory: buildTrajectory(last5, previous5),
    provenance: { source: 'teamObservations', readModel: TEAM_PERFORMANCE_SIGNALS_VERSION, asOf: asOf.toISOString(), scope: scopeKind, editionId },
  };
}
