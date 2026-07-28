/**
 * PREDICTED LINEUPS ENGINE — formation evaluation and selection
 *
 * The v1 engine assumed 1-4-4-2 for every team in every league, which is the
 * single largest source of wrong lineups: a squad with four wingers and one
 * recognized centre-forward was still forced into two strikers and two wide
 * midfielders.
 *
 * Here, every formation in the catalogue is solved independently as a full
 * maximum-weight assignment against the same candidate pool, and the shape
 * that fits the available players best wins. Nothing is hardcoded and no
 * formation is privileged — a squad of centre-backs will select a back three
 * because that genuinely scores higher, not because of a bonus rule.
 *
 * SCORING
 *
 *   slot score = weightedScore × suitability²
 *
 * Squaring the suitability is what makes natural positions dominate. Under the
 * linear form a 0.70-suitability player only needs to be 43% better to displace
 * a natural fit; squared, he needs to be more than twice as good. That matches
 * how selection actually works — managers overwhelmingly field players where
 * they play, and reach for a makeshift solution only when the gap in quality is
 * large.
 */

import type {
  Formation,
  FormationEvaluation,
  PlayerCandidate,
  SlotAssignment,
} from './types';
import { FORMATIONS } from './formations';
import { FORBIDDEN, maximumWeightAssignment } from './optimizer';
import { isOutOfPosition } from './positions';

/**
 * Formations whose total score is within this fraction of the best are treated
 * as tied, and decided instead by how many players they force out of position.
 * A shape that scores 0.5% higher but needs two makeshift selections is a worse
 * prediction than the near-identical shape everybody plays in their natural
 * role.
 */
export const FORMATION_TIE_BAND = 0.02;

/**
 * Value of assigning `candidate` to the slot identified by `slotCode`.
 * Returns FORBIDDEN for a pairing the engine must never make — principally an
 * outfielder in goal, or a goalkeeper outfield.
 */
function slotScore(candidate: PlayerCandidate, slotCode: string): number {
  const suitability = candidate.positionSuitability.get(slotCode) ?? 0;
  if (suitability <= 0) return FORBIDDEN;
  return candidate.weightedScore * suitability * suitability;
}

/**
 * Solves one formation against one candidate pool.
 *
 * Returns an infeasible evaluation — never a partial XI — when the squad
 * cannot fill the shape. Writing ten players and calling it a prediction is
 * the failure mode this replaces.
 */
export function evaluateFormation(
  formation: Formation,
  candidates: PlayerCandidate[],
): FormationEvaluation {
  const empty = (reason: string): FormationEvaluation => ({
    formation,
    assignments: [],
    totalScore: 0,
    outOfPositionCount: 0,
    feasible: false,
    reason,
  });

  if (candidates.length < formation.slots.length) {
    return empty(`only ${candidates.length} available players, need ${formation.slots.length}`);
  }
  if (!candidates.some((c) => c.isGoalkeeper)) {
    return empty('no available goalkeeper');
  }

  // Rows = slots, columns = candidates. Rectangular by construction; the guard
  // above keeps rows ≤ columns, which the solver requires.
  const matrix: number[][] = formation.slots.map((s) =>
    candidates.map((c) => slotScore(c, s.code)),
  );

  const rowToCol = maximumWeightAssignment(matrix);

  const assignments: SlotAssignment[] = [];
  let totalScore = 0;
  let outOfPositionCount = 0;

  for (let i = 0; i < formation.slots.length; i++) {
    const col = rowToCol[i];
    if (col < 0) {
      // Only reachable when a slot had no legal candidate at all — in practice
      // the goalkeeper slot in a squad with no keeper, which is caught above,
      // so this is a defensive branch rather than an expected path.
      return empty(`slot ${formation.slots[i].code} had no eligible player`);
    }
    const slot = formation.slots[i];
    const candidate = candidates[col];
    const suitability = candidate.positionSuitability.get(slot.code) ?? 0;
    const score = candidate.weightedScore * suitability * suitability;

    if (isOutOfPosition(suitability)) outOfPositionCount++;
    totalScore += score;
    assignments.push({ slot, candidate, suitability, score });
  }

  return { formation, assignments, totalScore, outOfPositionCount, feasible: true };
}

export interface FormationSelection {
  best: FormationEvaluation;
  /** Every feasible evaluation, best first — useful for logging and analytics. */
  ranked: FormationEvaluation[];
  /**
   * How decisively the winner beat the next-best shape, 0..1. Near zero means
   * two formations fit this squad equally well, which legitimately lowers
   * confidence in the predicted shape.
   */
  margin: number;
}

/**
 * Evaluates every candidate formation and picks the best fit.
 *
 * Selection rule, in order:
 *   1. Highest total score.
 *   2. Among formations within FORMATION_TIE_BAND of the leader, the one
 *      needing the fewest out-of-position players.
 *   3. Catalogue order, so the result is deterministic for a genuinely tied
 *      squad rather than dependent on object iteration order.
 *
 * Returns null when no formation is feasible — the caller logs and skips the
 * team rather than writing a short lineup.
 */
export function selectBestFormation(
  candidates: PlayerCandidate[],
  formations: Formation[] = FORMATIONS,
): FormationSelection | null {
  const catalogueIndex = new Map(formations.map((f, i) => [f.name, i]));

  const feasible = formations
    .map((f) => evaluateFormation(f, candidates))
    .filter((e) => e.feasible);

  if (feasible.length === 0) return null;

  const ranked = [...feasible].sort((a, b) => b.totalScore - a.totalScore);
  const leader = ranked[0];

  const contenders = ranked.filter(
    (e) => e.totalScore >= leader.totalScore * (1 - FORMATION_TIE_BAND),
  );

  const best = contenders.reduce((chosen, e) => {
    if (e.outOfPositionCount !== chosen.outOfPositionCount) {
      return e.outOfPositionCount < chosen.outOfPositionCount ? e : chosen;
    }
    if (e.totalScore !== chosen.totalScore) {
      return e.totalScore > chosen.totalScore ? e : chosen;
    }
    const ei = catalogueIndex.get(e.formation.name) ?? Number.MAX_SAFE_INTEGER;
    const ci = catalogueIndex.get(chosen.formation.name) ?? Number.MAX_SAFE_INTEGER;
    return ei < ci ? e : chosen;
  }, contenders[0]);

  const runnerUp = ranked.find((e) => e.formation.name !== best.formation.name);
  const margin =
    runnerUp && best.totalScore > 0
      ? Math.max(0, Math.min(1, (best.totalScore - runnerUp.totalScore) / best.totalScore))
      : 1;

  return { best, ranked, margin };
}
