/**
 * PREDICTED LINEUPS ENGINE — final assembly
 *
 * Turns a solved formation into the eleven rows that get stored: confidence,
 * depth-chart rank, captaincy. Everything here is presentation-facing state
 * derived from an already-decided XI — no selection happens at this stage.
 */

import type {
  FormationEvaluation,
  PlayerCandidate,
  PredictedLineup,
  PredictedLineupPlayer,
} from './types';
import { calculateConfidence, calculateFormationConfidence, type ConfidenceNormalizers } from './confidence';

/**
 * Captaincy thresholds. The armband correlates strongly with being an
 * undroppable starter, so the candidate must be BOTH the highest-scoring
 * player and a genuine regular — naming a brilliant recent signing with four
 * starts as captain would be a worse guess than naming the second-best player
 * who has started everything.
 */
const CAPTAIN_MIN_START_SHARE = 0.6;
const CAPTAIN_MIN_MINUTES_SHARE = 0.6;

export interface AssemblyInput {
  teamId: number;
  evaluation: FormationEvaluation;
  /** Every candidate considered, including those not selected. */
  allCandidates: PlayerCandidate[];
  /** How decisively this formation beat the runner-up, 0..1. */
  formationMargin: number;
  normalizers: ConfidenceNormalizers;
}

/**
 * Builds the final lineup.
 *
 * rank_in_position is a DEPTH-CHART rank within a position family, not a
 * render order: the two centre-backs of a back four are CB 1 and CB 2, the
 * three central midfielders of a 4-5-1 are CM 1, CM 2 and CM 3. Render order
 * lives in the slot's own `order` field. Conflating the two was one of the
 * v1 defects — the frontend could not tell "second-choice centre-back" from
 * "the centre-back drawn second".
 */
export function assembleLineup(input: AssemblyInput): PredictedLineup {
  const { teamId, evaluation, allCandidates, formationMargin, normalizers } = input;

  const selectedIds = new Set(evaluation.assignments.map((a) => a.candidate.playerId));
  const rivals = allCandidates.filter((c) => !selectedIds.has(c.playerId));

  // Depth-chart rank within each position family, strongest first. Ordered by
  // weighted score with minutes as the tie-break so the result is stable
  // across runs rather than dependent on assignment order.
  const byFamily = new Map<string, typeof evaluation.assignments>();
  for (const a of evaluation.assignments) {
    const key = a.slot.family;
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key)!.push(a);
  }
  const rankByPlayer = new Map<number, number>();
  for (const group of byFamily.values()) {
    [...group]
      .sort((a, b) =>
        b.candidate.weightedScore !== a.candidate.weightedScore
          ? b.candidate.weightedScore - a.candidate.weightedScore
          : b.candidate.minutesPlayed - a.candidate.minutesPlayed,
      )
      .forEach((a, i) => rankByPlayer.set(a.candidate.playerId, i + 1));
  }

  const players: PredictedLineupPlayer[] = evaluation.assignments.map((a) => ({
    playerId: a.candidate.playerId,
    slot: a.slot,
    candidate: a.candidate,
    suitability: a.suitability,
    confidence: calculateConfidence(a, rivals, normalizers),
    rankInPosition: rankByPlayer.get(a.candidate.playerId) ?? 1,
    isCaptain: false,
    isViceCaptain: false,
  }));

  assignCaptaincy(players, normalizers);

  return {
    teamId,
    formation: evaluation.formation,
    formationScore: round2(evaluation.totalScore),
    formationConfidence: calculateFormationConfidence(
      players.map((p) => p.confidence),
      formationMargin,
    ),
    outOfPositionCount: evaluation.outOfPositionCount,
    players,
  };
}

/**
 * Names a captain and vice-captain in place.
 *
 * Ranks the XI by weighted score, then walks down the list taking the first
 * two who clear the regular-starter thresholds. If nobody clears them — an
 * early-season squad where no one has accumulated minutes yet — the top two by
 * score take the roles, since some captain is a better prediction than none
 * and the confidence values already communicate how thin the evidence is.
 */
function assignCaptaincy(players: PredictedLineupPlayer[], norm: ConfidenceNormalizers): void {
  const ranked = [...players].sort(
    (a, b) => b.candidate.weightedScore - a.candidate.weightedScore,
  );

  const isRegular = (p: PredictedLineupPlayer): boolean =>
    p.candidate.matchesStarted / Math.max(1, norm.maxStarts) >= CAPTAIN_MIN_START_SHARE &&
    p.candidate.minutesPlayed / Math.max(1, norm.maxMinutes) >= CAPTAIN_MIN_MINUTES_SHARE;

  const qualified = ranked.filter(isRegular);
  const picks = qualified.length >= 2 ? qualified : ranked;

  if (picks[0]) picks[0].isCaptain = true;
  if (picks[1]) picks[1].isViceCaptain = true;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
